// The nightly link check (fix plan P65, decision D15(4)): it marks only a film its cloud no longer has, never
// looks at closed or trashed galleries, tells the studio once per film until it is found again (a bell always, a
// mail only through the platform's verified sender), goes on from where it stopped, and keeps to its budget.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import wrangler from '../wrangler.jsonc?raw';
import worker from '../worker/index';
import { checkFilmLinks, LINK_CHECK_CRON, LINK_CHECK_FILMS } from '../worker/cleanup';
import { filmKey, marksKey, probeFilm, readMarks } from '../worker/linkCheck';
import { DROPBOX_SECRET, storeFor } from '../worker/store';
import { MemoryStore } from '../worker/store-memory';
import { SupabaseStore } from '../worker/store-supabase';
import type { Env, Film, Gallery, PhotoData } from '../worker/types';
import { fakeEnv } from './fake-kv';
import { buildDb, supabaseFetchFor } from './pglite-supabase';

const DAY = 86_400_000;
const T = '00000000-0000-4000-8000-0000000a0001';
const T2 = '00000000-0000-4000-8000-0000000a0002';
const hex = (n: number) => n.toString(16).padStart(16, '0');

/** A public Dropbox file link whose name says what the fake cloud answers ('gone', 'page', anything else plays). */
const dbxFilm = (name: string, over: Partial<Film> = {}): Film => ({
  title: name,
  tag: 'other',
  fileName: `${name}.mp4`,
  provider: 'dropbox',
  fileId: `https://www.dropbox.com/scl/fi/${name}/${name}.mp4?rlkey=k${name}`,
  sourceUrl: `https://www.dropbox.com/scl/fi/${name}/${name}.mp4?rlkey=k${name}`,
  watchUrl: '',
  downloadUrl: '',
  sizeBytes: 10,
  playable: true,
  ...over,
});

const gallery = (id: string, films: Film[], over: Partial<Gallery> = {}): Gallery => ({
  id,
  tenantId: T,
  kind: 'films',
  coupleName: 'זוג בדיקה',
  date: '',
  films,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 30 * DAY).toISOString(),
  days: 30,
  hasCover: false,
  views: 0,
  downloads: 0,
  ...over,
});

