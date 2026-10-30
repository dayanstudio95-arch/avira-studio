// The hourly clean-up (fix plan P69): one failing gallery doesn't stop the rest, a run keeps to its
// subrequest budget and repeated runs finish the work, open galleries aren't read one by one, the trash
// has no fixed cap and studios take turns, face data goes on time (D06) with face search switched off.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeChunk } from '../shared/faces';
import { CLOSED_STUDIO_GRACE_DAYS, FACE_MAX_AGE_DAYS, nightly, subrequestBudget } from '../worker/cleanup';
import { addFacesChunk } from '../worker/faces';
import { closeOfDay } from '../shared/day';
import { extendGallery, MAX_GALLERY_DAYS } from '../worker/galleries';
import { MemoryStore } from '../worker/store-memory';
import { SupabaseStore } from '../worker/store-supabase';
import type { Gallery, PhotoData } from '../worker/types';

const DAY = 86_400_000;
const vec = Array.from({ length: 128 }, (_, i) => Math.sin(i) * 0.2);
const hex = (n: number) => n.toString(16).padStart(16, '0');

function kvCounter() {
  const kv = { deletes: 0, delete: async () => void kv.deletes++ };
  return kv;
}

function envWith(budget?: number, kv = kvCounter()) {
  return { env: { KV: kv, ...(budget ? { CLEANUP_MAX_SUBREQUESTS: String(budget) } : {}) } as never, kv };
}

function gallery(id: string, over: Partial<Gallery> = {}): Gallery {
  return { id, tenantId: 't1', kind: 'photos', coupleName: 'x', date: '', films: [], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * DAY).toISOString(), days: 30, hasCover: false, views: 0, downloads: 0, ...over } as Gallery;
}

async function withFaces(store: MemoryStore, id: string, over: Partial<Gallery> = {}, faceSearch = true) {
  const g = gallery(id, over);
  await store.putGallery(g);
  await store.savePhotos(g.tenantId, id, { folderUrl: '', provider: 'mock', sets: [], items: [{ key: 'aaaaaaaa', name: 'a.jpg' }], faceSearch } as unknown as PhotoData);
  await addFacesChunk(store, g, encodeChunk([{ key: 'aaaaaaaa', faces: [{ box: [0.1, 0.1, 0.2, 0.2], vec }] }]), new Set(['aaaaaaaa']));
  return g;
}

const closed = { expiresAt: new Date(Date.now() - DAY).toISOString() };

