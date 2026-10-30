// Fix plan P61: a photo gallery's list stays one JSON document (decision D16(1)), but the photo route reads one
// photo (films_photo_item, 0131) only when the preview is not at the edge, the edge cache is keyed by the
// gallery's visible version, and a studio edit writes only what changed (films_photos_patch). On SupabaseStore
// over a real Postgres with every migration (test/pglite-supabase.ts), the clouds and the edge cache faked.
// Fix plan P66 (at the end): what the cloud sends is kept only when it is a picture, the cache key and every
// photo address follow the gallery's generation (a new link or file), the cache is written after the photo went
// out, a photo Dropbox has no preview of is a 415, and a cover is kept at the edge.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import { previewToken } from '../worker/access';
import { applyPhotoDiff, applyPhotoEdits, buildPhotoData, diffPhotoData, forgetPhotoDocs, MAX_PHOTOS, mergePhotoData, nextGen, photoDoc, sortByTime } from '../worker/photos';
import { detectLink } from '../shared/providers';
import type { Store } from '../worker/store';
import type { Env, Gallery, PhotoData, PhotoItem } from '../worker/types';
import { HttpError } from '../worker/types';
import { fakeEnv } from './fake-kv';
import { buildDb, supabaseFetchFor } from './pglite-supabase';

const BASE = 'http://supabase.p61.test';
const SECRET = 'p61-state-secret';
const T = '00000000-0000-4000-8000-0000000061a1';
const USER = '00000000-0000-4000-8000-0000000061b1';
const G = '6161616161616101';
const LOCKED = '6161616161616102';
const BIG = '6161616161616103';
const PCLOUD = '6161616161616104';
const OWNER = { Authorization: 'Bearer session-of-the-owner' };
const key = (i: number) => `61${i.toString(16).padStart(6, '0')}`;
const shot = (i: number, more: Partial<PhotoItem> = {}): PhotoItem => ({ key: key(i), name: `IMG_${String(i).padStart(5, '0')}.jpg`, ref: `p:/wedding/img_${i}.jpg`, ...more });
const PHOTOS = Array.from({ length: 20 }, (_, i) => shot(i));

let db: PGlite;
let rest: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
/** Every request the Worker sent to the outside: "METHOD host/path" and its body. */
let sent: { what: string; body: string }[] = [];
const edgeCache = new Map<string, Response>();
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array<number>(252).fill(7)]);
/** P66: a test's own answer from a cloud (undefined = the usual picture). */
let cloudAnswer: ((u: URL, init?: RequestInit) => Response | undefined) | null = null;
/** P66: shared Dropbox folders (someone else's account) by their canonical link: the files each lists. */
const sharedFolders = new Map<string, { '.tag': 'file'; name: string; size?: number; rev?: string; content_hash?: string }[]>();
/** P66: while set, every edge-cache write waits for it. */
let holdPuts: Promise<void> | null = null;

async function outside(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const u = new URL(input instanceof Request ? input.url : String(input));
  sent.push({ what: `${(init?.method ?? 'GET').toUpperCase()} ${u.host}${u.pathname}`, body: typeof init?.body === 'string' ? init.body : '' });
  if (u.origin === BASE) {
    if (u.pathname === '/auth/v1/user') return Response.json({ id: USER });
    // Face data files (Supabase Storage): none are left in these tests.
    if (u.pathname === '/storage/v1/object/list/films-faces') return Response.json([]);
    return rest(input, init);
  }
  const custom = cloudAnswer?.(u, init);
  if (custom) return custom;
  if (u.href === 'https://api.dropboxapi.com/oauth2/token') return Response.json({ access_token: 'dropbox-access', expires_in: 14_400 });
  if (u.host === 'api.dropboxapi.com') {
    let arg: { shared_link?: { url: string } } | null = null;
    try {
      arg = JSON.parse(String(init?.body ?? 'null'));
    } catch {
      arg = null;
    }
    if (u.pathname === '/2/users/get_current_account') return Response.json({ name: { display_name: 'P66' }, root_info: { root_namespace_id: '1', home_namespace_id: '1' } });
    // Not in the studio's account: read through the shared link.
    if (u.pathname === '/2/sharing/get_shared_link_metadata') return Response.json({ '.tag': 'folder', name: 'shared' });
    if (u.pathname === '/2/files/list_folder') return Response.json({ entries: sharedFolders.get(arg?.shared_link?.url ?? '') ?? [], cursor: 'c', has_more: false });
  }
  if (u.host === 'content.dropboxapi.com' || u.pathname === '/getpubthumb') return new Response(JPEG, { headers: { 'Content-Type': 'image/jpeg' } });
  throw new Error(`unexpected request: ${u.href}`);
}

