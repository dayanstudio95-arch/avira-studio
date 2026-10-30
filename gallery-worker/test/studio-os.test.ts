// The films module inside StudioOS: galleries stored per studio, Supabase logins,
// the subscription gate, and couples only ever getting our own streaming URLs.
import { describe, expect, it, vi } from 'vitest';
import { closeGallery, coupleView, createGallery, extendGallery, getOwnedGallery, updateGallery } from '../worker/galleries';
import { settingsFrom, getSettings, publicView } from '../worker/settings';
import { MemoryStore } from '../worker/store-memory';
import { defaultFilmsStudio } from '../worker/store';
import { requireStudioAdmin } from '../worker/supabaseAuth';
import type { Env, Film } from '../worker/types';
import { fakeEnv } from './fake-kv';
import wranglerConfig from '../wrangler.jsonc?raw';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

function setup(extraEnv: Partial<Env> = {}) {
  const store = new MemoryStore();
  store.seedTenant({ id: A, name: 'Studio A', slug: 'studio-a', logoUrl: 'https://cdn/a.png', instagramUrl: 'https://instagram.com/studio.a', phone: '050-1234567' });
  store.seedTenant({ id: B, name: 'Studio B', slug: 'studio-b' });
  const env = { ...fakeEnv(), GOOGLE_API_KEY: 'AIzaSECRETKEY1234567890', DROPBOX_APP_KEY: 'k', DROPBOX_APP_SECRET: 's', ...extraEnv } as Env;
  return { store, env };
}

const req = (token?: string) => new Request('https://films/api/admin/x', { headers: token ? { Authorization: `Bearer ${token}` } : {} });

const driveFilm: Partial<Film> = { title: 'Highlights', tag: 'highlights', fileName: 'h.mp4', provider: 'gdrive', fileId: '1AbCdEfGhIjKlMnOp', playable: true, sizeBytes: 10 };
const dropboxFilm: Partial<Film> = {
  title: 'Film',
  tag: 'feature',
  fileName: 'f.mp4',
  provider: 'dropbox',
  sourceUrl: 'https://www.dropbox.com/scl/fi/abc123/f.mp4?rlkey=xyz&dl=0',
  playable: true,
  sizeBytes: 10,
};

describe('studio admins sign in with their StudioOS session', () => {
  it('accepts owners/admins and refuses crew roles and missing tokens', async () => {
    const { store } = setup();
    await expect(requireStudioAdmin(req(), store)).rejects.toMatchObject({ status: 401 });
    await expect(requireStudioAdmin(req('nonsense'), store)).rejects.toMatchObject({ status: 401 });
    await expect(requireStudioAdmin(req(`test:u1:${A}:photographer`), store)).rejects.toMatchObject({ status: 403 });
    expect(await requireStudioAdmin(req(`test:u1:${A}:owner`), store)).toMatchObject({ tenantId: A, role: 'owner' });
    expect(await requireStudioAdmin(req(`test:u2:${A}:studio_manager`), store)).toMatchObject({ tenantId: A });
  });

  it('an unpaid studio can read but not change; a suspended one can do neither', async () => {
    const { store } = setup();
    store.seedTenant({ id: A, access: 'read_only' });
    await expect(requireStudioAdmin(req(`test:u:${A}:owner`), store)).resolves.toBeTruthy();
    await expect(requireStudioAdmin(req(`test:u:${A}:owner`), store, { write: true })).rejects.toMatchObject({ status: 402 });
    store.seedTenant({ id: A, access: 'blocked' });
    await expect(requireStudioAdmin(req(`test:u:${A}:owner`), store)).rejects.toMatchObject({ status: 403 });
  });

  it('a studio without any gallery module cannot use the admin; each module opens only its own tools', async () => {
    const { store } = setup();
    store.seedTenant({ id: A, access: 'ok', films: false, photos: false });
    await expect(requireStudioAdmin(req(`test:u:${A}:owner`), store)).rejects.toMatchObject({ status: 402 });
    store.seedTenant({ id: A, access: 'ok', films: false, photos: true });
    await expect(requireStudioAdmin(req(`test:u:${A}:owner`), store, { module: 'photos' })).resolves.toMatchObject({ photos: true, films: false });
    await expect(requireStudioAdmin(req(`test:u:${A}:owner`), store, { module: 'films' })).rejects.toMatchObject({ status: 402 });
  });
});