describe('clean-up: errors and budget', () => {
  it('a gallery that fails is marked, reported and goes last; the others are still cleaned', async () => {
    const store = new MemoryStore();
    for (let i = 1; i <= 4; i++) await withFaces(store, hex(i), closed);
    const real = store.deleteFaces.bind(store);
    store.deleteFaces = async (id, opts) => {
      if (id === hex(1)) throw new Error('storage down');
      return real(id, opts);
    };
    const { env } = envWith();
    const r = await nightly(store, env);
    expect(r.facesRemoved).toEqual([hex(2), hex(3), hex(4)]);
    expect(r.errors).toEqual([{ step: 'faces', id: hex(1), error: 'storage down' }]);
    expect(r.pendingFaces).toBe(1);
    expect(store.faces.get(hex(1))?.failedAt).toBeTruthy();
    expect(store.runs.at(-1)).toMatchObject({ facesRemoved: 3, pendingFaces: 1, errors: [{ step: 'faces', id: hex(1) }] });
    // A new gallery to clean comes before the one that failed.
    await withFaces(store, hex(9), closed);
    expect((await store.faceCleanupCandidates({ maxAgeDays: 365, graceDays: 30, limit: 1 })).items[0].galleryId).toBe(hex(9));
  });

  it('a failing step does not stop the next ones: the trash and the rate-limit sweep still run', async () => {
    const store = new MemoryStore();
    await store.putGallery(gallery(hex(5), { kind: 'films', deletedAt: new Date(Date.now() - 40 * DAY).toISOString() }));
    store.faceCleanupCandidates = async () => {
      throw new Error('database busy');
    };
    const sweep = vi.spyOn(store, 'sweepRateHits');
    const r = await nightly(store, envWith().env);
    expect(r.errors.map((e) => e.step)).toEqual(['faces']);
    expect(r.purged).toEqual([hex(5)]);
    expect(sweep).toHaveBeenCalledOnce();
  });

  it('a run never sends more requests than its budget, and repeated runs finish everything', async () => {
    const store = new MemoryStore();
    for (let i = 1; i <= 30; i++) await withFaces(store, hex(i), closed);
    for (let i = 100; i < 140; i++) await withFaces(store, hex(i), { deletedAt: new Date(Date.now() - 40 * DAY).toISOString() }, false);
    // Trashed galleries lost their face data when they went to the trash.
    for (let i = 100; i < 140; i++) await store.deleteFaces(hex(i));
    let runs = 0;
    for (;;) {
      const { env, kv } = envWith(45);
      const before = store.callCount();
      const r = await nightly(store, env);
      runs++;
      expect(store.callCount() - before + kv.deletes).toBeLessThanOrEqual(45);
      expect(r.subrequests).toBe(store.callCount() - before + kv.deletes);
      expect(r.errors).toEqual([]);
      if (r.pendingFaces === 0 && r.pendingTrash === 0) break;
      expect(r.stopped).toBe('budget');
      expect(runs).toBeLessThan(40);
    }
    expect(runs).toBeGreaterThan(2);
    expect(await store.faceGalleryIds()).toEqual([]);
    expect([...store.galleries.keys()].filter((id) => store.galleries.get(id)?.deletedAt)).toEqual([]);
  });

  it('open galleries with face search on are not read one by one', async () => {
    const store = new MemoryStore();
    for (let i = 1; i <= 30; i++) await withFaces(store, hex(i));
    const reads = vi.spyOn(store, 'getGallery');
    const photos = vi.spyOn(store, 'getPhotos');
    const r = await nightly(store, envWith().env);
    expect(r.facesRemoved).toEqual([]);
    expect(reads).not.toHaveBeenCalled();
    expect(photos).not.toHaveBeenCalled();
    expect(await store.faceGalleryIds()).toHaveLength(30);
  });

  it('reads the budget from CLEANUP_MAX_SUBREQUESTS (45 by default, at least 20, at most 1000)', () => {
    expect(subrequestBudget({} as never)).toBe(45);
    expect(subrequestBudget({ CLEANUP_MAX_SUBREQUESTS: '900' } as never)).toBe(900);
    expect(subrequestBudget({ CLEANUP_MAX_SUBREQUESTS: '5' } as never)).toBe(45);
    expect(subrequestBudget({ CLEANUP_MAX_SUBREQUESTS: '5000' } as never)).toBe(1000);
  });
});

describe('clean-up: the trash', () => {
  it('removes more than 25 galleries in one run when the budget allows', async () => {
    const store = new MemoryStore();
    for (let i = 1; i <= 40; i++) await store.putGallery(gallery(hex(i), { kind: 'films', deletedAt: new Date(Date.now() - 40 * DAY).toISOString() }));
    const r = await nightly(store, envWith(1000).env);
    expect(r.purged).toHaveLength(40);
    expect(r.pendingTrash).toBe(0);
    expect(store.galleries.size).toBe(0);
  });

  it('a small studio does not wait behind a big one', async () => {
    const store = new MemoryStore();
    for (let i = 1; i <= 30; i++) await store.putGallery(gallery(hex(i), { tenantId: 'big', kind: 'films', deletedAt: new Date(Date.now() - (90 - i) * DAY).toISOString() }));
    await store.putGallery(gallery(hex(99), { tenantId: 'small', kind: 'films', deletedAt: new Date(Date.now() - 31 * DAY).toISOString() }));
    const r = await nightly(store, envWith(45).env);
    expect(r.purged.slice(0, 2)).toEqual([hex(1), hex(99)]);
    expect(r.pendingTrash).toBeGreaterThan(0);
  });

  it('a gallery that fails to purge is marked and the rest go on', async () => {
    const store = new MemoryStore();
    for (let i = 1; i <= 3; i++) await store.putGallery(gallery(hex(i), { kind: 'films', deletedAt: new Date(Date.now() - (40 + i) * DAY).toISOString() }));
    const real = store.deleteGallery.bind(store);
    store.deleteGallery = async (id) => {
      if (id === hex(3)) throw new Error('row locked');
      return real(id);
    };
    const r = await nightly(store, envWith().env);
    expect(r.purged.sort()).toEqual([hex(1), hex(2)]);
    expect(r.errors).toEqual([{ step: 'trash', id: hex(3), error: 'row locked' }]);
    expect(store.purgeFailed.has(hex(3))).toBe(true);
    expect(r.pendingTrash).toBe(1);
  });
});

