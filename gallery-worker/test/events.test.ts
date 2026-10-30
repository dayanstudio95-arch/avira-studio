// Views and downloads for the studio's list (P72, D15): the guests' views count apart from the
// couple's, the studio's own look doesn't count, and nobody without the password counts (P67 carry-over).
import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import { storeFor } from '../worker/store';
import type { MemoryStore } from '../worker/store-memory';
import type { Env } from '../worker/types';
import { fakeEnv } from './fake-kv';

const env = { ...fakeEnv(), CLOUD_MOCK: '1', ASSETS: { fetch: async () => new Response('x') } } as unknown as Env;
let n = 0;
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  worker.fetch(new Request(`https://films.test${path}`, { method, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `9.9.9.${n}`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env);

async function setup() {
  n++;
  const tid = `00000000-0000-4000-8000-00000072e${String(n).padStart(3, '0')}`;
  const studio = { Authorization: `Bearer test:ev${n}:${tid}:owner` };
  const store = (await storeFor(env)) as MemoryStore;
  store.seedTenant({ id: tid, slug: `events-${n}x` });
  const { id } = (await (await call('POST', '/api/admin/galleries', { coupleName: 'א & ב', kind: 'photos' }, studio)).json()) as { id: string };
  const { guestId, previewToken } = (await (await call('GET', `/api/admin/galleries/${id}`, undefined, studio)).json()) as { guestId: string; previewToken: string };
  const counts = async () => {
    const g = (await store.getGallery(id))!;
    return { views: g.views, guestViews: g.guestViews ?? 0, downloads: g.downloads };
  };
  return { id, guestId, previewToken, studio, store, counts };
}

describe('view and download counts', () => {
  it("counts the guests' views apart from the couple's", async () => {
    const { id, guestId, counts } = await setup();
    expect((await call('POST', `/api/watch/${id}/event`, { type: 'view' })).status).toBe(200);
    await call('POST', `/api/watch/${guestId}/event`, { type: 'view' });
    await call('POST', `/api/watch/${guestId}/event`, { type: 'view' });
    await call('POST', `/api/watch/${guestId}/event`, { type: 'download' });
    expect(await counts()).toEqual({ views: 1, guestViews: 2, downloads: 1 });
  });

  it("the studio's own look is not a view", async () => {
    const { id, previewToken, counts } = await setup();
    const opened = await call('GET', `/api/watch/${id}?pt=${encodeURIComponent(previewToken)}`);
    const cookie = opened.headers.get('Set-Cookie')!.split(';')[0];
    await call('POST', `/api/watch/${id}/event`, { type: 'view' }, { Cookie: cookie });
    expect(await counts()).toEqual({ views: 0, guestViews: 0, downloads: 0 });
  });

  it('behind a password only who typed it counts', async () => {
    const { id, studio, counts } = await setup();
    await call('PUT', `/api/admin/galleries/${id}`, { password: 'events1' }, studio);
    expect((await call('POST', `/api/watch/${id}/event`, { type: 'view' })).status).toBe(200);
    await call('POST', `/api/watch/${id}/event`, { type: 'download' });
    expect(await counts()).toEqual({ views: 0, guestViews: 0, downloads: 0 });
    const cookie = (await call('POST', `/api/watch/${id}/unlock`, { code: 'events1' })).headers.get('Set-Cookie')!.split(';')[0];
    await call('POST', `/api/watch/${id}/event`, { type: 'view' }, { Cookie: cookie });
    expect(await counts()).toEqual({ views: 1, guestViews: 0, downloads: 0 });
  });

  it('a closed gallery and unknown events count nothing', async () => {
    const { id, store, counts } = await setup();
    await call('POST', `/api/watch/${id}/event`, { type: 'hack' });
    const g = (await store.getGallery(id))!;
    await store.patchGallery(g.tenantId, id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    await call('POST', `/api/watch/${id}/event`, { type: 'view' });
    expect(await counts()).toEqual({ views: 0, guestViews: 0, downloads: 0 });
  });
});
