// The studio's album sketch editor's routes (work order item 41, port B9): the photo bank comes from the event's
// photo gallery through the Worker — read only, the album roles (album manager too), the photos module, never the
// studio pass, never a hidden photo. Synthetic photos only (a JPEG header made here).
import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import { DESIGNER_ROLES, designerGalleries, designerPhotos, pixelSize } from '../worker/albumDesigner';
import { photoKey } from '../worker/photos';
import { storeFor } from '../worker/store';
import type { MemoryStore } from '../worker/store-memory';
import type { Env, Gallery } from '../worker/types';
import { fakeEnv } from './fake-kv';

/** A JPEG's first bytes: SOI, a JFIF APP0, then SOF0 with the size (no picture data — enough to read the size). */
function jpegHead(width: number, height: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]);
}

const served: string[] = [];
const env = {
  ...fakeEnv(),
  CLOUD_MOCK: '1',
  HUB_URL: 'https://hub.example',
  ASSETS: {
    fetch: async (req: Request) => {
      served.push(new URL(req.url).pathname);
      return new Response(jpegHead(6000, 4000), { headers: { 'Content-Type': 'image/jpeg' } });
    },
  },
} as unknown as Env;

let n = 0;
async function studio(opts: { photos?: boolean } = {}) {
  n++;
  const tid = `00000000-0000-4000-8000-${(0xb9000 + n).toString(16).padStart(12, '0')}`;
  const store = (await storeFor(env)) as MemoryStore;
  store.seedTenant({ id: tid, slug: `b9-studio-${n}`, photos: opts.photos ?? true });
  const as = (role: string) => ({ Authorization: `Bearer test:u-b9-${n}-${role}:${tid}:${role}`, Origin: 'https://hub.example', 'Content-Type': 'application/json' });
  const call = async (method: string, path: string, role = 'owner', data?: unknown) =>
    worker.fetch(new Request(`https://films.test${path}`, { method, headers: as(role), body: data === undefined ? undefined : JSON.stringify(data) }), env);
  const gallery = async (i: number, over: Partial<Gallery> = {}) => {
    const id = `b9${n.toString(16).padStart(2, '0')}${i.toString(16).padStart(12, '0')}`;
    await store.putGallery({ id, tenantId: tid, kind: 'photos', coupleName: `זוג ${i}`, date: '2026-09-01', films: [], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), days: 30, hasCover: false, views: 0, downloads: 0, ...over } as Gallery);
    return id;
  };
  const fill = async (id: string) => {
    const refs = Array.from({ length: 6 }, (_, i) => `m:/demo/photos/${String(i + 1).padStart(2, '0')}.jpg`);
    const items = refs.map((ref, i) => ({ key: photoKey(ref), name: `IMG_${i + 1}.jpg`, ref, ar: i % 2 ? 0.667 : 1.5, t: 1_700_000_000_000 + i * 60_000, ...(i === 5 ? { hidden: true } : {}), ...(i < 2 ? { set: 's1' } : {}) }));
    await store.savePhotos(tid, id, { folderUrl: 'https://www.dropbox.com/scl/fo/x/y?rlkey=k&dl=0', provider: 'mock', sets: [{ id: 's1', name: 'התארגנות' }], items });
    return items;
  };
  return { tid, store, call, gallery, fill };
}

describe('album designer: pure helpers', () => {
  it('the album roles are the hub\'s album roles', () => {
    expect([...DESIGNER_ROLES]).toEqual(['owner', 'admin', 'studio_manager', 'album_manager']);
  });

  it('pixel size from a JPEG or PNG head, turned by the photo\'s shape', () => {
    expect(pixelSize(jpegHead(6000, 4000))).toEqual([6000, 4000]);
    expect(pixelSize(jpegHead(6000, 4000), 0.667)).toEqual([4000, 6000]);
    expect(pixelSize(jpegHead(4000, 6000), 0.667)).toEqual([4000, 6000]);
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(png.buffer).setUint32(16, 3000);
    new DataView(png.buffer).setUint32(20, 2000);
    expect(pixelSize(png)).toEqual([3000, 2000]);
    expect(pixelSize(new Uint8Array([0x47, 0x49, 0x46]))).toBeNull();
    expect(pixelSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]))).toBeNull();
  });

  it('galleries: photo galleries only, none from the trash', () => {
    const base = { tenantId: 't', films: [], createdAt: '', expiresAt: '', days: 1, hasCover: false, views: 0, downloads: 0 };
    const out = designerGalleries([
      { ...base, id: 'a', kind: 'photos', coupleName: 'א', date: '2026-01-01', eventId: 'e1', photoCount: 3 },
      { ...base, id: 'b', kind: 'films', coupleName: 'ב', date: '' },
      { ...base, id: 'c', kind: 'photos', coupleName: 'ג', date: '', deletedAt: '2026-01-01' },
    ] as Gallery[]);
    expect(out).toEqual([{ id: 'a', coupleName: 'א', date: '2026-01-01', eventId: 'e1', photoCount: 3 }]);
  });

  it('photos: never a hidden one, never where the file lives', () => {
    const out = designerPhotos({ folderUrl: 'x', provider: 'mock', gen: 7, sets: [{ id: 's', name: 'חופה' }], items: [
      { key: 'aaaaaaaa', name: 'a.jpg', ref: 'm:/a.jpg', ar: 1.5, t: 5, set: 's', folder: 'f' },
      { key: 'bbbbbbbb', name: 'b.jpg', ref: 'm:/b.jpg', hidden: true },
    ] });
    expect(out).toEqual({ gen: 7, sets: [{ id: 's', name: 'חופה' }], items: [{ key: 'aaaaaaaa', name: 'a.jpg', ar: 1.5, t: 5, set: 's', folder: 'f' }] });
    expect(JSON.stringify(out)).not.toContain('m:/');
    expect(designerPhotos(null)).toEqual({ gen: 0, sets: [], items: [] });
  });
});

