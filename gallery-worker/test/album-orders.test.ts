import { describe, expect, it } from 'vitest';
import { albumOrderToken, albumSummary, orderLink, orderingOf, sha256Hex, submitAlbum } from '../worker/albums';
import worker from '../worker/index';
import { storeFor } from '../worker/store';
import { MemoryStore } from '../worker/store-memory';
import type { Env, Gallery } from '../worker/types';
import { fakeEnv } from './fake-kv';

const secret = 'test-secret';
const hub = 'https://app.example';

describe('album orders from the designer', () => {
  it('a studio without album orders: sending goes to the studio only', () => {
    expect(orderingOf({ crm: false })).toBeNull();
  });

  it("uses the studio's page price and included pages, or none (never 0 or 45 made up — fix plan P53)", () => {
    expect(orderingOf({ crm: true, extraPagePrice: 50, includedSpreads: 26, order: null })).toEqual({ extraSpreadPrice: 50, includedSpreads: 26, status: 'draft' });
    expect(orderingOf({ crm: true, extraPagePrice: null, order: null })).toEqual({ extraSpreadPrice: null, includedSpreads: null, status: 'draft' });
  });

  it("the summaries price the album by the studio's numbers; none set → no price", () => {
    const store = new MemoryStore();
    const album = { size: '80x30', spreads: Array.from({ length: 32 }, (_, i) => ({ id: `s${i}`, template: 't1', fills: [], texts: [] })), status: 'draft', updatedAt: '' };
    expect(albumSummary(album as never, orderingOf({ crm: true, extraPagePrice: 52, includedSpreads: 30 }))).toMatchObject({ extraSpreads: 2, extraCost: 104 });
    expect(albumSummary(album as never, orderingOf({ crm: true, extraPagePrice: 52, includedSpreads: 28 }))).toMatchObject({ extraSpreads: 4, extraCost: 208 });
    expect(albumSummary(album as never, orderingOf({ crm: true, extraPagePrice: null, includedSpreads: 30 }))).toMatchObject({ extraSpreads: 2, extraCost: null });
    expect(albumSummary(album as never, null)).toMatchObject({ extraSpreads: 2, extraCost: null });
    // MemoryStore's made-up studio charges 52, not the real studio's 45.
    expect(store.albumExtraPagePrice).toBe(52);
    expect(store.albumIncludedSpreads).toBe(30);
  });

  it('the couple link works only while the order keeps its own token', async () => {
    const token = await albumOrderToken(secret, 'a1a1a1a1a1a1a1a1');
    expect(token).toBe(await albumOrderToken(secret, 'a1a1a1a1a1a1a1a1'));
    expect(token).not.toBe(await albumOrderToken(secret, 'b1b1b1b1b1b1b1b1'));
    expect(token).not.toContain('a1a1a1a1a1a1a1a1');
    const order = { id: 'o1', workflowStatus: 'approved', paymentStatus: 'unpaid', tokenHash: await sha256Hex(token), revoked: false };
    expect(await orderLink(secret, hub, 'a1a1a1a1a1a1a1a1', { crm: true, order })).toEqual({ url: `${hub}/album/${token}` });
    expect(await orderLink(secret, hub, 'a1a1a1a1a1a1a1a1', { crm: true, order: { ...order, tokenHash: 'studio-made' } })).toMatchObject({ status: 409 });
    expect(await orderLink(secret, hub, 'a1a1a1a1a1a1a1a1', { crm: true, order: { ...order, revoked: true } })).toMatchObject({ status: 403 });
    expect(await orderLink(secret, hub, 'a1a1a1a1a1a1a1a1', { crm: true, order: null })).toMatchObject({ status: 404 });
  });

  it('P73: signs with a key of its own, and an order sent before (the old token) keeps its link', async () => {
    const { hmac } = await import('../worker/auth');
    const oldToken = await hmac(secret, 'album-order:a1a1a1a1a1a1a1a1');
    const token = await albumOrderToken(secret, 'a1a1a1a1a1a1a1a1');
    expect(token).not.toBe(oldToken);
    const order = { id: 'o1', workflowStatus: 'approved', paymentStatus: 'unpaid', tokenHash: await sha256Hex(oldToken), revoked: false };
    expect(await orderLink(secret, hub, 'a1a1a1a1a1a1a1a1', { crm: true, order })).toEqual({ url: `${hub}/album/${oldToken}` });
    // The old token of another gallery is still refused.
    expect(await orderLink(secret, hub, 'b1b1b1b1b1b1b1b1', { crm: true, order })).toMatchObject({ status: 409 });
  });

  it('sending twice is one send', async () => {
    const store = new MemoryStore();
    await store.putAlbum('t', 'a1a1a1a1a1a1a1a1', { size: '80x30', spreads: [], status: 'draft' } as never);
    expect((await submitAlbum(store, 't', 'a1a1a1a1a1a1a1a1')).sent).toBe(true);
    expect((await submitAlbum(store, 't', 'a1a1a1a1a1a1a1a1')).sent).toBe(false);
  });
});

