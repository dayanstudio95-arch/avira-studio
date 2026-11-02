// The studio's album-choice folder (Avira, 2026-11-02; 0104): one folder in the settings (the price list) joins every
// photo gallery as "בחירת אלבום" — at the end, kept through a folder load, replaced (same keys, hearts stay) when the
// settings change, never twice (the gallery's own copy wins), off per gallery; a new gallery keeps that set from the
// guests; never on a photographer's page. Synthetic photos only.
import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import { ALBUM_SET, STUDIO_FOLDER, hasOwnAlbumCopy, studioSetFrom, withStudioSet, type StudioAlbumSet } from '../worker/albumSet';
import { weddingPhotos } from '../worker/photographerPage';
import { storeFor } from '../worker/store';
import type { MemoryStore } from '../worker/store-memory';
import type { Env, Gallery, PhotoData, PhotoItem } from '../worker/types';
import { fakeEnv } from './fake-kv';

const env = {
  ...fakeEnv(),
  CLOUD_MOCK: '1',
  HUB_URL: 'https://hub.example',
  ASSETS: { fetch: async () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { headers: { 'Content-Type': 'image/jpeg' } }) },
} as unknown as Env;
const FOLDER = 'https://www.dropbox.com/scl/fo/abc/def?rlkey=k&dl=0';
const PRICES = 'https://www.dropbox.com/scl/fo/price/list?rlkey=k&dl=0&mock=price';

const sets = [
  { id: 's1', name: 'טיזר' },
  { id: 's8', name: ALBUM_SET },
];
const photo = (n: number, over: Partial<PhotoItem> = {}): PhotoItem => ({ key: `k${n}`, name: `IMG_${n}.jpg`, ref: `m:/w/${n}.jpg`, ...over });
const list = (items: PhotoItem[], over: Partial<PhotoData> = {}): PhotoData => ({ folderUrl: FOLDER, provider: 'mock', sets, items, ...over });
const studioSet = (refs: string[]): StudioAlbumSet => ({ url: PRICES, provider: 'mock', items: refs.map((ref, i) => ({ name: `מחירון-${i + 1}.jpg`, ref, ar: 0.7 })), at: '2026-11-02T00:00:00.000Z' });

