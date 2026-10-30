// Who may do what with a gallery. Ported from the Avira films app (2026-09-27).
// - The couple's link (/<studio>/<gallery id>) can do everything: hearts, Instagram marks.
// - The guests' link (/<studio>/<guest id>, a different number, photo galleries only) can only
//   look and download. The guest id can't lead back to the couple's id.
// - A gallery may have a password (to look at all) and a download code (for full-quality
//   downloads). Typing them once leaves a signed cookie on that device, for that link's role
//   (couple or guests); its name and value show nothing readable (P67).
// - The studio: the hub is another site, so "open as the couple" carries a short-lived signed
//   preview token (?pt=) that this site turns into a studio cookie for that gallery (P73: the token
//   names the gallery, the studio, who asked for it, when it ends and the studio's access version; the
//   cookie is the same token, so it never lives past those 12 hours). The hub's list pictures carry a
//   thumbs token instead, which opens only small pictures and a film for its frame.
// - "Disconnect every access" (P73) raises the studio's access version: every preview token, thumbs
//   token, studio cookie and password/code cookie made before stops working at once.
import { derivedKey, hmac, randomId, sign, verify } from './auth';
import { kindOf } from './galleries';
import type { Store } from './store';
import type { Gallery } from './types';
import { HttpError } from './types';

export type Role = 'couple' | 'guest';

/** A gallery by the couple's id or by its guests' id. */
export async function viewerGallery(store: Store, id: string): Promise<{ g: Gallery; role: Role } | null> {
  if (!/^[a-f0-9]{16}$/.test(id)) return null;
  // A gallery in the trash has no links (couple or guests).
  const g = await store.getGallery(id);
  if (g) return g.deletedAt ? null : { g, role: 'couple' };
  const viaGuest = await store.getGalleryByGuestId(id);
  return viaGuest && viaGuest.guestId === id && !viaGuest.deletedAt ? { g: viaGuest, role: 'guest' } : null;
}

/** A random id no gallery uses yet, as its couple's id or its guests' id. */
async function freshGuestId(store: Store, g: Gallery): Promise<string> {
  let id = randomId();
  while (id === g.id || id === g.guestId || (await store.getGallery(id)) || (await store.getGalleryByGuestId(id))) id = randomId();
  return id;
}

/** The guests' id of a photo gallery, made the first time it's needed. */
export async function ensureGuestId(store: Store, g: Gallery): Promise<string> {
  if (kindOf(g) !== 'photos') return '';
  if (g.guestId) return g.guestId;
  const id = await freshGuestId(store, g);
  // Written only while it is still empty: two first openings at once end with one guests' address.
  const saved = (await store.patchGallery(g.tenantId, g.id, { guestId: id }, { guestId: null })) ?? (await store.getGallery(g.id));
  g.guestId = saved?.guestId;
  return g.guestId ?? '';
}

/**
 * A new guests' id for a photo gallery (P73): the old guests' link answers 404 from now on. Written only
 * while the id is still the one this request read (two clicks at once make one new id); null = the gallery
 * changed meanwhile or is gone.
 */
export async function rotateGuestId(store: Store, g: Gallery): Promise<Gallery | null> {
  const id = await freshGuestId(store, g);
  return store.patchGallery(g.tenantId, g.id, { guestId: id }, { guestId: g.guestId ?? null });
}

