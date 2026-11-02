// A photographer's landing page (Avira, 2026-11-02; 0102): his starred weddings only (his name on the gallery, or the
// event's "צלם 1"), never a gallery's id, each wedding's teaser photos (all of them once the studio opened it, still
// without a set kept from the guests or a hidden photo), preview sizes only, the page's own pictures only, views
// counted, and nothing at all once the page is off. Synthetic photos only.
import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import { weddingPhotos } from '../worker/photographerPage';
import { photoKey } from '../worker/photos';
import { storeFor } from '../worker/store';
import type { MemoryStore } from '../worker/store-memory';
import type { Env, Gallery } from '../worker/types';
import { fakeEnv } from './fake-kv';

const env = {
  ...fakeEnv(),
  CLOUD_MOCK: '1',
  ASSETS: { fetch: async () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { headers: { 'Content-Type': 'image/jpeg' } }) },
} as unknown as Env;

let n = 0;
async function setup() {
  n++;
  const tid = `00000000-0000-4000-8000-${(0xe1000 + n).toString(16).padStart(12, '0')}`;
  const store = (await storeFor(env)) as MemoryStore;
  store.seedTenant({ id: tid, slug: `pp-${n}`, photos: true, phone: '050-1234567' });
  let i = 0;
  const gallery = async (over: Partial<Gallery> = {}) => {
    i++;
    const id = `e1${n.toString(16).padStart(2, '0')}${i.toString(16).padStart(12, '0')}`;
    await store.putGallery({ id, tenantId: tid, kind: 'photos', coupleName: `זוג${i} כהן & בת${i} לוי`, date: `2026-0${i}-10`, venue: `אולם ${i}`, films: [], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), days: 30, hasCover: false, views: 0, downloads: 0, ...over } as Gallery);
    const refs = Array.from({ length: 6 }, (_, k) => `m:/demo/photos/${String(k + 1).padStart(2, '0')}.jpg`);
    const items = refs.map((ref, k) => ({ key: photoKey(ref), name: `IMG_${k}.jpg`, ref, ar: 1.5, set: k < 2 ? 'teaser' : k < 4 ? 'ready' : 'party', ...(k === 1 ? { hidden: true } : {}) }));
    await store.savePhotos(tid, id, { folderUrl: 'https://www.dropbox.com/scl/fo/x/y?rlkey=k&dl=0', provider: 'mock', sets: [{ id: 'teaser', name: 'טיזר' }, { id: 'ready', name: 'התארגנות' }, { id: 'party', name: 'מסיבה' }], items });
    return { id, keys: items.map((x) => x.key) };
  };
  const token = `pageToken${n}abcdefghijklmnop`;
  const page = { id: `00000000-0000-4000-9000-${n.toString(16).padStart(12, '0')}`, tenantId: tid, staffName: 'יריב', token, published: true, hiddenGalleries: [] as string[], fullGalleries: [] as string[], bio: 'מצלם רגעים אמיתיים', photoPath: '' };
  store.photographerPages.set(page.id, page);
  const call = (path: string) => worker.fetch(new Request(`https://films.test${path}`), env);
  return { tid, store, gallery, page, token, call };
}