// ---------- fix plan P71: a designed album keeps its gallery (decisions D15(5), D18(6)) ----------

describe('P71: the trash and a designed album', () => {
  const env = { ...fakeEnv(), CLOUD_MOCK: '1' } as unknown as Env;
  let n = 0;
  async function studio() {
    const tid = `00000000-0000-4000-8000-${(0x71a00 + ++n).toString(16).padStart(12, '0')}`;
    const store = (await storeFor(env)) as MemoryStore;
    store.seedTenant({ id: tid, slug: `album-guard-${n}` });
    const auth = { Authorization: `Bearer test:u${n}:${tid}:owner`, 'Content-Type': 'application/json' };
    const call = async (method: string, path: string, data?: unknown) => {
      const res = await worker.fetch(new Request(`https://films.test${path}`, { method, headers: auth, body: data === undefined ? undefined : JSON.stringify(data) }), env);
      return { status: res.status, json: (await res.json()) as Record<string, any> };
    };
    const photoGallery = async (i: number, over: Partial<Gallery> = {}) => {
      const id = `${(0x71a0 + n).toString(16)}${i.toString(16).padStart(12, '0')}`;
      await store.putGallery({ id, tenantId: tid, kind: 'photos', coupleName: `Album ${i}`, date: '', films: [], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), days: 30, hasCover: false, views: 0, downloads: 0, ...over } as Gallery);
      return id;
    };
    const sent = (id: string) => store.putAlbum(tid, id, { size: '80x30', spreads: [], status: 'submitted', submittedAt: new Date().toISOString() } as never);
    const order = (id: string, workflowStatus: string, paymentStatus = 'unpaid') => store.albumOrders.set(id, { id: `o-${id}`, workflowStatus, paymentStatus, tokenHash: null, revoked: false, spreads: 10 });
    return { tid, store, call, photoGallery, sent, order };
  }

  it('a sent album goes to the trash only with the studio\'s explicit yes', async () => {
    const { store, call, photoGallery, sent } = await studio();
    const id = await photoGallery(1);
    await sent(id);
    const asked = await call('DELETE', `/api/admin/galleries/${id}`);
    expect(asked).toMatchObject({ status: 409, json: { code: 'album_submitted' } });
    expect((await store.getGallery(id))?.deletedAt).toBeUndefined();
    expect((await call('DELETE', `/api/admin/galleries/${id}?force=1`)).status).toBe(200);
    expect((await store.getGallery(id))?.deletedAt).toBeTruthy();
  });

  it('an open album order keeps the gallery out of the trash, even with a yes; a delivered one needs the yes', async () => {
    const { store, call, photoGallery, sent, order } = await studio();
    const open = await photoGallery(1);
    await sent(open);
    order(open, 'awaiting_payment');
    expect(await call('DELETE', `/api/admin/galleries/${open}?force=1`)).toMatchObject({ status: 409, json: { code: 'album_order' } });
    const done = await photoGallery(2);
    order(done, 'delivered', 'paid');
    const plain = await photoGallery(3);
    const batch = await call('POST', '/api/admin/galleries/batch', { action: 'trash', ids: [open, done, plain] });
    expect(batch.json).toMatchObject({ done: 1, doneIds: [plain] });
    expect(batch.json.skipped).toEqual([
      { id: open, reason: 'album_order' },
      { id: done, reason: 'album_submitted' },
    ]);
    // The screen asks, then sends those again with `force`: the open order still keeps its gallery.
    const forced = await call('POST', '/api/admin/galleries/batch', { action: 'trash', ids: [open, done], force: true });
    expect(forced.json).toMatchObject({ done: 1, doneIds: [done], skipped: [{ id: open, reason: 'album_order' }] });
    expect((await store.getGallery(open))?.deletedAt).toBeUndefined();
  });

  it('a paid or printing album order: never removed for good, not even with a yes', async () => {
    const { store, call, photoGallery, order } = await studio();
    const paid = await photoGallery(1, { deletedAt: new Date().toISOString() });
    order(paid, 'delivered', 'paid');
    const printing = await photoGallery(2, { deletedAt: new Date().toISOString() });
    order(printing, 'in_print', 'transfer_pending_review');
    const free = await photoGallery(3, { deletedAt: new Date().toISOString() });
    expect(await call('DELETE', `/api/admin/galleries/${paid}?forever=1&force=1`)).toMatchObject({ status: 409, json: { code: 'album_paid' } });
    const batch = await call('POST', '/api/admin/galleries/batch', { action: 'purge', ids: [paid, printing, free], force: true });
    expect(batch.json).toMatchObject({ done: 1, doneIds: [free] });
    expect(batch.json.skipped).toEqual([
      { id: paid, reason: 'album_paid' },
      { id: printing, reason: 'album_paid' },
    ]);
    expect(await store.getGallery(paid)).not.toBeNull();
    expect(await store.getAlbum(free)).toBeNull();
    // Restoring it is always allowed.
    expect((await call('POST', `/api/admin/galleries/${paid}/restore`)).status).toBe(200);
  });
});

