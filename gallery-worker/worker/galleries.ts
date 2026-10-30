import { cleanChapters } from '../shared/chapters';
import { coverPath } from './covers';
import { cleanSecret, MIN_PIN } from './access';
import { baseTitle, groupVersions, parseDropboxLink, sortByTag, TAG_ORDER } from '../shared/dropbox';
import { detectLink, parseDriveLink, parseMyAirBridgeLink, parsePcloudLink, type Provider } from '../shared/providers';
import { filmUrls, folderDownloadUrl } from './providers';
import { closeAfterDays, closeOfDay, israelDaysBetween } from '../shared/day';
import { isIsoDate } from '../shared/event';
import { randomId } from './auth';
import { galleryChanges, type AlbumGuardState, type GalleryFields, type Store } from './store';
import { publicView } from './settings';
import type { Env, Film, Gallery, Settings } from './types';
import { HttpError } from './types';
import { READ_ONLY_REDUCE_WORDS } from './supabaseAuth';

const DAY = 86_400_000;
/** A gallery closes at most this many days after it was made (10 years). */
export const MAX_GALLERY_DAYS = 3650;

/** A gallery only if it belongs to this studio; otherwise it doesn't exist as far as they know. */
export async function getOwnedGallery(store: Store, tenantId: string, id: string): Promise<Gallery> {
  const g = await store.getGallery(id);
  if (!g || g.tenantId !== tenantId) throw new HttpError(404, 'הגלריה לא נמצאה');
  return g;
}

export const kindOf = (g: Gallery): 'films' | 'photos' => (g.kind === 'photos' ? 'photos' : 'films');

export interface GalleryInput {
  kind?: 'films' | 'photos';
  /** Photo galleries: '' = the studio's default song, 'none' = silent, else a track id. */
  music?: string;
  /** '' removes them. */
  password?: string;
  downloadPin?: string;
  coupleName?: string;
  studioName?: string;
  date?: string;
  venue?: string;
  days?: number;
  expiresAt?: string;
  folderUrl?: string;
  films?: Partial<Film>[];
  /** The studio's event (crm studios; P57): '' or null unlinks it. Checked with checkEvent before it is applied. */
  eventId?: string | null;
}

/** P57: a gallery is linked only to an event of its own studio (the database refuses others too, 0139). */
async function checkEvent(store: Store, tenantId: string, input: GalleryInput): Promise<void> {
  const id = input.eventId;
  if (id === undefined || id === null || id === '') return;
  if (typeof id !== 'string' || !(await store.eventInStudio(tenantId, id))) throw new HttpError(400, 'האירוע לא נמצא');
}

const PROVIDERS: Provider[] = ['dropbox', 'dropbox-link', 'dropbox-own', 'gdrive', 'myairbridge', 'pcloud'];