describe("the photographer's page", () => {
  it('his starred weddings (also through the event), first names and venue, no gallery id, views counted', async () => {
    const { store, gallery, page, token, call } = await setup();
    const mine = await gallery({ studioFavorite: true, photographer: ' יריב ' });
    const viaEvent = await gallery({ studioFavorite: true, eventId: '11111111-1111-4111-8111-111111111111', hideVenue: true });
    store.eventTeams.set('11111111-1111-4111-8111-111111111111', { tenantId: page.tenantId, photographer: 'יריב' });
    const notStarred = await gallery({ photographer: 'יריב' });
    const someoneElse = await gallery({ studioFavorite: true, photographer: 'אבי' });
    const hidden = await gallery({ studioFavorite: true, photographer: 'יריב' });
    page.hiddenGalleries.push(hidden.id);
    const res = await call(`/api/photographer/${token}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; whatsapp: string; weddings: { ref: string; names: string; venue: string; month: string }[] };
    expect(body.name).toBe('יריב');
    expect(body.whatsapp).toBe('972501234567');
    expect(body.weddings.map((w) => w.names)).toEqual(['זוג2 & בת2', 'זוג1 & בת1']);
    expect(body.weddings.map((w) => w.venue)).toEqual(['', 'אולם 1']);
    expect(body.weddings[1].month).toBe('ינואר 2026');
    const text = JSON.stringify(body);
    for (const g of [mine, viaEvent, notStarred, someoneElse, hidden]) expect(text).not.toContain(g.id);
    expect(store.pageViews.get(page.id)).toBe(1);
  });

  it('a wedding shows its teaser; opened whole: every photo the guests may see; only those photos, in preview sizes', async () => {
    const { gallery, page, token, call } = await setup();
    const g = await gallery({ studioFavorite: true, photographer: 'יריב', guestHiddenSets: ['ready'] });
    const ref = ((await (await call(`/api/photographer/${token}`)).json()) as { weddings: { ref: string }[] }).weddings[0].ref;
    const teaser = (await (await call(`/api/photographer/${token}/w/${ref}`)).json()) as { items: { key: string }[]; base: string };
    // The teaser set without its hidden photo.
    expect(teaser.items.map((i) => i.key)).toEqual([g.keys[0]]);
    expect((await call(`${teaser.base}/${g.keys[0]}?s=l`)).status).toBe(200);
    expect((await call(`${teaser.base}/${g.keys[4]}?s=m`)).status).toBe(404);
    // Opened whole: no hidden photo, no set kept from the guests.
    page.fullGalleries.push(g.id);
    const whole = (await (await call(`/api/photographer/${token}/w/${ref}`)).json()) as { items: { key: string }[] };
    expect(whole.items.map((i) => i.key)).toEqual([g.keys[0], g.keys[4], g.keys[5]]);
    expect((await call(`${teaser.base}/${g.keys[4]}?s=m`)).status).toBe(200);
    expect((await call(`${teaser.base}/${g.keys[2]}?s=m`)).status).toBe(404);
    // A made-up wedding.
    expect((await call(`/api/photographer/${token}/w/notARealRef12345`)).status).toBe(404);
  });

  it("the page's own pictures only; switched off or unknown: nothing", async () => {
    const { store, page, token, call } = await setup();
    page.photoPath = `${page.tenantId}/${page.id}/photo.jpg`;
    store.objects.set(`photographer-pages/${page.photoPath}`, { body: new Uint8Array([1, 2, 3]).buffer, type: 'image/jpeg' });
    store.testimonials.set(page.id, [{ id: 't1', body: 'מדהים', coupleName: 'דניאלה ודן', sort: 0 }, { id: 't2', imagePath: 'other-tenant/x/shot.jpg', sort: 1 }]);
    const res = await call(`/api/photographer/${token}/img/photo`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect((await call(`/api/photographer/${token}/img/t2`)).status).toBe(404);
    const body = (await (await call(`/api/photographer/${token}`)).json()) as { photoUrl: string; testimonials: { body: string; imageUrl: string }[] };
    expect(body.photoUrl).toBe(`/api/photographer/${token}/img/photo`);
    expect(body.testimonials[0]).toMatchObject({ body: 'מדהים', imageUrl: '' });
    page.published = false;
    expect((await call(`/api/photographer/${token}`)).status).toBe(404);
    expect((await call(`/api/photographer/${token}/img/photo`)).status).toBe(404);
    expect((await call('/api/photographer/short')).status).toBe(404);
  });
});

describe('what a wedding shows', () => {
  it('no teaser set: the first photos', () => {
    const items = Array.from({ length: 50 }, (_, k) => ({ key: `k${k}`, name: '', ref: '' }));
    expect(weddingPhotos({ folderUrl: '', provider: 'mock', sets: [], items } as never, {}, false)).toHaveLength(40);
  });
});