const env = {
  ...fakeEnv(),
  SUPABASE_URL: BASE,
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
  FILMS_STATE_SECRET: SECRET,
  DROPBOX_APP_KEY: 'app-key',
  DROPBOX_APP_SECRET: 'app-secret',
  ASSETS: { fetch: async () => new Response('<!doctype html><title>x</title>', { headers: { 'Content-Type': 'text/html' } }) },
} as unknown as Env;

const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  worker.fetch(new Request(`https://films.test${path}`, { method, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '6.1.0.1', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env);

async function counted(fn: () => Promise<Response>) {
  sent = [];
  const res = await fn();
  await res.clone().arrayBuffer();
  const db = sent.filter((s) => s.what.includes(new URL(BASE).host));
  return { res, db: db.length, sent: [...sent], photoReads: db.filter((s) => /films_photo_item|films_photos/.test(s.what)).length, cloud: sent.length - db.length };
}

const sql = <R = Record<string, unknown>>(text: string, params: unknown[] = []) => db.query<R>(text, params);
const list = (items: PhotoItem[], more: object = {}) => JSON.stringify({ folderUrl: 'https://www.dropbox.com/scl/fo/p61/x', provider: 'dropbox', sets: [], items, ...more });
const photo = (gallery: string, k: string, q = 's=m', headers: Record<string, string> = {}) => call('GET', `/api/photos/${gallery}/${k}?${q}`, undefined, headers);
const asStudio = async (gallery: string) => `pt=${encodeURIComponent(await previewToken(SECRET, { galleryId: gallery, tenantId: T, userId: 'owner', version: 0 }))}`;
const hide = (gallery: string, k: string, hidden: boolean) => call('PUT', `/api/admin/galleries/${gallery}/photos`, { items: { [k]: { hidden } } }, OWNER);
const visible = async (gallery: string) => Number((await sql<{ v: number }>(`select photos_visible_version as v from films_galleries where id = $1`, [gallery])).rows[0].v);

beforeAll(async () => {
  db = await buildDb();
  rest = supabaseFetchFor(db, BASE);
  await sql(`insert into tenants (id, name, slug) values ($1, 'P61 Studio', 'p61-studio')`, [T]);
  await sql(`insert into auth.users (id) values ($1)`, [USER]);
  await sql(`insert into profiles (id, tenant_id, role) values ($1, $2, 'owner')`, [USER, T]);
  await sql(`insert into tenant_secrets (tenant_id, key, value) values ($1, 'dropbox_refresh_token', 'refresh-61')`, [T]);
  for (const [id, name, password] of [[G, 'Couple 61', null], [LOCKED, 'Locked 61', 'סוד'], [BIG, 'Big 61', null], [PCLOUD, 'pCloud 61', null]]) {
    await sql(`insert into films_galleries (id, tenant_id, couple_name, expires_at, kind, password) values ($1, $2, $3, now() + interval '30 days', 'photos', $4)`, [id, T, name, password]);
  }
  await sql(`insert into films_photos (gallery_id, tenant_id, data) values ($1, $2, $3), ($4, $2, $3)`, [G, T, list(PHOTOS), LOCKED]);
  const pcloud = { folderUrl: 'https://u.pcloud.link/publink/show?code=XZp61photos0001', provider: 'pcloud', sets: [], items: [{ key: key(900), name: 'P.jpg', ref: 'c:7000001' }] };
  await sql(`insert into films_photos (gallery_id, tenant_id, data) values ($1, $2, $3)`, [PCLOUD, T, JSON.stringify(pcloud)]);
  vi.stubGlobal('fetch', outside);
  vi.stubGlobal('caches', {
    default: {
      match: async (req: Request) => edgeCache.get(req.url)?.clone(),
      put: async (req: Request, res: Response) => {
        if (holdPuts) await holdPuts;
        edgeCache.set(req.url, new Response(await res.arrayBuffer(), res));
      },
      delete: async (req: Request) => edgeCache.delete(req.url),
    },
  });
}, 120_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await db?.close();
});

beforeEach(() => {
  sent = [];
  cloudAnswer = null;
  holdPuts = null;
});

describe('a photo from the edge cache', () => {
  it('the second request for the same photo reads nothing of the photo list: the gallery and the studio only', async () => {
    const first = await counted(() => photo(G, key(3)));
    expect(first.res.status).toBe(200);
    expect(first.sent.filter((s) => s.what.includes('films_photo_item')).length, 'one photo read, not the list').toBe(1);
    expect(first.sent.filter((s) => /\/films_photos\b/.test(s.what)), 'the whole list is never read').toEqual([]);
    const again = await counted(() => photo(G, key(3)));
    expect(again.res.status).toBe(200);
    expect(again.photoReads, again.sent.map((s) => s.what).join('\n')).toBe(0);
    expect(again.db, 'the gallery row and the studio: access is still checked').toBe(2);
    expect(again.cloud).toBe(0);
  });

  it('a Drive or pCloud photo reads no studio settings (only Dropbox needs them)', async () => {
    const r = await counted(() => photo(PCLOUD, key(900)));
    expect(r.res.status).toBe(200);
    expect(r.sent.filter((s) => /films_studio_settings|tenant_secrets/.test(s.what)).map((s) => s.what)).toEqual([]);
  });
});

describe('hidden photos never come out of the cache', () => {
  it('after hiding, and after the studio looked at the hidden photo, the public link answers 404', async () => {
    const before = await visible(G);
    expect((await photo(G, key(5))).status).toBe(200);
    expect((await hide(G, key(5), true)).status).toBe(200);
    expect(await visible(G), 'hiding raises the visible version').toBeGreaterThan(before);
    expect((await photo(G, key(5))).status).toBe(404);
    // The studio's own screen shows the hidden photo...
    expect((await photo(G, key(5), await asStudio(G))).status).toBe(200);
    expect((await photo(G, key(5), `s=md&${await asStudio(G)}`)).status).toBe(200);
    // ...and the public still gets nothing, from the cache or elsewhere.
    expect((await photo(G, key(5))).status).toBe(404);
    expect((await photo(G, key(5), 's=md')).status).toBe(404);
    // Shown again: the public sees it again.
    expect((await hide(G, key(5), false)).status).toBe(200);
    expect((await photo(G, key(5))).status).toBe(200);
  });

  it('a photo hidden before anyone saw it, opened first by the studio, is never public', async () => {
    expect((await hide(G, key(6), true)).status).toBe(200);
    expect((await photo(G, key(6), await asStudio(G))).status).toBe(200);
    expect((await photo(G, key(6), `s=l&${await asStudio(G)}`)).status).toBe(200);
    expect((await photo(G, key(6))).status).toBe(404);
    expect((await photo(G, key(6), 's=l')).status).toBe(404);
    expect([...edgeCache.keys()].some((k) => k.includes(`/${key(6)}/`)), 'the hidden photo was never put at the edge').toBe(false);
  });

  it('a list written whole (a folder load, SQL, an older Worker) raises the visible version too', async () => {
    expect((await photo(G, key(7))).status).toBe(200);
    const hidden = PHOTOS.map((p, i) => (i === 7 ? { ...p, hidden: true } : p));
    await sql(`update films_photos set data = $2 where gallery_id = $1`, [G, list(hidden)]);
    try {
      expect((await photo(G, key(7))).status).toBe(404);
      expect((await photo(G, key(8))).status).toBe(200);
    } finally {
      await sql(`update films_photos set data = $2 where gallery_id = $1`, [G, list(PHOTOS)]);
    }
  });
});

describe('access is checked before the cache', () => {
  it('a gallery behind a password is never served from the cache without it', async () => {
    const unlock = await call('POST', `/api/watch/${LOCKED}/unlock`, { code: 'סוד' });
    expect(unlock.status).toBe(200);
    const cookie = (unlock.headers.get('Set-Cookie') ?? '').split(';')[0];
    expect((await photo(LOCKED, key(2), 's=m', { Cookie: cookie })).status).toBe(200);
    expect(edgeCache.size).toBeGreaterThan(0);
    const without = await photo(LOCKED, key(2));
    expect(without.status).toBe(401);
    expect(without.headers.get('Content-Type')).toContain('application/json');
  });

  // Avira: no subscriptions, so no suspended studio (Studio Plan also checks that here).
  it('the trash and a closed gallery stop a cached photo at once', async () => {
    expect((await photo(G, key(9))).status).toBe(200);
    await sql(`update films_galleries set deleted_at = now() where id = $1`, [G]);
    expect((await photo(G, key(9))).status).toBe(404);
    await sql(`update films_galleries set deleted_at = null, expires_at = now() - interval '1 day' where id = $1`, [G]);
    expect((await photo(G, key(9))).status).toBe(410);
    await sql(`update films_galleries set expires_at = now() + interval '30 days' where id = $1`, [G]);
    expect((await photo(G, key(9))).status).toBe(200);
  });
});

describe('an edit writes only what changed', () => {
  it('hiding one photo of 5,000 sends less than 4KB and never the whole list', async () => {
    const items = Array.from({ length: 5000 }, (_, i) => shot(1000 + i, { ar: 1.5, t: 1_780_000_000_000 + i * 1000 }));
    await sql(`insert into films_photos (gallery_id, tenant_id, data) values ($1, $2, $3)`, [BIG, T, list(items, { timesV: 2 })]);
    const target = key(1000 + 2345);
    const r = await counted(() => hide(BIG, target, true));
    expect(r.res.status).toBe(200);
    const patch = r.sent.filter((s) => s.what.includes('/rpc/films_photos_patch'));
    expect(patch.length).toBe(1);
    expect(patch[0].body.length, patch[0].body.slice(0, 300)).toBeLessThan(4096);
    expect(r.sent.filter((s) => /^(PATCH|POST) .*\/films_photos\b/.test(s.what)).map((s) => s.what), 'no whole-list write').toEqual([]);
    const row = (await sql<{ data: PhotoData; photo_count: number }>(`select p.data, g.photo_count from films_photos p join films_galleries g on g.id = p.gallery_id where p.gallery_id = $1`, [BIG])).rows[0];
    expect(row.data.items.length).toBe(5000);
    expect(row.data.items.filter((i) => i.hidden).map((i) => i.key)).toEqual([target]);
    expect(row.data.items.map((i) => i.key)).toEqual(items.map((i) => i.key));
    expect(row.photo_count).toBe(4999);
  });

  it('an edit keeps what was saved meanwhile: the list this Worker holds is used only for its own version', async () => {
    forgetPhotoDocs();
    // This Worker holds the list at its version; someone else saves meanwhile.
    expect((await call('GET', `/api/admin/galleries/${G}/photos`, undefined, OWNER)).status).toBe(200);
    await sql(`update films_photos set data = jsonb_set(data, '{cover}', to_jsonb($2::text)) where gallery_id = $1`, [G, key(11)]);
    expect((await hide(G, key(12), true)).status).toBe(200);
    const data = (await sql<{ data: PhotoData }>(`select data from films_photos where gallery_id = $1`, [G])).rows[0].data;
    expect(data.cover).toBe(key(11));
    expect(data.items.find((i) => i.key === key(12))?.hidden).toBe(true);
    await hide(G, key(12), false);
  });
});

describe('the list itself', () => {
  it(`a folder of more than ${MAX_PHOTOS.toLocaleString('en-US')} photos is refused with a clear message`, () => {
    const found = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `IMG_${i}.jpg`, folder: '', ref: `p:/x/${i}.jpg` }));
    expect(buildPhotoData('u', 'dropbox', found(MAX_PHOTOS)).items).toHaveLength(MAX_PHOTOS);
    try {
      buildPhotoData('u', 'dropbox', found(MAX_PHOTOS + 1));
      throw new Error('not refused');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).status).toBe(400);
      expect((e as HttpError).message).toContain('20,001');
      expect((e as HttpError).message).toContain('20,000');
    }
  });

  it('before + diffPhotoData(before, after) = after, for every kind of edit', () => {
    const base: PhotoData = { folderUrl: 'u', provider: 'mock', sets: [{ id: 's1', name: 'א' }], items: sortByTime(Array.from({ length: 30 }, (_, i) => shot(i, i % 2 ? { t: 1_780_000_000_000 + (30 - i) * 1000 } : {}))), cover: key(0) };
    const edits = [
      { items: { [key(3)]: { hidden: true } } },
      { items: { [key(4)]: { set: 's1', ar: 1.25, label: 'red' } } },
      { items: { [key(5)]: { t: 1_790_000_000_000 } } },
      { items: { [key(7)]: { t: null } } },
      { timeOrder: false },
      { sets: [{ id: 's2', name: 'ב' }] },
      { cover: key(9), coverPos: { x: 10, y: 90 }, faceSearch: true, timesV: 2 },
      { design: { grid: 'masonry' } },
    ];
    for (const edit of edits) {
      const after = applyPhotoEdits(base, edit as never);
      const diff = diffPhotoData(base, after)!;
      expect(diff, JSON.stringify(edit)).not.toBeNull();
      expect(applyPhotoDiff(base, diff), JSON.stringify(edit)).toEqual(JSON.parse(JSON.stringify(after)));
    }
    const hideOne = diffPhotoData(base, applyPhotoEdits(base, { items: { [key(3)]: { hidden: true } } }))!;
    expect([Object.keys(hideOne.items), hideOne.order, hideOne.fields]).toEqual([[key(3)], null, {}]);
    expect(diffPhotoData(base, base)).toEqual({ items: {}, order: null, fields: {} });
    // A list where two photos share a key (from before P64), or another field: saved whole.
    const shared = { ...base, items: [...base.items, { ...base.items[0], ref: 'p:/other.jpg' }] };
    expect(diffPhotoData(shared, applyPhotoEdits(shared, { items: { [key(3)]: { hidden: true } } }))).toBeNull();
    expect(diffPhotoData(base, { ...base, folderUrl: 'other' })).toBeNull();
    expect(() => applyPhotoDiff(base, { items: { ffffffff: shot(99) }, order: null, fields: {} })).toThrow();
  });

  it('photoDoc: one parse per version, a newer version read again, at most 4 lists, never changed by a caller', async () => {
    forgetPhotoDocs();
    let reads = 0;
    const lists = new Map<string, { data: PhotoData; version: number }>();
    const store = { getPhotosVersioned: async (id: string) => (reads++, structuredClone(lists.get(id) ?? null)) } as unknown as Store;
    const g = (id: string, v: number) => ({ id, photosVersion: v }) as Gallery;
    for (let i = 0; i < 5; i++) lists.set(`g${i}`, { data: { folderUrl: '', provider: 'mock', sets: [], items: [shot(i)] }, version: 1 });
    await photoDoc(store, g('g0', 1));
    await photoDoc(store, g('g0', 1));
    expect(reads).toBe(1);
    lists.set('g0', { ...lists.get('g0')!, version: 2 });
    expect((await photoDoc(store, g('g0', 2)))?.version).toBe(2);
    expect(reads).toBe(2);
    const doc = (await photoDoc(store, g('g0', 2)))!;
    expect(() => {
      (doc.data.items[0] as { hidden?: boolean }).hidden = true;
    }).toThrow();
    for (let i = 1; i < 5; i++) await photoDoc(store, g(`g${i}`, 1));
    reads = 0;
    await photoDoc(store, g('g0', 2));
    expect(reads, 'the oldest of five was let go').toBe(1);
  });
});

