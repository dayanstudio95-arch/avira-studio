// Fix plan P70: the studio's galleries screens on SupabaseStore over a real Postgres with every migration
// (test/pglite-supabase.ts: at most 1,000 rows per read, like Supabase), behind a fetch that fails from the
// 51st request of a call (Cloudflare's limit on the free plan). "Extend 50" sent about 100 requests; a list
// import one per line; the galleries list, the summary and the link picker read one request of 1,000 rows.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/types';
import { fakeEnv } from './fake-kv';
import { buildDb, supabaseFetchFor } from './pglite-supabase';

const BASE = 'http://supabase.batch.test';
const T = '00000000-0000-4000-8000-0000000070b1';
const USER = '00000000-0000-4000-8000-0000000070b2';
const OWNER = { Authorization: 'Bearer session-of-the-owner' };

let db: PGlite;
let rest: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
/** The requests of the current call ("path METHOD"). */
let sent: string[] = [];
/** Face files in the private bucket, by gallery. */
const faceFiles = new Map<string, string[]>();
const sql = (text: string, params: unknown[] = []) => db.query(text, params);

async function limited(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const u = new URL(input instanceof Request ? input.url : String(input));
  sent.push(`${u.pathname} ${init?.method ?? 'GET'}`);
  if (sent.length > 50) throw new Error('Too many subrequests.');
  if (u.origin !== BASE) throw new Error(`unexpected request: ${u.href}`);
  if (u.pathname === '/auth/v1/user') return Response.json({ id: USER });
  if (u.pathname === '/storage/v1/object/list/films-faces') {
    const { prefix } = JSON.parse(String(init?.body)) as { prefix: string };
    return Response.json((faceFiles.get(prefix) ?? []).map((name) => ({ name })));
  }
  if (u.pathname === '/storage/v1/object/films-faces' && init?.method === 'DELETE') {
    const { prefixes } = JSON.parse(String(init.body)) as { prefixes: string[] };
    for (const p of prefixes) faceFiles.delete(p.split('/')[0]);
    return Response.json([]);
  }
  return rest(input, init);
}