/** Validates films sent by the admin page. Links are re-derived here, never trusted from the browser. */
function cleanFilms(input: Partial<Film>[] | undefined, settings: Settings, env: Env): Film[] {
  if (!Array.isArray(input)) return [];
  const films: Film[] = [];
  for (const f of input) {
    const label = String(f.title ?? f.fileName ?? '');
    const provider: Provider = PROVIDERS.includes(f.provider as Provider) ? (f.provider as Provider) : 'dropbox';
    const raw = String(f.fileId || f.sourceUrl || '').trim();
    let fileId = '';
    let sourceUrl = String(f.sourceUrl ?? '').trim();
    let pathRoot = '';
    let expiresAt = '';
    if (provider === 'dropbox-own') {
      // A file in the studio's own Dropbox (P65): its id (or path), the team root, the folder link it was read from.
      // Streamed only with this studio's own connection, so it reaches nothing outside the studio's account.
      if (!/^(id:[A-Za-z0-9_-]{1,200}|\/[^\0]{1,1000})$/.test(raw)) throw new HttpError(400, `הסרט "${label}" חסר את פרטי הקובץ בדרופבוקס. טען את הסרטים מהתיקייה מחדש.`);
      fileId = raw;
      const root = String(f.pathRoot ?? '').trim();
      if (root && !/^\d{1,30}$/.test(root)) throw new HttpError(400, `הסרט "${label}" חסר את פרטי הקובץ בדרופבוקס. טען את הסרטים מהתיקייה מחדש.`);
      pathRoot = root;
      const folder = parseDropboxLink(sourceUrl);
      sourceUrl = folder?.kind === 'folder' ? folder.canonical : '';
    } else if (provider === 'dropbox') {
      const parsed = parseDropboxLink(raw);
      if (!parsed || parsed.kind !== 'file') throw new HttpError(400, `הקישור של הסרט "${label}" אינו קישור לקובץ דרופבוקס`);
      fileId = sourceUrl = parsed.canonical;
    } else if (provider === 'dropbox-link') {
      // A file inside someone else's shared folder: the folder link plus the file's path in it.
      const folder = parseDropboxLink(sourceUrl);
      if (!folder || folder.kind !== 'folder' || !raw.startsWith('/')) throw new HttpError(400, `הסרט "${label}" חסר את פרטי התיקייה בדרופבוקס. טען את הסרטים מהתיקייה מחדש.`);
      fileId = raw;
      sourceUrl = folder.canonical;
    } else if (provider === 'pcloud') {
      // "<public link>#<file id>": played through our site.
      const i = raw.lastIndexOf('#');
      const link = parsePcloudLink(i > 0 ? raw.slice(0, i) : '');
      const fileid = i > 0 ? raw.slice(i + 1) : '';
      if (!link || !/^\d{1,20}$/.test(fileid)) throw new HttpError(400, `הסרט "${label}" חסר את פרטי הקובץ ב-pCloud. טען את הסרטים מהתיקייה מחדש.`);
      fileId = `${link.canonical}#${fileid}`;
      sourceUrl = link.canonical;
    } else if (provider === 'gdrive') {
      const parsed = /^[A-Za-z0-9_-]{10,}$/.test(raw) ? { id: raw } : parseDriveLink(raw);
      if (!parsed) throw new HttpError(400, `הקישור של הסרט "${label}" אינו קובץ בגוגל דרייב`);
      fileId = parsed.id;
      sourceUrl = `https://drive.google.com/file/d/${fileId}/view`;
    } else {
      // Couples are redirected to this address, so it must really be MyAirBridge
      // (otherwise any studio could turn the films domain into an open redirect).
      const ok = Boolean(parseMyAirBridgeLink(raw)) && raw.startsWith('https://');
      if (!ok) throw new HttpError(400, `הקישור של הסרט "${label}" אינו קישור תקין של MyAirBridge`);
      fileId = raw;
      if (!parseMyAirBridgeLink(sourceUrl)) sourceUrl = raw;
      // The share's end date as MyAirBridge said when it was read (P65): the editor warns before it comes.
      const t = Date.parse(String(f.providerExpiresAt ?? ''));
      if (Number.isFinite(t)) expiresAt = new Date(t).toISOString();
    }
    const tag = TAG_ORDER.includes(f.tag as never) ? (f.tag as Film['tag']) : 'other';
    const film: Film = {
      title: String(f.title ?? '').trim() || String(f.fileName ?? '') || 'סרט',
      tag,
      fileName: String(f.fileName ?? ''),
      provider,
      fileId,
      sourceUrl,
      watchUrl: env.CLOUD_MOCK && typeof f.watchUrl === 'string' && f.watchUrl.startsWith('/') ? f.watchUrl : '',
      downloadUrl: '',
      sizeBytes: Number(f.sizeBytes ?? 0) || 0,
      playable: Boolean(f.playable),
    };
    if (pathRoot) film.pathRoot = pathRoot;
    if (expiresAt) film.providerExpiresAt = expiresAt;
    const chapters = cleanChapters(f.chapters);
    if (chapters.length) film.chapters = chapters;
    Object.assign(film, filmUrls(film, settings, env));
    films.push(film);
  }
  return films;
}

/** Films and folder link only (used by the studio page's showcase, which is not a gallery). */
export function applyFilmsAndFolder(g: Gallery, input: Pick<GalleryInput, 'films' | 'folderUrl'>, settings: Settings, env: Env): void {
  applyInput(g, { films: input.films, folderUrl: input.folderUrl, coupleName: g.coupleName }, settings, env);
}