/** The fake clouds: every address asked, and what each answers. */
const asked: string[] = [];
let metadataCalls = 0;
let tokenCalls = 0;
async function fakeClouds(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  asked.push(url);
  if (url === 'https://api.dropboxapi.com/oauth2/token') {
    tokenCalls++;
    return Response.json({ access_token: 'AT', expires_in: 14400 });
  }
  if (url === 'https://api.dropboxapi.com/2/files/get_metadata') {
    metadataCalls++;
    const { path } = JSON.parse(String(init?.body));
    if (String(path).includes('GONE')) return Response.json({ error_summary: 'path/not_found/..', error: { '.tag': 'path', path: { '.tag': 'not_found' } } }, { status: 409 });
    return Response.json({ '.tag': 'file', id: path });
  }
  if (url.startsWith('https://dl.dropboxusercontent.com/')) {
    if (url.includes('gone')) return new Response('<html>not found</html>', { status: 404, headers: { 'Content-Type': 'text/html' } });
    if (url.includes('page')) return new Response('<html>this link is disabled</html>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    if (url.includes('busy')) return new Response('slow down', { status: 429 });
    return new Response('x', { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-0/10' } });
  }
  throw new Error(`unexpected request ${url}`);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  asked.length = 0;
  metadataCalls = 0;
  tokenCalls = 0;
});

function setup(budget?: number) {
  vi.stubGlobal('fetch', fakeClouds);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const store = new MemoryStore();
  store.seedTenant({ id: T, name: 'סטודיו', slug: 'studio-a' });
  const env = { ...fakeEnv(), ...(budget ? { CLEANUP_MAX_SUBREQUESTS: String(budget) } : {}) } as Env & { dump: () => Record<string, string> };
  return { store, env };
}

describe('the nightly link check', () => {
  it('marks only the broken film, skips closed and trashed galleries, and tells the studio once per film until it is back', async () => {
    const { store, env } = setup();
    const g = gallery(hex(1), [dbxFilm('ok1'), dbxFilm('gone1'), dbxFilm('page1'), dbxFilm('busy1')]);
    await store.putGallery(g);
    await store.putGallery(gallery(hex(2), [dbxFilm('gone2')], { expiresAt: new Date(Date.now() - DAY).toISOString() }));
    await store.putGallery(gallery(hex(3), [dbxFilm('gone3')], { deletedAt: new Date().toISOString() }));
    // A blocked studio's gallery and a studio without the films module are not read either.
    store.seedTenant({ id: T2, slug: 'studio-b', access: 'blocked' });
    await store.putGallery(gallery(hex(4), [dbxFilm('gone4')], { tenantId: T2 }));

    const r = await checkFilmLinks(store, env);
    expect(r.checked).toBe(4);
    expect(r.broken.map((b) => [b.galleryId, b.index])).toEqual([[hex(1), 1], [hex(1), 2]]);
    expect(r.unknown).toBe(1);
    expect(r.wrapped).toBe(true);
    expect(asked.some((u) => /gone2|gone3|gone4/.test(u))).toBe(false);
    const marks = await readMarks(env.KV, hex(1));
    expect(Object.keys(marks).sort()).toEqual([await filmKey(g.films[1]), await filmKey(g.films[2])].sort());
    expect(marks[await filmKey(g.films[1])]).toMatchObject({ reason: 'הקובץ נמחק, הועבר או שהשיתוף שלו בוטל', alerted: true });
    expect(marks[await filmKey(g.films[2])].reason).toBe('הספק מחזיר דף שגיאה במקום הסרט');
    // One bell for the gallery, naming both films; no mail without the platform's verified sender.
    expect(store.notices).toHaveLength(1);
    expect(store.notices[0]).toMatchObject({ tenantId: T, type: 'films_link_broken', title: '2 סרטים בגלריה של זוג בדיקה כבר לא זמינים' });
    expect(store.notices[0].body).toContain('"gone1", "page1"');
    expect(store.mails).toEqual([]);

    // The next run: still broken, no new bell.
    await checkFilmLinks(store, env);
    expect(store.notices).toHaveLength(1);

    // The studio fixed one (here: the cloud has it again) → its mark goes; it breaks again later → a new bell.
    const fixed = { ...g, films: [g.films[0], dbxFilm('back1'), g.films[2], g.films[3]] };
    await store.patchGallery(T, g.id, { films: fixed.films });
    const r3 = await checkFilmLinks(store, env);
    expect(r3.broken.map((b) => b.index)).toEqual([2]);
    // A replaced film's old mark goes with it; the new film has none.
    expect(Object.keys(await readMarks(env.KV, hex(1)))).toEqual([await filmKey(g.films[2])]);
    expect(store.notices).toHaveLength(1);
    await store.patchGallery(T, g.id, { films: [g.films[0], dbxFilm('gone9'), g.films[2]] });
    await checkFilmLinks(store, env);
    expect(store.notices).toHaveLength(2);
    expect(store.notices[1].title).toBe('סרט בגלריה של זוג בדיקה כבר לא זמין');
  });

  it('mails the owners through the platform when its sender is set up; a bell that failed is tried again next run', async () => {
    const { store, env } = setup();
    store.mailSender = true;
    await store.putGallery(gallery(hex(1), [dbxFilm('gone1')]));
    store.failNotify = true;
    const r1 = await checkFilmLinks(store, env);
    expect(r1.errors.map((e) => e.step)).toEqual(['bell']);
    // No bell, no mail, and the mark is not "told" yet.
    expect(store.mails).toEqual([]);
    expect(Object.values(await readMarks(env.KV, hex(1)))[0].alerted).toBeUndefined();
    store.failNotify = false;
    const r2 = await checkFilmLinks(store, env);
    expect([r2.alerted, r2.emailed]).toEqual([1, 1]);
    expect(store.mails).toEqual([{ tenantId: T, mail: { kind: 'films_link_broken', galleryId: hex(1), coupleName: 'זוג בדיקה', films: ['gone1'] } }]);
    await checkFilmLinks(store, env);
    expect(store.mails).toHaveLength(1);
  });

  it(`checks at most ${LINK_CHECK_FILMS} films a run and goes on next time from the same place, each film once`, async () => {
    const { store, env } = setup();
    for (let i = 1; i <= 3; i++) await store.putGallery(gallery(hex(i), [1, 2, 3, 4, 5].map((n) => dbxFilm(`ok${i}x${n}`))));
    const r1 = await checkFilmLinks(store, env);
    expect([r1.checked, r1.stopped, r1.wrapped]).toEqual([LINK_CHECK_FILMS, 'films', false]);
    expect(JSON.parse(env.dump()['filmcheck:cursor'])).toEqual({ start: hex(3), film: 2 });
    const r2 = await checkFilmLinks(store, env);
    expect([r2.checked, r2.wrapped]).toEqual([3, true]);
    expect(asked).toHaveLength(15);
    expect(new Set(asked).size).toBe(15);
    // After the end, the list starts again.
    expect(JSON.parse(env.dump()['filmcheck:cursor'])).toEqual({});
    expect((await checkFilmLinks(store, env)).checked).toBe(LINK_CHECK_FILMS);
  });

  it('keeps to the request budget (the free plan) and counts what it sent', async () => {
    const { store, env } = setup(20);
    for (let i = 1; i <= 6; i++) await store.putGallery(gallery(hex(i), [dbxFilm(`ok${i}a`), dbxFilm(`ok${i}b`), dbxFilm(`gone${i}`)]));
    const r = await checkFilmLinks(store, env);
    expect(r.stopped).toBe('budget');
    expect(r.subrequests).toBeLessThanOrEqual(20);
    // Everything it sent is counted: the clouds, the store, the KV reads and writes.
    expect(r.subrequests).toBeGreaterThanOrEqual(asked.length + store.notices.length);
    let total = r.checked;
    for (let i = 0; i < 6 && total < 18; i++) total += (await checkFilmLinks(store, env)).checked;
    expect(total).toBe(18);
  });

  it("a film in the studio's own Dropbox is checked by its id with the studio's connection; not connected = not checked", async () => {
    const { store, env } = setup();
    Object.assign(env, { DROPBOX_APP_KEY: 'k', DROPBOX_APP_SECRET: 's' });
    await store.setSecret(T, DROPBOX_SECRET, 'refresh-a');
    const own = (id: string): Film => ({ ...dbxFilm(id), provider: 'dropbox-own', fileId: `id:${id}`, sourceUrl: 'https://www.dropbox.com/scl/fo/f/x?rlkey=f' });
    await store.putGallery(gallery(hex(1), [own('OK1'), own('GONE1'), own('OK2')]));
    store.seedTenant({ id: T2, slug: 'studio-b' });
    await store.putGallery(gallery(hex(2), [own('GONE2')], { tenantId: T2 }));
    const r = await checkFilmLinks(store, env);
    expect(r.broken.map((b) => [b.galleryId, b.index])).toEqual([[hex(1), 1]]);
    expect(metadataCalls).toBe(3);
    // One token for the studio's run; the studio without a connection: unknown, no mark, no bell.
    expect(tokenCalls).toBe(1);
    expect(r.unknown).toBe(1);
    expect(env.dump()[marksKey(hex(2))]).toBeUndefined();
    expect(store.notices.map((n) => n.tenantId)).toEqual([T]);
  });

  it('runs on its own cron, apart from the clean-up', async () => {
    expect(wrangler).toContain(`"${LINK_CHECK_CRON}"`);
    expect(wrangler).toContain('"0 * * * *"');
    vi.stubGlobal('fetch', fakeClouds);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const env = { ...fakeEnv(), CLOUD_MOCK: '1' } as Env & { dump: () => Record<string, string> };
    const store = (await storeFor(env)) as MemoryStore;
    const runs = store.runs.length;
    await worker.scheduled({ cron: LINK_CHECK_CRON } as ScheduledController, env);
    expect(store.runs.length).toBe(runs);
    expect(env.dump()['filmcheck:cursor']).toBeDefined();
    await worker.scheduled({ cron: '0 * * * *' } as ScheduledController, env);
    expect(store.runs.length).toBe(runs + 1);
  });
});

describe('what the checks answer', () => {
  const ctx = (over = {}) => ({ fetch: (u: string, i?: RequestInit) => fakeClouds(u, i), dropboxToken: async () => 'AT', googleApiKey: '', ...over });
  it('MyAirBridge: past its end date is broken without asking; an error page or no file list is broken', async () => {
    const mab = (over: Partial<Film>): Film => ({ ...dbxFilm('m'), provider: 'myairbridge', fileId: 'https://mab.to/f/x/file.mp4', sourceUrl: 'https://mab.to/abc', ...over });
    const calls: string[] = [];
    const answer = (res: Response) => ctx({ fetch: async (u: string) => (calls.push(u), res) });
    expect(await probeFilm(mab({ providerExpiresAt: new Date(Date.now() - DAY).toISOString() }), answer(new Response('')))).toEqual({ state: 'broken', reason: 'תוקף הקישור פג' });
    expect(calls).toEqual([]);
    expect((await probeFilm(mab({}), answer(new Response('<html>expired</html>', { status: 200, headers: { 'Content-Type': 'text/html' } })))).state).toBe('broken');
    expect((await probeFilm(mab({}), answer(new Response('', { status: 404 })))).state).toBe('broken');
    expect((await probeFilm(mab({}), answer(new Response('', { status: 503 })))).state).toBe('unknown');
    const xml = '<d:multistatus xmlns:d="DAV:"><d:response><d:href>/x/</d:href><d:propstat><d:prop><d:displayname>x</d:displayname><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response></d:multistatus>';
    expect(await probeFilm(mab({}), answer(new Response(xml, { status: 207, headers: { 'Content-Type': 'application/xml' } })))).toEqual({ state: 'ok' });
  });

  it('Drive, pCloud and the shared-folder Dropbox: gone only when the cloud says so', async () => {
    const drive: Film = { ...dbxFilm('d'), provider: 'gdrive', fileId: 'A1234567890abc' };
    const json = (body: unknown, status = 200) => ctx({ googleApiKey: 'key', fetch: async () => Response.json(body, { status }) });
    expect((await probeFilm(drive, json({ id: 'A', trashed: true }))).state).toBe('broken');
    expect((await probeFilm(drive, json({ id: 'A', trashed: false }))).state).toBe('ok');
    expect((await probeFilm(drive, json({}, 404))).state).toBe('broken');
    expect((await probeFilm(drive, json({}, 403))).state).toBe('unknown');
    expect((await probeFilm(drive, ctx())).state).toBe('unknown');
    const pc: Film = { ...dbxFilm('p'), provider: 'pcloud', fileId: 'https://u.pcloud.link/publink/show?code=ABCDEFGH12#123' };
    expect((await probeFilm(pc, json({ result: 7002 })))).toEqual({ state: 'broken', reason: 'הקובץ נמחק, הועבר או שהשיתוף שלו בוטל' });
    expect((await probeFilm(pc, json({ result: 7005 }))).state).toBe('unknown');
    expect((await probeFilm(pc, json({ result: 0, hosts: ['x'], path: '/y' }))).state).toBe('ok');
    const link: Film = { ...dbxFilm('l'), provider: 'dropbox-link', fileId: '/a.mp4', sourceUrl: 'https://www.dropbox.com/scl/fo/x/y?rlkey=z' };
    expect((await probeFilm(link, json({ error_summary: 'shared_link_not_found/' }, 409))).state).toBe('broken');
    expect((await probeFilm(link, json({ '.tag': 'file' }))).state).toBe('ok');
    expect((await probeFilm(link, ctx({ dropboxToken: async () => null }))).state).toBe('unknown');
  });
});

describe('the studio sees the mark next to the film', () => {
  it('the gallery screen answers linkIssue for the broken film only', async () => {
    vi.stubGlobal('fetch', fakeClouds);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const env = { ...fakeEnv(), CLOUD_MOCK: '1' } as Env & { dump: () => Record<string, string> };
    const store = (await storeFor(env)) as MemoryStore;
    const tid = '00000000-0000-4000-8000-0000000a00f1';
    store.seedTenant({ id: tid, slug: 'studio-f' });
    const id = 'f00000000000000a';
    await store.putGallery(gallery(id, [dbxFilm('okA'), dbxFilm('goneA')], { tenantId: tid }));
    await checkFilmLinks(store, env);
    const res = await worker.fetch(new Request(`https://films.test/api/admin/galleries/${id}`, { headers: { Authorization: `Bearer test:o:${tid}:owner` } }), env);
    const g = (await res.json()) as { films: (Film & { linkIssue?: { reason: string } })[] };
    expect(g.films[0].linkIssue).toBeUndefined();
    expect(g.films[1].linkIssue?.reason).toBe('הקובץ נמחק, הועבר או שהשיתוף שלו בוטל');
  });
});

// The queue and the disconnect count as the database answers them (0153), the same as MemoryStore's copy.
// Avira: films are off and studios are never suspended — this compares the films health check across stores.
describe.skip('films_link_check_candidates and films_dropbox_impact (0153) answer like MemoryStore', () => {
  const BASE = 'http://supabase.linkcheck.test';
  let db: PGlite;
  beforeAll(async () => {
    db = await buildDb();
  }, 120_000);
  afterAll(async () => {
    await db?.close();
  });

  it('same galleries, same order, same counts', async () => {
    const own: Film = { ...dbxFilm('o'), provider: 'dropbox-own', fileId: 'id:O' };
    const link: Film = { ...dbxFilm('l'), provider: 'dropbox-link', fileId: '/l.mp4', sourceUrl: 'https://www.dropbox.com/scl/fo/x/y?rlkey=z' };
    const rows: Gallery[] = [
      gallery(hex(11), [own, link, dbxFilm('pub')]),
      gallery(hex(12), [own]),
      gallery(hex(13), [own], { expiresAt: new Date(Date.now() - DAY).toISOString() }),
      gallery(hex(14), [own], { deletedAt: new Date().toISOString() }),
      gallery(hex(15), []),
      gallery(hex(16), [], { kind: 'photos' }),
      gallery(hex(17), [], { kind: 'photos' }),
      gallery(hex(18), [own], { tenantId: T2 }),
    ];
    const photos: Record<string, PhotoData['provider']> = { [hex(16)]: 'dropbox', [hex(17)]: 'pcloud' };
    const run = async (s: SupabaseStore | MemoryStore) => {
      for (const g of rows) await s.putGallery(g);
      for (const [id, provider] of Object.entries(photos)) await s.savePhotos(T, id, { folderUrl: 'https://www.dropbox.com/scl/fo/x/y?rlkey=z', provider, sets: [], items: [{ key: 'aaaaaaaa', name: 'a.jpg', ref: 'p:/a.jpg' }] } as PhotoData);
      return {
        all: (await s.filmCheckCandidates({ limit: 10 })).map((g) => [g.id, g.films.length]),
        after: (await s.filmCheckCandidates({ after: hex(11), limit: 10 })).map((g) => g.id),
        from: (await s.filmCheckCandidates({ start: hex(12), limit: 1 })).map((g) => g.id),
        impact: await s.dropboxImpact(T),
      };
    };
    const mem = new MemoryStore();
    mem.seedTenant({ id: T, slug: 'studio-a' });
    mem.seedTenant({ id: T2, slug: 'studio-b', access: 'blocked' });
    const memory = await run(mem);
    await db.query(`insert into public.tenants (id, name, slug) values ($1, 'A', 'studio-a')`, [T]);
    await db.query(`insert into public.tenants (id, name, slug, status) values ($1, 'B', 'studio-b', 'suspended')`, [T2]);
    vi.stubGlobal('fetch', supabaseFetchFor(db, BASE));
    let supabase: typeof memory;
    try {
      supabase = await run(new SupabaseStore(BASE, 'service-role-test-key'));
    } finally {
      vi.unstubAllGlobals();
    }
    expect(memory).toEqual({ all: [[hex(11), 3], [hex(12), 1]], after: [hex(12)], from: [hex(12)], impact: { photoGalleries: 1, films: 3, filmGalleries: 2 } });
    expect(supabase).toEqual(memory);
  }, 60_000);
});

describe('under the mock cloud (tests and local previews)', () => {
  it('asks no real cloud: a link that says "gone" is gone, every other film of every cloud is there', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('no network under CLOUD_MOCK');
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const store = new MemoryStore();
    store.seedTenant({ id: T, slug: 'studio-a' });
    await store.setSecret(T, DROPBOX_SECRET, 'mock-refresh-token');
    const env = { ...fakeEnv(), CLOUD_MOCK: '1', GOOGLE_API_KEY: 'k' } as Env;
    const films: Film[] = [
      dbxFilm('ok'),
      { ...dbxFilm('own'), provider: 'dropbox-own', fileId: 'id:OWN' },
      { ...dbxFilm('mab'), provider: 'myairbridge', fileId: 'https://mab.to/f/x.mp4', sourceUrl: 'https://mab.to/x' },
      { ...dbxFilm('pc'), provider: 'pcloud', fileId: 'https://u.pcloud.link/publink/show?code=ABCDEFGH12#5' },
      { ...dbxFilm('dr'), provider: 'gdrive', fileId: 'A1234567890abc' },
      dbxFilm('gone7'),
    ];
    await store.putGallery(gallery(hex(1), films));
    const r = await checkFilmLinks(store, env);
    expect([r.checked, r.unknown]).toEqual([6, 0]);
    expect(r.broken.map((b) => b.index)).toEqual([5]);
  });
});