describe('clean-up: face data on time (D06)', () => {
  it(`goes ${FACE_MAX_AGE_DAYS} days after the scan, ${CLOSED_STUDIO_GRACE_DAYS} days after a studio ended, and orphan files too; face search switches off`, async () => {
    const store = new MemoryStore();
    await withFaces(store, hex(1)); // fresh: kept
    await withFaces(store, hex(2));
    store.faces.get(hex(2))!.createdAt = new Date(Date.now() - (FACE_MAX_AGE_DAYS + 1) * DAY).toISOString();
    await withFaces(store, hex(3), { tenantId: 'gone-studio' });
    store.studioEnded.set('gone-studio', new Date(Date.now() - (CLOSED_STUDIO_GRACE_DAYS + 1) * DAY).toISOString());
    await withFaces(store, hex(4), { tenantId: 'recent-studio' });
    store.studioEnded.set('recent-studio', new Date(Date.now() - 5 * DAY).toISOString());
    store.orphanFaces.set(hex(5), new Date(Date.now() - 3 * DAY).toISOString());
    store.orphanFaces.set(hex(6), new Date().toISOString()); // an upload in progress
    const r = await nightly(store, envWith().env);
    expect(r.facesRemoved).toEqual([hex(2), hex(3), hex(5)]);
    expect(await store.faceGalleryIds()).toEqual([hex(1), hex(4)]);
    expect((await store.getPhotos(hex(2)))?.faceSearch).toBe(false);
    expect((await store.getPhotos(hex(3)))?.faceSearch).toBe(false);
    expect((await store.getPhotos(hex(1)))?.faceSearch).toBe(true);
    expect(store.orphanFaces.has(hex(6))).toBe(true);
  });

  it('a closed gallery loses its face data and its face search (no empty search after an extension)', async () => {
    const store = new MemoryStore();
    await withFaces(store, hex(7), closed);
    await nightly(store, envWith().env);
    expect((await store.facesMeta(hex(7))).chunks).toBe(0);
    expect((await store.getPhotos(hex(7)))?.faceSearch).toBe(false);
  });
});

describe('the Worker: scheduled, "close" and the 10-year ceiling', () => {
  const setup = async () => {
    const { default: worker } = await import('../worker/index');
    const { storeFor } = await import('../worker/store');
    const env = { CLOUD_MOCK: '1', KV: { delete: async () => {}, get: async () => null, put: async () => {} } } as never;
    const store = (await storeFor(env)) as MemoryStore;
    await store.userFromToken('test:u1:t1:owner');
    return { worker, env, store, owner: { Authorization: 'Bearer test:u1:t1:owner', 'Content-Type': 'application/json' } };
  };

  it('"close" on several galleries deletes face data at once and switches face search off', async () => {
    const { worker, env, store, owner } = await setup();
    await withFaces(store, 'c10c10c10c10c10c');
    const res = await worker.fetch(new Request('http://films.test/api/admin/galleries/batch', { method: 'POST', headers: owner, body: JSON.stringify({ ids: ['c10c10c10c10c10c'], action: 'close' }) }), env);
    expect(await res.json()).toEqual({ ok: true, done: 1, doneIds: ['c10c10c10c10c10c'], skipped: [], remaining: [] });
    expect((await store.facesMeta('c10c10c10c10c10c')).chunks).toBe(0);
    expect((await store.getPhotos('c10c10c10c10c10c'))?.faceSearch).toBe(false);
  });

  it('a run with failures is reported as failed to Cloudflare (Cron Events), after doing the rest', async () => {
    const { worker, env, store } = await setup();
    await withFaces(store, 'e10e10e10e10e10e', closed);
    await withFaces(store, 'e20e20e20e20e20e', closed);
    const real = store.deleteFaces.bind(store);
    store.deleteFaces = async (id, opts) => {
      if (id === 'e10e10e10e10e10e') throw new Error('storage down');
      return real(id, opts);
    };
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(worker.scheduled({} as never, env)).rejects.toThrow('1 failure');
    expect(log.mock.calls.some((c) => String(c[0]).includes('e10e10e10e10e10e'))).toBe(true);
    expect((await store.facesMeta('e20e20e20e20e20e')).chunks).toBe(0);
    store.deleteFaces = real;
    log.mockRestore();
    await expect(worker.scheduled({} as never, env)).resolves.toBeUndefined();
  });

  it('a closing date more than 10 years after creation is refused; extensions stop at 10 years', async () => {
    const { worker, env, store, owner } = await setup();
    const far = new Date(Date.now() + (MAX_GALLERY_DAYS + 10) * DAY).toISOString();
    const bad = await worker.fetch(new Request('http://films.test/api/admin/galleries', { method: 'POST', headers: owner, body: JSON.stringify({ coupleName: 'x', expiresAt: far }) }), env);
    expect(bad.status).toBe(400);
    const near = new Date(Date.now() + (MAX_GALLERY_DAYS - 10) * DAY).toISOString();
    const good = await worker.fetch(new Request('http://films.test/api/admin/galleries', { method: 'POST', headers: owner, body: JSON.stringify({ coupleName: 'x', expiresAt: near }) }), env);
    expect(good.status).toBe(200);
    const g = gallery('f10f10f10f10f10f', { expiresAt: near });
    await store.putGallery(g);
    const extended = await extendGallery(store, g, 365);
    // At the end of that last day in Israel (P72).
    expect(Date.parse(extended.expiresAt)).toBe(closeOfDay(Date.parse(g.createdAt) + MAX_GALLERY_DAYS * DAY));
  });
});