function applyInput(g: Gallery, input: GalleryInput, settings: Settings, env: Env): void {
  // Stored as written: "X וY" → "X & Y" is only the hub form's suggestion (P72, D15).
  if (input.coupleName !== undefined) g.coupleName = String(input.coupleName).replace(/\s+/g, ' ').trim();
  if (input.studioName !== undefined) {
    // Only a real override is stored; otherwise the couple sees the studio's current name from Settings.
    const name = String(input.studioName).trim();
    g.studioName = name && name !== settings.studioName ? name : undefined;
  }
  if (input.date !== undefined) {
    // A real day or nothing (the album order reads it as a date); an old free-text date sent back unchanged stays.
    const date = String(input.date).trim();
    if (date && date !== g.date && !isIsoDate(date)) throw new HttpError(400, 'תאריך החתונה לא תקין');
    g.date = date;
  }
  if (input.venue !== undefined) g.venue = String(input.venue).trim() || undefined;
  if (input.eventId !== undefined) g.eventId = input.eventId ? String(input.eventId) : undefined;
  if (input.folderUrl !== undefined) {
    const raw = String(input.folderUrl).trim();
    if (raw) {
      const link = detectLink(raw);
      if (!link || link.kind === 'file') throw new HttpError(400, 'קישור התיקייה לא תקין. אפשר להדביק תיקייה מדרופבוקס, מגוגל דרייב, מ-pCloud או מ-MyAirBridge.');
      g.folderUrl = link.canonical;
      g.folderProvider = link.provider;
    } else {
      g.folderUrl = undefined;
      g.folderProvider = undefined;
    }
  }
  if (input.films !== undefined) g.films = cleanFilms(input.films, settings, env);
  if (input.password !== undefined) g.password = cleanSecret(input.password) || undefined;
  if (input.downloadPin !== undefined) {
    const pin = cleanSecret(input.downloadPin);
    // Only a new code must be long enough; a short one set before stays as it is.
    if (pin && pin !== g.downloadPin && pin.length < MIN_PIN) throw new HttpError(400, `קוד ההורדה צריך לפחות ${MIN_PIN} תווים`);
    g.downloadPin = pin || undefined;
  }
  if (input.music !== undefined) {
    const m = String(input.music ?? '').trim();
    g.music = m === 'none' || /^[A-Za-z0-9_-]{6,20}$/.test(m) ? m : undefined;
  }
  // The closing day follows the days only when they really changed (P71): a form sent back with the days it
  // showed never reopens a gallery that was closed or extended meanwhile.
  const days = input.days === undefined ? undefined : Math.floor(Number(input.days));
  if (days !== undefined && (days !== g.days || !g.days)) {
    if (!Number.isFinite(days) || days < 1 || days > MAX_GALLERY_DAYS) throw new HttpError(400, 'מספר הימים לא תקין: לפחות יום אחד');
    g.days = days;
    // Open to the end of the last day, 23:59 Israel time (P72, D15), not to the hour it was made.
    g.expiresAt = new Date(closeAfterDays(Date.parse(g.createdAt), days)).toISOString();
  }
  if (input.expiresAt !== undefined) {
    const t = Date.parse(String(input.expiresAt));
    if (!Number.isFinite(t)) throw new HttpError(400, 'תאריך הסגירה לא תקין');
    if (t > Date.parse(g.createdAt) + MAX_GALLERY_DAYS * DAY) throw new HttpError(400, 'תאריך הסגירה רחוק מדי: עד 10 שנים מיום יצירת הגלריה');
    g.expiresAt = new Date(closeOfDay(t)).toISOString();
  }
  if (!g.coupleName) throw new HttpError(400, 'צריך למלא את שם הזוג');
  if (!g.days && input.days === undefined && !input.expiresAt) {
    g.days = settings.defaultDays;
    g.expiresAt = new Date(closeAfterDays(Date.parse(g.createdAt), g.days)).toISOString();
  }
}

export async function createGallery(store: Store, env: Env, settings: Settings, input: GalleryInput, tenantId: string): Promise<Gallery> {
  await checkEvent(store, tenantId, input);
  const g = buildGallery(env, settings, input, tenantId);
  await store.putGallery(g);
  return g;
}

/**
 * A new gallery, checked and filled in memory only (nothing saved): createGallery saves one, a list import
 * saves them all in one write (store.putGalleries, fix plan P70), so a bad line leaves nothing half made.
 */
export function buildGallery(env: Env, settings: Settings, input: GalleryInput, tenantId: string): Gallery {
  const now = new Date().toISOString();
  const g: Gallery = {
    id: randomId(),
    tenantId,
    kind: input.kind === 'photos' ? 'photos' : 'films',
    coupleName: '',
    date: '',
    days: 0,
    createdAt: now,
    expiresAt: now,
    hasCover: false,
    films: [],
    views: 0,
    downloads: 0,
  };
  applyInput(g, { days: settings.defaultDays, ...input }, settings, env);
  return g;
}