const env = { ...fakeEnv(), SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key', FILMS_STATE_SECRET: 'p70-state-secret' } as unknown as Env;

/** One call to the Worker; `sent` holds its requests afterwards. */
async function call(method: string, path: string, body?: unknown) {
  sent = [];
  const res = await worker.fetch(new Request(`https://films.test${path}`, { method, headers: { 'Content-Type': 'application/json', ...OWNER }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null, text, requests: [...sent] };
}

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i.toString(16).padStart(16 - prefix.length, '0')}`);
const expiresOf = async (list: string[]) =>
  Object.fromEntries((await sql(`select id, expires_at from films_galleries where id = any($1)`, [list])).rows.map((r) => [(r as { id: string }).id, new Date((r as { expires_at: string }).expires_at).toISOString()]));

beforeAll(async () => {
  db = await buildDb();
  rest = supabaseFetchFor(db, BASE);
  await sql(`insert into tenants (id, name, slug) values ($1, 'P70 Batch Studio', 'p70-batch')`, [T]);
  await sql(`insert into auth.users (id) values ($1)`, [USER]);
  await sql(`insert into profiles (id, tenant_id, role) values ($1, $2, 'owner')`, [USER, T]);
  vi.stubGlobal('fetch', limited);
}, 120_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await db?.close();
});

describe('extending 50 galleries', () => {
  const list = ids('e1', 50);

  beforeAll(async () => {
    await sql(`insert into films_galleries (id, tenant_id, couple_name, expires_at, created_at, days, kind)
      select x, $2, 'Extend ' || x, now() + interval '2 days', now() - interval '10 days', 12, 'films' from unnest($1::text[]) x`, [list, T]);
  });

  it('is one database call for all 50, and the same request sent again extends nothing', async () => {
    const before = await expiresOf(list);
    const seen = Object.fromEntries(list.map((id) => [id, before[id]]));
    const r = await call('POST', '/api/admin/galleries/batch', { action: 'extend', ids: list, days: 30, seen });
    expect(r.status, r.text).toBe(200);
    expect(r.json).toMatchObject({ done: 50, skipped: [], remaining: [] });
    expect(r.requests.filter((x) => x.includes('films_galleries_extend'))).toHaveLength(1);
    expect(r.requests.length).toBeLessThanOrEqual(6);
    const after = await expiresOf(list);
    for (const id of list) {
      // 32 days from now, to 23:59:59 Israel time of that day.
      expect(Date.parse(after[id]) - Date.parse(before[id])).toBeGreaterThan(29 * 86_400_000);
      expect(new Date(after[id]).toLocaleTimeString('en-GB', { timeZone: 'Asia/Jerusalem' })).toBe('23:59:59');
    }
    // The dialog's second click (or another tab): the closing times it saw are gone.
    const again = await call('POST', '/api/admin/galleries/batch', { action: 'extend', ids: list, days: 30, seen });
    expect(again.json).toMatchObject({ done: 0 });
    expect(again.json.skipped).toHaveLength(50);
    expect(again.json.skipped[0]).toEqual({ id: list[0], reason: 'changed' });
    expect(await expiresOf(list)).toEqual(after);
  });

  it('one gallery from its own button: also only while the closing time is the one the screen saw', async () => {
    const [id] = list;
    const seen = (await expiresOf([id]))[id];
    const r = await call('POST', `/api/admin/galleries/${id}/extend`, { days: 5, expiresAt: seen });
    expect(r.status).toBe(200);
    expect(Date.parse(r.json.expiresAt)).toBeGreaterThan(Date.parse(seen));
    const again = await call('POST', `/api/admin/galleries/${id}/extend`, { days: 5, expiresAt: seen });
    expect(again.status).toBe(409);
  });
});

describe('closing, the trash and removing for good', () => {
  const films = ids('c1', 44);
  const photos = ids('c2', 6);
  const withFaces = ids('c3', 10);

  beforeAll(async () => {
    await sql(`insert into films_galleries (id, tenant_id, couple_name, expires_at, kind)
      select x, $2, 'Batch ' || x, now() + interval '20 days', 'films' from unnest($1::text[]) x`, [films, T]);
    await sql(`insert into films_galleries (id, tenant_id, couple_name, expires_at, kind)
      select x, $2, 'Photos ' || x, now() + interval '20 days', 'photos' from unnest($1::text[]) x`, [[...photos, ...withFaces], T]);
    await sql(`insert into films_photos (gallery_id, tenant_id, data) select x, $2, '{"items":[],"sets":[],"faceSearch":true}'::jsonb from unnest($1::text[]) x`, [withFaces, T]);
    await sql(`insert into films_faces (gallery_id, tenant_id, files, photos, faces) select x, $2, array[x || '/a.bin'], 3, 5 from unnest($1::text[]) x`, [withFaces, T]);
    for (const id of withFaces) faceFiles.set(id, ['a.bin']);
    // Linked pairs: a film gallery and a photo gallery of the same couple.
    await sql(`update films_galleries set linked_id = $2 where id = $1`, [films[0], photos[0]]);
    await sql(`update films_galleries set linked_id = $1 where id = $2`, [films[0], photos[0]]);
  });

  it('close 50 (44 films, 6 photos without face data): one read, one write', async () => {
    const r = await call('POST', '/api/admin/galleries/batch', { action: 'close', ids: [...films, ...photos] });
    expect(r.status, r.text).toBe(200);
    expect(r.json).toMatchObject({ done: 50, skipped: [], remaining: [] });
    expect(r.requests.filter((x) => x.startsWith('/rest/v1/films_galleries PATCH'))).toHaveLength(1);
    expect(r.requests.length).toBeLessThanOrEqual(8);
    const open = await sql(`select count(*)::int as n from films_galleries where id = any($1) and expires_at > now()`, [[...films, ...photos]]);
    expect((open.rows[0] as { n: number }).n).toBe(0);
  });

  it('to the trash: face data first, 6 galleries per request, the rest come back as `remaining`', async () => {
    const first = await call('POST', '/api/admin/galleries/batch', { action: 'trash', ids: [...films, ...photos, ...withFaces].slice(0, 50) });
    expect(first.status, first.text).toBe(200);
    // 44 films + 6 photo galleries without face data: all in one write.
    expect(first.json).toMatchObject({ done: 50, remaining: [] });

    const second = await call('POST', '/api/admin/galleries/batch', { action: 'trash', ids: withFaces });
    expect(second.status, second.text).toBe(200);
    expect(second.json.done).toBe(6);
    expect(second.json.remaining).toEqual(withFaces.slice(6));
    expect(second.requests.length).toBeLessThanOrEqual(50);
    const third = await call('POST', '/api/admin/galleries/batch', { action: 'trash', ids: second.json.remaining });
    expect(third.json).toMatchObject({ done: 4, remaining: [] });
    // Face data gone, face search off, every gallery in the trash.
    expect((await sql(`select count(*)::int as n from films_faces where gallery_id = any($1)`, [withFaces])).rows[0]).toEqual({ n: 0 });
    expect([...faceFiles.keys()].filter((k) => withFaces.includes(k))).toEqual([]);
    expect((await sql(`select count(*)::int as n from films_photos where gallery_id = any($1) and data->>'faceSearch' = 'true'`, [withFaces])).rows[0]).toEqual({ n: 0 });
    expect((await sql(`select count(*)::int as n from films_galleries where id = any($1) and deleted_at is null`, [[...films, ...photos, ...withFaces]])).rows[0]).toEqual({ n: 0 });
  });

  it('a failure while deleting face data is said, and that gallery stays as it was', async () => {
    const [bad] = ids('c4', 1);
    await sql(`insert into films_galleries (id, tenant_id, couple_name, expires_at, kind) values ($1, $2, 'Faces fail', now() + interval '5 days', 'photos')`, [bad, T]);
    await sql(`insert into films_faces (gallery_id, tenant_id) values ($1, $2)`, [bad, T]);
    faceFiles.set(bad, ['x.bin']);
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => (String(input).includes('/storage/') && init?.method === 'DELETE' ? Promise.resolve(new Response('down', { status: 503 })) : realFetch(input, init)));
    try {
      const r = await call('POST', '/api/admin/galleries/batch', { action: 'trash', ids: [bad] });
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ done: 0, skipped: [{ id: bad, reason: 'faces_failed' }] });
    } finally {
      vi.stubGlobal('fetch', realFetch);
    }
    expect((await sql(`select deleted_at from films_galleries where id = $1`, [bad])).rows[0]).toEqual({ deleted_at: null });
  });

  it('restore and remove 50 for good: one write each; a linked gallery forgets the link by itself', async () => {
    const back = await call('POST', '/api/admin/galleries/batch', { action: 'restore', ids: films.slice(0, 5) });
    expect(back.json).toMatchObject({ done: 5 });
    const purge = await call('POST', '/api/admin/galleries/batch', { action: 'purge', ids: [...films, ...photos] });
    expect(purge.status, purge.text).toBe(200);
    // The 5 restored are not in the trash: skipped, never removed.
    expect(purge.json.done).toBe(45);
    expect(purge.json.skipped).toEqual(films.slice(0, 5).map((id) => ({ id, reason: 'not_in_trash' })));
    expect(purge.requests.filter((x) => x.startsWith('/rest/v1/films_galleries DELETE'))).toHaveLength(1);
    expect(purge.requests.length).toBeLessThanOrEqual(8);
    // photos[0] was linked with films[0], which stays: its link is cleared by the foreign key.
    expect((await sql(`select linked_id from films_galleries where id = $1`, [films[0]])).rows[0]).toEqual({ linked_id: null });
  });

  it('another studio\'s gallery and a bad id are skipped, never touched', async () => {
    const OTHER = '00000000-0000-4000-8000-0000000070b9';
    const [theirs] = ids('c5', 1);
    await sql(`insert into tenants (id, name) values ($1, 'Other')`, [OTHER]);
    await sql(`insert into films_galleries (id, tenant_id, couple_name, expires_at) values ($1, $2, 'Theirs', now() + interval '5 days')`, [theirs, OTHER]);
    const r = await call('POST', '/api/admin/galleries/batch', { action: 'trash', ids: [theirs, 'not-an-id'] });
    expect(r.json).toMatchObject({ done: 0, skipped: [{ id: theirs, reason: 'not_found' }, { id: 'not-an-id', reason: 'not_found' }] });
    expect((await sql(`select deleted_at from films_galleries where id = $1`, [theirs])).rows[0]).toEqual({ deleted_at: null });
  });
});

describe('a list import', () => {
  it('100 lines are one write; a bad line saves nothing', async () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ coupleName: `Import ${i} & ${i}`, date: '2026-10-01', venue: 'Hall' }));
    const r = await call('POST', '/api/admin/galleries/bulk', { items, kind: 'films' });
    expect(r.status, r.text).toBe(200);
    expect(r.json).toHaveLength(100);
    expect(r.requests.filter((x) => x.startsWith('/rest/v1/films_galleries POST'))).toHaveLength(1);
    expect(r.requests.length).toBeLessThanOrEqual(8);
    const before = (await sql(`select count(*)::int as n from films_galleries where tenant_id = $1`, [T])).rows[0];
    const bad = await call('POST', '/api/admin/galleries/bulk', { items: [...items.slice(0, 56), { coupleName: 'Bad & Date', date: '2026-13-45' }, ...items.slice(56, 99)], kind: 'films' });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toContain('בשורה 57');
    expect((await sql(`select count(*)::int as n from films_galleries where tenant_id = $1`, [T])).rows[0]).toEqual(before);
  });
});

describe('the galleries list, the summary and the link picker with 1,200 galleries', () => {
  beforeAll(async () => {
    await sql(`insert into films_galleries (id, tenant_id, couple_name, expires_at, kind, created_at, views, password, download_pin)
      select 'd1' || lpad(to_hex(i), 14, '0'), $1, 'Many ' || i, now() + (i % 40) * interval '1 day' + interval '1 hour', case when i % 3 = 0 then 'photos' else 'films' end,
             now() - interval '1 year' + i * interval '1 minute', i % 17, 'secret-' || i, 'pin-' || i
        from generate_series(0, 1199) i`, [T]);
  });

  it('without paging every gallery comes back, in a few requests, with no secret and no photo list read', async () => {
    const r = await call('GET', '/api/admin/galleries');
    expect(r.status, r.text.slice(0, 200)).toBe(200);
    const total = (await sql(`select count(*)::int as n from films_galleries where tenant_id = $1`, [T])).rows[0] as { n: number };
    expect(r.json.length).toBe(total.n);
    expect(total.n).toBeGreaterThan(1200);
    expect(r.text).not.toContain('secret-');
    expect(r.text).not.toContain('pin-');
    expect(r.requests.filter((x) => x.includes('films_photos'))).toEqual([]);
    expect(r.requests.length).toBeLessThanOrEqual(6);
  });

  it('a page of 500 and the total', async () => {
    const r = await call('GET', '/api/admin/galleries?limit=500&offset=1000');
    const total = ((await sql(`select count(*)::int as n from films_galleries where tenant_id = $1`, [T])).rows[0] as { n: number }).n;
    expect(r.json.total).toBe(total);
    expect(r.json.items).toHaveLength(Math.min(500, total - 1000));
  });

  it('the summary is one database call and counts every gallery', async () => {
    const r = await call('GET', '/api/admin/dashboard');
    expect(r.status).toBe(200);
    expect(r.requests.filter((x) => x.includes('films_dashboard'))).toHaveLength(1);
    const open = ((await sql(`select count(*)::int as n from films_galleries where tenant_id = $1 and deleted_at is null and expires_at > now()`, [T])).rows[0] as { n: number }).n;
    expect(r.json.open).toBe(open);
    expect(r.json.open).toBeGreaterThan(1000);
    expect(r.json.closing).toHaveLength(12);
    expect(r.json.mostViewed.map((g: { views: number }) => g.views)).toEqual([16, 16, 16, 16, 16]);
    expect(r.json.closing[0]).toHaveProperty('expiresAt');
  });

  it('the link picker reads every gallery in a few fields', async () => {
    const r = await call('GET', '/api/admin/galleries/options');
    const total = ((await sql(`select count(*)::int as n from films_galleries where tenant_id = $1`, [T])).rows[0] as { n: number }).n;
    expect(r.json).toHaveLength(total);
    expect(r.text).not.toContain('secret-');
  });
});

describe('hearts: 500 at once', () => {
  const G = '7070707070b0f001';
  const keys = Array.from({ length: 500 }, (_, i) => (0x70000 + i).toString(16).padStart(8, '0'));

  beforeAll(async () => {
    await sql(`insert into films_galleries (id, tenant_id, couple_name, expires_at, kind) values ($1, $2, 'Hearts 70', now() + interval '30 days', 'photos')`, [G, T]);
    const items = keys.map((key, i) => ({ key, name: `IMG_${i}.jpg`, ref: `p:/w/${i}.jpg`, ...(i === 7 ? { hidden: true } : {}) }));
    await sql(`insert into films_photos (gallery_id, tenant_id, data) values ($1, $2, $3)`, [G, T, JSON.stringify({ folderUrl: 'https://www.dropbox.com/scl/fo/p70/x', provider: 'dropbox', sets: [], items })]);
  });

  it('the couple hearts 500 photos: one write, and the answer counts only photos they can see', async () => {
    sent = [];
    const res = await worker.fetch(new Request(`https://films.test/api/watch/${G}/fav`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys, on: true, who: 'מאי' }) }), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { favorites: string[] };
    expect(body.favorites).toHaveLength(499);
    expect(sent.filter((x) => x.startsWith('/rest/v1/films_hearts POST'))).toHaveLength(1);
    expect(sent.length).toBeLessThanOrEqual(10);
  });
});
