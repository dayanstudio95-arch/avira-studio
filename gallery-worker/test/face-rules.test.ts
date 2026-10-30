import { describe, expect, it, vi } from 'vitest';
import { decodeChunk, encodeChunk, findPerson } from '../shared/faces';
import { nightly } from '../worker/cleanup';
import { addFacesChunk, FACE_CONSENT, FACE_SEARCHES_PER_HOUR, FACE_TOKEN_SECONDS, faceToken } from '../worker/faces';
import { storeFor } from '../worker/store';
import { MemoryStore } from '../worker/store-memory';
import type { Env, Gallery, PhotoData } from '../worker/types';
import { fakeEnv } from './fake-kv';

const DAY = 86_400_000;
const vec = Array.from({ length: 128 }, (_, i) => Math.sin(i) * 0.2);

async function galleryWithFaces(store: MemoryStore, id: string, opts: { expiresIn: number; faceSearch: boolean }) {
  const g = { id, tenantId: 't1', kind: 'photos', coupleName: 'x', date: '', films: [], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + opts.expiresIn).toISOString(), days: 30, hasCover: false, views: 0, downloads: 0 } as unknown as Gallery;
  await store.putGallery(g);
  const data = { folderUrl: '', provider: 'mock', sets: [], items: [{ key: 'aaaaaaaa', name: 'a.jpg' }, { key: 'bbbbbbbb', name: 'b.jpg' }], faceSearch: opts.faceSearch } as unknown as PhotoData;
  await store.savePhotos('t1', id, data);
  await addFacesChunk(store, g, encodeChunk([{ key: 'aaaaaaaa', faces: [{ box: [0.1, 0.1, 0.2, 0.2], vec }] }]), new Set(['aaaaaaaa', 'bbbbbbbb']));
  return g;
}

describe('face data: the three deletion rules', () => {
  it('keeps only photos of the gallery', async () => {
    const store = new MemoryStore();
    const g = await galleryWithFaces(store, '1111111111111111', { expiresIn: DAY, faceSearch: true });
    await expect(addFacesChunk(store, g, encodeChunk([{ key: 'cccccccc', faces: [] }]), new Set(['aaaaaaaa']))).rejects.toThrow('לא שייכת');
    expect(await store.facesMeta(g.id)).toMatchObject({ chunks: 1, photos: 1, faces: 1 });
  });

  it('nightly: keeps open galleries with face search on, removes closed, deleted and switched-off ones', async () => {
    const store = new MemoryStore();
    await galleryWithFaces(store, '1111111111111111', { expiresIn: DAY, faceSearch: true });
    await galleryWithFaces(store, '2222222222222222', { expiresIn: -DAY, faceSearch: true });
    await galleryWithFaces(store, '3333333333333333', { expiresIn: DAY, faceSearch: true });
    await store.deleteGallery('3333333333333333');
    await galleryWithFaces(store, '4444444444444444', { expiresIn: DAY, faceSearch: false });
    const report = await nightly(store, { KV: { delete: async () => {} } } as never);
    expect(report.facesRemoved.sort()).toEqual(['2222222222222222', '3333333333333333', '4444444444444444']);
    expect(await store.faceGalleryIds()).toEqual(['1111111111111111']);
    expect((await store.facesMeta('2222222222222222')).chunks).toBe(0);
  });
});

describe('face data through the Worker (mock clouds)', () => {
  it('deleting a gallery (to the trash) deletes its face data at once; "forever" removes it', async () => {
    const { default: worker } = await import('../worker/index');
    const { storeFor } = await import('../worker/store');
    const env = { CLOUD_MOCK: '1', KV: { delete: async () => {}, get: async () => null, put: async () => {} } } as never;
    const store = (await storeFor(env)) as MemoryStore;
    const owner = { Authorization: 'Bearer test:u1:t1:owner' };
    await store.userFromToken('test:u1:t1:owner');
    const g = await galleryWithFaces(store, '5555555555555555', { expiresIn: DAY, faceSearch: true });
    expect(await store.faceGalleryIds()).toContain(g.id);
    const res = await worker.fetch(new Request(`http://films.test/api/admin/galleries/${g.id}`, { method: 'DELETE', headers: owner }), env);
    expect(res.status).toBe(200);
    expect(await store.faceGalleryIds()).not.toContain(g.id);
    expect((await store.getGallery(g.id))?.deletedAt).toBeTruthy();
    const gone = await worker.fetch(new Request(`http://films.test/api/admin/galleries/${g.id}?forever=1`, { method: 'DELETE', headers: owner }), env);
    expect(gone.status).toBe(200);
    expect(await store.getGallery(g.id)).toBeNull();
  });
});