/** Writes one gallery's fields; the saved gallery (404 when it was removed meanwhile). */
async function patch(store: Store, g: Gallery, fields: GalleryFields): Promise<Gallery> {
  const saved = await store.patchGallery(g.tenantId, g.id, fields);
  if (!saved) throw new HttpError(404, 'הגלריה לא נמצאה');
  return saved;
}

/**
 * The gallery form sends every field; only those that really differ from the copy read are written,
 * so a form saved at the same moment as another change (a password, the trash, a print link) keeps it.
 */
export async function updateGallery(store: Store, env: Env, settings: Settings, g: Gallery, input: GalleryInput, opts: { onlyLower?: boolean } = {}): Promise<Gallery> {
  if (input.eventId !== undefined && (input.eventId || undefined) !== g.eventId) await checkEvent(store, g.tenantId, input);
  const before = structuredClone(g);
  applyInput(g, input, settings, env);
  const changes = galleryChanges(before, g);
  // A read-only studio (P55): only what lowers exposure — a new password or code, an earlier closing day.
  if (opts.onlyLower && !onlyLowersExposure(before, changes)) throw new HttpError(402, READ_ONLY_REDUCE_WORDS);
  return patch(store, g, changes);
}

/**
 * Whether a gallery edit only lowers who can reach it (fix plan P55, for a studio whose subscription is not active): a
 * new, non-empty password or download code, an earlier closing day (with its days). Anything else — a removed password,
 * a later day, names, the folder — is not.
 */
export function onlyLowersExposure(before: Gallery, changes: GalleryFields): boolean {
  const keys = Object.keys(changes) as (keyof GalleryFields)[];
  if (!keys.length) return true;
  const earlier = changes.expiresAt !== undefined && Date.parse(changes.expiresAt) < Date.parse(before.expiresAt);
  return keys.every((k) => {
    if (k === 'password' || k === 'downloadPin') return typeof changes[k] === 'string' && changes[k] !== '';
    if (k === 'expiresAt') return earlier;
    if (k === 'days') return earlier;
    return false;
  });
}

/**
 * Re-opens a closed gallery (or lengthens an open one) by a number of days from today, at most up to
 * MAX_GALLERY_DAYS from its creation (repeated extensions can't keep it, and its face data, open forever);
 * like every closing, at the end of that day in Israel.
 */
export async function extendGallery(store: Store, g: Gallery, days: number): Promise<Gallery> {
  return patch(store, g, extendedTo(g, validDays(days)));
}

/** A number of days to extend by (1 to MAX_GALLERY_DAYS), else 400. */
export function validDays(days: unknown): number {
  const n = Math.floor(Number(days));
  if (!Number.isFinite(n) || n < 1 || n > MAX_GALLERY_DAYS) throw new HttpError(400, 'מספר הימים לא תקין');
  return n;
}

/** Where extending by `days` takes a gallery (the rule films_galleries_extend, 0133, applies in the database). */
export function extendedTo(g: Pick<Gallery, 'expiresAt' | 'createdAt'>, days: number, now = Date.now()): { expiresAt: string; days: number } {
  const from = Math.max(now, Date.parse(g.expiresAt));
  const expiresAt = new Date(closeOfDay(Math.min(from + days * DAY, Date.parse(g.createdAt) + MAX_GALLERY_DAYS * DAY))).toISOString();
  return { expiresAt, days: Math.round((Date.parse(expiresAt) - Date.parse(g.createdAt)) / DAY) };
}

/**
 * Closes galleries now (P71; the batch's "close"): the closing time is now, and a gallery keeps at least one day
 * (an old gallery saved with 0 gets 1), so the form saved afterwards — it sends the days only when they were
 * edited, and they count only when they changed — never reopens it. Only galleries not in the trash; at most two
 * writes (those that keep their days, and those that get 1). The ids closed.
 */
