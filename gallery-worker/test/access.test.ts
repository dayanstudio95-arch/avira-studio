// Ported from the Avira films app's test/access.test.ts (2026-09-27): the guests link, the
// password and the download code. Studio Plan differences: the studio signs in with a Supabase
// session (a bearer token), so its way past a password is the preview token from the admin API.
import { describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import { storeFor } from '../worker/store';
import { MemoryStore } from '../worker/store-memory';
import type { Env } from '../worker/types';
import { fakeEnv } from './fake-kv';

// Pages and demo clips come from the site's files; here one small answer stands for all of them.
const env = { ...fakeEnv(), CLOUD_MOCK: '1', ASSETS: { fetch: async () => new Response('<!doctype html><title>x</title>', { headers: { 'Content-Type': 'text/html' } }) } } as unknown as Env;
let n = 0;

const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  worker.fetch(
    new Request(`https://films.test${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `1.2.3.${n}`, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
const cookieOf = (res: Response) => res.headers.get('Set-Cookie')!.split(';')[0];

async function setup(kind: 'photos' | 'films' = 'photos', extra: Record<string, unknown> = {}) {
  n++;
  const tid = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const studio = { Authorization: `Bearer test:u${n}:${tid}:owner` };
  const store = (await storeFor(env)) as MemoryStore;
  store.seedTenant({ id: tid, slug: `studio-${n}x` });
  const g = (await (await call('POST', '/api/admin/galleries', { coupleName: 'מאי & אופק', kind, ...extra }, studio)).json()) as { id: string };
  if (kind === 'photos') await store.savePhotos(tid, g.id, { folderUrl: '', provider: 'mock', sets: [], items: [{ key: 'aaaaaaaa', name: 'a.jpg', ref: 'm:/a.jpg' }] });
  return { studio, id: g.id };
}

describe('the guests link', () => {
  it('shows the gallery under another number, without hearts or Instagram marks', async () => {
    const { studio, id } = await setup();
    const admin = (await (await call('GET', `/api/admin/galleries/${id}`, undefined, studio)).json()) as { guestId: string };
    expect(admin.guestId).toMatch(/^[a-f0-9]{16}$/);
    expect(admin.guestId).not.toBe(id);

    const couple = (await (await call('GET', `/api/watch/${id}`)).json()) as { role: string; guestPath: string };
    expect(couple.role).toBe('couple');
    expect(couple.guestPath).toMatch(new RegExp(`/${admin.guestId}$`));

    const res = await call('GET', `/api/watch/${admin.guestId}`);
    const text = await res.text();
    expect(text).not.toContain(id); // the couple's number never reaches a guest
    const guest = JSON.parse(text) as { role: string; id: string; photos: { base: string; items: unknown[] }; favorites: unknown[]; guestPath?: string };
    expect(guest.role).toBe('guest');
    expect(guest.id).toBe(admin.guestId);
    expect(guest.photos.base).toMatch(new RegExp(`^/api/photos/${admin.guestId}/v\\d+$`));
    expect(guest.photos.items).toHaveLength(1);
    expect(guest.guestPath).toBeUndefined();

    expect((await call('POST', `/api/watch/${admin.guestId}/fav`, { key: 'aaaaaaaa', on: true })).status).toBe(403);
    expect((await call('POST', `/api/watch/${admin.guestId}/insta`, { key: 'aaaaaaaa', on: true })).status).toBe(403);
    expect((await call('POST', `/api/watch/${id}/fav`, { key: 'aaaaaaaa', on: true })).status).toBe(200);
  });

  it('film galleries have no guests link', async () => {
    const { studio, id } = await setup('films');
    const admin = (await (await call('GET', `/api/admin/galleries/${id}`, undefined, studio)).json()) as { guestId?: string };
    expect(admin.guestId).toBeUndefined();
  });
});

describe('password and download code', () => {
  it('asks for the password before anything, remembers it, and lets the studio through with its preview token', async () => {
    const { studio, id } = await setup();
    await call('PUT', `/api/admin/galleries/${id}`, { password: 'Maya2026' }, studio);

    const locked = (await (await call('GET', `/api/watch/${id}`)).json()) as { locked: boolean; photos?: unknown; coupleName: string };
    expect(locked.locked).toBe(true);
    expect(locked.photos).toBeUndefined();
    expect(locked.coupleName).toBe('מאי & אופק');
    expect((await call('POST', `/api/watch/${id}/fav`, { key: 'aaaaaaaa', on: true })).status).toBe(401);
    expect((await call('GET', `/api/photos/${id}/aaaaaaaa?s=m`)).status).toBe(401);

    expect((await call('POST', `/api/watch/${id}/unlock`, { code: 'wrong' })).status).toBe(400);
    const ok = await call('POST', `/api/watch/${id}/unlock`, { code: ' maya2026 ' });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Set-Cookie')).toContain('HttpOnly');
    const pass = cookieOf(ok);
    const open = (await (await call('GET', `/api/watch/${id}`, undefined, { Cookie: pass })).json()) as { locked?: boolean; photos: unknown };
    expect(open.locked).toBeUndefined();
    expect(open.photos).toBeTruthy();
    expect((await call('POST', `/api/watch/${id}/fav`, { key: 'aaaaaaaa', on: true }, { Cookie: pass })).status).toBe(200);

    // The studio: its preview token opens it and leaves a cookie for this browser.
    const { previewToken } = (await (await call('GET', `/api/admin/galleries/${id}`, undefined, studio)).json()) as { previewToken: string };
    const viaToken = await call('GET', `/api/watch/${id}?pt=${encodeURIComponent(previewToken)}`);
    expect(((await viaToken.json()) as { locked?: boolean }).locked).toBeUndefined();
    const studioCookie = cookieOf(viaToken);
    expect(((await (await call('GET', `/api/watch/${id}`, undefined, { Cookie: studioCookie })).json()) as { locked?: boolean }).locked).toBeUndefined();
    // A forged or another gallery's token does nothing.
    expect(((await (await call('GET', `/api/watch/${id}?pt=forged`)).json()) as { locked?: boolean }).locked).toBe(true);

    // A new password: the old one stops working on every device.
    await call('PUT', `/api/admin/galleries/${id}`, { password: 'other' }, studio);
    expect(((await (await call('GET', `/api/watch/${id}`, undefined, { Cookie: pass })).json()) as { locked?: boolean }).locked).toBe(true);
  });

  it('asks for the download code before full-quality downloads only', async () => {
    const { studio, id } = await setup();
    await call('PUT', `/api/admin/galleries/${id}`, { downloadPin: '123456' }, studio);
    const view = (await (await call('GET', `/api/watch/${id}`)).json()) as { downloadLocked: boolean; photos: unknown };
    expect(view.downloadLocked).toBe(true);
    expect(view.photos).toBeTruthy();
    expect((await call('GET', `/api/photos/${id}/aaaaaaaa?s=full`)).status).toBe(403);
    const pin = cookieOf(await call('POST', `/api/watch/${id}/pin`, { code: '123456' }));
    const after = (await (await call('GET', `/api/watch/${id}`, undefined, { Cookie: pin })).json()) as { downloadLocked?: boolean };
    expect(after.downloadLocked).toBeUndefined();
    expect((await call('GET', `/api/photos/${id}/aaaaaaaa?s=full`, undefined, { Cookie: pin })).status).not.toBe(403);
  });

  it('hides film download links until the code is typed, and refuses the download itself', async () => {
    const { studio, id } = await setup('films', { films: [{ title: 'הייליטס', provider: 'gdrive', fileId: 'abcdefghijk123', fileName: 'h.mp4', playable: true }] });
    await call('PUT', `/api/admin/galleries/${id}`, { downloadPin: 'abcdef' }, studio);
    const view = (await (await call('GET', `/api/watch/${id}`)).json()) as { films: { downloadUrl: string; watchUrl: string }[] };
    expect(view.films[0].downloadUrl).toBe('');
    expect(view.films[0].watchUrl).toBeTruthy(); // watching stays open
    expect((await call('GET', `/api/watch/${id}/film/0?dl=1`)).status).toBe(403);
    const pin = cookieOf(await call('POST', `/api/watch/${id}/pin`, { code: 'ABCDEF' }));
    const after = (await (await call('GET', `/api/watch/${id}`, undefined, { Cookie: pin })).json()) as { films: { downloadUrl: string }[] };
    expect(after.films[0].downloadUrl).toContain('dl=1');
  });

  it('limits guessing', async () => {
    const { studio, id } = await setup();
    await call('PUT', `/api/admin/galleries/${id}`, { password: 'secret' }, studio);
    for (let i = 0; i < 10; i++) await call('POST', `/api/watch/${id}/unlock`, { code: `x${i}` });
    expect((await call('POST', `/api/watch/${id}/unlock`, { code: 'secret' })).status).toBe(429);
  });
});

// ---------- P67: every route checks access ----------
const raw = (method: string, path: string, bytes: ArrayBuffer, type: string, headers: Record<string, string>) =>
  worker.fetch(new Request(`https://films.test${path}`, { method, headers: { 'Content-Type': type, 'CF-Connecting-IP': `1.2.3.${n}`, ...headers }, body: bytes }), env);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).buffer;
const memory = async () => (await storeFor(env)) as MemoryStore;
const tidOf = (studio: Record<string, string>) => studio.Authorization.split(':')[2];

const VERSIONED = [
  { title: 'הייליטס 4K', tag: 'highlights', provider: 'gdrive', fileId: 'abcdefghijk4k0', fileName: 'highlights 4K.mp4', playable: true },
  { title: 'הייליטס 1080p', tag: 'highlights', provider: 'gdrive', fileId: 'abcdefghijk108', fileName: 'highlights 1080p.mp4', playable: true },
  { title: 'טקס', tag: 'ceremony', provider: 'gdrive', fileId: 'abcdefghijkmov', fileName: 'ceremony.mov', playable: false },
  { title: 'טיזר', tag: 'teaser', provider: 'myairbridge', fileId: 'https://mab.to/AbC123xyz', fileName: 'teaser.mp4', playable: true },
];

describe('P67: films without the download code', () => {
  it('play only in their smallest size; larger sizes, files that do not play and MyAirBridge stay closed until the code', async () => {
    const { studio, id } = await setup('films', { films: VERSIONED });
    expect((await call('PUT', `/api/admin/galleries/${id}`, { downloadPin: 'film2026' }, studio)).status).toBe(200);
    type V = { label: string; watchUrl: string; downloadUrl: string; playable: boolean };
    type F = { title: string; watchUrl: string; playable: boolean; versions: V[] };
    const view = (await (await call('GET', `/api/watch/${id}`)).json()) as { films: F[]; downloadLocked: boolean };
    expect(view.downloadLocked).toBe(true);
    const hl = view.films.find((f) => f.versions.length === 2)!;
    expect(hl.versions.map((v) => [v.label, v.playable, Boolean(v.watchUrl)])).toEqual([
      ['4K', false, false],
      ['1080p', true, true],
    ]);
    expect(hl.watchUrl).toBe(`/api/watch/${id}/film/1`);
    expect(view.films.every((f) => f.versions.every((v) => v.downloadUrl === ''))).toBe(true);
    const teaser = view.films.find((f) => f.title === 'טיזר')!;
    expect(teaser.watchUrl).toBe(''); // the MyAirBridge address is the file itself
    expect(JSON.stringify(view)).not.toContain('mab.to');

    expect((await call('GET', `/api/watch/${id}/film/0`)).status).toBe(403); // 4K
    expect((await call('GET', `/api/watch/${id}/film/1`)).status).toBe(200); // 1080p plays
    expect((await call('GET', `/api/watch/${id}/film/2`)).status).toBe(403); // .mov: a stream would be a download
    expect((await call('GET', `/api/watch/${id}/film/3`)).status).toBe(403);

    const pin = cookieOf(await call('POST', `/api/watch/${id}/pin`, { code: 'FILM2026' }));
    expect((await call('GET', `/api/watch/${id}/film/0`, undefined, { Cookie: pin })).status).toBe(200);
    const open = (await (await call('GET', `/api/watch/${id}`, undefined, { Cookie: pin })).json()) as { films: F[] };
    expect(open.films.find((f) => f.versions.length === 2)!.versions.every((v) => v.playable && v.downloadUrl)).toBe(true);
  });

  it('a film gallery without a code plays every size as before', async () => {
    const { id } = await setup('films', { films: VERSIONED });
    expect((await call('GET', `/api/watch/${id}/film/0`)).status).toBe(200);
  });
});

describe('P67: new download codes are at least 6 characters; codes from before keep working', () => {
  it('refuses a short new code, keeps a short old one, and remembers the code for 30 days', async () => {
    const { studio, id } = await setup();
    const short = await call('PUT', `/api/admin/galleries/${id}`, { downloadPin: '12345' }, studio);
    expect(short.status).toBe(400);
    expect(((await short.json()) as { error: string }).error).toContain('6');
    await (await memory()).patchGallery(tidOf(studio), id, { downloadPin: '777' });
    // The form sends the same old code again with other changes: fine.
    expect((await call('PUT', `/api/admin/galleries/${id}`, { downloadPin: '777', venue: 'אולם' }, studio)).status).toBe(200);
    const ok = await call('POST', `/api/watch/${id}/pin`, { code: '777' });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Set-Cookie')).toContain(`Max-Age=${30 * 86_400}`);
  });
});

describe('P67: the password cookie', () => {
  it("shows nothing readable, a guest's opens only the guests' link, and old cookies stop working", async () => {
    const { studio, id } = await setup();
    await call('PUT', `/api/admin/galleries/${id}`, { password: 'Maya2026' }, studio);
    const { guestId } = (await (await call('GET', `/api/admin/galleries/${id}`, undefined, studio)).json()) as { guestId: string };
    const locked = async (link: string, cookie: string) => ((await (await call('GET', `/api/watch/${link}`, undefined, { Cookie: cookie })).json()) as { locked?: boolean }).locked === true;

    const guest = await call('POST', `/api/watch/${guestId}/unlock`, { code: 'maya2026' });
    const guestCookie = guest.headers.get('Set-Cookie')!;
    expect(guestCookie).not.toContain(id);
    expect(guestCookie).not.toContain(guestId);
    expect(guestCookie).toMatch(/^gp_[A-Za-z0-9_-]{22}=v1\.0\.[A-Za-z0-9_-]{43};/);
    const g = cookieOf(guest);
    expect(await locked(guestId, g)).toBe(false);
    expect(await locked(id, g)).toBe(true); // never the couple's link
    expect((await call('POST', `/api/watch/${id}/fav`, { key: 'aaaaaaaa', on: true }, { Cookie: g })).status).toBe(401);

    const couple = cookieOf(await call('POST', `/api/watch/${id}/unlock`, { code: 'Maya2026' }));
    expect(couple).not.toContain(id);
    expect(couple.split('=')[0]).not.toBe(g.split('=')[0]);
    expect(await locked(id, couple)).toBe(false);
    expect(await locked(guestId, couple)).toBe(false); // the couple may open the guests' link too

    // The cookie from before P67 (named after the couple's number, signed with the main secret).
    const { sign } = await import('../worker/auth');
    const old = `gpass_${id}=${await sign('mock-state-secret', `pass:${id}:Maya2026`)}`;
    expect(await locked(id, old)).toBe(true);
  });
});

describe('P67: guessing a password from many addresses', () => {
  it('locks the gallery after 40 wrong tries in an hour, tells the studio once, and refuses when it cannot count', async () => {
    const { studio, id } = await setup();
    await call('PUT', `/api/admin/galleries/${id}`, { password: 'secret1' }, studio);
    for (let i = 0; i < 40; i++) expect((await call('POST', `/api/watch/${id}/unlock`, { code: `x${i}` }, { 'CF-Connecting-IP': `9.${n}.${i}.1` })).status).toBe(400);
    const right = await call('POST', `/api/watch/${id}/unlock`, { code: 'secret1' }, { 'CF-Connecting-IP': `8.${n}.0.1` });
    expect(right.status).toBe(429);
    const store = await memory();
    expect(store.notices.filter((x) => x.tenantId === tidOf(studio) && x.type === 'films_gallery_locked')).toHaveLength(1);
    // The download code has its own count.
    expect((await call('POST', `/api/watch/${id}/pin`, { code: 'nope' }, { 'CF-Connecting-IP': `8.${n}.0.2` })).status).toBe(400);

    const other = await setup();
    await call('PUT', `/api/admin/galleries/${other.id}`, { password: 'secret2' }, other.studio);
    store.failCounter = true;
    try {
      expect((await call('POST', `/api/watch/${other.id}/unlock`, { code: 'secret2' })).status).toBe(503);
    } finally {
      store.failCounter = false;
    }
    expect((await call('POST', `/api/watch/${other.id}/unlock`, { code: 'secret2' })).status).toBe(200);
  });

  it('counts an IPv6 home as one address (its /64)', async () => {
    const { clientIp } = await import('../worker/studio');
    const ip = (v: string) => clientIp(new Request('https://x', { headers: { 'CF-Connecting-IP': v } }));
    expect(ip('2001:db8:1:2:aaaa::1')).toBe(ip('2001:db8:1:2:bbbb:cccc:dddd:eeee'));
    expect(ip('2001:db8:1:2::9')).toBe('2001:db8:1:2::/64');
    expect(ip('2001:db8:1:3::1')).not.toBe(ip('2001:db8:1:2::1'));
    expect(ip('::ffff:10.0.0.7')).toBe('10.0.0.7');
    expect(ip('10.0.0.7')).toBe('10.0.0.7');

    const { studio, id } = await setup();
    await call('PUT', `/api/admin/galleries/${id}`, { password: 'secret3' }, studio);
    for (let i = 1; i <= 10; i++) await call('POST', `/api/watch/${id}/unlock`, { code: `x${i}` }, { 'CF-Connecting-IP': `2001:db8:${n}:7::${i.toString(16)}` });
    expect((await call('POST', `/api/watch/${id}/unlock`, { code: 'secret3' }, { 'CF-Connecting-IP': `2001:db8:${n}:7::ff` })).status).toBe(429);
  });
});

describe('P67: "download all"', () => {
  it('is gone from photo galleries (their folder holds the hidden photos) and needs the password in film galleries', async () => {
    const photos = await setup();
    await (await memory()).patchGallery(tidOf(photos.studio), photos.id, { folderUrl: 'https://www.dropbox.com/scl/fo/abc/def?rlkey=x', folderProvider: 'dropbox-link' });
    const pv = (await (await call('GET', `/api/watch/${photos.id}`)).json()) as { folderDownloadUrl: string };
    expect(pv.folderDownloadUrl).toBe('');
    expect((await call('GET', `/api/watch/${photos.id}/all`)).status).toBe(404);

    const films = await setup('films', { folderUrl: 'https://www.dropbox.com/scl/fo/abc/def?rlkey=x' });
    expect(((await (await call('GET', `/api/watch/${films.id}`)).json()) as { folderDownloadUrl: string }).folderDownloadUrl).toBe(`/api/watch/${films.id}/all`);
    await call('PUT', `/api/admin/galleries/${films.id}`, { password: 'films1' }, films.studio);
    expect((await call('GET', `/api/watch/${films.id}/all`)).status).toBe(401);
    const pass = cookieOf(await call('POST', `/api/watch/${films.id}/unlock`, { code: 'films1' }));
    expect((await call('GET', `/api/watch/${films.id}/all`, undefined, { Cookie: pass })).status).toBe(200);
  });
});

describe("P67: the studio's list pictures", () => {
  it('open with the preview token only while the gallery is out of the trash and the studio active with the module', async () => {
    const { studio, id } = await setup('films', { films: VERSIONED.slice(1, 2) });
    const made = (await (await raw('POST', `/api/admin/galleries/${id}/thumb`, JPEG, 'image/jpeg', studio)).json()) as { thumb: string };
    expect((await call('GET', made.thumb)).status).toBe(200);
    const { previewToken: pt } = (await (await call('GET', `/api/admin/galleries/${id}`, undefined, studio)).json()) as { previewToken: string };
    const film = `/api/admin/galleries/${id}/film/0?pt=${encodeURIComponent(pt)}`;
    expect((await call('GET', film)).status).toBe(200);

    const store = await memory();
    const tid = tidOf(studio);
    store.seedTenant({ id: tid, films: false });
    expect((await call('GET', made.thumb)).status).toBe(404);
    expect((await call('GET', film)).status).toBe(404);
    store.seedTenant({ id: tid, films: true, access: 'blocked' });
    expect((await call('GET', made.thumb)).status).toBe(404);
    store.seedTenant({ id: tid, access: 'ok' });
    expect((await call('GET', film)).status).toBe(200);

    await call('DELETE', `/api/admin/galleries/${id}`, undefined, studio);
    expect((await call('GET', made.thumb)).status).toBe(404);
    expect((await call('GET', film)).status).toBe(404);
    const list = (await (await call('GET', '/api/admin/galleries', undefined, studio)).json()) as { id: string; thumb: string; previewToken?: string }[];
    const trashed = list.find((g) => g.id === id)!;
    expect(trashed.thumb).toBe('');
    expect(trashed.previewToken).toBeUndefined();
  });
});

describe('P67: the cover', () => {
  it('behind a password opens only past it (or with the studio token), and is not kept on the way', async () => {
    const { studio, id } = await setup('films');
    expect((await raw('POST', `/api/admin/galleries/${id}/cover`, JPEG, 'image/jpeg', studio)).status).toBe(200);
    const open = await call('GET', `/api/cover/${id}`);
    expect(open.status).toBe(200);
    expect(open.headers.get('Cache-Control')).toContain('public');

    await call('PUT', `/api/admin/galleries/${id}`, { password: 'cover1' }, studio);
    expect((await call('GET', `/api/cover/${id}`)).status).toBe(404);
    const pass = cookieOf(await call('POST', `/api/watch/${id}/unlock`, { code: 'cover1' }));
    const mine = await call('GET', `/api/cover/${id}`, undefined, { Cookie: pass });
    expect(mine.status).toBe(200);
    expect(mine.headers.get('Cache-Control')).toContain('private');
    // The hub's list carries the token with the cover.
    const list = (await (await call('GET', '/api/admin/galleries', undefined, studio)).json()) as { id: string; thumb: string }[];
    const thumb = list.find((g) => g.id === id)!.thumb;
    expect(thumb).toMatch(new RegExp(`^/api/cover/${id}\\?v=\\d+&pt=`));
    expect((await call('GET', thumb)).status).toBe(200);
  });
});

describe('P67: the terms record', () => {
  it('is written only past the password, never for the studio, and tells the couple from guests', async () => {
    const { studio, id } = await setup();
    await call('PUT', `/api/admin/galleries/${id}`, { password: 'terms1' }, studio);
    const { guestId, previewToken } = (await (await call('GET', `/api/admin/galleries/${id}`, undefined, studio)).json()) as { guestId: string; previewToken: string };
    expect((await call('POST', `/api/watch/${id}/terms`, {})).status).toBe(401);

    const studioCookie = cookieOf(await call('GET', `/api/watch/${id}?pt=${encodeURIComponent(previewToken)}`));
    expect((await call('POST', `/api/watch/${id}/terms`, {}, { Cookie: studioCookie })).status).toBe(200);
    const terms = async () => ((await (await call('GET', `/api/admin/galleries/${id}`, undefined, studio)).json()) as { terms: { count: number; guests: number; unknown: number } }).terms;
    expect(await terms()).toMatchObject({ count: 0, guests: 0 });

    const guest = cookieOf(await call('POST', `/api/watch/${guestId}/unlock`, { code: 'terms1' }));
    expect((await call('POST', `/api/watch/${guestId}/terms`, {}, { Cookie: guest })).status).toBe(200);
    expect(await terms()).toMatchObject({ count: 0, guests: 1 });
    const couple = cookieOf(await call('POST', `/api/watch/${id}/unlock`, { code: 'terms1' }));
    expect((await call('POST', `/api/watch/${id}/terms`, {}, { Cookie: couple })).status).toBe(200);
    expect(await terms()).toMatchObject({ count: 1, guests: 1, unknown: 0 });
    const rec = (await memory()).terms.filter((t) => t.galleryId === id);
    expect(rec.map((t) => [t.role, t.linkId])).toEqual([
      ['guest', guestId],
      ['couple', id],
    ]);
  });
});

describe('P67: gallery passwords and codes in the hub (D12)', () => {
  it('only the owner and admins see or change them; the studio manager sees that they exist', async () => {
    const { studio, id } = await setup();
    await call('PUT', `/api/admin/galleries/${id}`, { password: 'owner1', downloadPin: 'owner-pin' }, studio);
    const manager = { Authorization: `Bearer test:m${n}:${tidOf(studio)}:studio_manager` };
    const seen = (await (await call('GET', `/api/admin/galleries/${id}`, undefined, manager)).json()) as Record<string, unknown>;
    expect(seen.password).toBeUndefined();
    expect(seen.downloadPin).toBeUndefined();
    expect(seen).toMatchObject({ hasPassword: true, hasDownloadPin: true });
    const list = await (await call('GET', '/api/admin/galleries', undefined, manager)).text();
    expect(list).not.toContain('owner1');
    expect(list).not.toContain('owner-pin');
    // The manager's form (without the fields) saves the rest and leaves the secrets as they are.
    const saved = await call('PUT', `/api/admin/galleries/${id}`, { password: '', downloadPin: '', venue: 'גן' }, manager);
    expect(await saved.text()).not.toContain('owner1');
    const owner = (await (await call('GET', `/api/admin/galleries/${id}`, undefined, studio)).json()) as Record<string, unknown>;
    expect(owner).toMatchObject({ password: 'owner1', downloadPin: 'owner-pin', venue: 'גן' });
    const admin = { Authorization: `Bearer test:a${n}:${tidOf(studio)}:admin` };
    expect(((await (await call('GET', `/api/admin/galleries/${id}`, undefined, admin)).json()) as Record<string, unknown>).password).toBe('owner1');
  });
});

describe('P67: site-wide headers', () => {
  it('pages and answers may be framed only by the site and the hub; no plugins, no <base>', async () => {
    const hubEnv = { ...env, CLOUD_MOCK: '', HUB_URL: 'https://hub.example/app' } as unknown as Env;
    const csp = (r: Response) => r.headers.get('Content-Security-Policy') ?? '';
    // The API (no store needed for /api/health) and a plain file of the site.
    expect(csp(await call('GET', '/api/health'))).toContain("object-src 'none'");
    // The uptime monitor (free plan) checks with HEAD.
    expect((await call('HEAD', '/api/health')).status).toBe(200);
    // Without a hub address outside tests: only the site itself may frame it.
    const noHub = await worker.fetch(new Request('https://films.test/favicon.svg'), { ...env, CLOUD_MOCK: '' } as unknown as Env);
    expect(csp(noHub)).toBe("frame-ancestors 'self'; object-src 'none'; base-uri 'self'");
    const page = await worker.fetch(new Request('https://films.test/accessibility'), env);
    expect(csp(page)).toContain("object-src 'none'");
    expect(csp(page)).toContain("base-uri 'self'");
    const withHub = await worker.fetch(new Request('https://films.test/favicon.svg'), hubEnv);
    expect(csp(withHub)).toBe("frame-ancestors 'self' https://hub.example; object-src 'none'; base-uri 'self'");
  });
});

// ---------- P73: links and tokens that can be cut off ----------
const tokenOf = async (id: string, studio: Record<string, string>) => ((await (await call('GET', `/api/admin/galleries/${id}`, undefined, studio)).json()) as { previewToken: string }).previewToken;
// The mock cloud sends no real picture (502): what matters is that access let the request through.
const passed = (status: number) => ![401, 403, 404].includes(status);
const lockedWith = async (id: string, query = '', cookie = '') =>
  ((await (await call('GET', `/api/watch/${id}${query}`, undefined, cookie ? { Cookie: cookie } : {})).json()) as { locked?: boolean }).locked === true;

describe("P73: the studio's preview token", () => {
  it('never renews itself: the cookie is the same token with its own end, and it closes after 12 hours', async () => {
    const { studio, id } = await setup();
    await call('PUT', `/api/admin/galleries/${id}`, { password: 'renew1' }, studio);
    const pt = await tokenOf(id, studio);
    const first = await call('GET', `/api/watch/${id}?pt=${encodeURIComponent(pt)}`);
    const cookie = cookieOf(first);
    expect(cookie.split('=').slice(1).join('=')).toBe(pt);
    expect(Number(/Max-Age=(\d+)/.exec(first.headers.get('Set-Cookie')!)![1])).toBeLessThanOrEqual(12 * 3600);

    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 11 * 3600_000);
      // 11 hours on: the cookie (or the token taken from it) opens it, and what comes back is the same token.
      expect(await lockedWith(id, '', cookie)).toBe(false);
      const again = await call('GET', `/api/watch/${id}?pt=${encodeURIComponent(pt)}`);
      expect(cookieOf(again)).toBe(cookie);
      expect(Number(/Max-Age=(\d+)/.exec(again.headers.get('Set-Cookie')!)![1])).toBeLessThanOrEqual(3600);
      vi.setSystemTime(Date.now() + 1.5 * 3600_000);
      expect(await lockedWith(id, '', cookie)).toBe(true);
      expect(await lockedWith(id, `?pt=${encodeURIComponent(pt)}`)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("another gallery's or another studio's token opens nothing, and the old kind of token no longer works", async () => {
    const a = await setup();
    const b = await setup();
    await call('PUT', `/api/admin/galleries/${a.id}`, { password: 'other1' }, a.studio);
    await call('PUT', `/api/admin/galleries/${b.id}`, { password: 'other2' }, b.studio);
    expect(await lockedWith(a.id, `?pt=${encodeURIComponent(await tokenOf(b.id, b.studio))}`)).toBe(true);
    const { previewToken } = await import('../worker/access');
    // Signed with the right key for this gallery, but for another studio.
    const forged = await previewToken('mock-state-secret', { galleryId: a.id, tenantId: tidOf(b.studio), userId: 'x', version: 0 });
    expect(await lockedWith(a.id, `?pt=${encodeURIComponent(forged)}`)).toBe(true);
    // The token from before P73 (the gallery and an end, signed with the main secret).
    const { sign } = await import('../worker/auth');
    const old = await sign('mock-state-secret', `pv:${a.id}:${Date.now() + 3600_000}`);
    expect(await lockedWith(a.id, `?pt=${encodeURIComponent(old)}`)).toBe(true);
    expect(await lockedWith(a.id, `?pt=${encodeURIComponent(await tokenOf(a.id, a.studio))}`)).toBe(false);
  });
});

describe('P73: "disconnect every access"', () => {
  it('stops every token and cookie made before; a new token from the hub and a newly typed password work', async () => {
    const { studio, id } = await setup();
    await call('PUT', `/api/admin/galleries/${id}`, { password: 'revoke1', downloadPin: 'revoke-pin' }, studio);
    const pt = await tokenOf(id, studio);
    const studioCookie = cookieOf(await call('GET', `/api/watch/${id}?pt=${encodeURIComponent(pt)}`));
    const pass = cookieOf(await call('POST', `/api/watch/${id}/unlock`, { code: 'revoke1' }));
    const pin = cookieOf(await call('POST', `/api/watch/${id}/pin`, { code: 'revoke-pin' }));
    expect(await lockedWith(id, '', pass)).toBe(false);
    await (await memory()).patchGallery(tidOf(studio), id, { coverKey: 'aaaaaaaa' });
    const list = (await (await call('GET', '/api/admin/galleries', undefined, studio)).json()) as { id: string; thumb: string }[];
    const thumb = list.find((g) => g.id === id)!.thumb;
    expect(passed((await call('GET', thumb)).status)).toBe(true);

    // A studio manager may not; the owner may, also when the subscription is not active.
    const manager = { Authorization: `Bearer test:m${n}:${tidOf(studio)}:studio_manager` };
    expect((await call('POST', '/api/admin/access/revoke', {}, manager)).status).toBe(403);
    (await memory()).seedTenant({ id: tidOf(studio), access: 'read_only' });
    const res = await call('POST', '/api/admin/access/revoke', {}, studio);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accessVersion: 1 });
    (await memory()).seedTenant({ id: tidOf(studio), access: 'ok' });

    expect(await lockedWith(id, `?pt=${encodeURIComponent(pt)}`)).toBe(true);
    expect(await lockedWith(id, '', studioCookie)).toBe(true);
    expect(await lockedWith(id, '', pass)).toBe(true);
    expect((await call('GET', `/api/photos/${id}/aaaaaaaa?s=full`, undefined, { Cookie: `${pass}; ${pin}` })).status).toBe(401);
    expect((await call('GET', thumb)).status).toBe(401);

    expect(await lockedWith(id, `?pt=${encodeURIComponent(await tokenOf(id, studio))}`)).toBe(false);
    const again = await call('POST', `/api/watch/${id}/unlock`, { code: 'revoke1' });
    expect(again.headers.get('Set-Cookie')).toMatch(/^gp_[A-Za-z0-9_-]{22}=v1\.1\./);
    expect(await lockedWith(id, '', cookieOf(again))).toBe(false);
    // Another studio's galleries are not touched.
    const other = await setup();
    await call('PUT', `/api/admin/galleries/${other.id}`, { password: 'keep1' }, other.studio);
    const kept = cookieOf(await call('POST', `/api/watch/${other.id}/unlock`, { code: 'keep1' }));
    await call('POST', '/api/admin/access/revoke', {}, studio);
    expect(await lockedWith(other.id, '', kept)).toBe(false);
  });
});

describe("P73: the list's thumbs token", () => {
  it('opens the small picture, the cover and the film frame, never a larger photo, the gallery or a studio cookie', async () => {
    const { studio, id } = await setup();
    await call('PUT', `/api/admin/galleries/${id}`, { password: 'thumbs1' }, studio);
    await (await memory()).patchGallery(tidOf(studio), id, { coverKey: 'aaaaaaaa' });
    const list = (await (await call('GET', '/api/admin/galleries', undefined, studio)).json()) as { id: string; thumb: string }[];
    const thumb = list.find((g) => g.id === id)!.thumb;
    expect(thumb).toMatch(new RegExp(`^/api/photos/${id}/v\\d+/aaaaaaaa\\?s=m&pt=`));
    expect(passed((await call('GET', thumb)).status)).toBe(true);
    const pt = new URL(thumb, 'https://films.test').searchParams.get('pt')!;
    const q = `pt=${encodeURIComponent(pt)}`;
    expect((await call('GET', `/api/photos/${id}/aaaaaaaa?s=l&${q}`)).status).toBe(401);
    expect((await call('GET', `/api/photos/${id}/aaaaaaaa?s=full&${q}`)).status).toBe(401);
    expect((await call('GET', `/api/photos/${id}/aaaaaaaa?s=m&dl=1&${q}`)).status).toBe(401);
    const watch = await call('GET', `/api/watch/${id}?${q}`);
    expect(((await watch.json()) as { locked?: boolean }).locked).toBe(true);
    expect(watch.headers.get('Set-Cookie')).toBeNull();

    // A film gallery without a picture: the token opens its film (for the frame) and its saved frame.
    const films = await setup('films', { films: VERSIONED.slice(1, 2) });
    await call('PUT', `/api/admin/galleries/${films.id}`, { password: 'thumbs2' }, films.studio);
    const flist = (await (await call('GET', '/api/admin/galleries', undefined, films.studio)).json()) as { id: string; previewToken: string }[];
    const ft = flist.find((g) => g.id === films.id)!.previewToken;
    expect((await call('GET', `/api/admin/galleries/${films.id}/film/0?pt=${encodeURIComponent(ft)}`)).status).toBe(200);
    expect(await lockedWith(films.id, `?pt=${encodeURIComponent(ft)}`)).toBe(true);
    expect((await call('GET', `/api/watch/${films.id}/film/0?pt=${encodeURIComponent(ft)}`)).status).toBe(401);
  });
});

describe("P73: a new guests' link", () => {
  it('replaces the guests\' id: the old link answers 404, the new one opens, the couple\'s link stays', async () => {
    const { studio, id } = await setup();
    const before = ((await (await call('GET', `/api/admin/galleries/${id}`, undefined, studio)).json()) as { guestId: string }).guestId;
    expect((await call('GET', `/api/watch/${before}`)).status).toBe(200);
    const manager = { Authorization: `Bearer test:m${n}:${tidOf(studio)}:studio_manager` };
    const res = await call('POST', `/api/admin/galleries/${id}/rotate-guest`, {}, manager);
    expect(res.status).toBe(200);
    const { guestId } = (await res.json()) as { guestId: string };
    expect(guestId).toMatch(/^[a-f0-9]{16}$/);
    expect(guestId).not.toBe(before);
    expect(guestId).not.toBe(id);
    expect((await call('GET', `/api/watch/${before}`)).status).toBe(404);
    expect((await call('GET', `/api/photos/${before}/aaaaaaaa?s=m`)).status).toBe(404);
    expect((await call('GET', `/api/cover/${before}`)).status).toBe(404);
    expect(((await (await call('GET', `/api/watch/${guestId}`)).json()) as { role: string }).role).toBe('guest');
    expect((await call('GET', `/api/watch/${id}`)).status).toBe(200);
    expect(((await (await call('GET', `/api/admin/galleries/${id}`, undefined, studio)).json()) as { guestId: string }).guestId).toBe(guestId);

    // Another studio can't; a film gallery has no guests' link; a gallery changed meanwhile → 409.
    const other = await setup();
    expect((await call('POST', `/api/admin/galleries/${id}/rotate-guest`, {}, other.studio)).status).toBe(404);
    const films = await setup('films');
    expect((await call('POST', `/api/admin/galleries/${films.id}/rotate-guest`, {}, films.studio)).status).toBe(400);
    const { rotateGuestId } = await import('../worker/access');
    const store = await memory();
    const stale = { ...(await store.getGallery(id))!, guestId: before };
    expect(await rotateGuestId(store, stale)).toBeNull();
    expect((await store.getGallery(id))!.guestId).toBe(guestId);
  });
});

describe('U1: the studio print export', () => {
  it("gives the album to the studio's preview only, never to the couple's or the guests' browser", async () => {
    const { studio, id } = await setup();
    await call('PUT', `/api/admin/galleries/${id}`, { downloadPin: '424242' }, studio);
    const { guestId, previewToken } = (await (await call('GET', `/api/admin/galleries/${id}`, undefined, studio)).json()) as { guestId: string; previewToken: string };
    // The couple — even with the download code — and the guests are refused; the couple's own album route stays theirs.
    expect((await call('GET', `/api/watch/${id}/print`)).status).toBe(403);
    const pin = cookieOf(await call('POST', `/api/watch/${id}/pin`, { code: '424242' }));
    expect((await call('GET', `/api/watch/${id}/print`, undefined, { Cookie: pin })).status).toBe(403);
    expect((await call('GET', `/api/watch/${guestId}/print`)).status).toBe(403);
    expect((await call('GET', `/api/watch/${id}/album`)).status).toBe(200);
    // The studio: the page's first call turns the token into the studio cookie, then the print route answers.
    const studioCookie = cookieOf(await call('GET', `/api/watch/${id}?pt=${encodeURIComponent(previewToken)}`));
    const res = await call('GET', `/api/watch/${id}/print`, undefined, { Cookie: studioCookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ album: null });
  });
});

// Avira fix (2026-10-30): a closed gallery with a password showed "הסתיימה ב־." — no date, no contact — because the
// locked answer carried neither. It now carries the closing day and the studio's contact line, and still no photos.
describe('Avira: a closed gallery behind a password', () => {
  it('says when it closed and how to reach the studio, and gives nothing else', async () => {
    n++;
    const tid = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const studio = { Authorization: `Bearer test:u${n}:${tid}:owner` };
    const store = (await storeFor(env)) as MemoryStore;
    store.seedTenant({ id: tid, slug: `studio-${n}x` });
    const g = (await (await call('POST', '/api/admin/galleries', { coupleName: 'מאי & אופק', kind: 'photos' }, studio)).json()) as { id: string };
    await store.savePhotos(tid, g.id, { folderUrl: '', provider: 'mock', sets: [], items: [{ key: 'aaaaaaaa', name: 'a.jpg', ref: 'm:/a.jpg' }] });
    await call('PUT', `/api/admin/galleries/${g.id}`, { password: 'Maya2026' }, studio);
    expect((await call('PUT', '/api/admin/settings', { contactLine: 'לשאלות: 050-0000000' }, studio)).status).toBe(200);

    const open = (await (await call('GET', `/api/watch/${g.id}`)).json()) as Record<string, unknown>;
    expect(open.locked).toBe(true);
    expect(open.expiresAt).toBeUndefined();

    const closedAt = new Date(Date.now() - 86400000).toISOString();
    await store.patchGallery(tid, g.id, { expiresAt: closedAt });
    const closed = (await (await call('GET', `/api/watch/${g.id}`)).json()) as Record<string, unknown>;
    expect(closed).toMatchObject({ locked: true, expired: true, expiresAt: closedAt, contactLine: 'לשאלות: 050-0000000' });
    expect(closed.photos).toBeUndefined();
    expect(closed.films).toBeUndefined();
  });
});