describe('the studio photos in a list', () => {
  it('at the end, in "בחירת אלבום", marked; again: the same keys and hidden; a photo gone from the folder leaves', () => {
    const first = withStudioSet(list([photo(1), photo(2)]), studioSet(['m:/p/1.jpg', 'm:/p/2.jpg']));
    expect(first.items.map((i) => [i.ref, i.set ?? '', i.studio ?? false, i.folder ?? ''])).toEqual([
      ['m:/w/1.jpg', '', false, ''],
      ['m:/w/2.jpg', '', false, ''],
      ['m:/p/1.jpg', 's8', true, STUDIO_FOLDER],
      ['m:/p/2.jpg', 's8', true, STUDIO_FOLDER],
    ]);
    expect(first.items[2].ar).toBe(0.7);
    const keyOf = (d: PhotoData, ref: string) => d.items.find((i) => i.ref === ref)?.key;
    const hidden = { ...first, items: first.items.map((i) => (i.ref === 'm:/p/2.jpg' ? { ...i, hidden: true } : i)) };
    const next = withStudioSet(hidden, studioSet(['m:/p/2.jpg', 'm:/p/3.jpg']));
    expect(next.items.filter((i) => i.studio).map((i) => i.ref)).toEqual(['m:/p/2.jpg', 'm:/p/3.jpg']);
    expect(keyOf(next, 'm:/p/2.jpg')).toBe(keyOf(first, 'm:/p/2.jpg'));
    expect(next.items.find((i) => i.ref === 'm:/p/2.jpg')?.hidden).toBe(true);
    expect(new Set(next.items.map((i) => i.key)).size).toBe(next.items.length);
  });

  it('none: no folder in the settings, switched off here, or the gallery has its own copy', () => {
    const withStudio = withStudioSet(list([photo(1)]), studioSet(['m:/p/1.jpg']));
    expect(withStudioSet(withStudio, undefined).items.map((i) => i.ref)).toEqual(['m:/w/1.jpg']);
    expect(withStudioSet({ ...withStudio, studioSetOff: true }, studioSet(['m:/p/1.jpg'])).items.map((i) => i.ref)).toEqual(['m:/w/1.jpg']);
    const own = list([photo(1), photo(2, { set: 's8', folder: 'מחירון 2027 אלבומים' })]);
    expect(hasOwnAlbumCopy(own)).toBe(true);
    expect(withStudioSet(own, studioSet(['m:/p/1.jpg'])).items.map((i) => i.ref)).toEqual(['m:/w/1.jpg', 'm:/w/2.jpg']);
    // A photo the studio put in "בחירת אלבום" by hand is not a copy of the price list.
    expect(hasOwnAlbumCopy(list([photo(1, { set: 's8', folder: '01 התארגנות' })]))).toBe(false);
  });

  it('the studio removed the set: it comes back for these photos', () => {
    const d = withStudioSet(list([photo(1)], { sets: [{ id: 's1', name: 'טיזר' }] }), studioSet(['m:/p/1.jpg']));
    expect(d.sets.map((s) => s.name)).toEqual(['טיזר', ALBUM_SET]);
    expect(d.items[1].set).toBe(d.sets[1].id);
  });

  it('the settings keep a folder of at most 100 photos; a photo read before keeps its shape', () => {
    const many = list(Array.from({ length: 101 }, (_, i) => photo(i)));
    expect(() => studioSetFrom(PRICES, many)).toThrow(/עד 100/);
    const before = { ...studioSet(['m:/w/1.jpg']), items: [{ name: 'a', ref: 'm:/w/1.jpg', v: 'x1', ar: 0.7 }] };
    const again = studioSetFrom(PRICES, list([photo(1, { v: 'x1' }), photo(2)]), before);
    expect(again.items.map((i) => i.ar ?? null)).toEqual([0.7, null]);
    expect(studioSetFrom(PRICES, list([photo(1, { v: 'x2' })]), before).items[0].ar).toBeUndefined();
  });

  it("never on a photographer's page, not even the gallery's own copy", () => {
    const d = withStudioSet(list([photo(1), photo(2, { set: 's8', folder: 'מחירון' })], { sets }), undefined);
    expect(weddingPhotos(withStudioSet(list([photo(1)]), studioSet(['m:/p/1.jpg'])), {}, true).map((i) => i.ref)).toEqual(['m:/w/1.jpg']);
    expect(weddingPhotos(d, {}, true).map((i) => i.ref)).toEqual(['m:/w/1.jpg']);
  });
});

let n = 0;
async function setup() {
  n++;
  const tid = `00000000-0000-4000-8000-${(0xa5000 + n).toString(16).padStart(12, '0')}`;
  const store = (await storeFor(env)) as MemoryStore;
  store.seedTenant({ id: tid, slug: `price-${n}`, photos: true });
  const studio = { Authorization: `Bearer test:u-a-${n}:${tid}:owner`, Origin: 'https://hub.example', 'Content-Type': 'application/json' };
  const call = (method: string, path: string, data?: unknown) =>
    worker.fetch(new Request(`https://films.test${path}`, { method, headers: studio, body: data === undefined ? undefined : JSON.stringify(data) }), env);
  let i = 0;
  const gallery = async (over: Partial<Gallery> = {}) => {
    i++;
    const id = `a5${n.toString(16).padStart(2, '0')}${i.toString(16).padStart(12, '0')}`;
    await store.putGallery({ id, tenantId: tid, kind: 'photos', coupleName: `זוג ${i}`, date: '2026-10-19', films: [], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), days: 30, hasCover: false, views: 0, downloads: 0, ...over } as Gallery);
    return id;
  };
  const load = async (id: string) => (await call('POST', `/api/admin/galleries/${id}/photos/load`, { url: FOLDER })).json() as Promise<PhotoData & { studioAlbum: { configured: boolean; own: boolean } }>;
  const studioRefs = async (id: string) => ((await store.getPhotosVersioned(id))?.data.items ?? []).filter((x) => x.studio).map((x) => x.ref);
  return { tid, store, call, gallery, load, studioRefs };
}