export async function closeGallery(store: Store, tenantId: string, galleries: Gallery[], now = Date.now()): Promise<string[]> {
  const expiresAt = new Date(now).toISOString();
  const keep = galleries.filter((g) => g.days >= 1).map((g) => g.id);
  const lift = galleries.filter((g) => !(g.days >= 1)).map((g) => g.id);
  const done: string[] = [];
  if (keep.length) done.push(...(await store.patchGalleries(tenantId, keep, { expiresAt }, { deletedAt: null })));
  if (lift.length) done.push(...(await store.patchGalleries(tenantId, lift, { expiresAt, days: 1 }, { deletedAt: null })));
  return done;
}

// ---------- what protects a designed album (fix plan P71, decisions D15(5), D18(6)) ----------

/** Why a gallery can't go to the trash, or be removed for good, as it is (the hub says it in words). */
export type AlbumBlock = 'album_submitted' | 'album_order' | 'album_paid';

const CLOSED_ORDER = ['delivered', 'completed'];
const isPaid = (o: { workflowStatus: string; paymentStatus: string }) => o.paymentStatus === 'paid' || o.workflowStatus === 'paid' || o.workflowStatus === 'in_print';

/**
 * A gallery's album and album order against the trash and removal for good:
 *   - `trash`: an open order (not delivered or completed) keeps it out of the trash, whatever the studio says
 *     ('album_order'); a sent album or a finished order needs the studio's explicit yes ('album_submitted',
 *     cleared by `force`);
 *   - `purge`: an order that was paid or is in print is never removed for good, not even with a yes ('album_paid',
 *     the design lives only in the gallery's album until P55); an open one neither ('album_order').
 * null = nothing in the way.
 */
export function albumGuard(state: AlbumGuardState | undefined, action: 'trash' | 'purge', force = false): AlbumBlock | null {
  if (!state) return null;
  const o = state.order;
  if (action === 'purge') {
    if (o && isPaid(o)) return 'album_paid';
    if (o && !CLOSED_ORDER.includes(o.workflowStatus)) return 'album_order';
    return null;
  }
  if (o && !CLOSED_ORDER.includes(o.workflowStatus)) return 'album_order';
  if ((state.album === 'submitted' || o) && !force) return 'album_submitted';
  return null;
}

/** What the studio is told when one gallery is refused (409, with the block as its code). */
export const ALBUM_BLOCK_WORDS: Record<AlbumBlock, string> = {
  album_submitted: 'הזוג כבר שלח את האלבום שעיצב בגלריה הזו. בסל המחזור הקישור יפסיק לעבוד ואחרי 30 יום העיצוב יימחק. לאשר?',
  album_order: 'לגלריה יש הזמנת אלבום פתוחה. אי אפשר להעביר אותה לסל המחזור או למחוק אותה עד שההזמנה נמסרה או הושלמה.',
  album_paid: 'לגלריה יש הזמנת אלבום ששולמה או בהדפסה, ולכן העיצוב נשמר ואי אפשר למחוק אותה לצמיתות.',
};

export async function deleteGallery(store: Store, env: Env, g: Gallery): Promise<void> {
  await store.deleteGallery(g.id);
  await env.KV.delete(`cover:${g.id}`);
  if (g.hasThumb) await env.KV.delete(`thumb:${g.id}`);
}

export const TRASH_DAYS = 30;

/**
 * To the trash: every link stops at once; face data goes now (privacy) and face search is switched
 * off (a restored gallery never offers an empty search), the rest after 30 days.
 */
export async function trashGallery(store: Store, g: Gallery): Promise<Gallery> {
  if (g.deletedAt) return g;
  if (kindOf(g) === 'photos') await store.deleteFaces(g.id, { searchOff: true });
  // Only while it is not in the trash yet (a second click keeps the first time).
  const saved = await store.patchGallery(g.tenantId, g.id, { deletedAt: new Date().toISOString() }, { deletedAt: null });
  if (saved) return saved;
  const now = await store.getGallery(g.id);
  if (!now || now.tenantId !== g.tenantId) throw new HttpError(404, 'הגלריה לא נמצאה');
  return now;
}

export async function restoreGallery(store: Store, g: Gallery): Promise<Gallery> {
  if (!g.deletedAt) return g;
  return patch(store, g, { deletedAt: undefined });
}

/** For good: face data first (if anything fails, the gallery stays), the link from its partner, the row. */
export async function purgeGallery(store: Store, env: Env, g: Gallery): Promise<void> {
  if (kindOf(g) === 'photos') await store.deleteFaces(g.id);
  // The partner forgets the link only while it still points here.
  if (g.linkedId) await store.patchGallery(g.tenantId, g.linkedId, { linkedId: undefined }, { linkedId: g.id });
  await deleteGallery(store, env, g);
}

