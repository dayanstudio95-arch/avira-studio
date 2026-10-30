// Fix plan P65: before a disconnect the studio sees what stops (open photo galleries and films that play only through
// its Dropbox, also on the studio page); crew cannot ask. Films from the studio's own Dropbox are saved by their file id
// ('dropbox-own') and checked like every film; reading a folder is an edit, not a look.
import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import { storeFor } from '../worker/store';
import type { MemoryStore } from '../worker/store-memory';
import type { Env, Film, PhotoData } from '../worker/types';
import { fakeEnv } from './fake-kv';

const env = { ...fakeEnv(), CLOUD_MOCK: '1' } as Env;
const T = '00000000-0000-4000-8000-0000000b0001';
const as = (role: string, tid = T) => ({ Authorization: `Bearer test:u-${role}:${tid}:${role}` });
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = as('owner')) =>
  worker.fetch(new Request(`https://films.test${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env);

const FOLDER = 'https://www.dropbox.com/scl/fo/abc/def?rlkey=k';
const film = (over: Partial<Film>): Partial<Film> => ({ title: 'סרט', fileName: 'a.mp4', tag: 'other', sizeBytes: 1, playable: true, ...over });
const own = (id: string, pathRoot?: string) => film({ provider: 'dropbox-own', fileId: `id:${id}`, sourceUrl: FOLDER, ...(pathRoot ? { pathRoot } : {}) });
const link = film({ provider: 'dropbox-link', fileId: '/a.mp4', sourceUrl: FOLDER });
const pub = film({ provider: 'dropbox', fileId: 'https://www.dropbox.com/scl/fi/x/a.mp4?rlkey=r', sourceUrl: 'https://www.dropbox.com/scl/fi/x/a.mp4?rlkey=r' });

async function newGallery(body: Record<string, unknown>) {
  const res = await call('POST', '/api/admin/galleries', { coupleName: 'זוג בדיקה', ...body });
  expect(res.status).toBe(200);
  return (await res.json()) as { id: string; films: Film[] };
}

describe('what a Dropbox disconnect stops', () => {
  it('counts open photo galleries and films read through the connection, and the studio page; crew get 403', async () => {
    const store = (await storeFor(env)) as MemoryStore;
    store.seedTenant({ id: T, slug: 'impact-studio' });
    expect(await (await call('GET', '/api/admin/dropbox/impact')).json()).toEqual({ photoGalleries: 0, films: 0, filmGalleries: 0, studioFilms: 0 });

    await newGallery({ films: [own('A1', '100'), link, pub] });
    await newGallery({ films: [own('B1')] });
    // Closed and trashed galleries stop anyway: not counted.
    const closed = await newGallery({ films: [own('C1')] });
    await call('POST', '/api/admin/galleries/batch', { action: 'close', ids: [closed.id] });
    const trashed = await newGallery({ films: [own('D1')] });
    await call('DELETE', `/api/admin/galleries/${trashed.id}`);
    for (const provider of ['dropbox', 'dropbox-link', 'pcloud'] as const) {
      const p = await newGallery({ kind: 'photos' });
      await store.savePhotos(T, p.id, { folderUrl: FOLDER, provider, sets: [], items: [] } as unknown as PhotoData);
    }
    expect((await call('PUT', '/api/admin/studio', { showcase: { folderUrl: FOLDER, films: [own('S1'), pub] } })).status).toBe(200);

    const impact = await (await call('GET', '/api/admin/dropbox/impact')).json();
    expect(impact).toEqual({ photoGalleries: 2, films: 3, filmGalleries: 2, studioFilms: 1 });
    expect((await call('GET', '/api/admin/dropbox/impact', undefined, as('studio_manager'))).status).toBe(200);
    expect((await call('GET', '/api/admin/dropbox/impact', undefined, as('photographer'))).status).toBe(403);
    expect((await call('GET', '/api/admin/dropbox/impact', undefined, {})).status).toBe(401);
  });
});

describe("films from the studio's own Dropbox are saved by their id", () => {
  it('keeps the id and the team root; a made-up id or root is refused', async () => {
    const g = await newGallery({ films: [own('KEEP1', '42')] });
    expect(g.films[0]).toMatchObject({ provider: 'dropbox-own', fileId: 'id:KEEP1', pathRoot: '42', sourceUrl: FOLDER, watchUrl: '', downloadUrl: '' });
    expect((await call('POST', '/api/admin/galleries', { coupleName: 'x', films: [film({ provider: 'dropbox-own', fileId: 'https://evil.example/x' })] })).status).toBe(400);
    expect((await call('POST', '/api/admin/galleries', { coupleName: 'x', films: [own('A', '../x')] })).status).toBe(400);
    // The couple's page streams it through our own address only.
    const view = (await (await call('GET', `/api/watch/${g.id}`, undefined, {})).json()) as { films: { watchUrl: string }[] };
    expect(view.films[0].watchUrl).toBe(`/api/watch/${g.id}/film/0`);
  });

  it("a MyAirBridge film keeps its share's end date", async () => {
    const g = await newGallery({ films: [film({ provider: 'myairbridge', fileId: 'https://mab.to/f/x.mp4', providerExpiresAt: '2026-12-01T00:00:00Z' })] });
    expect(g.films[0].providerExpiresAt).toBe('2026-12-01T00:00:00.000Z');
  });
});

describe('reading a folder uses the studio connection on its behalf: an edit', () => {
  it('a studio whose subscription is not active cannot read a folder or check a link (402)', async () => {
    const tid = '00000000-0000-4000-8000-0000000b0002';
    const store = (await storeFor(env)) as MemoryStore;
    store.seedTenant({ id: tid, slug: 'readonly-studio', access: 'read_only' });
    expect((await call('POST', '/api/admin/resolve-folder', { url: FOLDER }, as('owner', tid))).status).toBe(402);
    expect((await call('POST', '/api/admin/check-link', { url: 'https://www.dropbox.com/scl/fi/x/a.mp4?rlkey=r' }, as('owner', tid))).status).toBe(402);
    store.seedTenant({ id: tid, access: 'ok' });
    expect((await call('POST', '/api/admin/resolve-folder', { url: FOLDER }, as('owner', tid))).status).toBe(200);
  });
});
