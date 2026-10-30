// Fix plan P60: two requests close together on the same gallery must not lose each other's changes.
// Each case holds one request at the point where the old Worker kept a stale copy (a photo list, a
// gallery row, a list, the studio settings, the album) while a second request changes something,
// then lets the first one finish. Plus the Supabase store's requests (only the columns that changed,
// the photo list saved against its version).
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import { galleryChanges, storeFor } from '../worker/store';
import { MemoryStore } from '../worker/store-memory';
import { SupabaseStore } from '../worker/store-supabase';
import type { Env, Gallery } from '../worker/types';
import { fakeEnv } from './fake-kv';

const env = { ...fakeEnv(), CLOUD_MOCK: '1' } as Env;
let n = 600;

const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  worker.fetch(
    new Request(`https://films.test${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `1.6.0.${n}`, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );

const KEYS = ['aaaaaaaa', 'bbbbbbbb', 'cccccccc'];

async function setup() {
  n++;
  const tid = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const studio = { Authorization: `Bearer test:u${n}:${tid}:owner` };
  const store = (await storeFor(env)) as MemoryStore;
  store.seedTenant({ id: tid, slug: `studio-${n}l` });
  const g = (await (await call('POST', '/api/admin/galleries', { coupleName: 'מאי & אופק', kind: 'photos' }, studio)).json()) as { id: string };
  await store.savePhotos(tid, g.id, { folderUrl: '', provider: 'mock', sets: [], items: KEYS.map((key) => ({ key, name: `${key}.jpg`, ref: `m:/${key}.jpg` })) });
  return { tid, studio, id: g.id, store };
}

type Methods = keyof MemoryStore & string;
const saved: [MemoryStore, string, unknown][] = [];
afterEach(() => {
  for (const [store, name, fn] of saved.splice(0)) (store as unknown as Record<string, unknown>)[name] = fn;
});

/**
 * Holds the next call of one of `names` (the first that is called): `after` = it runs, then waits
 * (a stale read); otherwise it waits, then runs (a late write). `reached` resolves when it is held.
 */
function hold(store: MemoryStore, names: Methods[], after: boolean) {
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const arrived = new Promise<void>((r) => (reached = r));
  const own = store as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  const originals = names.filter((m) => typeof own[m] === 'function').map((m) => [m, own[m]] as const);
  const restore = () => {
    for (const [m, fn] of originals) own[m] = fn;
  };
  for (const [m, fn] of originals) {
    saved.push([store, m, fn]);
    own[m] = async (...args: unknown[]) => {
      restore();
      reached();
      if (after) {
        const out = await fn.apply(store, args);
        await gate;
        return out;
      }
      await gate;
      return fn.apply(store, args);
    };
  }
  return { reached: arrived, release };
}

/** The first `count` calls of `name` wait for each other, then all go on (both requests read before either writes). */
function barrier(store: MemoryStore, name: Methods, count = 2) {
  const own = store as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  const fn = own[name];
  saved.push([store, name, fn]);
  let waiting = 0;
  let open!: () => void;
  const all = new Promise<void>((r) => (open = r));
  own[name] = async (...args: unknown[]) => {
    const out = await fn.apply(store, args);
    if (++waiting >= count) {
      own[name] = fn;
      open();
    }
    await all;
    return out;
  };
}


describe('photo list: two edits at once', () => {
  it('keeps both when one edit read the list before the other saved', async () => {
    const { studio, id, store } = await setup();
    const h = hold(store, ['getPhotosVersioned', 'getPhotos'], true);
    const first = call('PUT', `/api/admin/galleries/${id}/photos`, { items: { aaaaaaaa: { hidden: true } } }, studio);
    await h.reached;
    const second = await call('PUT', `/api/admin/galleries/${id}/photos`, { items: { bbbbbbbb: { hidden: true } } }, studio);
    expect(second.status).toBe(200);
    h.release();
    expect((await first).status).toBe(200);
    const items = (await store.getPhotos(id))!.items;
    expect(items.filter((i) => i.hidden).map((i) => i.key).sort()).toEqual(['aaaaaaaa', 'bbbbbbbb']);
    expect((await store.getGallery(id))!.photoCount).toBe(1);
  });

  it('gives up with 409 after three clashes instead of overwriting', async () => {
    const { studio, id, store } = await setup();
    const real = store.savePhotos.bind(store);
    const realPatch = store.patchPhotos.bind(store);
    store.savePhotos = async (t, g, d, v) => (v === undefined ? real(t, g, d) : false);
    // P61: an edit is written as what changed (patchPhotos), against the version too.
    store.patchPhotos = async () => 'conflict';
    try {
      const res = await call('PUT', `/api/admin/galleries/${id}/photos`, { items: { aaaaaaaa: { hidden: true } } }, studio);
      expect(res.status).toBe(409);
    } finally {
      store.savePhotos = real;
      store.patchPhotos = realPatch;
    }
    expect((await store.getPhotos(id))!.items.some((i) => i.hidden)).toBe(false);
  });
});

describe('the gallery row is not written back from a stale copy', () => {
  it('a photo save that was slow keeps the password, the cancelled print link and the trash', async () => {
    const { tid, studio, id, store } = await setup();
    // A print link needs an album the couple sent (P55).
    await store.putAlbum(tid, id, { size: '80x30', spreads: [], status: 'submitted', updatedAt: new Date().toISOString() } as never);
    expect((await call('POST', `/api/admin/galleries/${id}/print-link`, {}, studio)).status).toBe(200);
    expect((await store.getGallery(id))!.printToken).toBeTruthy();

    // An edit is written as what changed since P61 (patchPhotos); a folder load still saves whole (savePhotos).
    const h = hold(store, ['savePhotos', 'patchPhotos'], false);
    const slow = call('PUT', `/api/admin/galleries/${id}/photos`, { items: { cccccccc: { hidden: true } } }, studio);
    await h.reached;
    expect((await call('PUT', `/api/admin/galleries/${id}`, { password: 'סוד' }, studio)).status).toBe(200);
    expect((await call('DELETE', `/api/admin/galleries/${id}/print-link`, undefined, studio)).status).toBe(200);
    // A sent album goes to the trash with the studio's yes (P71).
    expect((await call('DELETE', `/api/admin/galleries/${id}?force=1`, undefined, studio)).status).toBe(200);
    h.release();
    expect((await slow).status).toBe(200);

    const g = (await store.getGallery(id))!;
    expect(g.password).toBe('סוד');
    expect(g.printToken).toBeUndefined();
    expect(g.deletedAt).toBeTruthy();
    expect(g.photoCount).toBe(2);
  });

  it('a gallery removed for good while its photos were saving answers 404 and does not come back', async () => {
    const { studio, id, store } = await setup();
    const h = hold(store, ['savePhotos', 'patchPhotos'], false);
    const slow = call('PUT', `/api/admin/galleries/${id}/photos`, { items: { aaaaaaaa: { hidden: true } } }, studio);
    await h.reached;
    await call('DELETE', `/api/admin/galleries/${id}`, undefined, studio);
    expect((await call('DELETE', `/api/admin/galleries/${id}?forever=1`, undefined, studio)).status).toBe(200);
    h.release();
    expect((await slow).status).toBe(404);
    expect(await store.getGallery(id)).toBeNull();
    expect(await store.getPhotos(id)).toBeNull();
  });

  it('the gallery form writes only what it changed', async () => {
    const { studio, id, store } = await setup();
    // The form was opened before the password was set; it sends every field back.
    const before = (await (await call('GET', `/api/admin/galleries/${id}`, undefined, studio)).json()) as Gallery;
    const h = hold(store, ['patchGallery', 'putGallery'] as Methods[], false);
    const form = call('PUT', `/api/admin/galleries/${id}`, { coupleName: before.coupleName, date: '2026-10-01', venue: before.venue ?? '', music: '' }, studio);
    await h.reached;
    await store.patchGallery(before.tenantId, id, { password: 'בינתיים', downloadPin: '1234' });
    h.release();
    expect((await form).status).toBe(200);
    const g = (await store.getGallery(id))!;
    expect(g.date).toBe('2026-10-01');
    expect(g.password).toBe('בינתיים');
    expect(g.downloadPin).toBe('1234');
  });

  it('two first openings at once give one guests address', async () => {
    const { studio, id, store } = await setup();
    // Nobody opened it yet, so it has no guests' address.
    expect((await store.getGallery(id))!.guestId).toBeUndefined();
    barrier(store, 'getGallery');
    const [a, b] = await Promise.all([call('GET', `/api/admin/galleries/${id}`, undefined, studio), call('GET', `/api/admin/galleries/${id}`, undefined, studio)]);
    const ga = ((await a.json()) as Gallery).guestId;
    const gb = ((await b.json()) as Gallery).guestId;
    expect(ga).toMatch(/^[0-9a-f]{16}$/);
    expect(gb).toBe(ga);
    expect((await store.getGallery(id))!.guestId).toBe(ga);
  });
});

describe('personal lists', () => {
  it('two marks at once on one list both stay', async () => {
    const { id, store } = await setup();
    const made = (await (await call('POST', `/api/watch/${id}/lists`, { name: 'לסבתא' })).json()) as { id: string };
    barrier(store, 'listLists');
    const [a, b] = await Promise.all([
      call('PUT', `/api/watch/${id}/lists/${made.id}`, { keys: ['aaaaaaaa'], on: true }),
      call('PUT', `/api/watch/${id}/lists/${made.id}`, { keys: ['cccccccc'], on: true }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await store.listLists(id))[0].keys.sort()).toEqual(['aaaaaaaa', 'cccccccc']);
  });

  it('two "new list" clicks with one name make one list with both photos', async () => {
    const { id, store } = await setup();
    barrier(store, 'listLists');
    await Promise.all([call('POST', `/api/watch/${id}/lists`, { name: 'חתונה', keys: ['aaaaaaaa'] }), call('POST', `/api/watch/${id}/lists`, { name: 'חתונה', keys: ['bbbbbbbb'] })]);
    const lists = await store.listLists(id);
    expect(lists).toHaveLength(1);
    expect(lists[0].keys.sort()).toEqual(['aaaaaaaa', 'bbbbbbbb']);
  });

  it('renaming to a name another list has is refused with a clear message', async () => {
    const { id } = await setup();
    await call('POST', `/api/watch/${id}/lists`, { name: 'א' });
    const b = (await (await call('POST', `/api/watch/${id}/lists`, { name: 'ב' })).json()) as { id: string };
    const res = await call('PUT', `/api/watch/${id}/lists/${b.id}`, { name: 'א' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('כבר יש רשימה בשם הזה');
  });
});

describe('studio settings', () => {
  it('a song uploaded while the settings were saving stays', async () => {
    const { studio, tid, store } = await setup();
    const h = hold(store, ['getFilmsStudio'], true);
    const settings = call('PUT', '/api/admin/settings', { headline: 'כותרת חדשה' }, studio);
    await h.reached;
    const up = await worker.fetch(
      new Request('https://films.test/api/admin/music', { method: 'POST', headers: { ...studio, 'Content-Type': 'audio/mpeg', 'X-File-Name': 'song.mp3' }, body: new Uint8Array([1, 2, 3]) }),
      env,
    );
    expect(up.status).toBe(200);
    h.release();
    expect((await settings).status).toBe(200);
    const f = await store.getFilmsStudio(tid);
    expect(f.headline).toBe('כותרת חדשה');
    expect(f.music).toHaveLength(1);
    expect(f.musicDefault).toBe(f.music![0].id);
  });
});

describe('album draft', () => {
  it('a draft save that crossed the couple sending the album gets 409 and the album stays sent', async () => {
    const { id, store } = await setup();
    const album = { size: '80x30', spreads: [{ id: 'a', template: 't01', fills: [{ photo: 'aaaaaaaa' }], texts: [] }] };
    expect((await call('PUT', `/api/watch/${id}/album`, { album })).status).toBe(200);
    // P57: a draft save is one write (no read first); held before it runs, it lands after the send.
    const h = hold(store, ['putAlbum'], false);
    const late = call('PUT', `/api/watch/${id}/album`, { album });
    await h.reached;
    expect((await call('POST', `/api/watch/${id}/album/submit`, {})).status).toBe(200);
    h.release();
    expect((await late).status).toBe(409);
    expect((await store.getAlbum(id))!.status).toBe('submitted');
  });
});

describe('SupabaseStore requests', () => {
  type Sent = { url: string; method: string; body: Record<string, unknown> | null; prefer: string };
  function stub(reply: (s: Sent) => unknown) {
    const sent: Sent[] = [];
    vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
      const s = { url: String(input), method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : null, prefer: (init.headers as Record<string, string>)?.Prefer ?? '' };
      sent.push(s);
      return new Response(JSON.stringify(reply(s)), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    return sent;
  }
  afterEach(() => vi.unstubAllGlobals());
  const sb = () => new SupabaseStore('https://sb.test', 'service-key');

  it('saves the photo list only against the version it read', async () => {
    const sent = stub((s) => (s.url.includes('version=eq.4') ? [] : [{ version: 8 }]));
    const data = { folderUrl: '', provider: 'mock' as const, sets: [], items: [] };
    expect(await sb().savePhotos('t1', 'abcdefabcdefabcd', data, 4)).toBe(false);
    expect(sent[0].method).toBe('PATCH');
    expect(sent[0].url).toContain('/rest/v1/films_photos?gallery_id=eq.abcdefabcdefabcd&tenant_id=eq.t1&version=eq.4');
    expect(sent[0].prefer).toBe('return=representation');
    expect(await sb().savePhotos('t1', 'abcdefabcdefabcd', data, 7)).toBe(true);
    // No list yet: an insert that yields to one made meanwhile, never an overwrite.
    await sb().savePhotos('t1', 'abcdefabcdefabcd', data, null);
    expect(sent[2].method).toBe('POST');
    expect(sent[2].prefer).toContain('resolution=ignore-duplicates');
  });

  it('patches only the gallery columns that changed, for this studio only', async () => {
    const sent = stub(() => [{ id: 'abcdefabcdefabcd', tenant_id: 't1', created_at: '2026-01-01', expires_at: '2026-02-01' }]);
    const g = await sb().patchGallery('t1', 'abcdefabcdefabcd', { photoCount: 3, coverKey: 'aaaaaaaa', folderUrl: 'https://x', folderProvider: 'dropbox' });
    expect(g?.id).toBe('abcdefabcdefabcd');
    expect(sent[0].method).toBe('PATCH');
    expect(sent[0].url).toContain('films_galleries?id=eq.abcdefabcdefabcd&tenant_id=eq.t1');
    expect(Object.keys(sent[0].body!).sort()).toEqual(['cover_key', 'folder_provider', 'folder_url', 'photo_count', 'updated_at']);
  });

  it('a removed password or code is written as null, and guards become filters', async () => {
    const sent = stub(() => []);
    const before = { id: 'abcdefabcdefabcd', tenantId: 't1', coupleName: 'א', date: '', days: 30, createdAt: '', expiresAt: '', hasCover: false, films: [], views: 1, downloads: 2, password: 'x', downloadPin: '1' } as Gallery;
    const after = { ...before, password: undefined, downloadPin: undefined, views: 50 };
    const changes = galleryChanges(before, after);
    expect(Object.keys(changes).sort()).toEqual(['downloadPin', 'password']);
    expect(await sb().patchGallery('t1', before.id, changes, { guestId: null, linkedId: 'bbbbbbbbbbbbbbbb' })).toBeNull();
    expect(sent[0].body).toMatchObject({ password: null, download_pin: null });
    expect(sent[0].body).not.toHaveProperty('views');
    expect(sent[0].url).toContain('&guest_id=is.null&linked_id=eq.bbbbbbbbbbbbbbbb');
  });

  it('creates a gallery with a plain insert and writes settings as the changed columns only', async () => {
    const sent = stub(() => []);
    await sb().putGallery({ id: 'abcdefabcdefabcd', tenantId: 't1', coupleName: 'א', date: '', days: 30, createdAt: '', expiresAt: '', hasCover: false, films: [], views: 0, downloads: 0 });
    expect(sent[0].url).toBe('https://sb.test/rest/v1/films_galleries');
    expect(sent[0].prefer).toBe('');
    await sb().patchFilmsStudio('t1', { headline: 'x', dropboxAccountName: undefined });
    expect(Object.keys(sent[1].body!).sort()).toEqual(['dropbox_account_name', 'headline', 'tenant_id', 'updated_at']);
    expect(sent[1].body!.dropbox_account_name).toBeNull();
  });

  it('list changes go through the two database functions', async () => {
    const sent = stub((s) => (s.url.endsWith('films_photo_list_create') ? { error: 'too_many' } : { id: 'aaaaaaaaaaaa', name: 'x', keys: ['aaaaaaaa'] }));
    expect(await sb().toggleList('abcdefabcdefabcd', 'aaaaaaaaaaaa', ['aaaaaaaa'], true)).toEqual({ id: 'aaaaaaaaaaaa', name: 'x', keys: ['aaaaaaaa'] });
    expect(sent[0].url).toBe('https://sb.test/rest/v1/rpc/films_photo_list_toggle');
    expect(sent[0].body).toEqual({ p_gallery_id: 'abcdefabcdefabcd', p_list_id: 'aaaaaaaaaaaa', p_keys: ['aaaaaaaa'], p_on: true });
    expect(await sb().createList('abcdefabcdefabcd', { id: 'bbbbbbbbbbbb', name: 'y', keys: [] })).toBe('too_many');
  });
});

