// Fix plan P88-b: the two stores must behave the same. Every Worker test runs on MemoryStore, while
// production runs SupabaseStore, which no test executed. Here one series of calls (galleries, hearts,
// the trash, personal lists, Instagram marks, albums, the photo list's version, rate limits) runs on
// both: on MemoryStore, and on SupabaseStore talking to a real Postgres in memory (PGlite) built from
// every migration on tools/db-test/stubs.sql, reached through the demo's PostgREST stand-in
// (tools/demo/postgrest.mjs) — no network. The answers must be identical.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Album } from '../shared/album';
import { decodeChunk, encodeChunk } from '../shared/faces';
import { rewriteFaceFiles } from '../worker/faces';
import { MAX_LISTS, type Store } from '../worker/store';
import { MemoryStore } from '../worker/store-memory';
import { SupabaseStore } from '../worker/store-supabase';
import type { Gallery } from '../worker/types';

// Avira: the gallery album's order functions came with 0096 (phase 3).
const ALBUM_ORDERS_PORTED = true;
const STUDIO_PAGE_LEADS = false;
import { buildDb, supabaseFetchFor } from './pglite-supabase';

const BASE = 'http://supabase.contract.test';

let db: PGlite;
let supabaseFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

// ---------- the series of calls, run on each store ----------
const T1 = '00000000-0000-4000-8000-00000000c001';
const T2 = '00000000-0000-4000-8000-00000000c002';
const G = { films: 'a0000000000000f1', photos: 'a0000000000000f2', other: 'b0000000000000f3', old1: 'c0000000000000f4', old2: 'c0000000000000f5', old3: 'c0000000000000f6' };

const gallery = (id: string, tenantId: string, over: Partial<Gallery> = {}): Gallery => ({
  id,
  tenantId,
  kind: 'films',
  coupleName: 'Couple ' + id.slice(-2),
  date: '2026-08-20',
  days: 30,
  createdAt: '2026-09-01T10:00:00.000Z',
  // Far ahead: the summary counts open/closed galleries against the clock (a 2026-10-01 date turned them
  // 'closed' from that day on).
  expiresAt: '2036-10-01T20:59:59.000Z',
  hasCover: false,
  films: [],
  photoCount: 0,
  hasThumb: false,
  views: 0,
  guestViews: 0,
  downloads: 0,
  ...over,
});

const album = (status: Album['status'], at: string): Album => ({
  size: '80x30',
  spreads: [{ id: 's1', template: 't1', photos: ['0000000a', '0000000b'] } as unknown as Album['spreads'][number]],
  status,
  updatedAt: at,
  ...(status === 'submitted' ? { submittedAt: at } : {}),
});

// Photo keys have the Worker's shape (8 hex characters; the tables check it).
const [K1, K2, K3, K5, K6, K9] = ['0000000a', '0000000b', '0000000c', '0000000e', '0000000f', '00000019'];
// List ids too (12 hex characters).
const [L1, L2] = ['00000000011a', '00000000012a'];

type Step = [label: string, value: unknown];

async function attempt(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    return { ok: await fn() };
  } catch (e) {
    return { threw: (e as { status?: number }).status ?? 'error', message: e instanceof Error && (e as { status?: number }).status === 400 ? e.message : undefined };
  }
}

