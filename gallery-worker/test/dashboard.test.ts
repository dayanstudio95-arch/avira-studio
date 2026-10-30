import { describe, expect, it } from 'vitest';
import { nightly } from '../worker/cleanup';
import { dashboard } from '../worker/dashboard';
import { purgeGallery, restoreGallery, trashGallery } from '../worker/galleries';
import { MemoryStore } from '../worker/store-memory';
import type { Gallery } from '../worker/types';

const DAY = 86_400_000;
const env = { KV: { delete: async () => {} } } as never;

function gallery(id: string, over: Partial<Gallery> = {}): Gallery {
  return { id, tenantId: 't1', kind: 'films', coupleName: `זוג ${id.slice(0, 2)}`, date: '', films: [], createdAt: new Date(Date.now() - 10 * DAY).toISOString(), expiresAt: new Date(Date.now() + 30 * DAY).toISOString(), days: 40, hasCover: false, views: 0, downloads: 0, ...over } as Gallery;
}

describe('galleries summary', () => {
  it('counts open galleries, lists those closing within a week and the most viewed; ignores the trash and other modules', async () => {
    const store = new MemoryStore();
    await store.putGallery(gallery('1111111111111111', { views: 9 }));
    await store.putGallery(gallery('2222222222222222', { expiresAt: new Date(Date.now() + 3 * DAY).toISOString(), views: 2 }));
    await store.putGallery(gallery('3333333333333333', { expiresAt: new Date(Date.now() - DAY).toISOString() }));
    await store.putGallery(gallery('4444444444444444', { deletedAt: new Date().toISOString(), views: 99 }));
    await store.putGallery(gallery('5555555555555555', { kind: 'photos', views: 50 }));
    const d = await dashboard(store, 't1', { films: true, photos: false });
    expect(d.open).toBe(2);
    expect(d.closed).toBe(1);
    expect(d.trash).toBe(1);
    expect(d.closing.map((g) => g.id)).toEqual(['2222222222222222']);
    expect(d.mostViewed.map((g) => g.id)).toEqual(['1111111111111111', '2222222222222222']);
    expect(d.albumsSent).toEqual([]);
  });

  it('lists albums the couples sent', async () => {
    const store = new MemoryStore();
    await store.putGallery(gallery('6666666666666666', { kind: 'photos' }));
    await store.putAlbum('t1', '6666666666666666', { size: '80x30', spreads: [], status: 'submitted', submittedAt: '2026-09-20T10:00:00.000Z' } as never);
    const d = await dashboard(store, 't1', { films: false, photos: true });
    expect(d.albumsSent).toEqual([{ galleryId: '6666666666666666', coupleName: 'זוג 66', submittedAt: '2026-09-20T10:00:00.000Z' }]);
  });
});

describe('trash', () => {
  it('trash hides, restore brings back, purge removes and unlinks the partner', async () => {
    const store = new MemoryStore();
    const a = gallery('7777777777777777', { linkedId: '8888888888888888' });
    const b = gallery('8888888888888888', { kind: 'photos', linkedId: '7777777777777777' });
    await store.putGallery(a);
    await store.putGallery(b);
    // Each step returns the gallery as saved (only the changed field is written).
    const trashed = await trashGallery(store, b);
    expect((await store.getGallery(b.id))?.deletedAt).toBeTruthy();
    const back = await restoreGallery(store, trashed);
    expect((await store.getGallery(b.id))?.deletedAt).toBeUndefined();
    await purgeGallery(store, env, back);
    expect(await store.getGallery(b.id)).toBeNull();
    expect((await store.getGallery(a.id))?.linkedId).toBeUndefined();
  });

  it('the nightly job removes galleries after 30 days in the trash, not before', async () => {
    const store = new MemoryStore();
    await store.putGallery(gallery('9999999999999999', { deletedAt: new Date(Date.now() - 31 * DAY).toISOString() }));
    await store.putGallery(gallery('aaaaaaaaaaaaaaaa', { deletedAt: new Date(Date.now() - 5 * DAY).toISOString() }));
    const r = await nightly(store, env);
    expect(r.purged).toEqual(['9999999999999999']);
    expect(await store.getGallery('9999999999999999')).toBeNull();
    expect(await store.getGallery('aaaaaaaaaaaaaaaa')).not.toBeNull();
  });
});

