// Fix plan P55 (0140; decisions D17(3), D12(1)): the print shop's link (/print/<token>) gives only the album as the
// couple SENT it — made only after the send, paused (409) while the studio has it open for the couple again and while
// a page count sent after paying waits for the studio — and works 30 days from when it was made or renewed (then 404,
// and the clean-up removes it). A studio whose subscription is not active can still take things down (revoke, close,
// trash, delete face data, switch face search off, a new password, an earlier closing day) but not make, load, extend
// or renew. The clean-up closes only the public galleries of studios cancelled more than 30 days ago.
import { describe, expect, it } from 'vitest';
import { nightly } from '../worker/cleanup';
import worker from '../worker/index';
import { storeFor } from '../worker/store';
import { MemoryStore } from '../worker/store-memory';
import type { Env } from '../worker/types';
import { fakeEnv } from './fake-kv';

const env = { ...fakeEnv(), CLOUD_MOCK: '1' } as Env;
const DAY = 86_400_000;
const KEYS = ['aaaaaaaa', 'bbbbbbbb', 'cccccccc'];
let n = 5500;

async function studio() {
  n++;
  const tid = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const store = (await storeFor(env)) as MemoryStore;
  store.seedTenant({ id: tid, slug: `print-${n}` });
  const owner = { Authorization: `Bearer test:u${n}:${tid}:owner` };
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = owner) => {
    const res = await worker.fetch(
      new Request(`https://films.test${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `1.55.0.${n % 250}`, ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
    );
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, any> };
  };
  const gallery = async () => {
    const g = (await call('POST', '/api/admin/galleries', { coupleName: 'שיר & טל', kind: 'photos' })).json as { id: string };
    await store.savePhotos(tid, g.id, { folderUrl: '', provider: 'mock', sets: [], items: KEYS.map((key) => ({ key, name: `${key}.jpg`, ref: `m:/${key}.jpg` })) });
    return g.id;
  };
  const pages = (count: number) => ({ size: '80x30', spreads: Array.from({ length: count }, (_, i) => ({ id: `s${i}`, template: 't01', fills: [{ photo: KEYS[i % 3] }], texts: [] })) });
  /** The couple saves a draft of `count` pages (onto whatever is saved) and, with `send`, sends it. */
  const couple = async (id: string, count: number, send = true) => {
    const rev = (await store.getAlbum(id))?.rev ?? 0;
    expect((await call('PUT', `/api/watch/${id}/album`, { album: pages(count), rev }, {})).status).toBe(200);
    if (send) expect((await call('POST', `/api/watch/${id}/album/submit`, {}, {})).status).toBe(200);
  };
  const shop = async (url: string) => call('GET', `/api/print/${url.split('/').pop()}`, undefined, {});
  return { tid, store, call, gallery, couple, shop };
}

describe('the print link gives only the album as it was sent', () => {
  it('no link before the couple sends; after it, the sent album and 30 days', async () => {
    const { call, gallery, couple, shop } = await studio();
    const id = await gallery();
    await couple(id, 4, false);
    expect(await call('POST', `/api/admin/galleries/${id}/print-link`, {})).toMatchObject({ status: 409, json: { code: 'not_sent' } });
    await couple(id, 4);
    const made = await call('POST', `/api/admin/galleries/${id}/print-link`, {});
    expect(made.status).toBe(200);
    expect(made.json.url).toMatch(/\/print\/[A-Za-z0-9_-]{20,}$/);
    expect(Date.parse(made.json.expiresAt) - Date.parse(made.json.createdAt)).toBe(30 * DAY);
    expect(made.json).toMatchObject({ expired: false, paused: null });
    const page = await shop(made.json.url);
    expect(page.status).toBe(200);
    expect(page.json.album.spreads).toHaveLength(4);
    expect(page.json.album.status).toBe('submitted');
  });

  it('reopened for the couple: paused (409), never their draft; sent again: the new album', async () => {
    const { call, gallery, couple, shop } = await studio();
    const id = await gallery();
    await couple(id, 4);
    const { url } = (await call('POST', `/api/admin/galleries/${id}/print-link`, {})).json;
    expect((await shop(url)).status).toBe(200);
    const unlocked = await call('POST', `/api/admin/galleries/${id}/album/unlock`, {});
    expect(unlocked.json).toMatchObject({ printPaused: true, warning: expect.stringContaining('מושהה') });
    await couple(id, 6, false);
    const paused = await shop(url);
    expect(paused).toMatchObject({ status: 409, json: { code: 'album_open' } });
    expect(paused.json.album).toBeUndefined();
    expect((await call('GET', `/api/admin/galleries/${id}/print-link`)).json).toMatchObject({ paused: 'album_open', url });
    expect((await call('POST', `/api/watch/${id}/album/submit`, {}, {})).status).toBe(200);
    const again = await shop(url);
    expect(again.status).toBe(200);
    expect(again.json.album.spreads).toHaveLength(6);
  });

  it('sent again after paying with another page count: paused until the studio accepts the count', async () => {
    const { store, call, gallery, couple, shop } = await studio();
    const id = await gallery();
    await couple(id, 4);
    const { url } = (await call('POST', `/api/admin/galleries/${id}/print-link`, {})).json;
    store.albumOrders.get(id)!.paymentStatus = 'paid';
    expect((await shop(url)).status).toBe(200);
    await call('POST', `/api/admin/galleries/${id}/album/unlock`, {});
    await couple(id, 5);
    expect(await shop(url)).toMatchObject({ status: 409, json: { code: 'pages_changed' } });
    expect((await call('GET', `/api/admin/galleries/${id}/print-link`)).json.paused).toBe('pages_changed');
    expect(await call('POST', `/api/admin/galleries/${id}/album/confirm-pages`, {})).toMatchObject({ status: 200, json: { spreads: 5, before: 4 } });
    expect((await shop(url)).json.album.spreads).toHaveLength(5);
  });

  it('30 days on: 404; the studio renews the same link; the clean-up removes a link nobody renewed', async () => {
    const { tid, store, call, gallery, couple, shop } = await studio();
    const id = await gallery();
    await couple(id, 3);
    const { url } = (await call('POST', `/api/admin/galleries/${id}/print-link`, {})).json;
    await store.patchGallery(tid, id, { printTokenAt: new Date(Date.now() - 31 * DAY).toISOString() });
    expect(await shop(url)).toMatchObject({ status: 404, json: { code: 'print_expired' } });
    expect((await call('GET', `/api/admin/galleries/${id}/print-link`)).json).toMatchObject({ url, expired: true });
    const renewed = await call('POST', `/api/admin/galleries/${id}/print-link`, { renew: true });
    expect(renewed.json).toMatchObject({ url, expired: false });
    expect((await shop(url)).status).toBe(200);

    const other = await gallery();
    await couple(other, 3);
    const old = (await call('POST', `/api/admin/galleries/${other}/print-link`, {})).json.url as string;
    await store.patchGallery(tid, other, { printTokenAt: new Date(Date.now() - 31 * DAY).toISOString() });
    const report = await nightly(store, env);
    expect(report.printLinksExpired).toBeGreaterThanOrEqual(1);
    expect((await store.getGallery(other))?.printToken).toBeUndefined();
    expect((await shop(old)).status).toBe(404);
    expect((await store.getGallery(id))?.printToken, 'the renewed one stays').toBeTruthy();
    // A new link for an expired one is a new address.
    expect((await call('POST', `/api/admin/galleries/${other}/print-link`, {})).json.url).not.toBe(old);
  });
});

describe('a studio whose subscription is not active can take things down, nothing else', () => {
  it('revokes, closes, trashes, deletes face data, switches face search off, a new password, an earlier day', async () => {
    const { tid, store, call, gallery, couple, shop } = await studio();
    const id = await gallery();
    const other = await gallery();
    const third = await gallery();
    await couple(id, 3);
    const { url } = (await call('POST', `/api/admin/galleries/${id}/print-link`, {})).json;
    await call('PUT', `/api/admin/galleries/${id}/photos`, { faceSearch: true });
    store.seedTenant({ id: tid, access: 'read_only' });

    // Not allowed: making, renewing, loading, extending, restoring, other edits.
    expect((await call('POST', `/api/admin/galleries/${id}/print-link`, { renew: true })).status).toBe(402);
    expect((await call('POST', `/api/admin/galleries/${other}/photos/load`, { url: 'https://www.dropbox.com/scl/fo/x/y' })).status).toBe(402);
    expect((await call('POST', '/api/admin/galleries/batch', { action: 'extend', ids: [other], days: 10 })).status).toBe(402);
    expect((await call('PUT', `/api/admin/galleries/${id}`, { coupleName: 'אחר' })).status).toBe(402);
    expect((await call('PUT', `/api/admin/galleries/${id}`, { password: 'סוד-חדש', coupleName: 'אחר' })).status, 'a password with another change').toBe(402);
    expect((await call('PUT', `/api/admin/galleries/${id}`, { expiresAt: new Date(Date.now() + 400 * DAY).toISOString() })).status, 'a later day').toBe(402);
    expect((await call('PUT', `/api/admin/galleries/${id}/photos`, { items: { aaaaaaaa: { hidden: true } } })).status).toBe(402);

    // Allowed: what lowers exposure.
    expect((await call('PUT', `/api/admin/galleries/${id}`, { password: 'סוד-חדש' })).status).toBe(200);
    expect((await store.getGallery(id))?.password).toBe('סוד-חדש');
    expect((await call('PUT', `/api/admin/galleries/${id}`, { password: '' })).status, 'removing the password is not lowering').toBe(402);
    const sooner = new Date(Date.now() + 2 * DAY).toISOString();
    expect((await call('PUT', `/api/admin/galleries/${id}`, { expiresAt: sooner })).status).toBe(200);
    expect((await call('PUT', `/api/admin/galleries/${id}/photos`, { faceSearch: false })).status).toBe(200);
    expect((await call('DELETE', `/api/admin/galleries/${id}/faces`)).status).toBe(200);
    expect((await call('DELETE', `/api/admin/galleries/${id}/print-link`)).status).toBe(200);
    expect((await shop(url)).status).toBe(404);
    expect((await call('POST', '/api/admin/galleries/batch', { action: 'close', ids: [other] })).json).toMatchObject({ done: 1 });
    expect((await call('DELETE', `/api/admin/galleries/${third}`)).status).toBe(200);
    expect((await call('POST', `/api/admin/galleries/${third}/restore`)).status, 'restoring is not').toBe(402);
    expect((await call('DELETE', `/api/admin/galleries/${third}?forever=1`)).status).toBe(200);
    expect(await store.getGallery(third)).toBeNull();
    store.seedTenant({ id: tid, access: 'ok' });
  });
});

describe('the clean-up closes the galleries of a studio cancelled more than 30 days ago, only then', () => {
  it('cancelled 31 days ago: closed and its print links gone; 10 days ago or paid again: untouched', async () => {
    const lapsed = await studio();
    const recent = await studio();
    const paidAgain = await studio();
    const ids: Record<string, string> = {};
    for (const [name, s, days, access] of [['lapsed', lapsed, 31, 'read_only'], ['recent', recent, 10, 'read_only'], ['paid', paidAgain, 60, 'ok']] as const) {
      ids[name] = await s.gallery();
      await s.couple(ids[name], 2);
      await s.call('POST', `/api/admin/galleries/${ids[name]}/print-link`, {});
      s.store.canceledAt.set(s.tid, new Date(Date.now() - days * DAY).toISOString());
      s.store.seedTenant({ id: s.tid, access });
    }
    const store = lapsed.store;
    // Nothing happens until the clean-up runs (never on a database push).
    expect(Date.parse((await store.getGallery(ids.lapsed))!.expiresAt)).toBeGreaterThan(Date.now());
    const report = await nightly(store, env);
    expect(report.lapsed).toMatchObject({ studios: 1, galleries: 1, printLinks: 1 });
    const closed = (await store.getGallery(ids.lapsed))!;
    expect(Date.parse(closed.expiresAt)).toBeLessThanOrEqual(Date.now());
    expect(closed.printToken).toBeUndefined();
    for (const name of ['recent', 'paid']) {
      const g = (await store.getGallery(ids[name]))!;
      expect(Date.parse(g.expiresAt), name).toBeGreaterThan(Date.now());
      expect(g.printToken, name).toBeTruthy();
    }
    expect((await nightly(store, env)).lapsed.studios, 'a second run finds nothing').toBe(0);
    for (const s of [lapsed, recent, paidAgain]) s.store.canceledAt.delete(s.tid);
  });
});