async function scenario(s: Store): Promise<Step[]> {
  const out: Step[] = [];
  const step = async (label: string, fn: () => Promise<unknown>) => {
    out.push([label, await fn()]);
  };

  // The studio
  await step('tenant', () => s.getTenant(T1));
  await step('tenant: unknown', () => s.getTenant('00000000-0000-4000-8000-00000000c0ff'));
  await step('slug → studio', () => s.tenantIdBySlug('contract-two'));
  await step('slug: unknown', () => s.tenantIdBySlug('no-such-studio'));
  await step('slug: taken by another studio', () => attempt(() => s.setSlug(T1, 'contract-two')));
  await step('slug: not a valid address', () => attempt(() => s.setSlug(T1, 'Bad Slug!')));
  await s.setSlug(T1, 'contract-uno');
  await step('slug: changed', async () => [await s.tenantIdBySlug('contract-uno'), await s.tenantIdBySlug('contract-one')]);
  // P73 (0134): the address given up leads to its studio and stays its own; the access version.
  await step('slug: the old address → the studio that gave it up', async () => [await s.tenantIdByOldSlug('contract-one'), await s.tenantIdByOldSlug('no-such-studio')]);
  await step('slug: kept for the studio that gave it up', () => attempt(() => s.setSlug(T2, 'contract-one')));
  await step('access version: raised per studio', async () => [await s.bumpAccessVersion(T1), await s.bumpAccessVersion(T1), (await s.getTenant(T1))?.accessVersion, (await s.getTenant(T2))?.accessVersion]);
  await s.setSecret(T1, 'dropbox_refresh_token', 'tok-1');
  await s.setSecret(T1, 'dropbox_refresh_token', 'tok-2');
  await step('secret: replaced, per studio', async () => [await s.getSecret(T1, 'dropbox_refresh_token'), await s.getSecret(T2, 'dropbox_refresh_token')]);
  await s.setSecret(T1, 'dropbox_refresh_token', null);
  await step('secret: deleted', () => s.getSecret(T1, 'dropbox_refresh_token'));

  // Galleries
  await s.putGallery(gallery(G.films, T1, { venue: 'Hall', folderUrl: 'https://www.dropbox.com/sh/x', folderProvider: 'dropbox', films: [{ id: 'f1', name: 'Clip', ref: 'r1' } as unknown as Gallery['films'][number]] }));
  await s.putGallery(gallery(G.photos, T1, { kind: 'photos', createdAt: '2026-09-02T10:00:00.000Z', linkedId: G.films, guestId: 'd000000000000001', printToken: 'print-token-0123456789abcdef', password: 'pw' }));
  await s.putGallery(gallery(G.other, T2, { createdAt: '2026-09-03T10:00:00.000Z' }));
  await step('get', () => s.getGallery(G.films));
  await step('get missing', () => s.getGallery('ffffffffffffffff'));
  await step('get bad id', () => s.getGallery('not-an-id'));
  await step('put an existing id again', () => attempt(() => s.putGallery(gallery(G.films, T1, { coupleName: 'Overwritten' }))));
  await step('after the refused put', async () => (await s.getGallery(G.films))?.coupleName);
  await step('list T1 (newest first)', async () => (await s.listGalleries(T1)).map((g) => g.id));
  await step('list T2', async () => (await s.listGalleries(T2)).map((g) => g.id));
  await step('by guest id', async () => (await s.getGalleryByGuestId('d000000000000001'))?.id ?? null);
  await step('by print token', async () => (await s.getGalleryByPrintToken('print-token-0123456789abcdef'))?.id ?? null);
  await step('by unknown guest id', () => s.getGalleryByGuestId('d000000000000009'));
  await step('patch fields', () => s.patchGallery(T1, G.films, { coupleName: 'Renamed', venue: undefined, days: 45, coverVersion: 2 }));
  await step('patch from another studio', () => s.patchGallery(T2, G.films, { coupleName: 'Stolen' }));
  await step('patch with a guard that holds', async () => (await s.patchGallery(T1, G.films, { guestId: 'd000000000000002' }, { guestId: null }))?.guestId);
  await step('patch with a guard that fails', () => s.patchGallery(T1, G.films, { guestId: 'd000000000000003' }, { guestId: null }));
  await step('patch nothing', async () => (await s.patchGallery(T1, G.films, {}))?.coupleName);
  await s.countEvent(G.films, 'view');
  await s.countEvent(G.films, 'view');
  await s.countEvent(G.films, 'guest_view');
  await s.countEvent(G.films, 'download');
  await step('counters', async () => {
    const g = await s.getGallery(G.films);
    return [g?.views, g?.guestViews, g?.downloads];
  });

  // Photo list, saved against its version
  const photos = (n: number) => ({ folderUrl: '', provider: 'mock', sets: [], items: Array.from({ length: n }, (_, i) => ({ key: `k${i}`, name: `k${i}.jpg`, ref: `m:/k${i}` })) }) as never;
  await step('photos: first save', () => s.savePhotos(T1, G.photos, photos(1), null));
  await step('photos: a second "first" save yields', () => s.savePhotos(T1, G.photos, photos(2), null));
  await step('photos: save on version 1', () => s.savePhotos(T1, G.photos, photos(3), 1));
  await step('photos: a stale version is refused', () => s.savePhotos(T1, G.photos, photos(4), 1));
  await step('photos: read back', async () => {
    const v = await s.getPhotosVersioned(G.photos);
    return v && { n: (v.data as { items: unknown[] }).items.length, version: v.version };
  });
  await step('photos: first save for a missing gallery', () => attempt(() => s.savePhotos(T1, 'eeeeeeeeeeeeeeee', photos(1), null)));

  // One photo read alone, and an edit written as what changed (P61, 0131)
  const versions = async () => {
    const g = await s.getGallery(G.photos);
    return { version: g?.photosVersion, visible: g?.photosVisibleVersion, count: g?.photoCount, cover: g?.coverKey ?? null };
  };
  const status = async (fn: () => Promise<unknown>) => {
    try {
      return { ok: await fn() };
    } catch (e) {
      return { threw: (e as { status?: number }).status ?? 'error' };
    }
  };
  const shot = (key: string, name: string, more: object = {}) => ({ key, name, ref: `p:/${key}/${name}`, ...more });
  const list = {
    folderUrl: 'https://www.dropbox.com/scl/fo/contract',
    provider: 'dropbox',
    timesV: 2,
    sets: [{ id: 's1', name: 'Set' }],
    items: [shot('aaaa0001', 'A.jpg', { t: 1_700_000_000_123, ar: 1.5 }), shot('aaaa0002', 'a.JPG', { t: 1_700_000_000_123, ar: 1.51, hidden: true }), shot('aaaa0003', 'C.jpg', { ar: 0.66 })],
    cover: 'aaaa0002',
  } as never;
  await step('photos: versions follow every save', versions);
  await s.savePhotos(T1, G.photos, list, (await s.getPhotosVersioned(G.photos))!.version);
  await step('photos: a whole save raises both versions', versions);
  await step('photos: one photo', () => s.getPhotoItem(T1, G.photos, 'aaaa0003'));
  await step('photos: one photo with its possible copies', () => s.getPhotoItem(T1, G.photos, 'aaaa0001', { copies: true }));
  await step('photos: a key not in the list', () => s.getPhotoItem(T1, G.photos, 'ffff0000'));
  await step('photos: one photo, asked for by another studio', () => s.getPhotoItem(T2, G.photos, 'aaaa0001'));
  const v3 = (await s.getPhotosVersioned(G.photos))!.version;
  const shown = { key: 'aaaa0002', name: 'a.JPG', ref: 'p:/aaaa0002/a.JPG', t: 1_700_000_000_123, ar: 1.51 };
  await step('photos: patch', () => s.patchPhotos(T1, G.photos, v3, { items: { aaaa0002: shown }, order: ['aaaa0003', 'aaaa0001', 'aaaa0002'], fields: { cover: 'aaaa0003', timesV: null } }));
  await step('photos: after the patch', async () => [(await s.getPhotosVersioned(G.photos))?.data, await versions()]);
  await step('photos: a patch on a stale version', () => s.patchPhotos(T1, G.photos, v3, { items: {}, order: null, fields: { cover: 'aaaa0001' } }));
  await step('photos: a patch from another studio', () => s.patchPhotos(T2, G.photos, v3 + 1, { items: {}, order: null, fields: { cover: 'aaaa0001' } }));
  await step('photos: a patch of a photo not in the list', () => status(() => s.patchPhotos(T1, G.photos, v3 + 1, { items: { ffff0000: shot('ffff0000', 'x.jpg') }, order: null, fields: {} })));
  await step('photos: an order that is not the list', () => status(() => s.patchPhotos(T1, G.photos, v3 + 1, { items: {}, order: ['aaaa0001', 'aaaa0001', 'aaaa0002'], fields: {} })));
  await step('photos: a field an edit may not change', () => status(() => s.patchPhotos(T1, G.photos, v3 + 1, { items: {}, order: null, fields: { folderUrl: 'x' } as never })));
  await step('photos: a patch that shows nothing new keeps the visible version', async () => [await s.patchPhotos(T1, G.photos, v3 + 1, { items: { aaaa0003: { ...shot('aaaa0003', 'C.jpg'), ar: 0.7 } }, order: null, fields: { design: { grid: 'x' } } }), await versions()]);
  await step('photos: hiding the cover moves it', async () => [await s.patchPhotos(T1, G.photos, v3 + 2, { items: { aaaa0003: { ...shot('aaaa0003', 'C.jpg'), ar: 0.7, hidden: true } }, order: null, fields: {} }), await versions()]);

  // Hearts
  await s.setHearts(T1, G.photos, [K1], true, 'מאי');
  // Hearts are listed by when they were given; keep the two times apart (see the Instagram marks below).
  await new Promise((r) => setTimeout(r, 5));
  await s.setHearts(T1, G.photos, [K1], true, '');
  await s.setHearts(T1, G.photos, [K1], true, 'מאי');
  await s.setHearts(T1, G.photos, [K2], true, 'אופק');
  await step('hearts', () => s.listHearts(G.photos));
  await s.setHearts(T1, G.photos, [K1], false, 'מאי');
  await s.setHearts(T1, G.photos, [K9], false, 'nobody');
  await step('hearts after un-hearting', () => s.listHearts(G.photos));

  // Instagram marks
  await s.setInstaMany(T1, G.photos, [K3], true);
  // Marks are listed by when they were made; two marks in the same instant fall back to key order,
  // which would differ from MemoryStore's insertion order. A short gap keeps the times apart.
  await new Promise((r) => setTimeout(r, 5));
  await s.setInstaMany(T1, G.photos, [K1], true);
  await s.setInstaMany(T1, G.photos, [K3], true);
  await step('insta', () => s.listInsta(G.photos));
  await s.setInstaMany(T1, G.photos, [K3], false);
  await step('insta after un-marking', () => s.listInsta(G.photos));

  // Personal lists
  await step('list: create', () => s.createList(G.photos, { id: L1, name: 'Family', keys: [K1, K2, K1] }));
  await step('list: same name adds keys', () => s.createList(G.photos, { id: '00000000011b', name: 'Family', keys: [K3, K2] }));
  await step('list: second list', () => s.createList(G.photos, { id: L2, name: 'Friends', keys: [] }));
  await step('list: toggle on', () => s.toggleList(G.photos, L2, [K5, K6], true));
  await step('list: toggle off', () => s.toggleList(G.photos, L1, [K2], false));
  await step('list: toggle a missing list', () => s.toggleList(G.photos, 'ffffffffffff', [K1], true));
  await step('list: rename', () => s.renameList(G.photos, L2, 'Best friends'));
  await step('list: rename to a taken name', () => attempt(() => s.renameList(G.photos, L2, 'Family')));
  await step('list: rename a missing list', () => s.renameList(G.photos, 'ffffffffffff', 'X'));
  await step('list: no such gallery', () => s.createList('eeeeeeeeeeeeeeee', { id: '000000000119', name: 'X', keys: [] }));
  await s.deleteList(G.photos, L1);
  await step('lists', () => s.listLists(G.photos));
  for (let i = 0; i < MAX_LISTS; i++) await s.createList(G.films, { id: `0000000002${i.toString(16).padStart(2, '0')}`, name: `List ${i}`, keys: [] });
  await step('list: one over the limit', () => s.createList(G.films, { id: '0000000003ff', name: 'One more', keys: [] }));
  await step('list: an existing name at the limit still adds', async () => (await s.createList(G.films, { id: '0000000003fe', name: 'List 0', keys: [K1] })) as unknown);

  // Albums
  await step('album: none yet', () => s.getAlbum(G.photos));
  await step('album: first draft', () => s.putAlbum(T1, G.photos, album('draft', '2026-09-10T10:00:00.000Z'), { rev: 0, draftOnly: true }));
  await step('album: a second first draft (another tab) gets the first', () => s.putAlbum(T1, G.photos, album('draft', '2026-09-10T11:00:00.000Z'), { rev: 0, draftOnly: true }));
  await step('album: next draft on its rev', () => s.putAlbum(T1, G.photos, album('draft', '2026-09-11T10:00:00.000Z'), { rev: 1, draftOnly: true }));
  await step('album: a stale rev is refused (P57)', () => s.putAlbum(T1, G.photos, album('draft', '2026-09-11T11:00:00.000Z'), { rev: 1, draftOnly: true }));
  await step('album: another studio writes nothing', () => s.putAlbum(T2, G.photos, album('draft', '2026-09-11T12:00:00.000Z')));
  await s.putAlbum(T1, G.photos, album('submitted', '2026-09-12T10:00:00.000Z'));
  await step('album: a draft after sending is refused', () => s.putAlbum(T1, G.photos, album('draft', '2026-09-13T10:00:00.000Z'), { draftOnly: true }));
  await step('album: read back, with its rev', () => s.getAlbum(G.photos));
  await step('album: submitted list', () => s.listSubmittedAlbums(T1));
  await step('album: other studio sees none', () => s.listSubmittedAlbums(T2));
  // P55 (0140): the album as sent, kept for the print shop; reopened, it stays as sent and the album is open.
  await step('album: the print copy is the sent album', () => s.getPrintAlbum(G.photos));
  await s.putAlbum(T1, G.photos, album('draft', '2026-09-14T10:00:00.000Z'));
  await step('album: reopened, the print copy stays as sent', () => s.getPrintAlbum(G.photos));
  await step('album: no album, no print copy', () => s.getPrintAlbum(G.films));
  await s.putAlbum(T1, G.photos, album('submitted', '2026-09-12T10:00:00.000Z'));
  // P55: a print link has its date; one older than 30 days goes, and its date with it.
  await step('print link: dated when made', async () => Boolean((await s.getGallery(G.photos))?.printTokenAt));
  await s.patchGallery(T1, G.photos, { printTokenAt: '2026-01-01T00:00:00.000Z' });
  await step('print link: renewed date read back', async () => (await s.getGallery(G.photos))?.printTokenAt);
  await step('print link: past 30 days, removed', async () => [await s.expirePrintLinks(30), (await s.getGallery(G.photos))?.printToken ?? null, (await s.getGallery(G.photos))?.printTokenAt ?? null]);
  await s.patchGallery(T1, G.photos, { printToken: 'print-token-0123456789abcdef' });
  await step('print link: a new one is dated again', async () => [await s.expirePrintLinks(30), Boolean((await s.getGallery(G.photos))?.printTokenAt)]);

  // Trash: per studio in turn, oldest first, failed ones last
  await s.putGallery(gallery(G.old1, T1, { deletedAt: '2026-08-01T00:00:00.000Z' }));
  await s.putGallery(gallery(G.old2, T1, { deletedAt: '2026-08-02T00:00:00.000Z' }));
  await s.putGallery(gallery(G.old3, T2, { deletedAt: '2026-08-03T00:00:00.000Z' }));
  await step('trash: in turns', () => s.trashCandidates('2026-09-01T00:00:00.000Z', 10));
  await step('trash: limited', () => s.trashCandidates('2026-09-01T00:00:00.000Z', 1));
  await step('trash: only before the date', () => s.trashCandidates('2026-08-02T00:00:00.000Z', 10));
  await s.markPurgeFailed(G.old1);
  await step('trash: a failed one goes last', () => s.trashCandidates('2026-09-01T00:00:00.000Z', 10));
  // Two failed in one studio: the one that failed first is tried first (not the one deleted first).
  await s.patchGallery(T1, G.old1, { deletedAt: '2026-08-05T00:00:00.000Z' });
  await new Promise((r) => setTimeout(r, 5));
  await s.markPurgeFailed(G.old2);
  await step('trash: failed ones in the order they failed', () => s.trashCandidates('2026-09-01T00:00:00.000Z', 10));
  // P71 (0135): a gallery kept for its open album order comes apart, after the others; the album guards.
  const kept = 'e0000000000000b1';
  await s.putGallery(gallery(kept, T1, { kind: 'photos', deletedAt: '2026-07-01T00:00:00.000Z' }));
  // Phase 3 (the album, with Avira's album portal): films_album_order_from_design is not in 0095 yet — back then.
  if (ALBUM_ORDERS_PORTED) {
    await step('album order for a trash gallery', async () => (await s.albumOrderFromDesign(kept, 12, 'hash-p71'))?.workflowStatus);
    await step('trash: an open album order keeps its gallery apart', () => s.trashCandidates('2026-09-01T00:00:00.000Z', 10));
    await step('album guards', () => s.albumGuards(T1, [kept, G.photos, G.films, G.other, 'not-an-id']));
  }
  await s.deleteGallery(kept);

  // P71 (0135): the mit4mit business is one studio's.
  await s.patchFilmsStudio(T1, { mit4mitBizId: '71071', mit4mitLinkedAt: '2026-09-30T10:00:00.000Z', mit4mitRemoved: ['id:9'] });
  await step('mit4mit: another studio binds the same business', () => attempt(() => s.patchFilmsStudio(T2, { mit4mitBizId: '71071' })));
  await step('mit4mit: read back', async () => (({ mit4mitBizId, mit4mitRemoved, mit4mitLinkedAt, mit4mitApprovedAt }) => ({ mit4mitBizId, mit4mitRemoved, mit4mitLinkedAt, mit4mitApprovedAt }))(await s.getFilmsStudio(T1)));
  await step('mit4mit: the other studio has none', async () => (await s.getFilmsStudio(T2)).mit4mitBizId ?? null);

  // Several galleries at once, the list's fields, the summary, many hearts at once (P70)
  const P = ['d0000000000000a1', 'd0000000000000a2', 'd0000000000000a3'];
  await step('put several: one refused row leaves all out', () => attempt(() => s.putGalleries([gallery(P[0], T1), gallery(G.photos, T1)])));
  await step('after the refused put several: none', async () => (await s.getGalleries(T1, [P[0]])).length);
  await s.putGalleries([
    gallery(P[0], T1, { createdAt: '2026-09-04T10:00:00.000Z', expiresAt: '2036-10-02T20:59:59.000Z' }),
    gallery(P[1], T1, { kind: 'photos', createdAt: '2026-09-05T10:00:00.000Z', password: 'pw2', downloadPin: 'pin-2222', guestId: 'd000000000000009', expiresAt: '2027-03-01T21:59:59.000Z' }),
    gallery(P[2], T2, { createdAt: '2026-09-06T10:00:00.000Z' }),
  ]);
  for (const id of [P[0], P[1], P[1], P[1]]) await s.countEvent(id, 'view');
  await step('several by id (only this studio\'s)', async () => (await s.getGalleries(T1, [...P, 'not-an-id'])).map((g) => g.id).sort());
  await step('the list: its fields only, newest first', () => s.listGalleries(T1));
  await step('a page and the total', () => s.pageGalleries(T1, 2, 1));
  await step('link picker options', () => s.galleryOptions(T1));
  await step('patch several with a guard', async () => (await s.patchGalleries(T1, [...P, G.films], { venue: 'Garden' }, { deletedAt: null })).sort());
  await step('patch several from another studio', () => s.patchGalleries(T2, [P[0]], { venue: 'X' }));
  const seen = (await s.getGalleries(T1, [P[0]]))[0].expiresAt;
  await step('extend several (only while the closing time is the one seen)', async () =>
    (await s.extendGalleries(T1, [{ id: P[0], seen }, { id: P[1], seen: '2020-01-01T00:00:00.000Z' }, { id: P[2], seen }], 10)).map((r) => [r.id, r.days, r.expiresAt]));
  await step('extend again with the same closing time: nothing', () => s.extendGalleries(T1, [{ id: P[0], seen }], 10));
  await step('summary', () => s.galleriesSummary(T1, { films: true, photos: true }));
  await step('summary: films only', () => s.galleriesSummary(T1, { films: true, photos: false }));
  await s.patchGalleries(T1, [P[0]], { deletedAt: '2026-09-20T00:00:00.000Z' });
  await step('summary: one in the trash', async () => (({ open, closed, trash }) => ({ open, closed, trash }))(await s.galleriesSummary(T1, { films: true, photos: true })));
  await step('delete several: only those in the trash', () => s.deleteGalleries(T1, [P[0], P[1], P[2]]));
  await step('after delete several', async () => (await s.getGalleries(T1, P)).map((g) => g.id));
  await step('face data among: none', () => s.faceGalleriesAmong([P[1], G.photos]));
  await s.setHearts(T1, G.photos, [K6, K5, K3, K6], true, 'אופק');
  await step('hearts given together', () => s.listHearts(G.photos));
  await s.setHearts(T1, G.photos, [K5, K6, K9], false, 'אופק');
  await step('hearts taken off together', () => s.listHearts(G.photos));
  await s.setInstaMany(T1, G.photos, [K6, K5], true);
  await step('marks given together', () => s.listInsta(G.photos));
  await step('terms: none yet', () => s.termsAccepts(G.photos));
  const accept = (role: 'couple' | 'guest') => s.recordTermsAccept({ tenantId: T1, galleryId: G.photos, termsHash: 'h', ipHash: 'ip', userAgent: 'ua', role, linkId: G.photos });
  await accept('guest');
  await accept('couple');
  await accept('couple');
  await step('terms: counted', async () => (({ count, guests, unknown, first, last }) => ({ count, guests, unknown, first: Boolean(first), ordered: first <= last }))(await s.termsAccepts(G.photos)));

  // Deleting a gallery takes its hearts, marks, lists and album, and unlinks the other one
  await step('photos gallery links to films', async () => (await s.getGallery(G.photos))?.linkedId);
  await s.deleteGallery(G.films);
  await step('after delete: gone', () => s.getGallery(G.films));
  await step('after delete: link cleared', async () => (await s.getGallery(G.photos))?.linkedId ?? null);
  await step('after delete: its lists', () => s.listLists(G.films));
  await s.deleteGallery(G.photos);
  await step('after delete: hearts, marks, lists, album', async () => [await s.listHearts(G.photos), await s.listInsta(G.photos), await s.listLists(G.photos), await s.getAlbum(G.photos), await s.getPhotos(G.photos)]);

  // Rate limits
  await step('hit ×3 with max 2', async () => [await s.hit('contract', 2, 60), await s.hit('contract', 2, 60), await s.hit('contract', 2, 60)]);
  await step('another key is apart', () => s.hit('contract-2', 2, 60));
  // Fix plan P10 (0154): a key over 200 characters still counts as one bucket; the studio page's lead is one per phone.
  const longKey = 'contract-long:' + 'x'.repeat(300);
  await step('a long key: hit ×2 with max 1', async () => [await s.hit(longKey, 1, 60), await s.hit(longKey, 1, 60)]);
  const lead = (phone: string) => ({ id: 'l', coupleName: 'זוג חוזה', phone, date: '2027-06-01', venue: 'אולם', guests: '200', note: '', createdAt: new Date().toISOString(), status: 'new' as const });
  // Avira: no studio page, so no leads from it (films_insert_studio_lead is not in 0095).
  if (STUDIO_PAGE_LEADS) await step('a lead, the same phone in another spelling, another phone', async () => [
    await s.insertLead(T1, lead('050-123-0001')), await s.insertLead(T1, lead('+972501230001')), await s.insertLead(T1, lead('0501230002')),
    await s.insertLead(T2, lead('0501230001')),
  ]);
  await step('failures: count, add, add, look', async () => [await s.failures('pw:x', 600, false), await s.failures('pw:x', 600, true), await s.failures('pw:x', 600, true), await s.failures('pw:x', 600, false)]);

  // Guest face search (P68, 0136): one row per scanned photo, a duplicate chunk not added, photos out of what guests
  // get, files rewritten, face search off only when there was data. File names differ between the stores: only keys.
  const GF = 'a0000000000000fa';
  const face = (seed: number) => ({ box: [0.1, 0.1, 0.2, 0.2] as [number, number, number, number], vec: Array.from({ length: 128 }, (_, i) => Math.sin(seed + i) * 0.2) });
  await s.putGallery(gallery(GF, T1, { kind: 'photos', createdAt: '2026-09-04T10:00:00.000Z' }));
  await s.savePhotos(T1, GF, { folderUrl: '', provider: 'mock', sets: [], faceSearch: true, items: [K1, K2, K3].map((key) => ({ key, name: `${key}.jpg`, ref: `m:/${key}` })) } as never, null);
  const meta = async () => {
    const m = await s.facesMeta(GF);
    return { ...m, version: m.version > 0 };
  };
  const chunkKeys = async (n: number) => {
    const c = await s.facesChunk(GF, n);
    return c && { keys: [...c.keys].sort(), inFile: decodeChunk(c.bytes).map((p) => p.key), version: c.version > 0 };
  };
  await step('faces: none yet', meta);
  await step('faces: search on, read alone', () => s.faceSearchOn(GF));
  await step('faces: a chunk', async () => ({ ...(await s.addFacesChunk(T1, GF, encodeChunk([{ key: K1, faces: [face(1), face(2)] }, { key: K2, faces: [face(3)] }]), [K1, K2], 3)), version: true }));
  await step('faces: nothing new is not added', async () => ({ ...(await s.addFacesChunk(T1, GF, encodeChunk([{ key: K1, faces: [face(1)] }]), [K1], 1)), version: true }));
  await s.addFacesChunk(T1, GF, encodeChunk([{ key: K2, faces: [face(3)] }, { key: K3, faces: [face(4)] }]), [K2, K3], 2);
  await step('faces: after a chunk with one new photo', meta);
  await step('faces: the scanned photos', async () => (await s.facesDone(GF)).sort());
  await step('faces: chunk 0 and 1', async () => [await chunkKeys(0), await chunkKeys(1), await chunkKeys(2)]);
  await step('faces: a photo hidden', () => s.removeFaceKeys(GF, [K2, K9]).then((r) => ({ ...r, version: r.version > 0 })));
  await step('faces: what guests may get now', async () => [await chunkKeys(0), await chunkKeys(1)]);
  await step('faces: files to rewrite', async () => {
    const p = await s.facePlan(GF, null, 10);
    return { more: p.more, files: p.files.map((f) => [...f.keys].sort()).sort() };
  });
  await step('faces: the clean-up queue', async () => (await s.faceDirtyCandidates(10)).ids);
  await step('faces: rewritten', async () => {
    const r = await rewriteFaceFiles(s, GF, { limit: 10 });
    return { rewritten: r.rewritten, more: r.more, dropped: r.dropped };
  });
  await step('faces: after the rewrite', async () => [await meta(), await chunkKeys(0), await chunkKeys(1), (await s.faceDirtyCandidates(10)).ids]);
  await s.logFaceSearch(T1, GF, 'guest', 'v2');
  await s.deleteFaces(GF, { searchOff: true });
  await step('faces: deleted, search off, the gallery knows why', async () => [await meta(), await s.faceSearchOn(GF), Boolean((await s.getGallery(GF))?.facesOffAt)]);
  const v = await s.getPhotosVersioned(GF);
  await s.savePhotos(T1, GF, { ...(v!.data as object), faceSearch: true } as never, v!.version);
  await step('faces: on again, the mark goes', async () => [await s.faceSearchOn(GF), Boolean((await s.getGallery(GF))?.facesOffAt)]);
  await s.deleteFaces(GF, { searchOff: true });
  await step('faces: never scanned since, the switch stays', () => s.faceSearchOn(GF));
  return out;
}