// ---------- fix plan P68: what a guest downloads, when face data is deleted, removing a person ----------
describe('P68: guest face search', () => {
  const env = { ...fakeEnv(), CLOUD_MOCK: '1' } as unknown as Env;
  let n = 0;
  let ip = '10.0.0.1';
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const { default: worker } = await import('../worker/index');
    return worker.fetch(
      new Request(`https://films.test${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, ...headers },
        body: body === undefined ? undefined : body instanceof Uint8Array ? (body as Uint8Array<ArrayBuffer>) : JSON.stringify(body),
      }),
      env,
    );
  };
  const K = ['aaaaaaaa', 'bbbbbbbb', 'cccccccc'];
  const person = (seed: number) => Array.from({ length: 128 }, (_, i) => Math.sin(seed * 12.9898 + i * 78.233) * 0.25);

  /** A photo gallery of three photos, face search on and scanned by the studio (A and B: person 1; C: person 2). */
  async function scanned() {
    n++;
    const tid = `00000000-0000-4000-8068-${String(n).padStart(12, '0')}`;
    const studio = { Authorization: `Bearer test:u${n}:${tid}:owner` };
    const store = (await storeFor(env)) as MemoryStore;
    store.seedTenant({ id: tid, slug: `faces-${n}x` });
    const g = (await (await call('POST', '/api/admin/galleries', { coupleName: 'נועה & טל', kind: 'photos' }, studio)).json()) as { id: string };
    await store.savePhotos(tid, g.id, { folderUrl: '', provider: 'mock', sets: [], items: K.map((key) => ({ key, name: `${key}.jpg`, ref: `m:/${key}.jpg` })) } as unknown as PhotoData);
    await call('PUT', `/api/admin/galleries/${g.id}/photos`, { faceSearch: true }, studio);
    const { previewToken, guestId } = (await (await call('GET', `/api/admin/galleries/${g.id}`, undefined, studio)).json()) as { previewToken: string; guestId: string };
    const cookie = (await call('GET', `/api/watch/${g.id}?pt=${encodeURIComponent(previewToken)}`)).headers.get('Set-Cookie')!.split(';')[0];
    const chunk = encodeChunk([
      { key: K[0], faces: [{ box: [0.1, 0.1, 0.2, 0.2], vec: person(1) }, { box: [0.5, 0.1, 0.2, 0.2], vec: person(2) }] },
      { key: K[1], faces: [{ box: [0.1, 0.1, 0.2, 0.2], vec: person(1) }] },
      { key: K[2], faces: [{ box: [0.1, 0.1, 0.2, 0.2], vec: person(2) }] },
    ]);
    expect((await call('POST', `/api/watch/${g.id}/faces`, chunk, { Cookie: cookie, 'Content-Type': 'application/octet-stream' })).status).toBe(200);
    return { store, studio, id: g.id, guestId, cookie, tid };
  }
  const search = async (id: string, body: unknown = { consent: FACE_CONSENT }, headers: Record<string, string> = {}) => call('POST', `/api/watch/${id}/faces/search`, body, headers);
  const chunkOf = async (id: string, token: string, v: number, headers: Record<string, string> = {}) => call('GET', `/api/watch/${id}/faces/0?v=${v}`, undefined, { 'X-Face-Token': token, ...headers });
  const keysIn = async (res: Response) => decodeChunk(new Uint8Array(await res.arrayBuffer())).map((p) => p.key);

  it('a guest searches only after the consent, with a token that opens the chunks of this gallery for 10 minutes', async () => {
    const { guestId, id } = await scanned();
    expect((await search(guestId, {})).status).toBe(400);
    const s = (await (await search(guestId)).json()) as { ready: boolean; token: string; version: number; chunks: number };
    expect(s).toMatchObject({ ready: true, chunks: 1 });
    expect(await keysIn(await chunkOf(guestId, s.token, s.version))).toEqual(K);
    // Without the token, with another gallery's, or an old one: refused.
    expect((await call('GET', `/api/watch/${guestId}/faces/0?v=${s.version}`)).status).toBe(403);
    const other = await scanned();
    const theirs = (await (await search(other.guestId)).json()) as { token: string };
    expect((await chunkOf(guestId, theirs.token, s.version)).status).toBe(403);
    const old = await faceToken('mock-state-secret', id, Date.now() - (FACE_TOKEN_SECONDS + 5) * 1000);
    expect((await chunkOf(guestId, old, s.version)).status).toBe(403);
    // A chunk of an older version: the data changed since the search began.
    expect((await chunkOf(guestId, s.token, s.version - 1)).status).toBe(409);
    // Each search is recorded with its consent (no selfie, no address).
    const store = (await storeFor(env)) as MemoryStore;
    expect(store.faceSearches.filter((x) => x.galleryId === id)).toEqual([expect.objectContaining({ role: 'guest', consent: FACE_CONSENT })]);
  });

  it('downloading a chunk never reads the photo list, and the address carries the version so the phone keeps it', async () => {
    const { store, guestId } = await scanned();
    const s = (await (await search(guestId)).json()) as { token: string; version: number };
    const lists = vi.spyOn(store, 'getPhotosVersioned');
    const whole = vi.spyOn(store, 'getPhotos');
    const res = await chunkOf(guestId, s.token, s.version);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=86400');
    expect(lists).not.toHaveBeenCalled();
    expect(whole).not.toHaveBeenCalled();
    lists.mockRestore();
    whole.mockRestore();
  });

  it('searches are rate limited per address, high enough for a hall on one network', async () => {
    const { guestId } = await scanned();
    ip = '10.9.9.9';
    for (let i = 0; i < FACE_SEARCHES_PER_HOUR; i++) expect((await search(guestId)).status).toBe(200);
    expect((await search(guestId)).status).toBe(429);
    ip = '10.9.9.10';
    expect((await search(guestId)).status).toBe(200);
    ip = '10.0.0.1';
  });

  it('a photo hidden later leaves what guests download at once, and its face data leaves the file', async () => {
    const { store, studio, id, guestId } = await scanned();
    await call('PUT', `/api/admin/galleries/${id}/photos`, { items: { [K[1]]: { hidden: true } } }, studio);
    const s = (await (await search(guestId)).json()) as { token: string; version: number };
    expect(await keysIn(await chunkOf(guestId, s.token, s.version))).toEqual([K[0], K[2]]);
    const f = store.faces.get(id)!;
    expect(decodeChunk(f.files[0].bytes).map((p) => p.key)).toEqual([K[0], K[2]]);
    expect(f.faces).toBe(3);
    // The card counts by keys: 2 shown, 2 scanned. Shown again: 1 left to scan.
    expect(await (await call('GET', `/api/admin/galleries/${id}/faces`, undefined, studio)).json()).toMatchObject({ visible: 2, scanned: 2, left: 0 });
    await call('PUT', `/api/admin/galleries/${id}/photos`, { items: { [K[1]]: { hidden: false } } }, studio);
    expect(await (await call('GET', `/api/admin/galleries/${id}/faces`, undefined, studio)).json()).toMatchObject({ visible: 3, scanned: 2, left: 1 });
  });

  it('a chunk with nothing new is not stored; a scanned photo is not stored twice', async () => {
    const { store, id, cookie } = await scanned();
    const again = encodeChunk([{ key: K[0], faces: [{ box: [0.1, 0.1, 0.2, 0.2], vec: person(1) }] }]);
    const r = (await (await call('POST', `/api/watch/${id}/faces`, again, { Cookie: cookie, 'Content-Type': 'application/octet-stream' })).json()) as { chunks: number; skipped: number };
    expect(r).toMatchObject({ chunks: 1, skipped: 1 });
    expect(store.faces.get(id)!.files).toHaveLength(1);
  });

  it('face data deleted (closed): search off, guests are told it is not active, the studio is told on extend; on again without a scan: "not ready"', async () => {
    const { studio, id, guestId } = await scanned();
    const batch = (await (await call('POST', '/api/admin/galleries/batch', { ids: [id], action: 'close' }, studio)).json()) as { done: number };
    expect(batch.done).toBe(1);
    expect((await call('GET', `/api/watch/${guestId}/faces`)).status).toBe(410);
    const ext = (await (await call('POST', `/api/admin/galleries/${id}/extend`, { days: 14 }, studio)).json()) as { faceSearchOff?: boolean };
    expect(ext.faceSearchOff).toBe(true);
    expect((await call('GET', `/api/watch/${guestId}/faces`)).status).toBe(404);
    expect(await (await call('GET', `/api/admin/galleries/${id}/faces`, undefined, studio)).json()).toMatchObject({ offBecauseDeleted: true, chunks: 0 });
    await call('PUT', `/api/admin/galleries/${id}/photos`, { faceSearch: true }, studio);
    expect(await (await call('GET', `/api/watch/${guestId}/faces`)).json()).toMatchObject({ ready: false });
    expect(await (await search(guestId)).json()).toMatchObject({ ready: false });
    expect(await (await call('GET', `/api/admin/galleries/${id}/faces`, undefined, studio)).json()).toMatchObject({ offBecauseDeleted: false });
  });

  it('trash and restore in a batch: restored galleries whose search went off are named; one never scanned keeps its switch', async () => {
    const a = await scanned();
    const never = (await (await call('POST', '/api/admin/galleries', { coupleName: 'בלי & סריקה', kind: 'photos' }, a.studio)).json()) as { id: string };
    await a.store.savePhotos(a.tid, never.id, { folderUrl: '', provider: 'mock', sets: [], items: [{ key: 'dddddddd', name: 'd.jpg', ref: 'm:/d.jpg' }] } as unknown as PhotoData);
    await call('PUT', `/api/admin/galleries/${never.id}/photos`, { faceSearch: true }, a.studio);
    await call('POST', '/api/admin/galleries/batch', { ids: [a.id, never.id], action: 'trash' }, a.studio);
    const back = (await (await call('POST', '/api/admin/galleries/batch', { ids: [a.id, never.id], action: 'restore' }, a.studio)).json()) as { faceSearchOff: string[] };
    expect(back.faceSearchOff).toEqual([a.id]);
    expect((await a.store.getPhotos(never.id))?.faceSearch).toBe(true);
    expect((await a.store.getPhotos(a.id))?.faceSearch).toBe(false);
  });

  it('"הסר אדם זה": the faces of one person leave the data, the photo keeps its other faces and stays scanned', async () => {
    const { store, id, guestId, cookie } = await scanned();
    const s = (await (await search(id, {}, { Cookie: cookie })).json()) as { token: string; version: number };
    const photos = decodeChunk(new Uint8Array(await (await chunkOf(id, s.token, s.version, { Cookie: cookie })).arrayBuffer()));
    const hits = findPerson(person(1), photos);
    expect(hits.map((h) => h.key)).toEqual(expect.arrayContaining([K[0], K[1]]));
    // Only the studio.
    expect((await call('POST', `/api/watch/${id}/faces/remove`, { faces: hits.map((h) => ({ key: h.key, face: h.face })) })).status).toBe(403);
    const r = (await (await call('POST', `/api/watch/${id}/faces/remove`, { faces: hits.map((h) => ({ key: h.key, face: h.face })) }, { Cookie: cookie })).json()) as { removed: number; remaining: unknown[] };
    expect(r).toEqual({ removed: 2, remaining: [] });
    const g = (await (await search(guestId)).json()) as { token: string; version: number };
    const left = decodeChunk(new Uint8Array(await (await chunkOf(guestId, g.token, g.version)).arrayBuffer()));
    expect(findPerson(person(1), left)).toEqual([]);
    expect(findPerson(person(2), left).map((h) => h.key).sort()).toEqual([K[0], K[2]]);
    expect((await store.facesDone(id)).sort()).toEqual(K);
    expect(store.faceSearches.filter((x) => x.galleryId === id).map((x) => x.role)).toEqual(['studio', 'guest']);
  });

  it('the hourly clean-up rewrites files that still hold hidden photos', async () => {
    const { store, id } = await scanned();
    await store.removeFaceKeys(id, [K[2]]);
    expect(store.faces.get(id)!.dirty.size).toBe(1);
    const report = await nightly(store, { KV: { delete: async () => {} } } as never);
    expect(report.facesRewritten).toContain(id);
    expect(store.faces.get(id)!.dirty.size).toBe(0);
    expect(decodeChunk(store.faces.get(id)!.files[0].bytes).map((p) => p.key)).toEqual([K[0], K[1]]);
  });
});