// ---------- fix plan P57: saves that never overwrite, and an order made every time (decision D17(4)) ----------

describe('P57: the album designer saves and sends', () => {
  const env = { ...fakeEnv(), CLOUD_MOCK: '1' } as unknown as Env;
  let n = 0;
  const KEYS = ['aaaaaaaa', 'bbbbbbbb', 'cccccccc', 'dddddddd'];
  async function couple(over: Partial<Gallery> = {}) {
    n++;
    const tid = `00000000-0000-4000-8000-${(0x57a00 + n).toString(16).padStart(12, '0')}`;
    const store = (await storeFor(env)) as MemoryStore;
    store.seedTenant({ id: tid, slug: `p57-${n}` });
    const id = `${(0x57b0 + n).toString(16)}${'0'.repeat(12)}`;
    await store.putGallery({ id, tenantId: tid, kind: 'photos', coupleName: 'P57', date: '', films: [], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), days: 30, hasCover: false, views: 0, downloads: 0, ...over } as Gallery);
    await store.savePhotos(tid, id, { folderUrl: '', provider: 'mock', sets: [], items: KEYS.map((key) => ({ key, name: `${key}.jpg`, ref: `m:/${key}.jpg` })) });
    const call = async (method: string, path: string, data?: unknown, raw?: string) => {
      const res = await worker.fetch(new Request(`https://films.test${path}`, { method, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `5.7.0.${n}` }, body: raw ?? (data === undefined ? undefined : JSON.stringify(data)) }), env);
      return { status: res.status, json: (await res.json()) as Record<string, any> };
    };
    const spread = (i: number, photo = '') => ({ id: `s${i}`, template: 't01', fills: [{ photo }], texts: [] });
    const album = (pages: number, photo = KEYS[0]) => ({ size: '80x30', spreads: Array.from({ length: pages }, (_, i) => spread(i, i === 1 ? photo : '')) });
    return { tid, id, store, call, album };
  }

  it('an order that failed to be made never locks the album: 200 with orderPending, and sending again makes it', async () => {
    const { id, store, call, album } = await couple();
    const first = await call('PUT', `/api/watch/${id}/album`, { album: album(3), rev: 0 });
    expect(first.status).toBe(200);
    store.failAlbumOrders.fromDesign = 1;
    const sent = await call('POST', `/api/watch/${id}/album/submit`, { rev: first.json.album.rev });
    expect(sent).toMatchObject({ status: 200, json: { orderPending: true, album: { status: 'submitted' } } });
    expect(store.albumOrders.get(id)).toBeUndefined();
    expect((await call('GET', `/api/watch/${id}/album/order`)).status).toBe(404);
    // "להמשך ההזמנה" sends again: the album is already sent, the missing order is made.
    const again = await call('POST', `/api/watch/${id}/album/submit`, {});
    expect(again.status).toBe(200);
    expect(again.json.orderPending).toBeUndefined();
    expect(store.albumOrders.get(id)).toMatchObject({ spreads: 3, workflowStatus: 'approved' });
    expect((await call('GET', `/api/watch/${id}/album/order`)).status).toBe(200);
  });

  it('the album page opens when the order state cannot be read', async () => {
    const { id, store, call, album } = await couple();
    await call('PUT', `/api/watch/${id}/album`, { album: album(2), rev: 0 });
    store.failAlbumOrders.state = 1;
    const r = await call('GET', `/api/watch/${id}/album`);
    expect(r).toMatchObject({ status: 200, json: { ordering: null, orderingFailed: true, album: { spreads: [{}, {}] } } });
  });

  it('a closed gallery: an album already sent may be sent again to make its order; a draft may not', async () => {
    const { id, store, call, album } = await couple();
    const saved = await call('PUT', `/api/watch/${id}/album`, { album: album(2), rev: 0 });
    store.failAlbumOrders.fromDesign = 1;
    await call('POST', `/api/watch/${id}/album/submit`, { rev: saved.json.album.rev });
    await store.patchGallery(store.galleries.get(id)!.tenantId, id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    const again = await call('POST', `/api/watch/${id}/album/submit`, {});
    expect(again.status).toBe(200);
    expect(store.albumOrders.get(id)).toBeTruthy();
    const other = await couple({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    await other.store.putAlbum(other.tid, other.id, { ...other.album(2), status: 'draft', updatedAt: '' } as never);
    expect((await other.call('POST', `/api/watch/${other.id}/album/submit`, {})).status).toBe(410);
  });

  it('a resend while a transfer proof waits is charged like an unpaid order (the new page count)', async () => {
    const { tid, id, store, call, album } = await couple();
    const saved = await call('PUT', `/api/watch/${id}/album`, { album: album(3), rev: 0 });
    await call('POST', `/api/watch/${id}/album/submit`, { rev: saved.json.album.rev });
    Object.assign(store.albumOrders.get(id)!, { workflowStatus: 'awaiting_payment', paymentStatus: 'transfer_pending_review' });
    // The studio reopens the album; the couple adds a page and sends it again.
    await store.putAlbum(tid, id, { ...(await store.getAlbum(id))!, status: 'draft' });
    const rev = (await store.getAlbum(id))!.rev;
    const more = await call('PUT', `/api/watch/${id}/album`, { album: album(4), rev });
    await call('POST', `/api/watch/${id}/album/submit`, { rev: more.json.album.rev });
    expect(store.albumOrders.get(id)).toMatchObject({ spreads: 4, workflowStatus: 'approved', paymentStatus: 'unpaid' });
  });

  it("a gallery of an event with the studio's open order joins it (no second order)", async () => {
    const { tid, id, store, call, album } = await couple({ eventId: '00000000-0000-4000-8000-0000000e0057' });
    store.eventAlbumOrders.set('00000000-0000-4000-8000-0000000e0057', [{ id: 'studio-order', tenantId: tid }]);
    const saved = await call('PUT', `/api/watch/${id}/album`, { album: album(2), rev: 0 });
    await call('POST', `/api/watch/${id}/album/submit`, { rev: saved.json.album.rev });
    expect(store.albumOrders.get(id)).toMatchObject({ id: 'studio-order', spreads: 2 });
  });

  it('a save from a stale copy (another tab or device) gets 409 with the saved album, and changes nothing', async () => {
    const { id, store, call, album } = await couple();
    const a = await call('PUT', `/api/watch/${id}/album`, { album: album(3), rev: 0 });
    const rev = a.json.album.rev;
    const tabB = await call('PUT', `/api/watch/${id}/album`, { album: album(5), rev });
    expect(tabB.status).toBe(200);
    const tabA = await call('PUT', `/api/watch/${id}/album`, { album: album(2), rev });
    expect(tabA).toMatchObject({ status: 409, json: { code: 'album_conflict', error: 'האלבום עודכן ממכשיר אחר. מוצגת הגרסה העדכנית.' } });
    expect(tabA.json.album.spreads).toHaveLength(5);
    expect((await store.getAlbum(id))!.spreads).toHaveLength(5);
    // Sending names the copy too.
    expect((await call('POST', `/api/watch/${id}/album/submit`, { rev })).status).toBe(409);
    expect((await store.getAlbum(id))!.status).toBe('draft');
  });

  it('an album of 61 pages is refused whole and the saved one stays; a body over 512 KB too', async () => {
    const { id, store, call, album } = await couple();
    const a = await call('PUT', `/api/watch/${id}/album`, { album: album(30), rev: 0 });
    const big = await call('PUT', `/api/watch/${id}/album`, { album: album(61), rev: a.json.album.rev });
    expect(big).toMatchObject({ status: 400, json: { code: 'album_limits' } });
    expect(big.json.error).toContain('60 דפים');
    expect((await store.getAlbum(id))!.spreads).toHaveLength(30);
    const huge = await call('PUT', `/api/watch/${id}/album`, undefined, JSON.stringify({ album: album(2), rev: a.json.album.rev, pad: 'x'.repeat(600_000) }));
    expect(huge.status).toBe(413);
    expect((await store.getAlbum(id))!.spreads).toHaveLength(30);
  });

  it('a draft save never reads the photo list; the photos are checked when the album is sent', async () => {
    const { id, store, call, album } = await couple();
    const { forgetPhotoDocs } = await import('../worker/photos');
    forgetPhotoDocs();
    let reads = 0;
    const real = store.getPhotosVersioned.bind(store);
    store.getPhotosVersioned = async (gid: string) => (reads++, real(gid));
    try {
      const a = await call('PUT', `/api/watch/${id}/album`, { album: album(2, 'eeeeeeee'), rev: 0 });
      expect(a.status).toBe(200);
      expect(reads).toBe(0);
      // Sent: the photo that is not in the gallery leaves its slot, and the answer says so.
      const sent = await call('POST', `/api/watch/${id}/album/submit`, { rev: a.json.album.rev });
      expect(reads).toBe(1);
      expect(sent.json.removed).toBe(1);
      expect((await store.getAlbum(id))!.spreads[1].fills[0].photo).toBe('');
    } finally {
      store.getPhotosVersioned = real;
    }
  });
});
