// Ported from the Avira films app (2026-09-27): several photos at once, personal lists, the
// gallery's design, and the picture next to each gallery in the studio's list.
import { describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import { storeFor } from '../worker/store';
import { MemoryStore } from '../worker/store-memory';
import type { Env } from '../worker/types';
import { fakeEnv } from './fake-kv';

const env = { ...fakeEnv(), CLOUD_MOCK: '1' } as Env;
let n = 100;

const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  worker.fetch(
    new Request(`https://films.test${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `1.2.4.${n}`, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );

const KEYS = ['aaaaaaaa', 'bbbbbbbb', 'cccccccc'];

async function setup() {
  n++;
  const tid = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const studio = { Authorization: `Bearer test:u${n}:${tid}:owner` };
  const store = (await storeFor(env)) as MemoryStore;
  store.seedTenant({ id: tid, slug: `studio-${n}y` });
  const g = (await (await call('POST', '/api/admin/galleries', { coupleName: 'מאי & אופק', kind: 'photos' }, studio)).json()) as { id: string };
  await store.savePhotos(tid, g.id, { folderUrl: '', provider: 'mock', sets: [], items: KEYS.map((key) => ({ key, name: `${key}.jpg`, ref: `m:/${key}.jpg` })) });
  return { studio, id: g.id, store };
}

type Watch = { favorites: string[]; insta: string[]; lists: { id: string; name: string; keys: string[] }[]; photos: { design: Record<string, string> } };
const watch = async (id: string) => (await (await call('GET', `/api/watch/${id}`)).json()) as Watch;

describe('several photos at once', () => {
  it('marks and unmarks favourites and Instagram for a whole selection', async () => {
    const { id } = await setup();
    expect((await call('POST', `/api/watch/${id}/fav`, { keys: KEYS, on: true })).status).toBe(200);
    expect((await call('POST', `/api/watch/${id}/insta`, { keys: KEYS.slice(0, 2), on: true })).status).toBe(200);
    let w = await watch(id);
    expect([...w.favorites].sort()).toEqual(KEYS);
    expect([...w.insta].sort()).toEqual(KEYS.slice(0, 2));
    await call('POST', `/api/watch/${id}/fav`, { keys: ['aaaaaaaa'], on: false });
    w = await watch(id);
    expect([...w.favorites].sort()).toEqual(KEYS.slice(1));
  });

  it('ignores keys that are not in the gallery', async () => {
    const { id } = await setup();
    expect((await call('POST', `/api/watch/${id}/fav`, { keys: ['deadbeef'], on: true })).status).toBe(404);
    expect((await call('POST', `/api/watch/${id}/fav`, { keys: ['deadbeef', 'aaaaaaaa'], on: true })).status).toBe(200);
    expect((await watch(id)).favorites).toEqual(['aaaaaaaa']);
  });
});

describe('personal lists', () => {
  it('creates, fills, renames, empties and deletes a list', async () => {
    const { id } = await setup();
    const made = (await (await call('POST', `/api/watch/${id}/lists`, { name: ' של  אופק ', keys: ['aaaaaaaa'] })).json()) as { id: string };
    expect(made.id).toMatch(/^[0-9a-f]{12}$/);
    // The same name gives the same list.
    const again = (await (await call('POST', `/api/watch/${id}/lists`, { name: 'של אופק', keys: ['bbbbbbbb'] })).json()) as { id: string };
    expect(again.id).toBe(made.id);
    let w = await watch(id);
    expect(w.lists).toEqual([{ id: made.id, name: 'של אופק', keys: ['aaaaaaaa', 'bbbbbbbb'] }]);

    await call('PUT', `/api/watch/${id}/lists/${made.id}`, { name: 'לסבתא', keys: ['aaaaaaaa'], on: false });
    w = await watch(id);
    expect(w.lists[0]).toMatchObject({ name: 'לסבתא', keys: ['bbbbbbbb'] });

    expect((await call('PUT', `/api/watch/${id}/lists/000000000000`, { name: 'x' })).status).toBe(404);
    expect((await call('DELETE', `/api/watch/${id}/lists/${made.id}`)).status).toBe(200);
    expect((await watch(id)).lists).toEqual([]);
  });

  it('needs a name and is only for the couple', async () => {
    const { id, studio } = await setup();
    expect((await call('POST', `/api/watch/${id}/lists`, { name: '   ' })).status).toBe(400);
    const admin = (await (await call('GET', `/api/admin/galleries/${id}`, undefined, studio)).json()) as { guestId: string };
    expect((await call('POST', `/api/watch/${admin.guestId}/lists`, { name: 'אורח' })).status).toBeGreaterThanOrEqual(403);
    const guest = (await (await call('GET', `/api/watch/${admin.guestId}`)).json()) as { lists?: unknown };
    expect(guest.lists ?? []).toEqual([]);
  });

  it('goes away with the gallery', async () => {
    const { id, studio, store } = await setup();
    await call('POST', `/api/watch/${id}/lists`, { name: 'א', keys: ['aaaaaaaa'] });
    expect(await store.listLists(id)).toHaveLength(1);
    await store.deleteGallery(id);
    expect(await store.listLists(id)).toEqual([]);
    void studio;
  });
});

describe('design', () => {
  it("uses the gallery's choices over the studio default", async () => {
    const { id, studio } = await setup();
    expect((await watch(id)).photos.design).toMatchObject({ cover: 'center', color: 'light' });

    const s = (await (await call('PUT', '/api/admin/settings', { designDefault: { color: 'dark', cover: 'nope' } }, studio)).json()) as { designDefault: Record<string, string> };
    expect(s.designDefault).toMatchObject({ color: 'dark', cover: 'center' });
    expect((await watch(id)).photos.design).toMatchObject({ color: 'dark' });

    expect((await call('PUT', `/api/admin/galleries/${id}/photos`, { design: { cover: 'journal', font: 'serif' } }, studio)).status).toBe(200);
    expect((await watch(id)).photos.design).toMatchObject({ cover: 'journal', font: 'serif', color: 'light' });
  });
});

describe("the studio list's pictures", () => {
  it('gives photo galleries their cover photo and film galleries a frame once saved', async () => {
    const { studio, id, store } = await setup();
    const films = (await (await call('POST', '/api/admin/galleries', { coupleName: 'נועה', kind: 'films' }, studio)).json()) as { id: string };
    type Row = { id: string; kind?: string; thumb: string; previewToken?: string };
    // The cover is saved with the gallery when the studio's screen saves the list (cover_key).
    expect((await call('PUT', `/api/admin/galleries/${id}/photos`, { cover: 'aaaaaaaa' }, studio)).status).toBe(200);
    const lists = vi.spyOn(store, 'getPhotos');
    let list = (await (await call('GET', '/api/admin/galleries', undefined, studio)).json()) as Row[];
    expect(lists, 'the list reads no photo lists (P62)').not.toHaveBeenCalled();
    lists.mockRestore();
    const photoRow = list.find((g) => g.kind === 'photos')!;
    expect(photoRow.thumb).toMatch(/^\/api\/photos\/[0-9a-f]+\/v\d+\/aaaaaaaa\?s=m&pt=/);
    const filmRow = list.find((g) => g.id === films.id)!;
    expect(filmRow.thumb).toBe('');
    expect(filmRow.previewToken).toBeTruthy();

    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const up = await worker.fetch(new Request(`https://films.test/api/admin/galleries/${films.id}/thumb`, { method: 'POST', headers: { ...studio, 'Content-Type': 'image/jpeg' }, body: jpeg }), env);
    expect(up.status).toBe(200);
    list = (await (await call('GET', '/api/admin/galleries', undefined, studio)).json()) as Row[];
    const saved = list.find((g) => g.id === films.id)!;
    expect(saved.thumb).toMatch(new RegExp(`^/api/admin/galleries/${films.id}/thumb\\?pt=`));
    const pic = await call('GET', saved.thumb);
    expect(pic.status).toBe(200);
    expect(pic.headers.get('Content-Type')).toBe('image/jpeg');
    expect((await call('GET', `/api/admin/galleries/${films.id}/thumb?pt=wrong`)).status).toBeGreaterThanOrEqual(401);
  });
});