describe('P71: the nightly job and a designed album', () => {
  it('skips a gallery whose album order is open, paid or in print, says so, and the rest of the trash still goes', async () => {
    const store = new MemoryStore();
    const old = (days: number) => new Date(Date.now() - days * DAY).toISOString();
    // 30 galleries kept for their order, older than everything else: they must not hold the queue up.
    for (let i = 0; i < 30; i++) {
      const id = `b${i.toString(16).padStart(15, '0')}`;
      await store.putGallery(gallery(id, { kind: 'photos', deletedAt: old(90 + i) }));
      store.albumOrders.set(id, { id: `o${i}`, workflowStatus: i % 3 === 0 ? 'in_print' : 'approved', paymentStatus: i % 3 === 1 ? 'paid' : 'unpaid', tokenHash: null, revoked: false, spreads: 10 });
    }
    // A delivered, unpaid order no longer keeps its gallery.
    await store.putGallery(gallery('c000000000000001', { kind: 'photos', deletedAt: old(40) }));
    store.albumOrders.set('c000000000000001', { id: 'od', workflowStatus: 'delivered', paymentStatus: 'unpaid', tokenHash: null, revoked: false, spreads: 10 });
    await store.putGallery(gallery('c000000000000002', { deletedAt: old(35) }));
    const r = await nightly(store, env);
    expect(r.purged.sort()).toEqual(['c000000000000001', 'c000000000000002']);
    expect(r.pendingTrash).toBe(0);
    expect(r.errors).toEqual([]);
    expect(r.blockedTotal).toBe(30);
    expect(r.blocked).toHaveLength(30);
    expect(r.blocked.find((b) => b.id === 'b000000000000000')).toEqual({ id: 'b000000000000000', reason: 'album_paid' });
    expect(r.blocked.find((b) => b.id === 'b000000000000002')).toEqual({ id: 'b000000000000002', reason: 'album_order' });
    expect(store.galleries.has('b000000000000001')).toBe(true);
    expect(store.runs.at(-1)).toMatchObject({ purged: 2, blocked: 30, errors: [] });
  });
});

describe('P70: the galleries list', () => {
  it('reads no photo list, carries no secrets, and pages with a total', async () => {
    const { default: worker } = await import('../worker/index');
    const { fakeEnv } = await import('./fake-kv');
    const { storeFor } = await import('../worker/store');
    const { vi } = await import('vitest');
    const penv = { ...fakeEnv(), CLOUD_MOCK: '1' } as never;
    const store = (await storeFor(penv)) as MemoryStore;
    const tid = '00000000-0000-4000-8000-000000070010';
    const owner = { Authorization: `Bearer test:u7010:${tid}:owner` };
    store.seedTenant({ id: tid, slug: 'p70-list' });
    for (let i = 0; i < 12; i++) {
      const id = `70a0000000000${i.toString(16).padStart(3, '0')}`;
      await store.putGallery(gallery(id, { tenantId: tid, kind: i % 2 ? 'photos' : 'films', password: 'secret-pass', downloadPin: 'secret-pin', printToken: 'print-token-secret-0000', guestId: 'abcdefabcdef0000', createdAt: new Date(Date.now() - i * 1000).toISOString() }));
      if (i % 2) await store.savePhotos(tid, id, { folderUrl: '', provider: 'mock', sets: [], items: [{ key: 'aaaaaaaa', name: 'a.jpg', ref: 'm:/a.jpg' }] });
    }
    const reads = vi.spyOn(store, 'getPhotosVersioned');
    const reads2 = vi.spyOn(store, 'getPhotos');
    const call = (path: string) => worker.fetch(new Request(`https://films.test${path}`, { headers: owner }), penv);
    const all = await (await call('/api/admin/galleries')).text();
    expect(JSON.parse(all)).toHaveLength(12);
    for (const secret of ['secret-pass', 'secret-pin', 'print-token-secret', 'abcdefabcdef0000', 'hasPassword']) expect(all).not.toContain(secret);
    const page = (await (await call('/api/admin/galleries?limit=5&offset=10')).json()) as { items: { id: string }[]; total: number };
    expect(page.total).toBe(12);
    expect(page.items.map((g) => g.id)).toEqual(['70a000000000000a', '70a000000000000b']);
    expect((await call('/api/admin/galleries?limit=5000')).status).toBe(400);
    const options = (await (await call('/api/admin/galleries/options')).json()) as { id: string; kind: string }[];
    expect(options).toHaveLength(12);
    expect(Object.keys(options[0]).sort()).toEqual(['coupleName', 'date', 'id', 'kind']);
    expect(reads).not.toHaveBeenCalled();
    expect(reads2).not.toHaveBeenCalled();
  });

  it('the summary gives each gallery its closing time (the extend dialog sends it back)', async () => {
    const store = new MemoryStore();
    const g = gallery('7070707070707070', { expiresAt: new Date(Date.now() + 2 * DAY).toISOString() });
    await store.putGallery(g);
    const d = await dashboard(store, 't1', { films: true, photos: true });
    expect(d.closing).toEqual([expect.objectContaining({ id: g.id, expiresAt: g.expiresAt, daysLeft: expect.any(Number) })]);
  });
});
