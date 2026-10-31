// The couple's "we finished choosing" (Avira, 2026-10-31; 0099): the press locks their hearts and sends the album group
// one message (however many times it is pressed), the private link shows and serves only the chosen photos, the studio
// reopens the choice and renews or stops the link. Synthetic photos only.
import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import { photoKey } from '../worker/photos';
import { storeFor } from '../worker/store';
import type { MemoryStore } from '../worker/store-memory';
import type { Env, Gallery } from '../worker/types';
import { fakeEnv } from './fake-kv';

const env = {
  ...fakeEnv(),
  CLOUD_MOCK: '1',
  HUB_URL: 'https://hub.example',
  ASSETS: { fetch: async () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { headers: { 'Content-Type': 'image/jpeg' } }) },
} as unknown as Env;

let n = 0;
async function setup(over: Partial<Gallery> = {}) {
  n++;
  const tid = `00000000-0000-4000-8000-${(0xc1000 + n).toString(16).padStart(12, '0')}`;
  const store = (await storeFor(env)) as MemoryStore;
  store.seedTenant({ id: tid, slug: `choice-${n}`, photos: true });
  const studio = { Authorization: `Bearer test:u-c-${n}:${tid}:owner`, Origin: 'https://hub.example', 'Content-Type': 'application/json' };
  const id = `c1${n.toString(16).padStart(2, '0')}${'0'.repeat(12)}`;
  await store.putGallery({ id, tenantId: tid, kind: 'photos', coupleName: 'מאי & אופק', date: '2026-09-01', films: [], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), days: 30, hasCover: false, views: 0, downloads: 0, ...over } as Gallery);
  const refs = Array.from({ length: 6 }, (_, i) => `m:/demo/photos/${String(i + 1).padStart(2, '0')}.jpg`);
  const items = refs.map((ref, i) => ({ key: photoKey(ref), name: `IMG_${i + 1}.jpg`, ref, ar: 1.5, ...(i === 5 ? { hidden: true } : {}) }));
  await store.savePhotos(tid, id, { folderUrl: 'https://www.dropbox.com/scl/fo/x/y?rlkey=k&dl=0', provider: 'mock', sets: [], items });
  const call = (method: string, path: string, data?: unknown, headers: Record<string, string> = { 'Content-Type': 'application/json' }) =>
    worker.fetch(new Request(`https://films.test${path}`, { method, headers, body: data === undefined ? undefined : JSON.stringify(data) }), env);
  return { tid, id, store, items, call, studio };
}

describe('the couple finishes choosing', () => {
  it('nothing chosen: refused; chosen: locked, counted, one message for two presses, a private link', async () => {
    const { tid, id, store, items, call } = await setup();
    expect((await call('POST', `/api/watch/${id}/choice`, {})).status).toBe(400);
    // Three shown photos and the hidden one: the hidden one is never counted or sent.
    await store.setHearts(tid, id, [items[0].key, items[1].key, items[2].key, items[5].key], true, 'מאי');
    const [a, b] = await Promise.all([call('POST', `/api/watch/${id}/choice`, {}), call('POST', `/api/watch/${id}/choice`, {})]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await a.json()) as object).toMatchObject({ choiceDoneCount: 3 });
    expect(store.choiceNotified.filter((g) => g === id)).toHaveLength(1);
    const g = (await store.getGallery(id))!;
    expect(g).toMatchObject({ choiceDoneCount: 3 });
    expect(g.choiceToken).toMatch(/^[A-Za-z0-9_-]{20,64}$/);
    // The couple's page knows; their hearts are locked.
    expect(await (await call('GET', `/api/watch/${id}`)).json()).toMatchObject({ choiceDoneCount: 3, choiceDoneAt: g.choiceDoneAt });
    const fav = await call('POST', `/api/watch/${id}/fav`, { key: items[3].key, on: true });
    expect(fav.status).toBe(409);
    expect(await fav.json()).toMatchObject({ code: 'choice_done' });
    // Pressing again later sends nothing more.
    await call('POST', `/api/watch/${id}/choice`, {});
    expect(store.choiceNotified.filter((x) => x === id)).toHaveLength(1);
  });

  it('the private link: only the chosen photos, any size; nothing else of the gallery', async () => {
    const { tid, id, store, items, call } = await setup();
    await store.setHearts(tid, id, [items[0].key, items[2].key, items[5].key], true, '');
    await call('POST', `/api/watch/${id}/choice`, {});
    const token = (await store.getGallery(id))!.choiceToken!;
    const page = (await (await call('GET', `/api/choice/${token}`)).json()) as { coupleName: string; items: { key: string; name: string }[]; base: string };
    expect(page.coupleName).toBe('מאי & אופק');
    expect(page.items.map((i) => i.key)).toEqual([items[0].key, items[2].key]);
    expect(page.base).toBe(`/api/choice/${token}/photo/v0`);
    expect((await call('GET', `${page.base}/${items[0].key}?s=full`)).status).toBe(200);
    expect((await call('GET', `${page.base}/${items[1].key}?s=m`)).status).toBe(404);
    expect((await call('GET', `${page.base}/${items[5].key}?s=m`)).status).toBe(404);
    expect((await call('GET', `/api/choice/${'x'.repeat(24)}`)).status).toBe(404);
  });

  it('the studio reopens the choice, renews and stops the link; a closed gallery stops it too', async () => {
    const { tid, id, store, items, call, studio } = await setup();
    await store.setHearts(tid, id, [items[0].key], true, '');
    await call('POST', `/api/watch/${id}/choice`, {});
    const first = (await store.getGallery(id))!.choiceToken!;
    // Not the couple's to reopen.
    expect((await call('POST', `/api/admin/galleries/${id}/choice/reopen`)).status).toBe(401);
    const reopened = (await (await call('POST', `/api/admin/galleries/${id}/choice/reopen`, undefined, studio)).json()) as Gallery;
    expect(reopened.choiceDoneAt).toBeUndefined();
    expect(reopened.choiceToken).toBe(first);
    expect((await call('POST', `/api/watch/${id}/fav`, { key: items[1].key, on: true })).status).toBe(200);
    // A new link: the old one stops.
    const renewed = (await (await call('POST', `/api/admin/galleries/${id}/choice-link`, { renew: true }, studio)).json()) as Gallery;
    expect(renewed.choiceToken).not.toBe(first);
    expect((await call('GET', `/api/choice/${first}`)).status).toBe(404);
    expect((await call('GET', `/api/choice/${renewed.choiceToken}`)).status).toBe(200);
    // Stopped.
    await call('DELETE', `/api/admin/galleries/${id}/choice-link`, undefined, studio);
    expect((await call('GET', `/api/choice/${renewed.choiceToken}`)).status).toBe(404);
    // Closed.
    const again = (await (await call('POST', `/api/admin/galleries/${id}/choice-link`, {}, studio)).json()) as Gallery;
    await store.patchGallery(tid, id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect((await call('GET', `/api/choice/${again.choiceToken}`)).status).toBe(410);
  });
});