describe('the album-choice folder in the settings', () => {
  it('saved once: read now; a new gallery gets its photos on load, the set kept from the guests', async () => {
    const { call, gallery, load, store, studioRefs } = await setup();
    const saved = (await (await call('PUT', '/api/admin/album-set', { url: PRICES })).json()) as { albumSet: { items: { name: string }[] }; galleries: string[] };
    expect(saved.albumSet.items.map((x) => x.name)).toEqual(['מחירון-1.jpg', 'מחירון-2.jpg', 'מחירון-3.jpg', 'מחירון-4.jpg']);
    const id = await gallery();
    const loaded = await load(id);
    expect(loaded.items).toHaveLength(34);
    expect(loaded.studioAlbum).toEqual({ configured: true, own: false });
    expect(await studioRefs(id)).toHaveLength(4);
    const album = loaded.sets.find((s) => s.name === ALBUM_SET)!.id;
    expect((await store.getGallery(id))?.guestHiddenSets).toEqual([album]);
    // Loading the folder again keeps them, with the same keys.
    const keys = loaded.items.filter((x) => x.studio).map((x) => x.key);
    const again = await load(id);
    expect(again.items.filter((x) => x.studio).map((x) => x.key)).toEqual(keys);
    // A preview for the settings screen; one that isn't there.
    expect((await call('GET', '/api/admin/album-set/photo/0')).status).toBe(200);
    expect((await call('GET', '/api/admin/album-set/photo/9')).status).toBe(404);
  });

  it('the screen applies it to the galleries there; switched off in one; the folder removed: gone everywhere', async () => {
    const { call, gallery, load, studioRefs } = await setup();
    const a = await gallery();
    const b = await gallery();
    await load(a);
    await load(b);
    const empty = await gallery();
    const { galleries } = (await (await call('PUT', '/api/admin/album-set', { url: PRICES })).json()) as { galleries: string[] };
    expect(galleries.sort()).toEqual([a, b, empty].sort());
    const applied = (await (await call('POST', '/api/admin/album-set/apply', { ids: galleries })).json()) as { changed: string[] };
    expect(applied.changed.sort()).toEqual([a, b].sort());
    expect(await studioRefs(a)).toHaveLength(4);
    // Nothing new: nothing written.
    expect(((await (await call('POST', '/api/admin/album-set/apply', { ids: [a, b] })).json()) as { changed: string[] }).changed).toEqual([]);
    // Off in one gallery, and it stays off through "apply".
    const off = (await (await call('PUT', `/api/admin/galleries/${b}/photos/album-set`, { on: false })).json()) as PhotoData;
    expect(off.studioSetOff).toBe(true);
    await call('POST', '/api/admin/album-set/apply', { ids: [a, b] });
    expect(await studioRefs(b)).toEqual([]);
    await call('PUT', `/api/admin/galleries/${b}/photos/album-set`, { on: true });
    expect(await studioRefs(b)).toHaveLength(4);
    // No folder in the settings: "apply" takes them out.
    await call('PUT', '/api/admin/album-set', { url: '' });
    await call('POST', '/api/admin/album-set/apply', { ids: [a, b] });
    expect([await studioRefs(a), await studioRefs(b)]).toEqual([[], []]);
    expect((await call('POST', '/api/admin/album-set/apply', { ids: Array.from({ length: 9 }, (_, i) => `x${i}`) })).status).toBe(400);
  });

  it("another studio's gallery is never touched; the measured shapes are kept", async () => {
    const one = await setup();
    const other = await setup();
    const theirs = await other.gallery();
    await other.load(theirs);
    await one.call('PUT', '/api/admin/album-set', { url: PRICES });
    const r = (await (await one.call('POST', '/api/admin/album-set/apply', { ids: [theirs] })).json()) as { skipped: string[] };
    expect(r.skipped).toEqual([theirs]);
    expect(await other.studioRefs(theirs)).toEqual([]);
    const { albumSet } = (await (await one.call('GET', '/api/admin/album-set')).json()) as { albumSet: { items: { ref: string }[] } };
    await one.call('PUT', '/api/admin/album-set/sizes', { ars: { [albumSet.items[0].ref]: 0.707, [albumSet.items[1].ref]: 'x' } });
    const after = (await (await one.call('GET', '/api/admin/album-set')).json()) as { albumSet: { items: { ar: number | null }[] } };
    expect(after.albumSet.items.map((x) => x.ar)).toEqual([0.707, null, null, null]);
  });
});
