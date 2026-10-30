// Guest face search: the Worker's side. Ported from the Avira films app (2026-09-27); the numbers
// now live in a private Storage bucket (films-faces) through the Store, not in KV.
// Only descriptors (numbers) are kept: no pictures of faces and never a guest's selfie.
// Deleted when the studio switches face search off, when the gallery is closed or deleted, and by the
// hourly clean-up (`nightly` in cleanup.ts: closed galleries, scans older than 12 months, studios that
// ended), also the moment a guest asks for a closed gallery. Face search is switched off with it (only when
// there was face data), and the studio is told on extend and restore (decision D06(2), fix plan P68).
// Fix plan P68 (decision D06(3)-(4)): no matching on the server. A guest downloads only photos still shown (a
// photo hidden or gone from the folder leaves at once, and its file is rewritten without it), after a consent,
// under a rate limit, with a token of FACE_TOKEN_SECONDS; the studio removes a person on request ("הסר אדם זה").
import { decodeChunk, filterChunk } from '../shared/faces';
import { derivedKey, hmac } from './auth';
import type { FacesMeta, FaceSwap, Store } from './store';
import type { Gallery } from './types';
import { HttpError } from './types';

/** What a guest's search token is good for (the chunks of one gallery). */
export const FACE_TOKEN_SECONDS = 600;
/**
 * Guest searches per hour from one address in one gallery. High on purpose: the guests of a wedding hall often share
 * one address (the venue's Wi-Fi), and each "סלפי אחר" is a search.
 */
export const FACE_SEARCHES_PER_HOUR = 300;
export { FACE_CONSENT } from '../shared/faces';
/** Files rewritten at once after photos are hidden (the rest by the hourly clean-up); ~2 requests each. */
export const FACE_REWRITE_NOW = 6;
/** Files rewritten per "הסר אדם זה" request (the page sends the rest again). */
export const FACE_REWRITE_PER_REQUEST = 12;

/**
 * Adds one chunk made in the studio's browser. Only photos of this gallery are accepted; photos already scanned
 * and photos hidden meanwhile are left out before the upload (nothing left: nothing is uploaded, `skipped`).
 */
export async function addFacesChunk(
  store: Store,
  g: Gallery,
  bytes: Uint8Array,
  validKeys: Set<string>,
  opts: { hidden?: Set<string> } = {},
): Promise<FacesMeta & { skipped: number }> {
  if (bytes.byteLength > 4 * 1024 * 1024) throw new HttpError(400, 'חלק גדול מדי');
  const photos = decodeChunk(bytes);
  if (photos.length === 0) throw new HttpError(400, 'אין נתונים');
  if (photos.some((p) => !validKeys.has(p.key))) throw new HttpError(400, 'תמונה שלא שייכת לגלריה');
  const done = new Set(await store.facesDone(g.id));
  const seen = new Set<string>();
  const kept = filterChunk(bytes, (key) => {
    const fresh = !done.has(key) && !opts.hidden?.has(key) && !seen.has(key);
    seen.add(key);
    return fresh;
  });
  const skipped = photos.length - kept.keys.length;
  if (!kept.keys.length) return { ...(await store.facesMeta(g.id)), skipped };
  const m = await store.addFacesChunk(g.tenantId, g.id, kept.bytes, kept.keys, kept.faces);
  return { ...m, skipped: m.duplicate ? photos.length : skipped };
}

/** Chunk n for a guest: only the photos still shown. 409 when the face data changed since the search began. */
export async function guestChunk(store: Store, galleryId: string, n: number, version: number | null): Promise<Uint8Array> {
  const read = await store.facesChunk(galleryId, n);
  if (!read) throw new HttpError(404, 'לא נמצא');
  if (version !== null && read.version !== version) throw new HttpError(409, 'נתוני החיפוש התעדכנו. נסו שוב.', 'faces_changed');
  const shown = new Set(read.keys);
  return filterChunk(read.bytes, (key) => shown.has(key)).bytes;
}

/**
 * Rewrites files of a gallery: the marked ones (photos hidden since, copies), or (`keys`) those holding these photos.
 * Each keeps only the photos still listed for it, without the faces `drop` names (key → face indexes). At most `limit`
 * files; `more` = files still waiting; `found` = the photos met in the files rewritten.
 */