// ---------- fix plan P66 ----------

const LOADG = '6161616161616105';
const COVERG = '6161616161616106';
const LINK_A = 'https://www.dropbox.com/scl/fo/p66aaaa/folderA?rlkey=keya';
const LINK_B = 'https://www.dropbox.com/scl/fo/p66bbbb/folderB?rlkey=keyb';
const canonical = (url: string) => detectLink(url)!.canonical;
type Loaded = PhotoData & { warnings?: string[]; needsConfirm?: boolean };
const load = async (gallery: string, url: string) => {
  const res = await call('POST', `/api/admin/galleries/${gallery}/photos/load`, { url, confirm: true }, OWNER);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as Loaded;
};
const byName = (d: PhotoData, name: string) => d.items.find((i) => i.name === name)!;
const galleryRow = async (id: string) => (await sql<{ gen: string; visible: string }>(`select photos_gen::text as gen, photos_visible_version::text as visible from films_galleries where id = $1`, [id])).rows[0];
const at = (gallery: string, gen: number | undefined, k: string, q = 's=m') => call('GET', `/api/photos/${gallery}/v${gen ?? 0}/${k}?${q}`);
const cachedFor = (gallery: string, k: string) => [...edgeCache.keys()].filter((u) => u.includes(`/${gallery}/${k}/`));

