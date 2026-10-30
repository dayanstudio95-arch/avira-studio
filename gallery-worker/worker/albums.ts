// The couple's album for a photo gallery (films_albums, one JSON document per gallery).
// Ported from the Avira films app's worker/albums.ts (2026-09-27); the storage is the Store.
// Fix plan P57: every save names the copy it started from (`rev`), so a second tab or the partner's phone never
// overwrites the other's work silently (409 with the saved copy); a draft is checked for its shape only (the photo
// list is not read on every save) and refused — never trimmed — past the limits; the photos are checked when it is sent.
import { albumPrice, checkAlbum, emptySlots, usedPhotos, type Album } from '../shared/album';
import { derivedKey, hmac } from './auth';
import type { AlbumOrderState, AlbumWrite, Store } from './store';
import { HttpError } from './types';

const SENT_WORDS = 'האלבום כבר נשלח לסטודיו. לשינויים צריך לפנות לסטודיו.';
const CONFLICT_WORDS = 'האלבום עודכן ממכשיר אחר. מוצגת הגרסה העדכנית.';

/** 409 with the saved copy (`album`), so the couple's page shows it instead of overwriting it. */
export function albumRefused(w: Exclude<AlbumWrite, { ok: true }>): HttpError {
  if (w.reason === 'not_found') return new HttpError(404, 'הגלריה לא נמצאה');
  if (w.reason === 'submitted') return new HttpError(409, SENT_WORDS, 'album_sent', { album: w.current });
  return new HttpError(409, CONFLICT_WORDS, 'album_conflict', { album: w.current });
}

/** A revision number from the browser: a whole number ≥ 0, else none (a page open from before P57 sends none). */
export function revOf(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined;
}

/**
 * The couple saves their draft: one write, only onto `rev` (the copy their page has; 0 = none yet; undefined = a page
 * from before P57, not checked) and never onto a sent album. Past a limit → 400 with what (nothing is trimmed).
 */
export async function saveAlbumDraft(store: Store, tenantId: string, galleryId: string, input: unknown, rev: number | undefined): Promise<Album> {
  const { album, cut } = checkAlbum(input, null);
  if (cut.length) throw new HttpError(400, `האלבום לא נשמר: ${cut[0]}`, 'album_limits', { problems: cut });
  album.status = 'draft';
  album.submittedAt = undefined;
  if (album.spreads.length === 0) throw new HttpError(400, 'האלבום ריק');
  const w = await store.putAlbum(tenantId, galleryId, album, { rev, draftOnly: true });
  if (!w.ok) throw albumRefused(w);
  return { ...album, rev: w.rev };
}

/**
 * `sent` = it was a draft until now (a second click changes nothing). `rev`: the copy the couple sends (a change from
 * another device since → 409 with it). `visibleKeys`: the photos the couple may use, read only now (P57): photos the
 * studio hid since leave their slots, counted in `removed`. `closed`: the gallery is closed — only an album already
 * sent answers (its order can still be made), a draft is 410.
 */
export async function submitAlbum(
  store: Store,
  tenantId: string,
  galleryId: string,
  opts: { rev?: number; visibleKeys?: () => Promise<Set<string>>; closed?: boolean } = {},
): Promise<{ album: Album; sent: boolean; removed: number }> {
  for (let attempt = 0; ; attempt++) {
    const album = await store.getAlbum(galleryId);
    if (!album) throw new HttpError(opts.closed ? 410 : 400, opts.closed ? 'הגלריה נסגרה' : 'עוד לא התחלתם לעצב את האלבום');
    if (album.status === 'submitted') return { album, sent: false, removed: 0 };
    if (opts.closed) throw new HttpError(410, 'הגלריה נסגרה');
    if (opts.rev !== undefined && (album.rev ?? 0) !== opts.rev) throw albumRefused({ ok: false, reason: 'conflict', current: album });
    let removed = 0;
    let spreads = album.spreads;
    if (opts.visibleKeys) {
      const keys = await opts.visibleKeys();
      spreads = album.spreads.map((s) => ({ ...s, fills: s.fills.map((f) => (f.photo && !keys.has(f.photo) ? (removed++, { ...f, photo: '' }) : f)) }));
    }
    const now = new Date().toISOString();
    const done: Album = { ...album, spreads, status: 'submitted', submittedAt: now, updatedAt: now };
    const w = await store.putAlbum(tenantId, galleryId, done, { rev: album.rev ?? 0, draftOnly: true });
    if (w.ok) return { album: { ...done, rev: w.rev }, sent: true, removed };
    if (w.reason === 'submitted' && w.current) return { album: w.current, sent: false, removed: 0 };
    // A draft saved between the read and the write: the couple's own send names its copy (409); otherwise read again.
    if (w.reason !== 'conflict' || opts.rev !== undefined || attempt >= 2) throw albumRefused(w);
  }
}