describe('galleries belong to one studio', () => {
  it('creates with the studio default days and hides other studios galleries', async () => {
    const { store, env } = setup();
    await store.patchFilmsStudio(A, { defaultDays: 45 });
    const s = await getSettings(env, store, A);
    const g = await createGallery(store, env, s, { coupleName: 'Dana & Avi', date: '2026-10-01' }, A);
    expect(g.tenantId).toBe(A);
    expect(g.days).toBe(45);
    expect((await store.listGalleries(A)).map((x) => x.id)).toEqual([g.id]);
    expect(await store.listGalleries(B)).toEqual([]);
    await expect(getOwnedGallery(store, B, g.id)).rejects.toMatchObject({ status: 404 });
  });

  it('update and extend keep validating like before', async () => {
    const { store, env } = setup();
    const s = await getSettings(env, store, A);
    const g = await createGallery(store, env, s, { coupleName: 'X' }, A);
    await expect(updateGallery(store, env, s, g, { coupleName: '' })).rejects.toThrow(/שם הזוג/);
    const fresh = (await store.getGallery(g.id))!;
    await expect(extendGallery(store, fresh, 0)).rejects.toThrow(/ימים/);
    const extended = await extendGallery(store, fresh, 10);
    expect(Date.parse(extended.expiresAt)).toBeGreaterThan(Date.parse(g.expiresAt));
  });
});