export async function rewriteFaceFiles(
  store: Store,
  galleryId: string,
  opts: { limit: number; keys?: string[]; drop?: Map<string, Set<number>> },
): Promise<{ rewritten: number; more: number; found: Set<string>; dropped: number }> {
  const plan = await store.facePlan(galleryId, opts.keys ?? null, opts.limit);
  const swaps: FaceSwap[] = [];
  const met = new Map<string, string[]>();
  let dropped = 0;
  for (const file of plan.files) {
    const bytes = await store.faceFile(file.name);
    const live = new Set(file.keys);
    const inFile = bytes ? decodeChunk(bytes).map((p) => p.key) : [];
    const out = bytes ? filterChunk(bytes, (key) => live.has(key), opts.drop ? (key, i) => Boolean(opts.drop!.get(key)?.has(i)) : undefined) : null;
    met.set(file.name, inFile);
    dropped += out?.dropped ?? 0;
    swaps.push({ old: file.name, bytes: out?.keys.length ? out.bytes : null, keys: out?.keys ?? [], faces: out?.dropped ?? 0 });
  }
  const swapped = await store.swapFaceFiles(galleryId, swaps);
  const found = new Set(swapped.flatMap((name) => met.get(name) ?? []));
  return { rewritten: swapped.length, more: plan.more + (swaps.length - swapped.length), found, dropped };
}

type ListLike = { items: { key: string; hidden?: boolean }[] };

/**
 * After a save of the photo list: photos shown before and not now (hidden, or gone from the folder) leave what guests
 * download at once — with any other scanned photo not shown (one an earlier failure left behind) — and their files are
 * rewritten without them (up to FACE_REWRITE_NOW files now, the rest by the hourly clean-up). The edit is saved
 * already, so a failure here is logged, never thrown; the next such save, and the clean-up, try again.
 */
export async function removeFacePhotos(store: Store, g: Gallery, before: ListLike | null | undefined, after: ListLike): Promise<number> {
  if (!before) return 0;
  const shown = new Set(after.items.filter((i) => !i.hidden).map((i) => i.key));
  if (!before.items.some((i) => !i.hidden && !shown.has(i.key))) return 0;
  try {
    const keys = (await store.facesDone(g.id)).filter((k) => !shown.has(k));
    if (!keys.length) return 0;
    const { removed } = await store.removeFaceKeys(g.id, keys);
    if (removed) await rewriteFaceFiles(store, g.id, { limit: FACE_REWRITE_NOW });
    return removed;
  } catch (e) {
    console.error(`[films] faces of ${g.id}: photos no longer shown not removed yet:`, (e as Error).message);
    return 0;
  }
}

export interface PersonFace {
  key: string;
  face: number;
}

/**
 * "הסר אדם זה" (D06(4): a guest asks the studio): these faces (found in the studio's browser with a reference photo)
 * leave the gallery's face data; the photo's other faces stay, and it stays scanned (a new scan never brings the
 * face back). FACE_REWRITE_PER_REQUEST files per call: the faces of other files come back in `remaining`.
 */
export async function removePerson(store: Store, g: Gallery, faces: PersonFace[]): Promise<{ removed: number; remaining: PersonFace[] }> {
  const drop = new Map<string, Set<number>>();
  for (const f of faces) {
    if (!/^[0-9a-f]{8}$/.test(f.key) || !Number.isInteger(f.face) || f.face < 0 || f.face > 254) continue;
    drop.set(f.key, (drop.get(f.key) ?? new Set()).add(f.face));
  }
  if (!drop.size) return { removed: 0, remaining: [] };
  const r = await rewriteFaceFiles(store, g.id, { limit: FACE_REWRITE_PER_REQUEST, keys: [...drop.keys()], drop });
  const remaining = r.more > 0 ? [...drop].filter(([key]) => !r.found.has(key)).flatMap(([key, set]) => [...set].map((face) => ({ key, face }))) : [];
  return { removed: r.dropped, remaining };
}

// ---------- the guest's token for the chunks (a key of its own, derived from FILMS_STATE_SECRET) ----------

const tokenKey = (secret: string) => derivedKey(secret, 'films-face-search-v1');

/** Good for this gallery's chunks until `now` + FACE_TOKEN_SECONDS. */
export async function faceToken(secret: string, galleryId: string, now = Date.now()): Promise<string> {
  const ends = Math.floor(now / 1000) + FACE_TOKEN_SECONDS;
  return `${ends}.${await hmac(await tokenKey(secret), `${galleryId}.${ends}`)}`;
}

export async function faceTokenValid(secret: string, token: string | null, galleryId: string, now = Date.now()): Promise<boolean> {
  const m = /^(\d{9,11})\.([A-Za-z0-9_-]{20,})$/.exec(token ?? '');
  if (!m || Number(m[1]) * 1000 <= now || Number(m[1]) * 1000 > now + (FACE_TOKEN_SECONDS + 60) * 1000) return false;
  const want = await hmac(await tokenKey(secret), `${galleryId}.${m[1]}`);
  if (want.length !== m[2].length) return false;
  let d = 0;
  for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ m[2].charCodeAt(i);
  return d === 0;
}