describe('album designer: routes', () => {
  it('lists the photo galleries with their event, for the album manager too', async () => {
    const { call, gallery } = await studio();
    const id = await gallery(1, { eventId: '11111111-1111-4111-8111-111111111111' });
    await gallery(2, { kind: 'films' } as Partial<Gallery>);
    const res = await call('GET', '/api/admin/album-designer/galleries', 'album_manager');
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://hub.example');
    expect(await res.json()).toEqual([{ id, coupleName: 'זוג 1', date: '2026-09-01', eventId: '11111111-1111-4111-8111-111111111111', photoCount: 0 }]);
    // The album manager still has no gallery admin route.
    expect((await call('GET', '/api/admin/galleries', 'album_manager')).status).toBe(403);
  });

  it('other roles, another studio and a studio without photos are refused', async () => {
    const { call, gallery, fill } = await studio();
    const id = await gallery(1);
    await fill(id);
    for (const role of ['photographer', 'editor', 'lead_coordinator']) expect((await call('GET', `/api/admin/album-designer/galleries/${id}/photos`, role)).status).toBe(403);
    const other = await studio();
    expect((await other.call('GET', `/api/admin/album-designer/galleries/${id}/photos`)).status).toBe(404);
    const noPhotos = await studio({ photos: false });
    expect((await noPhotos.call('GET', '/api/admin/album-designer/galleries')).status).toBe(402);
  });

  it('the bank: visible photos in order, the sets, the generation and a thumbs token (never the studio pass)', async () => {
    const { call, gallery, fill } = await studio();
    // Behind a password: the token is what opens the small previews.
    const id = await gallery(1, { password: 'b9-secret' });
    const items = await fill(id);
    const body = (await (await call('GET', `/api/admin/album-designer/galleries/${id}/photos`, 'album_manager')).json()) as Record<string, any>;
    expect(body.items.map((i: { key: string }) => i.key)).toEqual(items.slice(0, 5).map((i) => i.key));
    expect(body.sets).toEqual([{ id: 's1', name: 'התארגנות' }]);
    expect(body.items[0]).toMatchObject({ name: 'IMG_1.jpg', ar: 1.5, set: 's1' });
    expect(body.thumbsToken).toBeTruthy();
    expect(body.previewToken).toBeUndefined();
    // The thumbs token opens the small preview only — not a large one, not the original; nothing without it.
    expect((await worker.fetch(new Request(`https://films.test/api/photos/${id}/v0/${items[0].key}?s=m`), env)).status).not.toBe(200);
    const small = await call('GET', `/api/photos/${id}/v0/${items[0].key}?s=m&pt=${encodeURIComponent(body.thumbsToken)}`);
    expect(small.status).toBe(200);
    const large = await worker.fetch(new Request(`https://films.test/api/photos/${id}/v0/${items[0].key}?s=l&pt=${encodeURIComponent(body.thumbsToken)}`), env);
    expect(large.status).not.toBe(200);
  });

  it('a photo large or full through the session (CORS), never a hidden one or a gallery in the trash', async () => {
    const { call, gallery, fill, store, tid } = await studio();
    const id = await gallery(1);
    const items = await fill(id);
    served.length = 0;
    const res = await call('GET', `/api/admin/album-designer/galleries/${id}/file/${items[1].key}?s=full`, 'album_manager');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://hub.example');
    expect(new Uint8Array(await res.arrayBuffer())[0]).toBe(0xff);
    expect(served).toEqual(['/demo/photos/02.jpg']);
    expect((await call('GET', `/api/admin/album-designer/galleries/${id}/file/${items[5].key}?s=l`)).status).toBe(404);
    expect((await call('GET', `/api/admin/album-designer/galleries/${id}/file/ffffffff`)).status).toBe(404);
    // No session: no photo.
    expect((await worker.fetch(new Request(`https://films.test/api/admin/album-designer/galleries/${id}/file/${items[1].key}`), env)).status).toBe(401);
    await store.patchGallery(tid, id, { deletedAt: new Date().toISOString() });
    expect((await call('GET', `/api/admin/album-designer/galleries/${id}/file/${items[1].key}`)).status).toBe(404);
  });

  it('pixel sizes of the asked photos (turned by their shape), hidden ones skipped', async () => {
    const { call, gallery, fill } = await studio();
    const id = await gallery(1);
    const items = await fill(id);
    const res = await call('POST', `/api/admin/album-designer/galleries/${id}/sizes`, 'album_manager', { keys: [items[0].key, items[1].key, items[5].key, 'nope'] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sizes: Record<string, number[]>; failed: string[]; skipped: string[]; batch: number };
    expect(body.sizes).toEqual({ [items[0].key]: [6000, 4000], [items[1].key]: [4000, 6000] });
    expect(body.failed).toEqual([]);
    expect(body.skipped).toEqual([]);
    expect(body.batch).toBeGreaterThan(0);
  });

  it('a read-only studio may still read (nothing here writes)', async () => {
    const { call, gallery, fill, store, tid } = await studio();
    const id = await gallery(1);
    await fill(id);
    store.seedTenant({ id: tid, access: 'read_only' });
    expect((await call('GET', `/api/admin/album-designer/galleries/${id}/photos`)).status).toBe(200);
    store.seedTenant({ id: tid, access: 'blocked' });
    expect((await call('GET', `/api/admin/album-designer/galleries/${id}/photos`)).status).toBe(403);
  });
});

// Work order item 42 (port B10): the couple's album portal reads the photos of the studio's sketch with its portal link.
describe('album designer: the couple\'s photos through the portal link', () => {
  const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, '0')).join('');
  let tokenSeq = 0;
  const portalCall = (token: unknown, ip = '198.51.100.20') =>
    worker.fetch(new Request('https://films.test/api/album-portal/design-bank', { method: 'POST', headers: { Origin: 'https://hub.example', 'Content-Type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ token }) }), env);
  async function openDesign(opts: { open?: boolean; revoked?: boolean } = {}) {
    const s = await studio();
    const id = await s.gallery(1, { password: 'b10-secret' });
    const items = await s.fill(id);
    const foreign = await (await studio()).gallery(2);
    const trashed = await s.gallery(3, { deletedAt: new Date().toISOString() } as Partial<Gallery>);
    const token = `b10-portal-token-${++tokenSeq}-0123456789abcdef`;
    s.store.seedDesignBank(await sha(token), { tenantId: s.tid, orderId: `order-${tokenSeq}`, galleries: [id, foreign, trashed, 'not-a-gallery'], ...opts });
    return { ...s, id, items, token };
  }

  it("the design's own galleries: visible photos, sets and a thumbs token for the small previews only (CORS for the hub)", async () => {
    const { id, items, token } = await openDesign();
    const res = await portalCall(token);
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://hub.example');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = (await res.json()) as { readOnly: boolean; galleries: Record<string, any>[] };
    expect(body.readOnly).toBe(false);
    // Another studio's gallery and one in the trash are left out, whatever the design says.
    expect(body.galleries.map((g) => g.id)).toEqual([id]);
    expect(body.galleries[0].items.map((i: { key: string }) => i.key)).toEqual(items.slice(0, 5).map((i) => i.key));
    expect(body.galleries[0].sets).toEqual([{ id: 's1', name: 'התארגנות' }]);
    expect(JSON.stringify(body)).not.toContain('m:/');
    expect(JSON.stringify(body)).not.toContain('b10-secret');
    const t = encodeURIComponent(body.galleries[0].thumbsToken);
    expect((await worker.fetch(new Request(`https://films.test/api/photos/${id}/v0/${items[0].key}?s=m&pt=${t}`), env)).status).toBe(200);
    expect((await worker.fetch(new Request(`https://films.test/api/photos/${id}/v0/${items[0].key}?s=l&pt=${t}`), env)).status).not.toBe(200);
    expect((await worker.fetch(new Request(`https://films.test/api/photos/${id}/v0/${items[0].key}?s=full&pt=${t}`), env)).status).not.toBe(200);
  });

  it('a wrong, revoked or closed link, a studio without photos or suspended: nothing', async () => {
    expect((await portalCall('a-wrong-link-0000000000000000')).status).toBe(404);
    expect((await portalCall(42)).status).toBe(404);
    expect((await portalCall('short')).status).toBe(404);
    const revoked = await openDesign({ revoked: true });
    expect((await portalCall(revoked.token)).status).toBe(404);
    const closed = await openDesign({ open: false });
    expect((await portalCall(closed.token)).status).toBe(403);
    const s = await openDesign();
    s.store.seedTenant({ id: s.tid, photos: false });
    expect((await portalCall(s.token)).status).toBe(403);
    s.store.seedTenant({ id: s.tid, photos: true, access: 'blocked' });
    expect((await portalCall(s.token)).status).toBe(403);
    s.store.seedTenant({ id: s.tid, access: 'read_only' });
    const ro = await portalCall(s.token);
    expect(ro.status).toBe(200);
    expect(((await ro.json()) as { readOnly: boolean }).readOnly).toBe(true);
  });

  it('counted per order (and per address)', async () => {
    const { token } = await openDesign();
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await portalCall(token, `198.51.100.${30 + (i % 50)}`)).status;
    expect(last).toBe(429);
  });
});