describe('P57: a gallery is linked to its own studio\'s event', () => {
  const EV_A = '00000000-0000-4000-8000-0000000ea057';
  const EV_B = '00000000-0000-4000-8000-0000000eb057';
  it("takes an event of the studio, refuses another studio's (or a made-up one), and '' unlinks", async () => {
    const { store, env } = setup();
    store.seedEvent(EV_A, A);
    store.seedEvent(EV_B, B);
    const s = await getSettings(env, store, A);
    const g = await createGallery(store, env, s, { coupleName: 'X', eventId: EV_A }, A);
    expect((await store.getGallery(g.id))!.eventId).toBe(EV_A);
    await expect(createGallery(store, env, s, { coupleName: 'Y', eventId: EV_B }, A)).rejects.toMatchObject({ status: 400 });
    await expect(updateGallery(store, env, s, (await store.getGallery(g.id))!, { eventId: EV_B })).rejects.toMatchObject({ status: 400 });
    await expect(updateGallery(store, env, s, (await store.getGallery(g.id))!, { eventId: 'nope' })).rejects.toMatchObject({ status: 400 });
    expect((await store.getGallery(g.id))!.eventId).toBe(EV_A);
    // The form sent back with the same event does not ask again; '' unlinks.
    await updateGallery(store, env, s, (await store.getGallery(g.id))!, { eventId: EV_A, venue: 'אולם' });
    expect((await updateGallery(store, env, s, (await store.getGallery(g.id))!, { eventId: '' })).eventId).toBeUndefined();
  });

  it('SupabaseStore asks for the event with its studio, and never sends a non-uuid', async () => {
    const { SupabaseStore } = await import('../worker/store-supabase');
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (input: string) => {
      urls.push(String(input));
      return new Response(JSON.stringify(String(input).includes(EV_A) ? [{ id: EV_A }] : []), { headers: { 'Content-Type': 'application/json' } });
    });
    try {
      const sb = new SupabaseStore('https://db.test', 'service-key');
      expect(await sb.eventInStudio(A, EV_A)).toBe(true);
      expect(await sb.eventInStudio(A, "x' or 1=1")).toBe(false);
      expect(urls).toHaveLength(1);
      expect(urls[0]).toContain(`/rest/v1/events?id=eq.${EV_A}&tenant_id=eq.${A}`);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('P71: a closed gallery stays closed', () => {
  it('saving the form again with the same days does not reopen it; the days count only when they change', async () => {
    const { store, env } = setup();
    const s = await getSettings(env, store, A);
    const g = await createGallery(store, env, s, { coupleName: 'Closed & Kept', days: 30 }, A);
    // Closed now (the batch's "close").
    expect(await closeGallery(store, A, [g])).toEqual([g.id]);
    const closed = (await store.getGallery(g.id))!;
    expect(Date.parse(closed.expiresAt)).toBeLessThanOrEqual(Date.now());
    expect(closed.days).toBe(30);
    // The form sends everything back, days included, unchanged: still closed.
    const saved = await updateGallery(store, env, s, closed, { coupleName: 'Closed & Kept', venue: 'אולם', days: 30 });
    expect(saved.venue).toBe('אולם');
    expect(saved.expiresAt).toBe(closed.expiresAt);
    // Days really changed: the closing day follows them.
    const longer = await updateGallery(store, env, s, saved, { days: 60 });
    expect(Date.parse(longer.expiresAt)).toBeGreaterThan(Date.now() + 50 * 86_400_000);
    // Less than a day is refused.
    await expect(updateGallery(store, env, s, longer, { days: 0 })).rejects.toMatchObject({ status: 400 });
  });

  it('an old gallery saved with 0 days gets 1 when closed, so a form sent back never reopens it', async () => {
    const { store, env } = setup();
    const s = await getSettings(env, store, A);
    const g = await createGallery(store, env, s, { coupleName: 'Zero' }, A);
    await store.patchGallery(A, g.id, { days: 0 });
    await closeGallery(store, A, [(await store.getGallery(g.id))!]);
    const closed = (await store.getGallery(g.id))!;
    expect(closed.days).toBe(1);
    const saved = await updateGallery(store, env, s, closed, { coupleName: 'Zero', days: 1 });
    expect(saved.expiresAt).toBe(closed.expiresAt);
  });
});

describe('what the couple receives', () => {
  it('every Dropbox and Drive film streams through our route, and the Google key never appears', async () => {
    const { store, env } = setup();
    const s = await getSettings(env, store, A);
    const g = await createGallery(store, env, s, { coupleName: 'Dana & Avi', films: [driveFilm, dropboxFilm] }, A);
    const view = coupleView(g, s, env);
    const text = JSON.stringify(view);
    expect(text).not.toContain('AIza');
    expect(text).not.toContain('dropbox.com');
    for (const f of view.films) {
      expect(f.watchUrl).toMatch(new RegExp(`^/api/watch/${g.id}/film/\\d+$`));
      expect(f.downloadUrl).toMatch(/\?dl=1$/);
    }
  });

  it('a closed gallery hands out no links at all', async () => {
    const { store, env } = setup();
    const s = await getSettings(env, store, A);
    const g = await createGallery(store, env, s, { coupleName: 'Old', films: [dropboxFilm], folderUrl: 'https://www.dropbox.com/scl/fo/abc/def?rlkey=k' }, A);
    g.expiresAt = new Date(Date.now() - 1000).toISOString();
    const view = coupleView(g, s, env);
    expect(view.expired).toBe(true);
    expect(view.films).toEqual([]);
    expect(view.folderDownloadUrl).toBe('');
  });

  it('the Dropbox "download all" goes through our route too', async () => {
    const { store, env } = setup();
    const s = await getSettings(env, store, A);
    const g = await createGallery(store, env, s, { coupleName: 'Z', folderUrl: 'https://www.dropbox.com/scl/fo/abc/def?rlkey=k' }, A);
    expect(coupleView(g, s, env).folderDownloadUrl).toBe(`/api/watch/${g.id}/all`);
  });

  it('branding comes from the studio record', async () => {
    const { store, env } = setup();
    const view = publicView(await getSettings(env, store, A));
    expect(view).toMatchObject({ studioName: 'Studio A', logoUrl: 'https://cdn/a.png', instagram: 'studio.a' });
  });

  it('the hub default accent keeps the gallery gold; a chosen accent is passed on', () => {
    const env = fakeEnv() as Env;
    const base = { id: A, name: 'S', displayName: 'S', logoUrl: '', phone: '', instagramUrl: '', facebookUrl: '', slug: 's', access: 'ok' as const, films: true, photos: true };
    expect(settingsFrom(env, { ...base, accentColor: '#FACC15' }, defaultFilmsStudio(), null, A).accentColor).toBe('');
    expect(settingsFrom(env, { ...base, accentColor: '#3B82F6' }, defaultFilmsStudio(), null, A).accentColor).toBe('#3b82f6');
  });
});

describe('slugs', () => {
  it('rejects reserved, invalid and taken slugs', async () => {
    const { store } = setup();
    await expect(store.setSlug(A, 'admin')).rejects.toThrow();
    await expect(store.setSlug(A, 'Bad Slug')).rejects.toThrow();
    await expect(store.setSlug(A, 'studio-b')).rejects.toThrow(/תפוסה/);
    await store.setSlug(A, 'my-studio');
    expect(await store.tenantIdBySlug('my-studio')).toBe(A);
  });

  it('P73: an address a studio gave up leads to it, stays its own a year, and changes are limited', async () => {
    const { store, env } = setup();
    const worker = (await import('../worker/index')).default;
    const { storeFor } = await import('../worker/store');
    const shared = (await storeFor({ ...env, CLOUD_MOCK: '1' } as Env)) as MemoryStore;
    const C = '33333333-3333-4333-8333-333333333333';
    const D = '44444444-4444-4444-8444-444444444444';
    shared.seedTenant({ id: C, name: 'Studio C', slug: 'p73-old-home' });
    shared.seedTenant({ id: D, name: 'Studio D', slug: 'p73-other' });
    await shared.patchFilmsStudio(C, { pageEnabled: true });
    await shared.setSlug(C, 'p73-new-home');
    const site = { ...env, CLOUD_MOCK: '1', ASSETS: { fetch: async () => new Response('<!doctype html><title>x</title>', { headers: { 'Content-Type': 'text/html' } }) } } as unknown as Env;
    const get = (path: string, init?: RequestInit) => worker.fetch(new Request(`https://films.test${path}`, init), site);

    // The old address's page moves to the new one (302: after a year another studio may take it).
    const page = await get('/p73-old-home?ref=card');
    expect(page.status).toBe(302);
    expect(page.headers.get('Location')).toBe('/p73-new-home?ref=card');
    // A lead left on the old address reaches the studio that gave it up.
    const lead = await get('/api/studio/p73-old-home/lead', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '5.6.7.8' }, body: JSON.stringify({ coupleName: 'דנה & אבי', phone: '0501234567', date: '2027-06-01' }) });
    expect(lead.status).toBe(200);
    expect(shared.leads.at(-1)!.tenantId).toBe(C);
    expect(((await (await get('/api/studio/p73-old-home')).json()) as { slug: string }).slug).toBe('p73-new-home');

    // Another studio can't take it; the studio that gave it up can take it back.
    await expect(shared.setSlug(D, 'p73-old-home')).rejects.toThrow('הכתובת שמורה לסטודיו אחר');
    await shared.setSlug(C, 'p73-old-home');
    expect(await shared.tenantIdBySlug('p73-old-home')).toBe(C);
    // 3 changes in 30 days: the fourth waits.
    await shared.setSlug(C, 'p73-third');
    await expect(shared.setSlug(C, 'p73-fourth')).rejects.toThrow(/3 פעמים/);
    // A year on, a given-up address is free again.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 366 * 86_400_000);
      await shared.setSlug(D, 'p73-new-home');
      expect(await shared.tenantIdBySlug('p73-new-home')).toBe(D);
      await shared.setSlug(C, 'p73-fourth');
    } finally {
      vi.useRealTimers();
    }
    void store;
  });
});

describe('MyAirBridge films', () => {
  it('only MyAirBridge addresses are accepted (couples are redirected there)', async () => {
    const { store, env } = setup();
    const s = await getSettings(env, store, A);
    const mab = { title: 'T', tag: 'teaser', fileName: 't.mp4', provider: 'myairbridge', playable: true } as Partial<Film>;
    await expect(createGallery(store, env, s, { coupleName: 'X', films: [{ ...mab, fileId: 'https://evil.example/phish' }] }, A)).rejects.toThrow(/MyAirBridge/);
    const ok = await createGallery(store, env, s, { coupleName: 'X', films: [{ ...mab, fileId: 'https://files.myairbridge.com/f/t.mp4' }] }, A);
    expect(ok.films[0].fileId).toBe('https://files.myairbridge.com/f/t.mp4');
  });
});

describe('Cloudflare logs (fix plan P07)', () => {
  it('keeps error logs but not the per-request log with full URLs', () => {
    // wrangler.jsonc has only whole-line comments.
    const config = JSON.parse(wranglerConfig.replace(/^\s*\/\/.*$/gm, ''));
    expect(config.observability?.enabled).toBe(true);
    expect(config.observability?.logs?.enabled).toBe(true);
    expect(config.observability?.logs?.invocation_logs).toBe(false);
  });
});

describe('the in-memory store names a studio like Supabase does', () => {
  it('a studio first created by a sign-in and renamed later shows the new name to couples', async () => {
    const store = new MemoryStore();
    // The hub dashboard signs in before any test seeds the studio: it is created with the default name.
    await store.userFromToken(`test:u:${A}:owner`);
    store.seedTenant({ id: A, name: 'Studio Renamed', slug: 'studio-a' });
    expect((await store.getTenant(A))?.displayName).toBe('Studio Renamed');
    expect((await getSettings(fakeEnv() as Env, store, A)).studioName).toBe('Studio Renamed');
  });

  it('a display name the studio set wins over the name, and clearing it falls back to the name', async () => {
    const store = new MemoryStore();
    store.seedTenant({ id: A, name: 'Studio A', displayName: 'A Films' });
    store.seedTenant({ id: A, name: 'Studio A2' });
    expect((await store.getTenant(A))?.displayName).toBe('A Films');
    store.seedTenant({ id: A, displayName: '' });
    expect((await store.getTenant(A))?.displayName).toBe('Studio A2');
  });
});

// Fix plan P10: what a stranger can make the Worker write. A view event only for a real gallery id (a made-up one is
// never looked up nor counted — it used to write a row each time), and a studio's uploads that write to KV or storage
// (cover, list picture, song) at most ADMIN_UPLOADS_PER_HOUR an hour. The cover's edge cache is P66's
// (photo-cache.test.ts).
describe('P10: public writes and studio uploads are bounded', () => {
  it('an event for an id that is no gallery reads nothing and records nothing', async () => {
    const { env } = setup();
    const worker = (await import('../worker/index')).default;
    const { storeFor } = await import('../worker/store');
    const shared = (await storeFor({ ...env, CLOUD_MOCK: '1' } as Env)) as MemoryStore;
    const site = { ...env, CLOUD_MOCK: '1' } as Env;
    const before = shared.hits.size;
    const getGallery = vi.spyOn(shared, 'getGallery');
    for (const id of ['not-a-gallery', '0123456789abcdeg', 'x'.repeat(300), '../../etc']) {
      const r = await worker.fetch(new Request(`https://films.test/api/watch/${encodeURIComponent(id)}/event`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '7.7.7.7' }, body: JSON.stringify({ type: 'view' }) }), site);
      expect(r.status).toBe(404);
    }
    expect(getGallery).not.toHaveBeenCalled();
    expect(shared.hits.size).toBe(before);
    getGallery.mockRestore();
  });

  it("a studio's uploads stop at the hourly limit", async () => {
    const { env } = setup();
    const worker = (await import('../worker/index')).default;
    const { storeFor } = await import('../worker/store');
    const { ADMIN_UPLOADS_PER_HOUR } = await import('../worker/studio');
    const shared = (await storeFor({ ...env, CLOUD_MOCK: '1' } as Env)) as MemoryStore;
    const E = '55555555-5555-4555-8555-555555555555';
    shared.seedTenant({ id: E, name: 'Studio E', slug: 'p10-uploads' });
    const site = { ...env, CLOUD_MOCK: '1' } as Env;
    const owner = { Authorization: `Bearer test:p10:${E}:owner` };
    const { id } = (await (await worker.fetch(new Request('https://films.test/api/admin/galleries', { method: 'POST', headers: { ...owner, 'Content-Type': 'application/json' }, body: JSON.stringify({ coupleName: 'א & ב' }) }), site)).json()) as { id: string };
    const thumb = () => worker.fetch(new Request(`https://films.test/api/admin/galleries/${id}/thumb`, { method: 'POST', headers: { ...owner, 'Content-Type': 'image/jpeg' }, body: new Uint8Array([255, 216, 255, 224]) }), site);
    expect((await thumb()).status).toBe(200);
    shared.hits.set(`admin-upload:${E}`, Array.from({ length: ADMIN_UPLOADS_PER_HOUR }, () => Date.now()));
    const r = await thumb();
    expect(r.status).toBe(429);
    const cover = await worker.fetch(new Request(`https://films.test/api/admin/galleries/${id}/cover`, { method: 'POST', headers: { ...owner, 'Content-Type': 'image/jpeg' }, body: new Uint8Array([255, 216, 255, 224]) }), site);
    expect(cover.status).toBe(429);
  });
});