describe('P66: what the cloud sends is kept only when it is a picture', () => {
  it('a sign-in page or a JSON error with status 200 is a 502 that nobody keeps, and is never put at the edge', async () => {
    const k = key(13);
    for (const [body, type] of [['<!doctype html><title>Sign in</title>', 'text/html; charset=utf-8'], ['{"error": "quota"}', 'application/json']]) {
      cloudAnswer = (u) => (u.host === 'content.dropboxapi.com' ? new Response(body, { headers: { 'Content-Type': type } }) : undefined);
      const res = await photo(G, k);
      expect(res.status, type).toBe(502);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(await res.text()).not.toContain(body);
      expect(cachedFor(G, k), `${type} was put at the edge`).toEqual([]);
    }
    cloudAnswer = null;
    expect((await photo(G, k)).status).toBe(200);
    expect(cachedFor(G, k).length).toBe(1);
  });
});

describe('P66: the generation — a new link or a new file is a new address and a new cache key', () => {
  beforeAll(async () => {
    await sql(`insert into films_galleries (id, tenant_id, couple_name, expires_at, kind) values ($1, $2, 'Load 66', now() + interval '30 days', 'photos')`, [LOADG, T]);
    sharedFolders.set(canonical(LINK_A), [
      { '.tag': 'file', name: 'IMG_1.jpg', size: 4_000_000, rev: 'r1', content_hash: 'h1' },
      { '.tag': 'file', name: 'IMG_2.jpg', size: 4_000_000, rev: 'r2', content_hash: 'h2' },
      { '.tag': 'file', name: 'IMG_3.HEIC', size: 3_000_000, rev: 'r3', content_hash: 'h3' },
      { '.tag': 'file', name: 'BIG.jpg', size: 25_000_000, rev: 'r4', content_hash: 'h4' },
    ]);
    // Another couple's folder, with the same file names (the same `l:` refs under another link).
    sharedFolders.set(canonical(LINK_B), [
      { '.tag': 'file', name: 'IMG_1.jpg', size: 5_000_000, rev: 'b1', content_hash: 'bh1' },
      { '.tag': 'file', name: 'IMG_2.jpg', size: 5_000_000, rev: 'b2', content_hash: 'bh2' },
    ]);
  });

  it('a load keeps each file\'s version; Dropbox photos without a preview (HEIC, over 20MB) come back as a warning', async () => {
    const d = await load(LOADG, LINK_A);
    expect(d.items.every((i) => /^[0-9a-f]{8}$/.test(i.v ?? '')), JSON.stringify(d.items)).toBe(true);
    expect(d.gen).toBeGreaterThan(1.7e9);
    expect(Number((await galleryRow(LOADG)).gen), 'the row carries the list\'s generation (0132)').toBe(d.gen);
    expect(d.warnings?.join(' ')).toMatch(/^2 קבצים/);
    expect(d.warnings?.join(' ')).toContain('IMG_3.HEIC');
    expect(d.warnings?.join(' ')).toContain('BIG.jpg');
  });

  it('a HEIC in Dropbox answers 415 (no preview), which nobody keeps', async () => {
    const d = (await (await call('GET', `/api/admin/galleries/${LOADG}/photos`, undefined, OWNER)).json()) as PhotoData;
    const heic = byName(d, 'IMG_3.HEIC');
    cloudAnswer = (u, init) => {
      const arg = String((init?.headers as Record<string, string> | undefined)?.['Dropbox-API-Arg'] ?? '');
      if (u.pathname === '/2/files/get_thumbnail_v2' && arg.includes('IMG_3.HEIC')) return Response.json({ error_summary: 'unsupported_extension/..', error: { '.tag': 'unsupported_extension' } }, { status: 409 });
      return undefined;
    };
    const res = await at(LOADG, d.gen, heic.key);
    expect(res.status).toBe(415);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.text()).toContain('HEIC');
    expect(cachedFor(LOADG, heic.key)).toEqual([]);
    expect((await at(LOADG, d.gen, byName(d, 'IMG_1.jpg').key)).status, 'the other photos are served').toBe(200);
  });

  it('the couple\'s addresses carry the generation: a year for the current one, a day for any other, the same picture', async () => {
    const d = (await load(LOADG, LINK_A)) as Loaded;
    const k = byName(d, 'IMG_2.jpg').key;
    const watch = (await (await call('GET', `/api/watch/${LOADG}`)).json()) as { photos: { base: string } };
    expect(watch.photos.base).toBe(`/api/photos/${LOADG}/v${d.gen}`);
    const now = await at(LOADG, d.gen, k);
    expect(now.status).toBe(200);
    expect(now.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    for (const other of [await photo(LOADG, k), await at(LOADG, d.gen! - 1, k), await call('GET', `/api/photos/${LOADG}/v${d.gen}/${k}?s=m`)]) expect(other.status).toBe(200);
    expect((await photo(LOADG, k)).headers.get('Cache-Control'), 'an address without the generation (shared before): a day').toBe('public, max-age=86400');
    expect((await at(LOADG, d.gen! - 1, k)).headers.get('Cache-Control'), 'an older generation: a day').toBe('public, max-age=86400');
    expect((await call('GET', `/api/photos/${LOADG}/x12/${k}?s=m`)).status, 'not an address of ours').toBe(404);
  });

  it('loading the same files again keeps the generation; a changed file raises it, is fetched again, and is measured again', async () => {
    const before = await load(LOADG, LINK_A);
    const again = await load(LOADG, LINK_A);
    expect(again.gen, 'nothing changed: the same addresses').toBe(before.gen);
    const [one, two] = [byName(again, 'IMG_1.jpg'), byName(again, 'IMG_2.jpg')];
    expect((await call('PUT', `/api/admin/galleries/${LOADG}/photos`, { items: { [one.key]: { ar: 1.25, t: 1_790_000_000_000, label: 'red' }, [two.key]: { ar: 0.8, set: 's2' } } }, OWNER)).status).toBe(200);
    expect((await at(LOADG, again.gen, one.key)).status).toBe(200);
    const oldKeys = cachedFor(LOADG, one.key);
    expect(oldKeys.some((u) => u.endsWith(`/g${again.gen}`)), oldKeys.join('\n')).toBe(true);
    // The photographer exported IMG_1 again: another revision and content.
    sharedFolders.get(canonical(LINK_A))![0] = { '.tag': 'file', name: 'IMG_1.jpg', size: 4_100_000, rev: 'r1b', content_hash: 'h1b' };
    const changed = await load(LOADG, LINK_A);
    expect(changed.gen).toBeGreaterThan(again.gen!);
    expect(Number((await galleryRow(LOADG)).gen)).toBe(changed.gen);
    const [one2, two2] = [byName(changed, 'IMG_1.jpg'), byName(changed, 'IMG_2.jpg')];
    expect(one2.key, 'the same photo: its hearts stay').toBe(one.key);
    expect([one2.ar, one2.t, one2.label], 'a new file: shape, time and label are read again').toEqual([undefined, undefined, undefined]);
    expect([two2.ar, two2.set], 'an unchanged file keeps them').toEqual([0.8, 's2']);
    const r = await counted(() => at(LOADG, changed.gen, one.key));
    expect(r.res.status).toBe(200);
    expect(r.cloud, 'the new file comes from the cloud, not the old copy at the edge').toBeGreaterThan(0);
    expect(cachedFor(LOADG, one.key).filter((u) => !oldKeys.includes(u)), 'under a new key').toEqual([expect.stringMatching(new RegExp(`/g${changed.gen}$`))]);
  });

  it('another couple\'s folder under a new shared link inherits nothing: no key, hidden, set, cover or face search; face data goes', async () => {
    const d = await load(LOADG, LINK_A);
    const one = byName(d, 'IMG_1.jpg');
    expect((await call('PUT', `/api/admin/galleries/${LOADG}/photos`, { items: { [one.key]: { hidden: true, set: 's1' } }, cover: byName(d, 'IMG_2.jpg').key, faceSearch: true }, OWNER)).status).toBe(200);
    const b = await load(LOADG, LINK_B);
    expect(b.gen).toBeGreaterThan(d.gen!);
    const oldKeys = new Set(d.items.map((i) => i.key));
    expect(b.items.map((i) => i.key).filter((k) => oldKeys.has(k)), 'no key of the old list is given again').toEqual([]);
    expect(b.items.some((i) => i.hidden || i.set || i.label !== undefined)).toBe(false);
    expect(b.cover).toBe(b.items[0].key);
    expect(b.faceSearch).toBeFalsy();
    expect(sent.some((x) => x.what.includes('/rpc/films_faces_forget')), 'the old photos\' face data is deleted (store.deleteFaces)').toBe(true);
    // Back to the first link (a different link again): the Dropbox refs are the same paths, and still nothing carries over.
    expect((await load(LOADG, LINK_A)).items.map((i) => i.key).filter((k) => b.items.some((x) => x.key === k))).toEqual([]);
  });

  it('nextGen and mergePhotoData on their own', () => {
    const base: PhotoData = { folderUrl: 'https://a', provider: 'dropbox-link', sets: [], items: [shot(1, { ref: 'l:/1.jpg', v: 'aaaaaaaa' }), shot(2, { ref: 'l:/2.jpg', v: 'bbbbbbbb' })], gen: 5 };
    expect(nextGen(base, structuredClone(base))).toBe(5);
    expect(nextGen(base, { ...base, items: [...base.items].reverse() }), 'the order is not the file').toBe(5);
    expect(nextGen(base, { ...base, folderUrl: 'https://b' })).toBeGreaterThan(1.7e9);
    expect(nextGen(base, { ...base, items: [base.items[0], { ...base.items[1], v: 'cccccccc' }] })).toBeGreaterThan(1.7e9);
    expect(nextGen(base, { ...base, items: [base.items[0]] }), 'a photo removed').toBeGreaterThan(1.7e9);
    expect(nextGen(null, base), 'the first load').toBeGreaterThan(1.7e9);
    // A saved list from before P66 (no versions): matching photos keep shape and time.
    const old: PhotoData = { ...base, items: base.items.map(({ v: _v, ...i }) => ({ ...i, ar: 1.5, t: 1_790_000_000_000 })) };
    expect(mergePhotoData(base, old).items.map((i) => i.ar)).toEqual([1.5, 1.5]);
    // Under another link, the own-account photos (ids) still match; shared-link photos don't.
    const own: PhotoData = { ...base, provider: 'dropbox', folderUrl: 'https://b', items: [shot(1, { ref: 'p:id:1' })] };
    expect(mergePhotoData(own, { ...own, folderUrl: 'https://a', items: [shot(1, { ref: 'p:id:1', hidden: true })] }).items[0].hidden).toBe(true);
  });
});

