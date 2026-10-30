// Fix plan P62: how many requests the Worker sends per call, on SupabaseStore over a real Postgres
// with every migration (test/pglite-supabase.ts), Dropbox faked. Cloudflare counts each one (50 per
// call on the free plan) and each database call is a round trip for a couple waiting for a photo.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import { SupabaseStore } from '../worker/store-supabase';
import type { Env } from '../worker/types';
import { fakeEnv } from './fake-kv';
import { buildDb, supabaseFetchFor } from './pglite-supabase';
import { DATES_BATCH } from '../shared/photosets';

const BASE = 'http://supabase.calls.test';
const T = '00000000-0000-4000-8000-0000000062a1';
const USER = '00000000-0000-4000-8000-0000000062b1';
const G = '6262626262626201';
const PRINT = 'print-6262-6262-6262-6262';
const OWNER = { Authorization: 'Bearer session-of-the-owner' };
const key = (i: number) => `62${i.toString(16).padStart(6, '0')}`;
const PHOTOS = Array.from({ length: 40 }, (_, i) => ({ key: key(i), name: `IMG_${i}.jpg`, ref: `p:/wedding/img_${i}.jpg` }));

let db: PGlite;
let rest: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
/** Every request the Worker sent to the outside ("host/path"), in order. */
let sent: string[] = [];
const edgeCache = new Map<string, Response>();

/** The start of a JPEG (no capture time in it). */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array<number>(508).fill(7)]);
/** P64: every photo costs the most requests its cloud can make it cost (busy, an expired address). */
let worst = false;
/** Dropbox paths answered with a web page / an error instead of the file. */
const notAPicture = new Set<string>();
const tooMany = new Set<string>();
const firstTry = new Set<string>();
const pcloudAddresses = new Map<string, number>();

async function outside(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const u = new URL(input instanceof Request ? input.url : String(input));
  sent.push(`${u.host}${u.pathname}`);
  if (u.origin === BASE) {
    if (u.pathname === '/auth/v1/user') return Response.json({ id: USER });
    return rest(input, init);
  }
  if (u.href === 'https://api.dropboxapi.com/oauth2/token') return Response.json({ access_token: 'dropbox-access', expires_in: 14_400 });
  const range = new Headers(init?.headers).get('Range');
  // A range (the start of an original, for its capture time) answers 206, a preview 200.
  if (u.host === 'content.dropboxapi.com') {
    const arg = new Headers(init?.headers).get('Dropbox-API-Arg') ?? '';
    const path = (JSON.parse(arg || '{}') as { path?: string }).path ?? '';
    if (notAPicture.has(path)) return new Response('<!doctype html><title>Sign in</title>', { headers: { 'Content-Type': 'text/html' } });
    if (tooMany.has(path)) return new Response('{"error_summary":"too_many_write_operations/"}', { status: 409, headers: { 'Content-Type': 'application/json' } });
    if (worst && !firstTry.has(arg)) {
      firstTry.add(arg);
      return new Response('busy', { status: 429, headers: { 'Retry-After': '0' } });
    }
    return new Response(JPEG, { status: range ? 206 : 200, headers: { 'Content-Type': 'image/jpeg' } });
  }
  // pCloud: the file's address, then the file. Worst case: the first address has already expired.
  if (u.host === 'api.pcloud.com' && u.pathname === '/getpublinkdownload') {
    const id = u.searchParams.get('fileid')!;
    const n = (pcloudAddresses.get(id) ?? 0) + 1;
    pcloudAddresses.set(id, n);
    return Response.json({ result: 0, hosts: ['files.pcloud.test'], path: `/${id}/${n}` });
  }
  if (u.host === 'files.pcloud.test') {
    if (worst && u.pathname.endsWith('/1')) return new Response('gone', { status: 410 });
    return new Response(JPEG, { status: range ? 206 : 200, headers: { 'Content-Type': 'application/octet-stream' } });
  }
  throw new Error(`unexpected request: ${u.href}`);
}

const env = {
  ...fakeEnv(),
  SUPABASE_URL: BASE,
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
  FILMS_STATE_SECRET: 'p62-state-secret',
  DROPBOX_APP_KEY: 'app-key',
  DROPBOX_APP_SECRET: 'app-secret',
  ASSETS: { fetch: async () => new Response('<!doctype html><title>x</title>', { headers: { 'Content-Type': 'text/html' } }) },
} as unknown as Env;