// ---------- the album order in the hub (the studio's "album orders", crm module) ----------
// A sent album becomes an approved order there, and the couple continues in the hub's album
// portal (/album/<token>): product, cover, engraving, add-ons, shipping, payment. The portal
// token is derived from the gallery (HMAC with the Worker's secret), so the couple's album page
// can always lead back to it without the raw token being stored anywhere; the database keeps
// only its SHA-256, like every portal token. A link the studio makes itself replaces it.
// P73: signed with a key of its own (derived from the secret); orders sent before are still
// found through the old derivation (the secret itself), so their links keep working.

export async function albumOrderToken(secret: string, galleryId: string): Promise<string> {
  return hmac(await derivedKey(secret, 'studio-plan/films/album-order-key/v1'), `album-order:${galleryId}`);
}

/** The token of an order sent before P73 (the main secret signed it directly). */
export async function legacyAlbumOrderToken(secret: string, galleryId: string): Promise<string> {
  return hmac(secret, `album-order:${galleryId}`);
}

export async function sha256Hex(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface Ordering {
  /** The studio's price for a page beyond the included ones; null = not set (no pages beyond them, P53). */
  extraSpreadPrice: number | null;
  /** The pages the studio includes; null = not set. */
  includedSpreads: number | null;
  status: string;
}

/** What the couple's album page shows about ordering; null = the studio has no album orders (send goes to the studio only). */
export function orderingOf(state: AlbumOrderState): Ordering | null {
  if (!state.crm) return null;
  return { extraSpreadPrice: state.extraPagePrice ?? null, includedSpreads: state.includedSpreads ?? null, status: state.order?.workflowStatus ?? 'draft' };
}

/** The couple's link to the order's portal; the error says why there's none. */
export async function orderLink(secret: string, hub: string, galleryId: string, state: AlbumOrderState): Promise<{ url: string } | { error: string; status: number }> {
  if (!state.crm || !state.order) return { error: 'עוד אין הזמנה לאלבום הזה', status: 404 };
  if (state.order.revoked) return { error: 'הסטודיו ביטל את הקישור להזמנה. פנו לסטודיו.', status: 403 };
  for (const token of [await albumOrderToken(secret, galleryId), await legacyAlbumOrderToken(secret, galleryId)]) {
    if (state.order.tokenHash === (await sha256Hex(token))) return { url: `${hub}/album/${token}` };
  }
  return { error: 'הסטודיו שלח לכם קישור אחר להזמנה. השתמשו בו, או פנו לסטודיו.', status: 409 };
}

export async function unlockAlbum(store: Store, tenantId: string, galleryId: string): Promise<Album> {
  for (let attempt = 0; ; attempt++) {
    const album = await store.getAlbum(galleryId);
    if (!album) throw new HttpError(404, 'אין אלבום לגלריה הזו');
    const open: Album = { ...album, status: 'draft', submittedAt: undefined, updatedAt: new Date().toISOString() };
    const w = await store.putAlbum(tenantId, galleryId, open, { rev: album.rev ?? 0 });
    if (w.ok) return { ...open, rev: w.rev };
    if (w.reason !== 'conflict' || attempt >= 2) throw albumRefused(w);
  }
}

/** The order's state, or null when it could not be read (P57: a passing database error never breaks the album page). */
export async function orderStateOrNull(store: Store, galleryId: string): Promise<AlbumOrderState | null> {
  try {
    return await store.albumOrderState(galleryId);
  } catch (e) {
    console.error('[films] album order state failed:', (e as Error).message);
    return null;
  }
}

/**
 * Whether a send must (re)make the album's order: a first send always; an album already sent when its order is
 * missing, or not paid and made for another page count (the first try failed half way — P57). Never for a studio
 * without album orders, nor when the state could not be read (the next try asks again).
 */
export function orderNeeded(album: Album, sent: boolean, state: AlbumOrderState | null): boolean {
  if (sent) return true;
  if (!state || !state.crm) return false;
  if (!state.order) return true;
  return state.order.paymentStatus !== 'paid' && state.order.spreads != null && state.order.spreads !== album.spreads.length;
}

/** What the studio (and the couple, after saving) sees about an album; the price is the studio's own (null = none set). */
export function albumSummary(album: Album | null, ordering?: Ordering | null) {
  if (!album) return null;
  const price = albumPrice(album, ordering?.extraSpreadPrice ?? null, ordering?.includedSpreads ?? null);
  return { status: album.status, spreads: album.spreads.length, photos: usedPhotos(album).size, empty: emptySlots(album), ...price, updatedAt: album.updatedAt, submittedAt: album.submittedAt ?? '' };
}