describe('the Supabase store: the clean-up requests (0105)', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (answer: (url: string) => unknown) => {
    const sent: { url: string; method: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      sent.push({ url, method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body });
      return new Response(JSON.stringify(answer(url)), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    return sent;
  };

  it('asks the database for candidates, forgets face data with face search off, and counts every request', async () => {
    const sb = new SupabaseStore('https://sb.test', 'service-key');
    const sent = stub((url) =>
      url.includes('films_faces_cleanup_candidates')
        ? [{ gallery_id: hex(1), reason: 'closed', total: 7 }]
        : url.includes('films_trash_candidates')
          ? [{ gallery_id: hex(2), total: 3 }]
          : url.includes('/object/list/')
            ? [{ name: 'a.bin' }]
            : [],
    );
    expect(await sb.faceCleanupCandidates({ maxAgeDays: 365, graceDays: 30, limit: 8 })).toEqual({ items: [{ galleryId: hex(1), reason: 'closed' }], total: 7 });
    expect(sent[0]).toMatchObject({ method: 'POST', body: { p_max_age_days: 365, p_grace_days: 30, p_limit: 8 } });
    expect(await sb.trashCandidates('2026-01-01T00:00:00.000Z', 4)).toEqual({ ids: [hex(2)], total: 3 });
    expect(sent[1]).toMatchObject({ url: 'https://sb.test/rest/v1/rpc/films_trash_candidates', body: { p_before: '2026-01-01T00:00:00.000Z', p_limit: 4 } });
    await sb.deleteFaces(hex(1), { searchOff: true });
    // One list (shorter than a page), one delete, one call for the record and the switch.
    expect(sent.slice(2).map((r) => r.url.replace('https://sb.test', ''))).toEqual(['/storage/v1/object/list/films-faces', '/storage/v1/object/films-faces', '/rest/v1/rpc/films_faces_forget']);
    expect(sent[4].body).toEqual({ p_gallery_id: hex(1), p_search_off: true });
    await sb.markFaceCleanupFailed(hex(1));
    await sb.markPurgeFailed(hex(2));
    expect(sent[5]).toMatchObject({ method: 'PATCH', url: `https://sb.test/rest/v1/films_faces?gallery_id=eq.${hex(1)}` });
    expect(Object.keys(sent[5].body as object)).toEqual(['cleanup_failed_at']);
    expect(Object.keys(sent[6].body as object)).toEqual(['purge_failed_at']);
    expect(sb.callCount()).toBe(sent.length);
    await expect(sb.deleteFaces('')).rejects.toThrow('bad gallery id');
    expect(sent).toHaveLength(7);
  });
});