/** Calendar days in Israel until the closing day: 0 = it closes today (still open until then), 1 = tomorrow. */
export function daysLeft(g: Gallery, now = Date.now()): number {
  if (isExpired(g, now)) return 0;
  return Math.max(0, israelDaysBetween(now, Date.parse(g.expiresAt)));
}

export function isExpired(g: Gallery, now = Date.now()): boolean {
  return Date.parse(g.expiresAt) <= now;
}

/**
 * Films that play without the download code (P67). A film in several sizes plays only in its
 * smallest one; a film in one size plays as before; a MyAirBridge film never (its address is the
 * file itself), and a file the browser can't play never streams (that would be a download).
 */
export function filmsWithoutCode(g: Gallery): Set<number> {
  const open = new Set<number>();
  const groups = groupVersions(g.films.map((f, index) => ({ ...f, index })));
  for (const grp of groups) {
    const ok = grp.versions.filter((v) => v.playable && v.provider !== 'myairbridge');
    if (ok.length === 0) continue;
    // Versions come largest first: the last playable one is the smallest.
    open.add(ok[ok.length - 1].index);
  }
  return open;
}

/**
 * The couple's view. Links only exist while the gallery is open. Without the download code
 * (`download` false) nothing can be downloaded and films play only in their smallest size.
 */
export function coupleView(g: Gallery, settings: Settings, env: Env, download = true) {
  const expired = isExpired(g);
  const base = {
    id: g.id,
    kind: kindOf(g),
    coupleName: g.coupleName,
    date: g.date,
    venue: g.venue ?? '',
    expiresAt: g.expiresAt,
    daysLeft: daysLeft(g),
    expired,
    coverUrl: g.hasCover ? coverPath(g.id, g) : '',
    ...publicView(settings),
    studioName: g.studioName || settings.studioName,
  };
  if (expired) return { ...base, films: [], folderDownloadUrl: '', folderProvider: '' };

  // Each stored film with its live URLs. `index` is the position in g.films (what the proxy route uses).
  const open = download ? null : filmsWithoutCode(g);
  const live = g.films.map((f, index) => {
    const urls = filmUrls(f, settings, env, { galleryId: g.id, index });
    const watchUrl = !open || open.has(index) ? urls.watchUrl : '';
    const playable = f.playable && Boolean(watchUrl);
    return { ...f, index, watchUrl: playable ? watchUrl : '', downloadUrl: download ? urls.downloadUrl : '', playable };
  });
  // Same film exported in several sizes → one entry with a quality menu.
  const grouped = groupVersions(live).map((grp) => {
    const versions = grp.versions.map((v) => ({
      label: v.label,
      height: v.height,
      watchUrl: v.watchUrl,
      downloadUrl: v.downloadUrl,
      sizeBytes: v.sizeBytes,
      playable: v.playable,
    }));
    // The largest version; without the code, the one that plays.
    const top = download ? grp.versions[0] : (grp.versions.find((v) => v.playable) ?? grp.versions[0]);
    // Grouped films use the owner's edited title (minus its quality token), so "רוני ורז - הייליטס 4K" → "הייליטס" if they trimmed it.
    const title = grp.versions.length > 1 ? baseTitle(grp.versions[0].title) || grp.title : grp.versions[0].title;
    // Chapters: from whichever version the studio typed them on.
    const chapters = grp.versions.find((v) => v.chapters?.length)?.chapters ?? [];
    return {
      title,
      tag: grp.tag,
      chapters,
      watchUrl: top.watchUrl,
      downloadUrl: top.downloadUrl,
      sizeBytes: top.sizeBytes,
      playable: versions.some((v) => v.playable),
      versions,
    };
  });
  // "Download all" is for film galleries only: a photo gallery's folder also holds the photos the
  // studio hid (its couples download the shown photos as a ZIP made in the browser).
  const folder = kindOf(g) === 'films' && download;
  return {
    ...base,
    films: sortByTag(grouped),
    folderDownloadUrl: folder ? folderDownloadUrl(g, g.id) : '',
    folderProvider: folder && g.folderUrl ? (g.folderProvider ?? 'dropbox') : '',
  };
}
