// The cover's address (P72): every new cover changes it, so no browser or WhatsApp keeps the old one;
// only the address of the cover stored now may be kept for long.
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import { storeFor } from '../worker/store';
import type { MemoryStore } from '../worker/store-memory';
import { SupabaseStore } from '../worker/store-supabase';
import type { Env, Gallery } from '../worker/types';
import { fakeEnv } from './fake-kv';

const env = { ...fakeEnv(), CLOUD_MOCK: '1', ASSETS: { fetch: async () => new Response('x') } } as unknown as Env;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const call = (method: string, path: string, init: { body?: BodyInit; type?: string; headers?: Record<string, string> } = {}) =>
  worker.fetch(new Request(`https://films.test${path}`, { method, body: init.body, headers: { 'Content-Type': init.type ?? 'application/json', ...(init.headers ?? {}) } }), env);

describe('cover version', () => {
  it('every cover upload changes the address the couple, the guests and the list get', async () => {
    const tid = '00000000-0000-4000-8000-0000000c0e72';
    const studio = { Authorization: `Bearer test:u72:${tid}:owner` };
    ((await storeFor(env)) as MemoryStore).seedTenant({ id: tid, slug: 'cover-studio' });
    const g = (await (await call('POST', '/api/admin/galleries', { body: JSON.stringify({ coupleName: 'א & ב', kind: 'photos' }), headers: studio })).json()) as { id: string };

    const up1 = (await (await call('POST', `/api/admin/galleries/${g.id}/cover`, { body: JPEG, type: 'image/jpeg', headers: studio })).json()) as { coverUrl: string };
    const seen1 = ((await (await call('GET', `/api/watch/${g.id}`)).json()) as { coverUrl: string }).coverUrl;
    expect(seen1).toBe(up1.coverUrl);
    expect(seen1).toMatch(new RegExp(`^/api/cover/${g.id}\\?v=\\d+$`));
    await new Promise((r) => setTimeout(r, 2));
    const up2 = (await (await call('POST', `/api/admin/galleries/${g.id}/cover`, { body: JPEG, type: 'image/jpeg', headers: studio })).json()) as { coverUrl: string };
    const seen2 = ((await (await call('GET', `/api/watch/${g.id}`)).json()) as { coverUrl: string }).coverUrl;
    expect(seen2).toBe(up2.coverUrl);
    expect(seen2).not.toBe(seen1);

    // The guests' address carries the same version.
    const admin = (await (await call('GET', `/api/admin/galleries/${g.id}`, { headers: studio })).json()) as { guestId: string };
    const guest = ((await (await call('GET', `/api/watch/${admin.guestId}`)).json()) as { coverUrl: string }).coverUrl;
    expect(guest).toBe(seen2.replace(g.id, admin.guestId));

    // The current version may be kept for a year; an old or missing one only for an hour.
    const current = await call('GET', seen2);
    expect(current.status).toBe(200);
    expect(current.headers.get('Cache-Control')).toContain('max-age=31536000');
    expect((await call('GET', seen1)).headers.get('Cache-Control')).toContain('max-age=3600');
    expect((await call('GET', `/api/cover/${g.id}`)).headers.get('Cache-Control')).toContain('max-age=3600');
  });
});

describe('cover version in the database', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('is read from cover_version and written only when it has a value', async () => {
    const sent: { method: string; body: Record<string, unknown> | null }[] = [];
    vi.stubGlobal('fetch', async (_: string, init: RequestInit = {}) => {
      sent.push({ method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify([{ id: 'abcdefabcdefabcd', tenant_id: 't1', created_at: '', expires_at: '', cover_version: 1790000000000, guest_views: 4 }]), { status: 200 });
    });
    const sb = new SupabaseStore('https://sb.test', 'k');
    const g = (await sb.patchGallery('t1', 'abcdefabcdefabcd', { hasCover: true, coverVersion: 1790000000000 }))!;
    expect(sent[0].body).toMatchObject({ has_cover: true, cover_version: 1790000000000 });
    expect(g.coverVersion).toBe(1790000000000);
    expect(g.guestViews).toBe(4);
    // A new gallery (no cover yet) and a patch without it never send the column.
    await sb.putGallery({ id: 'abcdefabcdefabcd', tenantId: 't1', coupleName: 'א', date: '', days: 30, createdAt: '', expiresAt: '', hasCover: false, films: [], views: 0, downloads: 0 } as Gallery);
    expect(sent[1].body).not.toHaveProperty('cover_version');
    await sb.patchGallery('t1', 'abcdefabcdefabcd', { coverVersion: undefined, venue: 'x' });
    expect(sent[2].body).not.toHaveProperty('cover_version');
  });
});