// Timestamps come back from Postgres as "…+00:00": the same instant as "…Z".
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
function normalize(v: unknown): unknown {
  if (typeof v === 'string' && ISO.test(v)) return new Date(v).toISOString();
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, normalize(x)]));
  return v;
}

/** Supabase Storage for the face files (films-faces): upload, read, list by folder, delete. */
function withStorage(rest: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const files = new Map<string, Uint8Array>();
  return async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const m = /^\/storage\/v1\/object\/(list\/)?films-faces\/?(.*)$/.exec(url.pathname);
    if (!m) return rest(input, init);
    const method = (init.method ?? 'GET').toUpperCase();
    if (m[1]) {
      const { prefix } = JSON.parse(String(init.body)) as { prefix: string };
      return Response.json([...files.keys()].filter((k) => k.startsWith(`${prefix}/`)).map((k) => ({ name: k.slice(prefix.length + 1) })));
    }
    if (method === 'POST') {
      files.set(m[2], new Uint8Array(await new Response(init.body).arrayBuffer()));
      return Response.json({ Key: m[2] });
    }
    if (method === 'DELETE') {
      for (const k of (JSON.parse(String(init.body)) as { prefixes: string[] }).prefixes) files.delete(k);
      return Response.json([]);
    }
    const f = files.get(m[2]);
    return f ? new Response(f as Uint8Array<ArrayBuffer>) : new Response('not found', { status: 404 });
  };
}