describe('P66: the photo goes out before the edge copy is written', () => {
  it('with waitUntil the answer does not wait for the cache; the write is handed to waitUntil', async () => {
    let release!: () => void;
    holdPuts = new Promise<void>((r) => (release = r));
    const handed: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void handed.push(p), passThroughOnException() {} } as unknown as ExecutionContext;
    const k = key(15);
    const res = await Promise.race([
      worker.fetch(new Request(`https://films.test/api/photos/${G}/${k}?s=m`, { headers: { 'CF-Connecting-IP': '6.1.0.1' } }), env, ctx),
      new Promise<'waited'>((r) => setTimeout(() => r('waited'), 2000)),
    ]);
    expect(res, 'the answer waited for the cache write').not.toBe('waited');
    expect((res as Response).status).toBe(200);
    expect(new Uint8Array(await (res as Response).arrayBuffer())).toEqual(JPEG);
    expect(handed.length).toBe(1);
    expect(cachedFor(G, k)).toEqual([]);
    release();
    await Promise.all(handed);
    expect(cachedFor(G, k).length).toBe(1);
  });
});

describe('P66: a cover is kept at the edge', () => {
  beforeAll(async () => {
    await sql(`insert into films_galleries (id, tenant_id, couple_name, expires_at, kind) values ($1, $2, 'Cover 66', now() + interval '30 days', 'films')`, [COVERG, T]);
  });
  const upload = (bytes: Uint8Array<ArrayBuffer>) =>
    worker.fetch(new Request(`https://films.test/api/admin/galleries/${COVERG}/cover`, { method: 'POST', headers: { ...OWNER, 'Content-Type': 'image/jpeg' }, body: bytes }), env);

  it('over 2MB is refused; a cover is read from KV once in 10 minutes, a new cover is a new copy, and the trash forgets it', async () => {
    expect((await upload(new Uint8Array(2 * 1024 * 1024 + 1).fill(1))).status).toBe(400);
    expect((await upload(JPEG)).status).toBe(200);
    const reads = vi.spyOn(env.KV, 'getWithMetadata');
    try {
      for (let i = 0; i < 3; i++) {
        const res = await call('GET', `/api/cover/${COVERG}`);
        expect(res.status).toBe(200);
        expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG);
      }
      expect(reads, 'KV once, then the edge').toHaveBeenCalledTimes(1);
      const second = new Uint8Array([...JPEG].reverse());
      expect((await upload(second)).status).toBe(200);
      expect(new Uint8Array(await (await call('GET', `/api/cover/${COVERG}`)).arrayBuffer()), 'the new cover at once').toEqual(second);
      expect([...edgeCache.keys()].filter((u) => u.includes(`cover-cache.internal/${COVERG}/`)).length, 'the old copy was forgotten').toBe(1);
      expect((await call('DELETE', `/api/admin/galleries/${COVERG}`, undefined, OWNER)).status).toBe(200);
      expect([...edgeCache.keys()].filter((u) => u.includes(`cover-cache.internal/${COVERG}/`)), 'the trash forgets it').toEqual([]);
      expect((await call('GET', `/api/cover/${COVERG}`)).status).toBe(404);
    } finally {
      reads.mockRestore();
    }
  });
});