export function readCookie(request: Request, name: string): string {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

const studioCookie = (id: string) => `gstudio_${id}`;

/**
 * The key password and code cookies are signed with (P67): derived from FILMS_STATE_SECRET and
 * used for nothing else, so a signature made for another purpose (the Dropbox state, a preview
 * token) can never pass as a cookie. Changing this key logs every couple and guest out once.
 */
export function cookieKey(secret: string): Promise<string> {
  return derivedKey(secret, 'studio-plan/films/cookie-key/v1');
}

/**
 * The key the studio's preview and thumbs tokens are signed with (P73), derived the same way and used for
 * nothing else: a cookie, the Dropbox state or an album-order token can never pass as a studio token.
 */
export function previewKey(secret: string): Promise<string> {
  return derivedKey(secret, 'studio-plan/films/preview-key/v1');
}

/**
 * Every cookie and token carries its studio's access version (films_studio_settings.access_version,
 * P73; read with the studio). 0 until the studio first presses "disconnect every access", so cookies
 * made before P73 (P67 already wrote the 0) keep working.
 */
export const NO_ACCESS_VERSION = 0;

type Secret = 'pass' | 'pin';

/**
 * The cookie's name: a signature of the gallery and the role, so it shows neither the couple's
 * number nor which gallery it is, and a guest's cookie is never the couple's (P67).
 */
async function cookieName(key: string, kind: Secret, g: Gallery, role: Role): Promise<string> {
  return `g${kind === 'pass' ? 'p' : 'd'}_${(await hmac(key, `name|${kind}|${g.id}|${role}`)).slice(0, 22)}`;
}

/**
 * What a cookie proves, as one opaque signature: this gallery, this role and the current password
 * or code (a new one makes old cookies stop working). "v1.<access version>.<signature>".
 */
async function cookieValue(key: string, kind: Secret, g: Gallery, role: Role, version: number): Promise<string> {
  const typed = ((kind === 'pass' ? g.password : g.downloadPin) ?? '').trim().toLowerCase();
  return `v1.${version}.${await hmac(key, `v1|${kind}|${g.id}|${role}|${version}|${typed}`)}`;
}

async function holdsAs(request: Request, key: string, kind: Secret, g: Gallery, role: Role, version: number): Promise<boolean> {
  const c = readCookie(request, await cookieName(key, kind, g, role));
  return Boolean(c) && equal(c, await cookieValue(key, kind, g, role, version));
}

/** The couple's cookie also opens the guests' link (it can do less); a guest's never opens the couple's. */
async function holds(request: Request, secret: string, kind: Secret, g: Gallery, role: Role, version: number): Promise<boolean> {
  const key = await cookieKey(secret);
  if (await holdsAs(request, key, kind, g, role, version)) return true;
  return role === 'guest' && holdsAs(request, key, kind, g, 'couple', version);
}

/** How long a preview or thumbs token opens a gallery. */
export const PREVIEW_HOURS = 12;

/** Who a preview token is for: the gallery, its studio, the signed-in member who asked, the studio's access version. */
export interface PreviewFor {
  galleryId: string;
  tenantId: string;
  userId: string;
  version: number;
}

/**
 * The studio's preview token for a gallery (made by the admin API for a signed-in member): opens it as the
 * studio for 12 hours — hidden photos, a closed gallery, past the password and the download code.
 */
export async function previewToken(secret: string, p: PreviewFor, hours = PREVIEW_HOURS): Promise<string> {
  return sign(await previewKey(secret), `pv2:${p.galleryId}:${p.tenantId}:${p.userId}:${Date.now() + hours * 3600_000}:${p.version}`);
}

/** The hub's list pictures (P73): a small photo, the cover, the saved frame and a film to take a frame from — nothing else. */
export async function thumbsToken(secret: string, p: Omit<PreviewFor, 'userId'>, hours = PREVIEW_HOURS): Promise<string> {
  return sign(await previewKey(secret), `th1:${p.galleryId}:${p.tenantId}:${Date.now() + hours * 3600_000}:${p.version}`);
}

interface ReadToken {
  kind: 'studio' | 'thumbs';
  galleryId: string;
  tenantId: string;
  ends: number;
  version: number;
}

async function readToken(secret: string, token: string): Promise<ReadToken | null> {
  const payload = await verify(await previewKey(secret), token);
  if (!payload) return null;
  const pv = /^pv2:([a-f0-9]{16}):([^:]{1,64}):[^:]{1,64}:(\d{1,15}):(\d{1,9})$/.exec(payload);
  if (pv) return { kind: 'studio', galleryId: pv[1], tenantId: pv[2], ends: Number(pv[3]), version: Number(pv[4]) };
  const th = /^th1:([a-f0-9]{16}):([^:]{1,64}):(\d{1,15}):(\d{1,9})$/.exec(payload);
  if (th) return { kind: 'thumbs', galleryId: th[1], tenantId: th[2], ends: Number(th[3]), version: Number(th[4]) };
  return null;
}

/**
 * A token that opens this gallery as its studio now: made for this gallery and its studio, not ended, under
 * the studio's current access version. A thumbs token counts only where `thumbs` allows it. The ending time
 * (ms) when it does, else 0.
 */
async function studioPassEnds(secret: string, g: Gallery, token: string | null | undefined, version: number, thumbs = false): Promise<number> {
  if (!token) return 0;
  const t = await readToken(secret, token);
  if (!t || t.galleryId !== g.id || t.tenantId !== g.tenantId || t.version !== version || t.ends <= Date.now()) return 0;
  return t.kind === 'studio' || thumbs ? t.ends : 0;
}

export async function isStudioPreview(secret: string, g: Gallery, token: string | null | undefined, version: number, opts: { thumbs?: boolean } = {}): Promise<boolean> {
  return (await studioPassEnds(secret, g, token, version, opts.thumbs)) > 0;
}

export interface Access {
  /** May see the photos and films. */
  view: boolean;
  /** May download full quality. */
  download: boolean;
  /** The gallery's own studio (preview token or its cookie). */
  studio: boolean;
}

export interface AccessOpts {
  /** The studio's access version (TenantInfo.accessVersion): cookies and tokens under another stop working. */
  version: number;
  /** The preview token in the address (?pt=), if any. */
  pt?: string | null;
  /** A thumbs token counts as the studio here (a small picture, the cover). Never for the gallery itself. */
  thumbs?: boolean;
}

/**
 * What this request may do with a gallery, opened through the couple's or the guests' link
 * (`role`, from publicGallery / viewerGallery): the cookies are per role.
 */
export async function accessOf(request: Request, secret: string, g: Gallery, role: Role, opts: AccessOpts): Promise<Access> {
  const { version } = opts;
  const studio = (await isStudioPreview(secret, g, opts.pt, version, { thumbs: opts.thumbs })) || (await isStudioPreview(secret, g, readCookie(request, studioCookie(g.id)), version));
  const view = studio || !g.password || (await holds(request, secret, 'pass', g, role, version));
  const download = studio || !g.downloadPin || (view && (await holds(request, secret, 'pin', g, role, version)));
  return { view, download, studio };
}

export async function requireView(request: Request, secret: string, g: Gallery, role: Role, opts: AccessOpts): Promise<Access> {
  const a = await accessOf(request, secret, g, role, opts);
  if (!a.view) throw new HttpError(401, 'הגלריה מוגנת בסיסמה');
  return a;
}

function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const cookieTail = (request: Request, maxAge: number) => `; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;

/**
 * Checks a typed password or code; returns the cookie that remembers it on this device for this
 * role (the password 180 days, the download code 30).
 */
export async function unlockCookie(request: Request, secret: string, g: Gallery, role: Role, kind: Secret, typed: string, version: number): Promise<string | null> {
  const want = (kind === 'pass' ? g.password : g.downloadPin) ?? '';
  if (!want || !equal(typed.trim().toLowerCase(), want.trim().toLowerCase())) return null;
  const key = await cookieKey(secret);
  return `${await cookieName(key, kind, g, role)}=${await cookieValue(key, kind, g, role, version)}${cookieTail(request, (kind === 'pass' ? 180 : 30) * 86_400)}`;
}

/**
 * The studio opened the gallery from the hub: this browser may view and download it until the token ends.
 * The cookie is the token itself with its own ending (P73): opening again with the cookie, or with the
 * token copied from it, never makes a newer one. A thumbs token leaves no cookie.
 */
export async function studioCookieFor(request: Request, secret: string, g: Gallery, token: string, version: number): Promise<string | null> {
  const ends = await studioPassEnds(secret, g, token, version);
  if (!ends) return null;
  return `${studioCookie(g.id)}=${token}${cookieTail(request, Math.max(1, Math.floor((ends - Date.now()) / 1000)))}`;
}

/** A password or code as the studio typed it: short, no spaces at the ends; '' = none. */
export function cleanSecret(input: unknown): string {
  return String(input ?? '')
    .trim()
    .slice(0, 40);
}

/** A NEW download code is at least this long (codes set before P67 keep working). */
export const MIN_PIN = 6;