const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  worker.fetch(new Request(`https://films.test${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env);

/** The requests one call sends: all of them, and those to the database. */
async function counted(fn: () => Promise<Response>) {
  sent = [];
  const res = await fn();
  await res.clone().arrayBuffer();
  return { res, all: sent.length, db: sent.filter((s) => s.startsWith(new URL(BASE).host)).length, sent: [...sent] };
}

const sql = (text: string, params: unknown[] = []) => db.query(text, params);
const photoList = (items: object[], cover?: string) => JSON.stringify({ folderUrl: 'https://www.dropbox.com/scl/fo/p62/x', provider: 'dropbox', sets: [], items, ...(cover ? { cover } : {}) });

beforeAll(async () => {
  db = await buildDb();
  rest = supabaseFetchFor(db, BASE);
  await sql(`insert into tenants (id, name, slug) values ($1, 'P62 Studio', 'p62-studio')`, [T]);
  await sql(`insert into auth.users (id) values ($1)`, [USER]);
  await sql(`insert into profiles (id, tenant_id, role) values ($1, $2, 'owner')`, [USER, T]);
  await sql(`insert into tenant_secrets (tenant_id, key, value) values ($1, 'dropbox_refresh_token', 'refresh-62')`, [T]);
  await sql(`insert into films_studio_settings (tenant_id, headline) values ($1, 'first headline')`, [T]);
  await sql(`insert into films_galleries (id, tenant_id, couple_name, expires_at, kind, cover_key, print_token) values ($1, $2, 'Couple 62', now() + interval '30 days', 'photos', $3, $4)`, [G, T, key(0), PRINT]);
  await sql(`insert into films_photos (gallery_id, tenant_id, data) values ($1, $2, $3)`, [G, T, photoList(PHOTOS)]);
  const album = { size: '30x30', status: 'submitted', updatedAt: '2026-09-30T10:00:00.000Z', spreads: [{ id: 's1', template: 't', fills: [{ photo: key(1) }, { photo: key(2) }] }] };
  await sql(`insert into films_albums (gallery_id, tenant_id, data, status) values ($1, $2, $3, 'submitted')`, [G, T, JSON.stringify(album)]);
  vi.stubGlobal('fetch', outside);
  vi.stubGlobal('caches', {
    default: {
      match: async (req: Request) => edgeCache.get(req.url)?.clone(),
      put: async (req: Request, res: Response) => void edgeCache.set(req.url, new Response(await res.arrayBuffer(), res)),
    },
  });
}, 120_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await db?.close();
});

beforeEach(() => {
  sent = [];
});

describe('a photo on the couple\'s page', () => {
  it('a preview already at the edge costs at most 3 database calls (was 12), and none to Dropbox', async () => {
    const first = await counted(() => call('GET', `/api/photos/${G}/${key(3)}?s=m`));
    expect(first.res.status).toBe(200);
    expect(first.sent.some((s) => s.startsWith('content.dropboxapi.com'))).toBe(true);
    const again = await counted(() => call('GET', `/api/photos/${G}/${key(3)}?s=m`));
    expect(again.res.status).toBe(200);
    expect(again.db, again.sent.join('\n')).toBeLessThanOrEqual(3);
    expect(again.all, 'nothing but the database').toBe(again.db);
  });

  it('a photo hidden after it was cached never comes out of the cache', async () => {
    expect((await call('GET', `/api/photos/${G}/${key(4)}?s=m`)).status).toBe(200);
    const hidden = PHOTOS.map((p, i) => (i === 4 ? { ...p, hidden: true } : p));
    await sql(`update films_photos set data = $2 where gallery_id = $1`, [G, photoList(hidden)]);
    try {
      expect((await call('GET', `/api/photos/${G}/${key(4)}?s=m`)).status).toBe(404);
      expect((await call('GET', `/api/photos/${G}/${key(5)}?s=m`)).status).toBe(200);
    } finally {
      await sql(`update films_photos set data = $2 where gallery_id = $1`, [G, photoList(PHOTOS)]);
    }
  });
});

describe("the studio's galleries list", () => {
  it('60 photo galleries: their pictures come from cover_key, no photo list is read', async () => {
    for (let i = 0; i < 60; i++) {
      const id = `62a0000000000${i.toString(16).padStart(3, '0')}`;
      // Every tenth gallery shows no photo (all hidden): no cover saved.
      const items = [{ key: key(100 + i), name: 'a.jpg', ref: `p:/a${i}.jpg`, ...(i % 10 === 0 ? { hidden: true } : {}) }];
      await sql(`insert into films_galleries (id, tenant_id, couple_name, expires_at, kind, cover_key, created_at) values ($1, $2, $3, now() + interval '9 days', 'photos', $4, now() - interval '1 hour')`, [id, T, `Couple ${i}`, i % 10 === 0 ? null : key(100 + i)]);
      await sql(`insert into films_photos (gallery_id, tenant_id, data) values ($1, $2, $3)`, [id, T, photoList(items)]);
    }
    const r = await counted(() => call('GET', '/api/admin/galleries', undefined, OWNER));
    expect(r.res.status).toBe(200);
    const list = (await r.res.json()) as { id: string; thumb: string }[];
    expect(list.length).toBe(61);
    expect(r.sent.filter((s) => s.includes('/films_photos')), 'photo lists read').toEqual([]);
    expect(list.find((g) => g.id === '62a0000000000001')?.thumb).toMatch(new RegExp(`^/api/photos/62a0000000000001/v0/${key(101)}\\?s=m&pt=`));
    expect(list.find((g) => g.id === '62a0000000000000')?.thumb).toBe('');
    expect(r.db, r.sent.join('\n')).toBeLessThanOrEqual(5);
  });
});

describe('reading capture times (photos/dates)', () => {
  const PCLOUD_G = '6262626262626202';
  const PCLOUD_PHOTOS = Array.from({ length: 12 }, (_, i) => ({ key: `63${i.toString(16).padStart(6, '0')}`, name: `P_${i}.jpg`, ref: `c:${7_000_000 + i}` }));

  beforeAll(async () => {
    await sql(`insert into films_galleries (id, tenant_id, couple_name, expires_at, kind) values ($1, $2, 'Couple 62 pCloud', now() + interval '30 days', 'photos')`, [PCLOUD_G, T]);
    const list = { folderUrl: 'https://u.pcloud.link/publink/show?code=XZp62photos0001', provider: 'pcloud', sets: [], items: PCLOUD_PHOTOS };
    await sql(`insert into films_photos (gallery_id, tenant_id, data) values ($1, $2, $3)`, [PCLOUD_G, T, JSON.stringify(list)]);
  });

  const read = (gallery: string, keys: string[]) => counted(() => call('POST', `/api/admin/galleries/${gallery}/photos/dates`, { keys }, OWNER));
  type Answer = { dates: Record<string, number | null>; labels: Record<string, string>; failed: string[]; skipped: string[]; batch: number };

  it('40 Dropbox photos asked for: 20 read, the rest `skipped` (not failed, no date, no label)', async () => {
    const keys = PHOTOS.map((p) => p.key);
    const r = await read(G, keys);
    expect(r.res.status).toBe(200);
    expect(r.all, r.sent.join('\n')).toBeLessThanOrEqual(50);
    const body = (await r.res.json()) as Answer;
    expect(Object.keys(body.dates).sort()).toEqual(keys.slice(0, 20).sort());
    expect(Object.keys(body.labels).sort()).toEqual(keys.slice(0, 20).sort());
    expect(body.failed).toEqual([]);
    expect(body.skipped).toEqual(keys.slice(20));
    expect(body.batch).toBe(20);
    expect(r.sent.filter((s) => s.startsWith('content.dropboxapi.com')).length).toBe(20);
  });

  it('a photo the cloud did not send (a web page, an error) is `failed`: no date and no empty label; a JPEG without a time is read (null)', async () => {
    notAPicture.add('/wedding/img_3.jpg');
    tooMany.add('/wedding/img_4.jpg');
    try {
      const keys = PHOTOS.slice(0, 6).map((p) => p.key);
      const r = await read(G, keys);
      expect(r.res.status).toBe(200);
      const body = (await r.res.json()) as Answer;
      expect(body.failed.sort()).toEqual([key(3), key(4)]);
      expect(key(3) in body.dates || key(3) in body.labels).toBe(false);
      expect(key(4) in body.dates || key(4) in body.labels).toBe(false);
      expect(body.dates[key(0)]).toBeNull();
      expect(body.labels[key(0)]).toBe('');
      expect(body.skipped).toEqual([]);
    } finally {
      notAPicture.clear();
      tooMany.clear();
    }
  });

  it('worst case, Dropbox busy on every photo (each asked twice): still at most 50 requests; P62\'s 30 would pass 50', async () => {
    worst = true;
    try {
      const r = await read(G, PHOTOS.map((p) => p.key));
      expect(r.res.status).toBe(200);
      const cloud = r.sent.filter((s) => s.startsWith('content.dropboxapi.com')).length;
      expect(cloud).toBe(2 * DATES_BATCH.dropbox);
      expect(r.all, r.sent.join('\n')).toBeLessThanOrEqual(50);
      const own = r.all - cloud;
      expect(own + 2 * 30, 'the call\'s own requests + 30 photos × 2').toBeGreaterThan(50);
    } finally {
      worst = false;
    }
  });

  it('worst case, pCloud (every first address expired: 4 requests a photo): at most 50; P62\'s 12 would pass 50', async () => {
    worst = true;
    try {
      const r = await read(PCLOUD_G, PCLOUD_PHOTOS.map((p) => p.key));
      expect(r.res.status).toBe(200);
      const body = (await r.res.json()) as Answer;
      expect(body.batch).toBe(DATES_BATCH.pcloud);
      expect(Object.keys(body.dates)).toHaveLength(DATES_BATCH.pcloud);
      const cloud = r.sent.filter((s) => s.includes('pcloud')).length;
      expect(cloud).toBe(4 * DATES_BATCH.pcloud);
      expect(r.all, r.sent.join('\n')).toBeLessThanOrEqual(50);
      expect(r.all - cloud + 4 * 12, 'the call\'s own requests + 12 photos × 4').toBeGreaterThan(50);
    } finally {
      worst = false;
    }
  });
});

describe('the print shop', () => {
  it('album and photo list are kept a minute; the link itself is checked on every request', async () => {
    const one = await counted(() => call('GET', `/api/print/${PRINT}/photo/${key(1)}?s=l`));
    expect(one.res.status).toBe(200);
    const two = await counted(() => call('GET', `/api/print/${PRINT}/photo/${key(2)}?s=l`));
    expect(two.res.status).toBe(200);
    expect(two.sent.filter((s) => /films_albums|films_photos/.test(s)), 'no album or list read again').toEqual([]);
    expect(two.sent.filter((s) => s.includes('/films_galleries')).length, 'the link is checked').toBe(1);
    expect((await call('GET', `/api/print/${PRINT}/photo/${key(9)}?s=l`)).status, 'not in the album').toBe(404);
    await sql(`update films_galleries set print_token = null where id = $1`, [G]);
    try {
      expect((await call('GET', `/api/print/${PRINT}/photo/${key(1)}?s=l`)).status, 'a cancelled link stops at once').toBe(404);
    } finally {
      await sql(`update films_galleries set print_token = $2 where id = $1`, [G, PRINT]);
    }
  });
});

describe('settings read once per request, never stale', () => {
  it('saved films settings answer at once, and a disconnected Dropbox shows as disconnected in the same answer', async () => {
    const put = (await (await call('PUT', '/api/admin/settings', { headline: 'new headline' }, OWNER)).json()) as { headline: string; dropbox: { connected: boolean } };
    expect(put.headline).toBe('new headline');
    expect(put.dropbox.connected).toBe(true);
    const read = (await (await call('GET', '/api/admin/settings', undefined, OWNER)).json()) as { headline: string };
    expect(read.headline).toBe('new headline');
    const off = (await (await call('POST', '/api/admin/dropbox/disconnect', {}, OWNER)).json()) as { dropbox: { connected: boolean } };
    expect(off.dropbox.connected).toBe(false);
    await sql(`insert into tenant_secrets (tenant_id, key, value) values ($1, 'dropbox_refresh_token', 'refresh-62')`, [T]);
  });

  it('in one request: the studio, its settings and its secret are read once; a copy each time; a write or a failure forgets them', async () => {
    const store = new SupabaseStore(BASE, 'service-role-test-key');
    sent = [];
    const [a, b] = await Promise.all([store.getTenant(T), store.getTenant(T)]);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ id: T, name: 'P62 Studio', access: 'ok', films: true, photos: true });
    const f1 = await store.getFilmsStudio(T);
    f1.headline = 'changed by a route';
    expect((await store.getFilmsStudio(T)).headline, 'a copy: an edit never reaches the next read').not.toBe('changed by a route');
    await store.getSecret(T, 'dropbox_refresh_token');
    await store.getSecret(T, 'dropbox_refresh_token');
    expect(sent.length, sent.join('\n')).toBe(3);

    await store.patchFilmsStudio(T, { headline: 'patched' });
    expect((await store.getFilmsStudio(T)).headline).toBe('patched');
    await store.setSecret(T, 'dropbox_refresh_token', 'refresh-63');
    expect(await store.getSecret(T, 'dropbox_refresh_token')).toBe('refresh-63');
    await store.setSlug(T, 'p62-renamed');
    expect((await store.getTenant(T))?.slug).toBe('p62-renamed');

    // A failed read is not kept: the next one asks again.
    const real = rest;
    rest = async () => new Response('down', { status: 503 });
    const fresh = new SupabaseStore(BASE, 'service-role-test-key');
    await expect(fresh.getTenant(T)).rejects.toThrow();
    rest = real;
    expect((await fresh.getTenant(T))?.slug).toBe('p62-renamed');
    await store.setSlug(T, 'p62-studio');
    await store.setSecret(T, 'dropbox_refresh_token', 'refresh-62');
  });
});