// Fix plan P12 (0161, D23(2)): a signup whose owner has not confirmed the email is 'blocked' (tenant_access_state, read by
// films_tenant_info) — its couple pages and its studio page are 404 like a suspended studio's, and open the moment the
// owner confirms. Over PGlite with every migration (the real rule), through SupabaseStore.
// Avira: no self-signup, so no unconfirmed studio.
describe.skip('P12: an unconfirmed signup has no public page', () => {
  it("the couple's page and the studio page are 404 until the owner confirms the email", async () => {
    const { buildDb, supabaseFetchFor } = await import('./pglite-supabase');
    const worker = (await import('../worker/index')).default;
    const db = await buildDb();
    const BASE = 'http://supabase.p12.test';
    const rest = supabaseFetchFor(db, BASE);
    const T = '00000000-0000-4000-8000-0000000012a1';
    const U = '00000000-0000-4000-8000-0000000012b1';
    const G = '1212121212121201';
    // What signup-tenant makes: the studio with email_verified_at null, the owner's login unconfirmed.
    await db.query(`insert into tenants (id, name, slug, status, modules, email_verified_at) values ($1, 'New signup', 'p12-new-signup', 'trialing', '{films,photos}', null)`, [T]);
    await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, 'new-owner@example.test', null)`, [U]);
    await db.query(`insert into profiles (id, tenant_id, role) values ($1, $2, 'owner')`, [U, T]);
    await db.query(`insert into films_studio_settings (tenant_id, page_enabled, headline) values ($1, true, 'headline')`, [T]);
    await db.query(`insert into films_galleries (id, tenant_id, couple_name, expires_at) values ($1, $2, 'Couple 12', now() + interval '30 days')`, [G, T]);
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(input instanceof Request ? input.url : String(input));
      if (u.origin === BASE) return rest(input, init);
      throw new Error(`unexpected request: ${u.href}`);
    });
    try {
      const env = { ...fakeEnv(), SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key', FILMS_STATE_SECRET: 'p12-state-secret', CLOUD_MOCK: '1' } as unknown as Env;
      const get = (path: string) => worker.fetch(new Request(`https://films.test${path}`), env);
      let r = await get(`/api/watch/${G}`);
      expect(r.status).toBe(404);
      expect(await r.text()).not.toContain('Couple 12');
      r = await get('/api/studio/p12-new-signup');
      expect(r.status).toBe(404);
      expect(await r.text()).not.toContain('New signup');
      // The owner opens the link in the signup mail: Supabase marks the email confirmed (the trigger verifies the studio).
      await db.query(`update auth.users set email_confirmed_at = now() where id = $1`, [U]);
      expect((await get(`/api/watch/${G}`)).status).toBe(200);
      r = await get('/api/studio/p12-new-signup');
      expect(r.status).toBe(200);
    } finally {
      vi.unstubAllGlobals();
      await db.close();
    }
  }, 60_000);
});