describe('MemoryStore and SupabaseStore (on the migrations) give the same answers', () => {
  let memory: Step[];
  let supabase: Step[];

  beforeAll(async () => {
    db = await buildDb();
    supabaseFetch = supabaseFetchFor(db, BASE);
    // Both studios on a live trial (every module open), with the same branding in both stores.
    await db.query(
      `insert into public.tenants (id, name, slug, accent_color, phone) values ($1, 'Studio One', 'contract-one', '#FACC15', '0500000000'), ($2, 'Studio Two', 'contract-two', '#FACC15', '')`,
      [T1, T2],
    );
    const mem = new MemoryStore();
    mem.seedTenant({ id: T1, name: 'Studio One', slug: 'contract-one', phone: '0500000000' });
    mem.seedTenant({ id: T2, name: 'Studio Two', slug: 'contract-two' });
    memory = normalize(await scenario(mem)) as Step[];
    vi.stubGlobal('fetch', withStorage(supabaseFetch));
    try {
      supabase = normalize(await scenario(new SupabaseStore(BASE, 'service-role-test-key'))) as Step[];
    } finally {
      vi.unstubAllGlobals();
    }
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it('runs the same steps', () => {
    expect(supabase.map(([l]) => l)).toEqual(memory.map(([l]) => l));
  });

  it('every step answers the same', () => {
    // Soft: one failing step still lists every other one that differs.
    for (let i = 0; i < memory.length; i++) expect.soft(supabase[i][1], memory[i][0]).toEqual(memory[i][1]);
  });

  it('and the answers are the right ones (not just equal)', () => {
    const at = (label: string) => memory.find(([l]) => l === label)?.[1];
    expect(at('tenant')).toMatchObject({ id: T1, name: 'Studio One', displayName: 'Studio One', slug: 'contract-one', access: 'ok', films: true, photos: true });
    expect(at('slug: taken by another studio')).toMatchObject({ threw: 400 });
    expect(at('slug: changed')).toEqual([T1, null]);
    expect(at('slug: the old address → the studio that gave it up')).toEqual([T1, null]);
    expect(at('slug: kept for the studio that gave it up')).toEqual({ threw: 400, message: 'הכתובת שמורה לסטודיו אחר' });
    expect(at('access version: raised per studio')).toEqual([1, 2, 2, 0]);
    expect(at('secret: replaced, per studio')).toEqual(['tok-2', null]);
    expect(at('put an existing id again')).toMatchObject({ threw: 409 });
    expect(at('after the refused put')).toBe('Couple f1');
    expect(at('list T1 (newest first)')).toEqual([G.photos, G.films]);
    if (ALBUM_ORDERS_PORTED) {
      expect(at('trash: an open album order keeps its gallery apart')).toMatchObject({ blocked: [{ id: 'e0000000000000b1', reason: 'album_order' }], blockedTotal: 1 });
      expect((at('trash: an open album order keeps its gallery apart') as { ids: string[] }).ids).not.toContain('e0000000000000b1');
      expect(at('album guards')).toEqual({ e0000000000000b1: { album: null, order: { workflowStatus: 'approved', paymentStatus: 'unpaid' } }, [G.photos]: { album: 'submitted', order: null } });
    }
    expect(at('mit4mit: another studio binds the same business')).toMatchObject({ threw: 409 });
    expect(at('mit4mit: read back')).toEqual({ mit4mitBizId: '71071', mit4mitRemoved: ['id:9'], mit4mitLinkedAt: '2026-09-30T10:00:00.000Z' });
    expect(at('patch from another studio')).toBeNull();
    expect(at('patch with a guard that fails')).toBeNull();
    expect(at('counters')).toEqual([2, 1, 1]);
    expect(at('photos: a stale version is refused')).toBe(false);
    expect(at('photos: read back')).toEqual({ n: 3, version: 2 });
    expect(at('faces: nothing new is not added')).toMatchObject({ duplicate: true, chunks: 1, photos: 2 });
    expect(at('faces: the scanned photos')).toEqual([K1, K2, K3]);
    expect(at('faces: what guests may get now')).toEqual([{ keys: [K1], inFile: [K1, K2], version: true }, { keys: [K3], inFile: [K2, K3], version: true }]);
    expect(at('faces: after the rewrite')).toEqual([{ chunks: 2, photos: 2, faces: 3, version: true }, { keys: [K1], inFile: [K1], version: true }, { keys: [K3], inFile: [K3], version: true }, []]);
    expect(at('faces: deleted, search off, the gallery knows why')).toEqual([{ chunks: 0, photos: 0, faces: 0, version: false }, false, true]);
    expect(at('faces: on again, the mark goes')).toEqual([true, false]);
    expect(at('faces: never scanned since, the switch stays')).toBe(true);
    expect(at('photos: first save for a missing gallery')).toMatchObject({ threw: 404 });
    expect(at('photos: versions follow every save')).toEqual({ version: 2, visible: 2, count: 0, cover: null });
    expect(at('photos: a whole save raises both versions')).toEqual({ version: 3, visible: 3, count: 0, cover: null });
    expect(at('photos: one photo')).toEqual({
      data: { folderUrl: 'https://www.dropbox.com/scl/fo/contract', provider: 'dropbox', timesV: 2, sets: [], items: [{ key: 'aaaa0003', name: 'C.jpg', ref: 'p:/aaaa0003/C.jpg', ar: 0.66 }] },
      item: { key: 'aaaa0003', name: 'C.jpg', ref: 'p:/aaaa0003/C.jpg', ar: 0.66 },
      version: 3,
      visibleVersion: 3,
    });
    expect((at('photos: one photo with its possible copies') as { data: { items: { key: string }[] } }).data.items.map((i) => i.key)).toEqual(['aaaa0001', 'aaaa0002']);
    expect(at('photos: a key not in the list')).toMatchObject({ item: null, data: { items: [] } });
    expect(at('photos: one photo, asked for by another studio')).toBeNull();
    expect(at('photos: patch')).toEqual({ version: 4, photoCount: 3, coverKey: 'aaaa0003', visibleVersion: 4 });
    const [after, v] = at('photos: after the patch') as [{ items: { key: string; hidden?: boolean }[]; cover: string; timesV?: number }, object];
    expect(after.items.map((i) => i.key)).toEqual(['aaaa0003', 'aaaa0001', 'aaaa0002']);
    expect(after.items[2].hidden).toBeUndefined();
    expect([after.cover, after.timesV]).toEqual(['aaaa0003', undefined]);
    expect(v).toEqual({ version: 4, visible: 4, count: 3, cover: 'aaaa0003' });
    expect(at('photos: a patch on a stale version')).toBe('conflict');
    expect(at('photos: a patch from another studio')).toBeNull();
    expect(at('photos: a patch of a photo not in the list')).toEqual({ threw: 400 });
    expect(at('photos: an order that is not the list')).toEqual({ threw: 400 });
    expect(at('photos: a field an edit may not change')).toEqual({ threw: 400 });
    expect(at('photos: a patch that shows nothing new keeps the visible version')).toEqual([{ version: 5, photoCount: 3, coverKey: 'aaaa0003', visibleVersion: 4 }, { version: 5, visible: 4, count: 3, cover: 'aaaa0003' }]);
    expect(at('photos: hiding the cover moves it')).toEqual([{ version: 6, photoCount: 2, coverKey: 'aaaa0001', visibleVersion: 5 }, { version: 6, visible: 5, count: 2, cover: 'aaaa0001' }]);
    expect(at('hearts after un-hearting')).toEqual({ [K1]: [''], [K2]: ['אופק'] });
    expect(at('put several: one refused row leaves all out')).toMatchObject({ threw: 409 });
    expect(at('after the refused put several: none')).toBe(0);
    expect(at('several by id (only this studio\'s)')).toEqual(['d0000000000000a1', 'd0000000000000a2']);
    const listed = at('the list: its fields only, newest first') as Record<string, unknown>[];
    expect(listed.map((g) => g.id)).toEqual(['d0000000000000a2', 'd0000000000000a1', G.photos, G.old2, G.old1, G.films]);
    expect(listed.every((g) => !('password' in g) && !('downloadPin' in g) && !('guestId' in g) && !('printToken' in g))).toBe(true);
    expect(at('a page and the total')).toMatchObject({ total: 6, galleries: [{ id: 'd0000000000000a1' }, { id: G.photos }] });
    expect(at('patch several with a guard')).toEqual([G.films, 'd0000000000000a1', 'd0000000000000a2'].sort());
    expect(at('patch several from another studio')).toEqual([]);
    expect((at('extend several (only while the closing time is the one seen)') as unknown[][]).map((r) => r[0])).toEqual(['d0000000000000a1']);
    expect(at('extend again with the same closing time: nothing')).toEqual([]);
    expect(at('summary: one in the trash')).toEqual({ open: 3, closed: 0, trash: 3 });
    expect(at('delete several: only those in the trash')).toEqual(['d0000000000000a1']);
    expect(at('hearts given together')).toEqual({ [K1]: [''], [K2]: ['אופק'], [K3]: ['אופק'], [K5]: ['אופק'], [K6]: ['אופק'] });
    expect(at('hearts taken off together')).toEqual({ [K1]: [''], [K2]: ['אופק'], [K3]: ['אופק'] });
    expect(at('marks given together')).toEqual([K1, K5, K6]);
    expect(at('terms: none yet')).toEqual({ count: 0, first: '', last: '', guests: 0, unknown: 0 });
    expect(at('terms: counted')).toEqual({ count: 2, guests: 1, unknown: 0, first: true, ordered: true });
    expect(at('insta after un-marking')).toEqual([K1]);
    expect(at('list: rename to a taken name')).toMatchObject({ threw: 400 });
    expect(at('list: one over the limit')).toBe('too_many');
    expect(at('album: first draft')).toEqual({ ok: true, rev: 1 });
    expect(at('album: a second first draft (another tab) gets the first')).toMatchObject({ ok: false, reason: 'conflict', current: { updatedAt: '2026-09-10T10:00:00.000Z', rev: 1 } });
    expect(at('album: next draft on its rev')).toEqual({ ok: true, rev: 2 });
    expect(at('album: a stale rev is refused (P57)')).toMatchObject({ ok: false, reason: 'conflict', current: { updatedAt: '2026-09-11T10:00:00.000Z', rev: 2 } });
    expect(at('album: another studio writes nothing')).toEqual({ ok: false, reason: 'not_found', current: null });
    expect(at('album: a draft after sending is refused')).toMatchObject({ ok: false, reason: 'submitted', current: { status: 'submitted', rev: 3 } });
    expect(at('album: read back, with its rev')).toMatchObject({ status: 'submitted', rev: 3 });
    expect(at('trash: in turns')).toEqual({ ids: [G.old1, G.old3, G.old2], total: 3 });
    expect(at('trash: a failed one goes last')).toEqual({ ids: [G.old2, G.old3, G.old1], total: 3 });
    expect(at('trash: failed ones in the order they failed')).toEqual({ ids: [G.old3, G.old1, G.old2], total: 3 });
    expect(at('after delete: link cleared')).toBeNull();
    expect(at('hit ×3 with max 2')).toEqual([true, true, false]);
    expect(at('failures: count, add, add, look')).toEqual([0, 1, 2, 2]);
  });
});
