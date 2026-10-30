// Photo galleries: read a Dropbox / Drive / pCloud folder, keep sets, serve fast previews and
// originals. Ported from the Avira films app (2026-09-26). Differences: the list lives in
// Postgres (films_photos) and hearts in films_hearts through the Store; MyAirBridge is not a
// photo source (no prepared previews, Daniel's decision D2); the edge cache is per gallery,
// since two studios' clouds can hold files at the same path.
import { decodeEntities } from '../shared/entities';
import { detectLink } from '../shared/providers';
import { cleanDesign } from '../shared/design';
import { exifTakenAt } from '../shared/exif';
import { PRESET_SETS, presetForFolder } from '../shared/photosets';
import { photoBase } from '../shared/photoUrl';
import { accessToken, api, apiArg, call, dropboxError, forgetAccessToken, locateOwnFolder, retryBusy, type Entry, type Session } from './providers/dropbox';
import { pcloudFile, pcloudThumb, pcloudTree, type PcloudItem } from './providers/pcloud';
import { PHOTO_EDIT_FIELDS, type PatchedPhotos, type PhotoDiff, type Store } from './store';
import type { Env, Gallery, PhotoData, PhotoItem, PhotoSet, Settings } from './types';
import { HttpError } from './types';

export const IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif|tiff?)$/i;
/**
 * Picture types sent as they are. Anything else (an SVG, HTML, a file named .jpg that isn't) goes
 * out as image/jpeg, so a browser never runs it as a page or a script on this site (P67).
 */
export const SAFE_IMAGE_TYPE = /^image\/(jpeg|png|webp|gif|avif|heic|heif|tiff)$/;
export const RECOMMENDED = 150;
/**
 * Photos one gallery may hold (fix plan P61): the list is one JSON document read and parsed by the Worker,
 * and a folder over this is refused with a message instead of making every request of the gallery slow.
 */
export const MAX_PHOTOS = 20_000;

/** FNV-1a → 8 hex chars. Stable across reloads, so hearts survive re-reading the folder. */
export function photoKey(ref: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < ref.length; i++) {
    h ^= ref.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * A key no other photo in the list has (fix plan P64): the hash of the ref, or on a clash the hash of
 * `ref#1`, `ref#2`… Eight characters can clash (two photos of 3,000 do about once in 1,000 galleries),
 * and two photos under one key shared hearts, hiding and their place in time. `taken` grows.
 */
export function uniqueKey(ref: string, taken: Set<string>): string {
  let key = photoKey(ref);
  for (let n = 1; taken.has(key); n++) key = photoKey(`${ref}#${n}`);
  taken.add(key);
  return key;
}

/**
 * A file's version as its cloud tells it (fix plan P66), in 8 characters: the hash of the parts it gives
 * (Dropbox rev + content_hash, Drive modifiedTime + md5Checksum, pCloud hash + size). None when it gives none.
 */
export function fileVersion(...parts: (string | number | undefined | null)[]): string | undefined {
  const known = parts.filter((p) => p !== undefined && p !== null && p !== '');
  return known.length ? photoKey(`v\u0000${parts.map((p) => p ?? '').join('\u0000')}`) : undefined;
}

/** "02 התארגנות" / "2. Getting ready" / "02_צילומי-חוץ" → a readable set name. */
export function setNameFromFolder(folder: string): string {
  return (
    folder
      .replace(/^\s*\d+\s*[-_.)]*\s*/, '')
      .replace(/[_]+/g, ' ')
      .replace(/\s*-\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || folder.trim()
  );
}

// One collator each, made once: calling localeCompare with options builds a new one on every
// comparison, which made sorting a few thousand photos take over 100ms of the request's CPU.
const folderOrder = new Intl.Collator('he', { numeric: true });

/** Natural order by folder then file name (IMG_2.jpg before IMG_10.jpg: camera order = the day's order). */
export function sortByName<T extends { name: string; folder?: string }>(list: T[]): T[] {
  const folders = [...new Set(list.map((f) => f.folder ?? ''))].sort((a, b) => folderOrder.compare(a, b));
  const rank = new Map(folders.map((f, i) => [f, i]));
  const keyed = list.map((f) => ({ f, r: rank.get(f.folder ?? '')!, k: f.name.toLowerCase().replace(/\d+/g, (d) => d.padStart(12, '0')) }));
  keyed.sort((a, b) => a.r - b.r || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  return keyed.map((x) => x.f);
}

interface Found {
  name: string;
  folder: string;
  ref: string;
  size?: number;
  /** A Dropbox file kept by its id: the path ref it had before (to find it in an older list). */
  alt?: string;
  /** The file's version (fileVersion, P66). */
  v?: string;
}

/** The studio's preset sets (empty until photos are assigned). */
export function presetSets(): PhotoSet[] {
  return PRESET_SETS.map((name, i) => ({ id: `s${i + 1}`, name }));
}

/**
 * Items in order, with the studio's preset sets. A subfolder named like a set ("02 התארגנות")
 * fills that set; other subfolders (per photographer, "טופ1"…) stay folders the studio can filter by.
 */
export function buildPhotoData(folderUrl: string, provider: PhotoData['provider'], found: Found[], pathRoot?: string): PhotoData {
  const images = sortByName(found.filter((f) => IMAGE_EXT.test(f.name)));
  if (images.length === 0) throw new HttpError(400, 'לא נמצאו תמונות בתיקייה (JPG / PNG / HEIC).');
  if (images.length > MAX_PHOTOS) {
    const n = (v: number) => v.toLocaleString('en-US');
    throw new HttpError(400, `בתיקייה יש ${n(images.length)} תמונות, וגלריה אחת יכולה להכיל עד ${n(MAX_PHOTOS)}. חלקו את התמונות לשתי תיקיות ופתחו גלריה לכל אחת.`);
  }
  const sets = presetSets();
  const idOf = new Map(sets.map((s) => [s.name, s.id]));
  const taken = new Set<string>();
  const items: PhotoItem[] = images.map((f) => {
    const preset = f.folder ? presetForFolder(f.folder) : '';
    return { key: uniqueKey(f.ref, taken), name: f.name, ref: f.ref, set: preset ? idOf.get(preset) : undefined, ...(f.folder ? { folder: f.folder } : {}), ...(f.size ? { size: f.size } : {}), ...(f.alt ? { alt: f.alt } : {}), ...(f.v ? { v: f.v } : {}) };
  });
  return { folderUrl, provider, pathRoot, sets, items, cover: items[0]?.key };
}

/**
 * The gallery's order: by the time each photo was taken (several photographers → one timeline) — or,
 * when the studio turned that off, by folder and file name. A photo without a capture time (none in
 * the file, or not read yet) goes right after the photo before it in name order: the nearest one
 * with a time in its own folder, else the nearest one before it at all; with none before it, at the
 * start. Everything else stays in time order (fix plan P64, decision D16: it was all or nothing — one
 * photo without a time put the whole gallery back in name order).
 */
export function sortByTime(items: PhotoItem[], timeOrder = true): PhotoItem[] {
  if (!timeOrder) return sortByName(items);
  const timed = items
    .map((it, i) => ({ it, i }))
    .filter((x) => typeof x.it.t === 'number')
    .sort((a, b) => a.it.t! - b.it.t! || a.i - b.i)
    .map((x) => x.it);
  if (timed.length === items.length) return timed;
  const after = new Map<PhotoItem | null, PhotoItem[]>();
  const lastInFolder = new Map<string, PhotoItem>();
  let last: PhotoItem | null = null;
  for (const it of sortByName(items)) {
    if (typeof it.t === 'number') {
      last = it;
      lastInFolder.set(it.folder ?? '', it);
      continue;
    }
    const anchor = lastInFolder.get(it.folder ?? '') ?? last;
    const list = after.get(anchor);
    if (list) list.push(it);
    else after.set(anchor, [it]);
  }
  const out = [...(after.get(null) ?? [])];
  for (const it of timed) out.push(it, ...(after.get(it) ?? []));
  return out;
}

const withoutAlt = ({ alt: _alt, ...it }: PhotoItem): PhotoItem => it;

/**
 * Which photo of a freshly read folder each photo of the saved list is now (fix plan P64): the same
 * ref (a Dropbox id, a Drive or pCloud file id, an unchanged path), else the fresh photo whose old
 * Dropbox path it was (`alt`: a list saved before photos were kept by id), else the one photo with
 * the same folder and name when exactly one saved photo and one fresh photo have them. A looser rule
 * never takes a photo a stricter one matched. Answers fresh index → saved photo.
 */
function matchSaved(fresh: PhotoItem[], old: PhotoItem[], isNew: (i: PhotoItem) => boolean = () => false): Map<number, PhotoItem> {
  const out = new Map<number, PhotoItem>();
  const left = new Set(old);
  const pass = (keyOf: (i: PhotoItem) => string | undefined, oldKey: (i: PhotoItem) => string, unique = false) => {
    const index = new Map<string, number[]>();
    fresh.forEach((it, n) => {
      const k = keyOf(it);
      if (k !== undefined && !out.has(n) && !isNew(it)) index.set(k, [...(index.get(k) ?? []), n]);
    });
    const olds = new Map<string, number>();
    if (unique) for (const o of left) olds.set(oldKey(o), (olds.get(oldKey(o)) ?? 0) + 1);
    for (const o of [...left]) {
      const candidates = (index.get(oldKey(o)) ?? []).filter((n) => !out.has(n));
      if (!candidates.length || (unique && (candidates.length > 1 || olds.get(oldKey(o))! > 1))) continue;
      out.set(candidates[0], o);
      left.delete(o);
    }
  };
  pass((i) => i.ref, (o) => o.ref);
  pass((i) => i.alt, (o) => o.ref);
  const place = (i: PhotoItem) => `${i.folder ?? ''}\u0000${i.name}`;
  pass(place, place, true);
  return out;
}

/**
 * The folder's link was replaced and the new folder is read through a shared link (fix plan P66): its refs are
 * paths inside the link (`l:/IMG_1.jpg`), so the same ref under another link is another couple's file.
 */
export function sharedLinkReplaced(old: PhotoData | null, fresh: PhotoData): boolean {
  return Boolean(old) && old!.folderUrl !== fresh.folderUrl && fresh.provider === 'dropbox-link';
}

/**
 * Keeps the studio's work (sets, cover, hidden, shapes, times) when the folder is read again. Each
 * saved photo keeps its key on the file it is now (matchSaved), so hearts, Instagram marks, lists and
 * the album follow it; when two saved photos shared a key, the first keeps it and the other gets a new
 * one. New photos get keys no other photo has. P66: a photo whose file changed (another version) keeps
 * its set and hidden, but not its shape, time and colour label: they are read again. When the link was
 * replaced by a shared link (sharedLinkReplaced), its photos are new photos: nothing is inherited — no
 * hidden, set, label, cover or face search — and no key the old list used is given again.
 */
export function mergePhotoData(fresh: PhotoData, old: PhotoData | null): PhotoData {
  if (!old) return { ...fresh, items: fresh.items.map(withoutAlt) };
  const sets = old.sets.length ? old.sets : fresh.sets;
  const idByName = new Map(sets.map((s) => [s.name, s.id]));
  const freshName = new Map(fresh.sets.map((s) => [s.id, s.name]));
  const kept = new Set(sets.map((s) => s.id));
  const relinked = sharedLinkReplaced(old, fresh);
  const match = matchSaved(fresh.items, old.items, (i) => relinked && i.ref.startsWith('l:'));
  const oldOrder = new Map(old.items.map((o, n) => [o, n]));
  const taken = new Set<string>();
  const keyOf = new Map<number, string>();
  // The saved keys first, in the saved list's order: a key two saved photos shared stays with the first.
  for (const [n, prev] of [...match].sort((a, b) => oldOrder.get(a[1])! - oldOrder.get(b[1])!)) {
    if (taken.has(prev.key)) continue;
    taken.add(prev.key);
    keyOf.set(n, prev.key);
  }
  const items = fresh.items.map((raw, n) => {
    const i = { ...withoutAlt(raw), key: keyOf.get(n) ?? '' };
    // A folder named like a set fills the studio's set of that name.
    const fromFolder = i.set ? idByName.get(freshName.get(i.set) ?? '') : undefined;
    const prev = match.get(n);
    if (!prev) return { ...i, set: fromFolder };
    const set = prev.set && kept.has(prev.set) ? prev.set : fromFolder;
    // Another version of the file: its shape, time and label are measured again (the photo screen does).
    if (prev.v && i.v && prev.v !== i.v) return { ...i, set, hidden: prev.hidden };
    return { ...i, set, ar: prev.ar, hidden: prev.hidden, t: prev.t, ...(prev.label !== undefined ? { label: prev.label } : {}) };
  });
  // Under a new shared link no photo gets a key the old list used (its hearts, lists or face data).
  if (relinked) for (const o of old.items) taken.add(o.key);
  for (const it of items) if (!it.key) it.key = uniqueKey(it.ref, taken);
  const cover = old.cover && items.some((i) => i.key === old.cover) ? old.cover : items[0]?.key;
  return {
    ...fresh,
    sets,
    items: sortByTime(items, old.timeOrder !== false),
    cover,
    timeOrder: old.timeOrder,
    coverPos: old.coverPos,
    faceSearch: relinked ? undefined : old.faceSearch,
    design: old.design,
    ...(old.timesV ? { timesV: old.timesV } : {}),
    ...(old.gen ? { gen: old.gen } : {}),
  };
}

/** A photo's file as its preview is made from it: where it is and which version (P66). */
const fileOf = (i: PhotoItem) => `${i.ref}\u0000${i.v ?? ''}`;

/**
 * The gallery's generation after a folder load (fix plan P66): the same while the link is the same and every
 * photo key names the same file at the same version; else a new one, never used before in this gallery — at
 * least the clock in seconds, so a list saved meanwhile without one (an older Worker) never brings back a number
 * a browser still keeps a picture under.
 */
export function nextGen(old: PhotoData | null, next: PhotoData): number {
  const was = old?.gen ?? 0;
  if (old && old.folderUrl === next.folderUrl && old.items.length === next.items.length) {
    const before = new Map(old.items.map((i) => [i.key, fileOf(i)]));
    if (next.items.every((i) => before.get(i.key) === fileOf(i))) return was;
  }
  return Math.max(was + 1, Math.floor(Date.now() / 1000));
}

/** Dropbox makes no preview of a HEIC file or of a file over 20MB (it answers 409; the photo route 415). */
export const DROPBOX_PREVIEW_MAX_BYTES = 20 * 1024 * 1024;

/** The photos of a Dropbox list that will have no preview (fix plan P66): the studio is told when loading. */
export function withoutPreview(data: PhotoData): PhotoItem[] {
  if (data.provider !== 'dropbox' && data.provider !== 'dropbox-link') return [];
  return data.items.filter((i) => /\.(heic|heif)$/i.test(i.name) || (i.size ?? 0) > DROPBOX_PREVIEW_MAX_BYTES);
}

/** The studio's warning about those photos, or '' when there are none. */
export function withoutPreviewWarning(data: PhotoData): string {
  const missing = withoutPreview(data);
  if (!missing.length) return '';
  const names = missing.slice(0, 5).map((i) => i.name).join(', ');
  const more = missing.length > 5 ? ` ועוד ${(missing.length - 5).toLocaleString('en-US')}` : '';
  return `${missing.length.toLocaleString('en-US')} קבצים בתיקייה (HEIC או גדולים מ-20MB) יופיעו בגלריה בלי תצוגה, כי דרופבוקס לא מכין להם תצוגה מקדימה: ${names}${more}. שמרו אותם כ-JPG קטן יותר וטענו שוב.`;
}

/**
 * How many of the photos the couple or the studio chose (hearts, Instagram marks, lists, album slots:
 * `chosen`) were in the saved list and are not in the new one (fix plan P64). Keys chosen for a photo
 * that was already gone don't count.
 */
export function chosenLost(chosen: Set<string>, before: PhotoData, after: PhotoData): { lost: number; total: number } {
  const was = new Set(before.items.map((i) => i.key));
  const now = new Set(after.items.map((i) => i.key));
  let total = 0;
  let lost = 0;
  for (const k of chosen) {
    if (!was.has(k)) continue;
    total++;
    if (!now.has(k)) lost++;
  }
  return { lost, total };
}

// ---------- listing ----------

async function listDropbox(settings: Settings, env: Env, url: string): Promise<PhotoData> {
  const link = detectLink(url);
  if (!link || link.provider !== 'dropbox' || link.kind !== 'folder') throw new HttpError(400, 'זה לא קישור לתיקיית דרופבוקס');
  const token = await accessToken(settings, env);
  const own = await locateOwnFolder(token, link.canonical);
  if (own.ref && own.entries) {
    // In the connected account, read the way it was found (fix plan P64: a folder found only by its
    // id was read through the public link before, and failed). Each photo is kept by Dropbox's id,
    // which a renamed or moved folder keeps; by its path only when Dropbox gives no id.
    const found = own.ref.startsWith('id:') ? await walkOwnById(own.session, own.entries) : await listOwnByPath(own.session, own.ref);
    return buildPhotoData(link.canonical, 'dropbox', found, own.session.pathRoot);
  }
  // Someone else's folder: list through the public link, one call per folder (folders inside
  // folders too, up to 3 levels; each photo keeps its top folder's name).
  const found: Found[] = [];
  let folders = 0;
  const walk = async (path: string, top: string, depth: number) => {
    for (const e of await listEverything(token, { path, shared_link: { url: link.canonical } })) {
      if (e['.tag'] === 'file') found.push({ name: e.name, folder: top, ref: `l:${path}/${e.name}`, ...(e.size ? { size: e.size } : {}), ...versionFrom(e) });
      else if (e['.tag'] === 'folder' && depth < MAX_DEPTH) {
        if (++folders > 40) throw new HttpError(400, 'יש בתיקייה יותר מדי תיקיות פנימיות (עד 40).');
        await walk(`${path}/${e.name}`, top || e.name, depth + 1);
      }
    }
  };
  await walk('', '', 0);
  return buildPhotoData(link.canonical, 'dropbox-link', found);
}

/** A Dropbox file's version: its revision and content hash (P66). */
function versionFrom(e: Entry): { v?: string } {
  const v = fileVersion(e.rev, e.content_hash);
  return v ? { v } : {};
}

/** A Dropbox file of the connected account: its id when Dropbox gives one (and the path it had), else its path. */
function ownFile(e: Entry, folder: string): Found {
  const path = e.path_lower ? `p:${e.path_lower}` : '';
  return { name: e.name, folder, ref: e.id ? `p:${e.id}` : path, ...(e.size ? { size: e.size } : {}), ...(e.id && path ? { alt: path } : {}), ...versionFrom(e) };
}

/**
 * The connected account's folder by its path: one recursive listing. The subfolder is the part of
 * each path under the folder, counted in path parts (a team space may spell the start differently).
 */
async function listOwnByPath(session: Session, root: string): Promise<Found[]> {
  const depth = root.split('/').filter(Boolean).length;
  const entries = await listEverything(session, { path: root, recursive: true });
  return entries
    .filter((e) => e['.tag'] === 'file' && (e.id || e.path_lower))
    .map((e) => {
      const parts = (e.path_display ?? e.path_lower ?? '').split('/').filter(Boolean);
      return ownFile(e, parts.length > depth + 1 ? parts[depth] : '');
    });
}

/** The connected account's folder by its id (no usable path): folder by folder, by id, up to 3 levels. */
async function walkOwnById(session: Session, top: Entry[]): Promise<Found[]> {
  const found: Found[] = [];
  let folders = 0;
  const walk = async (entries: Entry[], folder: string, depth: number) => {
    for (const e of entries) {
      if (e['.tag'] === 'file') {
        if (e.id || e.path_lower) found.push(ownFile(e, folder));
      } else if (e['.tag'] === 'folder' && depth < MAX_DEPTH && (e.id || e.path_lower)) {
        if (++folders > 40) throw new HttpError(400, 'יש בתיקייה יותר מדי תיקיות פנימיות (עד 40).');
        await walk(await listEverything(session, { path: e.id ?? e.path_lower }), folder || e.name, depth + 1);
      }
    }
  };
  await walk(top, '', 0);
  return found;
}

async function listEverything(session: Session | string, arg: Record<string, unknown>): Promise<Entry[]> {
  const res = await call(session, 'files/list_folder', { ...arg, limit: 2000 });
  if (!res.ok) {
    const text = await res.text();
    if (/shared_link_access_denied|password/i.test(text)) throw new HttpError(400, 'הקישור מוגן בסיסמה או לא ציבורי. צריך קישור פתוח ("כל מי שיש לו את הקישור").');
    throw dropboxError(res.status, text, 'files/list_folder');
  }
  let page = (await res.json()) as { entries: Entry[]; cursor: string; has_more: boolean };
  const out = [...page.entries];
  while (page.has_more) {
    page = await api(session, 'files/list_folder/continue', { cursor: page.cursor });
    out.push(...page.entries);
  }
  return out;
}

/** How many levels of folders inside the shared folder are read (the shared folder itself is level 0). */
const MAX_DEPTH = 3;

/**
 * A public Drive folder's contents without an API key: Google's own "embedded folder view" page
 * lists every file and subfolder. Plain string search keeps it inside the free plan's CPU time.
 */
export function parseEmbeddedFolder(html: string): { id: string; name: string; folder: boolean }[] {
  const out: { id: string; name: string; folder: boolean }[] = [];
  const marker = 'class="flip-entry" id="entry-';
  let at = html.indexOf(marker);
  while (at >= 0) {
    const idStart = at + marker.length;
    const id = html.slice(idStart, html.indexOf('"', idStart));
    const next = html.indexOf(marker, idStart);
    const block = html.slice(idStart, next < 0 ? html.length : next);
    const t = block.indexOf('<div class="flip-entry-title">');
    const name = t < 0 ? '' : decodeEntities(block.slice(t + 30, block.indexOf('</div>', t + 30)));
    if (id && name) out.push({ id, name, folder: block.includes('/drive/folders/') });
    at = next;
  }
  return out;
}

async function listDriveNoKey(folderId: string, canonical: string): Promise<PhotoData> {
  const children = async (id: string) => {
    const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(id)}`, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en' } });
    if (!res.ok) throw new HttpError(400, `גוגל דרייב לא החזיר את התיקייה (${res.status}). בדוק שהתיקייה משותפת ל"כל מי שיש לו את הקישור".`);
    return parseEmbeddedFolder(await res.text());
  };
  const found: Found[] = [];
  let folders = 0;
  // Folders inside folders too (e.g. "תמונות לבחירה/My_Favorites"), up to 3 levels; each photo keeps
  // the name of the top folder it's under. The free plan allows about 50 outside calls per request.
  const walk = async (id: string, top: string, depth: number) => {
    for (const f of await children(id)) {
      if (f.folder) {
        if (depth >= MAX_DEPTH) continue;
        if (++folders > 40) throw new HttpError(400, 'יש בתיקייה יותר מדי תיקיות פנימיות (עד 40).');
        await walk(f.id, top || f.name, depth + 1);
      } else found.push({ name: f.name, folder: top, ref: `g:${f.id}` });
    }
  };
  await walk(folderId, '', 0);
  if (found.length === 0) throw new HttpError(400, 'לא ראיתי קבצים בתיקייה. בדוק שהיא משותפת ל"כל מי שיש לו את הקישור" (Viewer).');
  return buildPhotoData(canonical, 'gdrive', found);
}

async function listDrive(settings: Settings, url: string, origin: string): Promise<PhotoData> {
  const link = detectLink(url);
  if (!link || link.provider !== 'gdrive' || link.kind === 'file') throw new HttpError(400, 'זה לא קישור לתיקייה בגוגל דרייב');
  if (!settings.googleApiKey) return listDriveNoKey(link.id, link.canonical);
  type DriveFile = { id: string; name: string; mimeType: string; modifiedTime?: string; md5Checksum?: string; size?: string };
  const listChildren = async (parent: string) => {
    const files: DriveFile[] = [];
    let pageToken = '';
    do {
      const u = new URL('https://www.googleapis.com/drive/v3/files');
      u.searchParams.set('q', `'${parent}' in parents and trashed = false`);
      u.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,modifiedTime,md5Checksum,size)');
      u.searchParams.set('pageSize', '1000');
      u.searchParams.set('supportsAllDrives', 'true');
      u.searchParams.set('includeItemsFromAllDrives', 'true');
      u.searchParams.set('key', settings.googleApiKey);
      if (pageToken) u.searchParams.set('pageToken', pageToken);
      const res = await fetch(u, { headers: { Referer: `${origin}/` } });
      if (!res.ok) throw new HttpError(400, `גוגל דרייב לא החזיר את רשימת הקבצים (${res.status}). בדוק שהתיקייה משותפת ל"כל מי שיש לו את הקישור".`);
      const page = (await res.json()) as { files: DriveFile[]; nextPageToken?: string };
      files.push(...page.files);
      pageToken = page.nextPageToken ?? '';
    } while (pageToken);
    return files;
  };
  const FOLDER = 'application/vnd.google-apps.folder';
  const found: Found[] = [];
  let folders = 0;
  const walk = async (id: string, top: string, depth: number) => {
    for (const f of await listChildren(id)) {
      if (f.mimeType === FOLDER) {
        if (depth >= MAX_DEPTH) continue;
        if (++folders > 40) throw new HttpError(400, 'יש בתיקייה יותר מדי תיקיות פנימיות (עד 40).');
        await walk(f.id, top || f.name, depth + 1);
        // What Google says the file is, not only its name: "photo.jpg" that is really an SVG stays out.
      } else if (SAFE_IMAGE_TYPE.test(f.mimeType)) {
        const v = fileVersion(f.modifiedTime, f.md5Checksum);
        const size = Number(f.size);
        found.push({ name: f.name, folder: top, ref: `g:${f.id}`, ...(size > 0 ? { size } : {}), ...(v ? { v } : {}) });
      }
    }
  };
  await walk(link.id, '', 0);
  return buildPhotoData(link.canonical, 'gdrive', found);
}

/** Demo folder for tests and the local preview: 30 photos in 3 subfolders (or a teaser layout). */
function mockPhotos(url: string, provider: PhotoData['provider'] = 'mock'): PhotoData {
  const found: Found[] = [];
  if (url.includes('mock=top')) {
    // A photographer's folder, plus the teaser in "טופ1" and the same photos again (small) in "טופ2".
    for (let i = 1; i <= 20; i++) {
      const n = String(i).padStart(2, '0');
      found.push({ name: `IMG_${n}.jpg`, folder: 'שיר ועומר 1', ref: `m:/demo/photos/${n}.jpg` });
    }
    for (let i = 21; i <= 25; i++) {
      found.push({ name: `T-${i}.jpg`, folder: 'שיר ועומר טופ1', ref: `m:/demo/photos/${i}.jpg` });
      found.push({ name: `T-${i}.jpg`, folder: 'שיר ועומר טופ2', ref: `m:/demo/photos/${i + 5}.jpg` });
    }
    return buildPhotoData(url, provider, found);
  }
  const folders = ['01 התארגנות', '02 צילומי חוץ', '03 מסיבה'];
  for (let i = 1; i <= 30; i++) {
    const n = String(i).padStart(2, '0');
    found.push({ name: `IMG_${n}.jpg`, folder: folders[Math.floor((i - 1) / 10)], ref: `m:/demo/photos/${n}.jpg` });
  }
  return buildPhotoData(url, provider, found);
}

/** pCloud: the whole folder comes in one call; first-level subfolders are the folders. */
async function listPcloud(canonical: string): Promise<PhotoData> {
  const root = await pcloudTree(canonical);
  if (!root.isfolder) throw new HttpError(400, 'זה קישור לקובץ בודד. צריך קישור לתיקייה ב-pCloud.');
  const found: Found[] = [];
  const walk = (items: PcloudItem[] | undefined, folder: string, depth: number) => {
    for (const it of items ?? []) {
      if (it.isfolder) {
        if (depth < 4) walk(it.contents, folder || it.name, depth + 1);
      } else if (it.fileid) {
        const v = fileVersion(it.hash === undefined ? undefined : String(it.hash), it.size);
        found.push({ name: it.name, folder, ref: `c:${it.fileid}`, ...(it.size ? { size: it.size } : {}), ...(v ? { v } : {}) });
      }
    }
  };
  walk(root.contents, '', 0);
  return buildPhotoData(canonical, 'pcloud', found);
}

export async function listPhotos(env: Env, settings: Settings, url: string, origin: string): Promise<PhotoData> {
  const link = detectLink(url);
  if (!link) throw new HttpError(400, 'הקישור לא מזוהה. אפשר להדביק תיקייה מדרופבוקס, מגוגל דרייב או מ-pCloud.');
  if (link.provider === 'myairbridge') throw new HttpError(400, 'גלריות תמונות עובדות עם דרופבוקס, גוגל דרייב ו-pCloud. MyAirBridge נתמך רק לסרטים.');
  if (link.kind === 'file') throw new HttpError(400, 'זה קישור לקובץ בודד. צריך קישור לתיקייה עם התמונות.');
  if (env.CLOUD_MOCK) return mockPhotos(link.canonical, link.provider === 'pcloud' ? 'pcloud' : 'mock');
  if (link.provider === 'pcloud') return listPcloud(link.canonical);
  return link.provider === 'gdrive' ? listDrive(settings, url, origin) : listDropbox(settings, env, url);
}

/**
 * Studio edits: sets, per-photo set/hidden/shape/time/label, cover, order. Keys that don't exist are
 * ignored. A key two photos share (a list saved before P64) is not edited — which of the two was
 * meant can't be known; it is added to `notes.ambiguous`, and loading the folder again parts them.
 * `t: null` removes a time (one that was not read from the file); `timesV: 2` marks times read the
 * P64 way (every time in the list came from the file itself).
 */
export function applyPhotoEdits(
  data: PhotoData,
  input: { sets?: unknown; items?: unknown; cover?: unknown; timeOrder?: unknown; coverPos?: unknown; faceSearch?: unknown; design?: unknown; timesV?: unknown },
  notes: { ambiguous: string[] } = { ambiguous: [] },
): PhotoData {
  const next: PhotoData = { ...data, items: data.items.map((i) => ({ ...i })) };
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const it of next.items) (seen.has(it.key) ? shared : seen).add(it.key);
  const refuse = (key: string) => {
    if (!notes.ambiguous.includes(key)) notes.ambiguous.push(key);
  };
  if (input.timesV === 2) next.timesV = 2;
  if (typeof input.faceSearch === 'boolean') next.faceSearch = input.faceSearch;
  // null = back to the studio's default look.
  if (input.design === null) delete next.design;
  else if (input.design !== undefined) next.design = cleanDesign(input.design);
  if (typeof input.timeOrder === 'boolean') {
    next.timeOrder = input.timeOrder;
    next.items = sortByTime(next.items, input.timeOrder);
  }
  if (input.coverPos && typeof input.coverPos === 'object') {
    const c = input.coverPos as { x?: unknown; y?: unknown };
    const x = Number(c.x),
      y = Number(c.y);
    if (Number.isFinite(x) && Number.isFinite(y)) next.coverPos = { x: Math.round(Math.max(0, Math.min(100, x))), y: Math.round(Math.max(0, Math.min(100, y))) };
  }
  if (Array.isArray(input.sets)) {
    next.sets = input.sets
      .slice(0, 40)
      .map((s, i) => ({ id: String((s as PhotoSet)?.id || `s${Date.now()}${i}`).slice(0, 40), name: String((s as PhotoSet)?.name ?? '').trim().slice(0, 40) }))
      .filter((s) => s.name);
    const valid = new Set(next.sets.map((s) => s.id));
    for (const it of next.items) if (it.set && !valid.has(it.set)) it.set = undefined;
  }
  if (input.items && typeof input.items === 'object') {
    const byKey = new Map(next.items.map((i) => [i.key, i]));
    const valid = new Set(next.sets.map((s) => s.id));
    for (const [key, patch] of Object.entries(input.items as Record<string, Partial<PhotoItem>>)) {
      const it = byKey.get(key);
      if (!it || !patch) continue;
      if (shared.has(key)) {
        refuse(key);
        continue;
      }
      if ('set' in patch) it.set = patch.set && valid.has(patch.set) ? patch.set : undefined;
      if ('hidden' in patch) it.hidden = Boolean(patch.hidden) || undefined;
      if ('ar' in patch) {
        const ar = Number(patch.ar);
        if (ar > 0.2 && ar < 5) it.ar = Math.round(ar * 1000) / 1000;
      }
      if ('t' in patch && patch.t === null) delete it.t;
      else if ('t' in patch) {
        const t = Number(patch.t);
        // 1990–2100: anything else is a camera without its clock set.
        if (t > 631152000000 && t < 4102444800000) it.t = Math.round(t);
      }
      if ('label' in patch) it.label = String(patch.label ?? '').slice(0, 30);
    }
    next.items = sortByTime(next.items, next.timeOrder !== false);
  }
  if (typeof input.cover === 'string' && shared.has(input.cover)) refuse(input.cover);
  else if (typeof input.cover === 'string' && next.items.some((i) => i.key === input.cover)) next.cover = input.cover;
  return next;
}

/**
 * The one way the Worker changes a photo list: read it with its version, apply `change`, save only if
 * nobody saved in between. On a clash it reads again and re-applies (3 tries), then 409. `change` must
 * be a patch that can run again on a newer list (no outside calls inside it). Fix plan P60.
 * P61: the first try may take the list this Worker already holds at the gallery's version (photoDoc); later
 * tries read it again. `how: 'patch'` (the studio's edits) writes only what changed (diffPhotoData →
 * store.patchPhotos, which also sets the photo count and the cover key: `patched`); nothing changed → nothing
 * is written (`unchanged`). A list a patch can't express (two photos sharing a key, from before P64) and
 * `how: 'whole'` (loading the folder) are saved whole.
 */
export async function editPhotos(
  store: Store,
  g: Gallery,
  change: (data: PhotoData | null) => PhotoData,
  how: 'whole' | 'patch' = 'whole',
): Promise<{ before: PhotoData | null; data: PhotoData; patched?: PatchedPhotos; unchanged?: boolean }> {
  let seen = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = attempt === 0 ? await photoDoc(store, g) : await store.getPhotosVersioned(g.id);
    // The list was there and now is gone: the gallery was removed meanwhile. Never bring it back.
    if (seen && !current) throw new HttpError(404, 'הגלריה לא נמצאה');
    seen = seen || Boolean(current);
    const data = change(current ? current.data : null);
    const diff = current && how === 'patch' ? diffPhotoData(current.data, data) : null;
    if (current && diff) {
      if (!Object.keys(diff.items).length && !diff.order && !Object.keys(diff.fields).length) return { before: current.data, data, unchanged: true };
      const patched = await store.patchPhotos(g.tenantId, g.id, current.version, diff);
      if (!patched) throw new HttpError(404, 'הגלריה לא נמצאה');
      if (patched !== 'conflict') return { before: current.data, data, patched };
      continue;
    }
    if (await store.savePhotos(g.tenantId, g.id, data, current ? current.version : null)) return { before: current?.data ?? null, data };
  }
  throw new HttpError(409, 'מישהו אחר שמר את התמונות של הגלריה באותו רגע. רעננו את הדף ונסו שוב.');
}

/** A photo gallery's cover picture: the chosen one while shown, else the first shown photo (SQL: films_photo_cover, 0130). */
export function coverOf(data: PhotoData): string {
  const shown = data.items.filter((i) => !i.hidden);
  return data.cover && shown.some((i) => i.key === data.cover) ? data.cover : (shown[0]?.key ?? '');
}

// ---------- the list in this Worker's memory (fix plan P61) ----------

/** Lists kept, the most recently used last (a Map keeps insertion order). At most 20,000 photos each. */
const DOCS_KEPT = 4;
const docs = new Map<string, { version: number; data: PhotoData }>();

function freeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v)) freeze(x);
  }
  return v;
}

/**
 * A gallery's photo list with its version, parsed once per version in this Worker: kept for the version the
 * gallery row (read in this request) names, so a list saved since is never served. At most DOCS_KEPT lists.
 * Frozen: a caller that wants to change it makes a copy (applyPhotoEdits, mergePhotoData do). null = no list.
 */
export async function photoDoc(store: Store, g: Gallery): Promise<{ data: PhotoData; version: number } | null> {
  const kept = docs.get(g.id);
  if (kept && g.photosVersion !== undefined && kept.version === g.photosVersion) {
    docs.delete(g.id);
    docs.set(g.id, kept);
    return kept;
  }
  const read = await store.getPhotosVersioned(g.id);
  if (!read) {
    docs.delete(g.id);
    return null;
  }
  const doc = { version: read.version, data: freeze(read.data) };
  docs.delete(g.id);
  docs.set(g.id, doc);
  while (docs.size > DOCS_KEPT) docs.delete(docs.keys().next().value!);
  return doc;
}

/** Test helper: forget every kept list. */
export function forgetPhotoDocs(): void {
  docs.clear();
}

/** Whether a photo is hidden as the database reads it (films_photo_cover: any value but false / null / 0 / ''). */
const hiddenIn = (i: PhotoItem | undefined) => Boolean(i?.hidden);

/** Two photos with the same fields (every field of a photo is a plain value; undefined = not there). */
function sameItem(a: PhotoItem, b: PhotoItem): boolean {
  const fa = Object.entries(a).filter(([, v]) => v !== undefined);
  const fb = Object.entries(b).filter(([, v]) => v !== undefined);
  return fa.length === fb.length && fa.every(([k, v]) => (b as unknown as Record<string, unknown>)[k] === v);
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * What an edit changed between the list before and after it (fix plan P61; applyPhotoEdits itself is
 * unchanged): the photos that differ (whole, by key), the order only when it changed, the edit fields that
 * changed (null = removed). null when a patch can't say it — two photos share a key (a list from before
 * P64), photos were added or removed, or another field changed: then the list is saved whole.
 */
export function diffPhotoData(before: PhotoData, after: PhotoData): PhotoDiff | null {
  const keys = before.items.map((i) => i.key);
  const nextKeys = after.items.map((i) => i.key);
  const had = new Set(keys);
  if (had.size !== keys.length || new Set(nextKeys).size !== nextKeys.length || nextKeys.length !== keys.length || nextKeys.some((k) => !had.has(k))) return null;
  const edit = new Set<string>(PHOTO_EDIT_FIELDS);
  for (const f of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (f !== 'items' && !edit.has(f) && !sameValue((before as unknown as Record<string, unknown>)[f], (after as unknown as Record<string, unknown>)[f])) return null;
  }
  const was = new Map(before.items.map((i) => [i.key, i]));
  const items: Record<string, PhotoItem> = {};
  for (const it of after.items) if (!sameItem(was.get(it.key)!, it)) items[it.key] = it;
  const fields: PhotoDiff['fields'] = {};
  for (const f of PHOTO_EDIT_FIELDS) {
    const a = (before as unknown as Record<string, unknown>)[f];
    const b = (after as unknown as Record<string, unknown>)[f];
    if (!sameValue(a, b)) fields[f] = b ?? null;
  }
  return { items, order: nextKeys.every((k, n) => k === keys[n]) ? null : nextKeys, fields };
}

/**
 * The list after a patch, as films_photos_patch (0131) writes it — MemoryStore's copy of that function, also
 * used by the tests to check that before + diffPhotoData(before, after) = after. Throws on a patch that
 * doesn't fit the list (the database refuses those too).
 */
export function applyPhotoDiff(data: PhotoData, diff: PhotoDiff): PhotoData {
  const keys = data.items.map((i) => i.key);
  const had = new Set(keys);
  if (had.size !== keys.length) throw new HttpError(400, 'two photos share a key; save the list whole');
  for (const [k, it] of Object.entries(diff.items)) if (!had.has(k) || !it || typeof it !== 'object' || it.key !== k) throw new HttpError(400, `photo ${k} is not in the list`);
  for (const f of Object.keys(diff.fields)) if (!(PHOTO_EDIT_FIELDS as readonly string[]).includes(f)) throw new HttpError(400, `${f} is not an edit field`);
  let items = data.items.map((i) => diff.items[i.key] ?? i);
  if (diff.order) {
    const pos = new Map(diff.order.map((k, n) => [k, n]));
    if (diff.order.length !== keys.length || pos.size !== keys.length || keys.some((k) => !pos.has(k))) throw new HttpError(400, "the order is not the list's photos");
    items = [...items].sort((a, b) => pos.get(a.key)! - pos.get(b.key)!);
  }
  const next: Record<string, unknown> = { ...data };
  for (const [f, v] of Object.entries(diff.fields)) {
    if (v === null || v === undefined) delete next[f];
    else next[f] = v;
  }
  next.items = items;
  // As the database keeps it (JSON): a field set to undefined is not there.
  return JSON.parse(JSON.stringify(next)) as PhotoData;
}

/** Whether a patch hides or shows a photo, or points one at another file (films_photos_patch raises the visible version then). */
export function patchChangesShown(data: PhotoData, diff: PhotoDiff): boolean {
  const was = new Map(data.items.map((i) => [i.key, i]));
  return Object.entries(diff.items).some(([k, it]) => hiddenIn(was.get(k)) !== hiddenIn(it) || was.get(k)?.ref !== it.ref);
}

/** What the couple receives: no file locations, hidden photos left out. `viewId` is the address the couple uses. */
/** What a photo answers while the studio's Dropbox is disconnected, and the couple's page says (P65). */
export const CLOUD_OFF_WORDS = 'התמונות לא זמינות כרגע: החיבור של הסטודיו לאחסון התמונות נותק. פנו לסטודיו.';

/** A photo list read through the studio's Dropbox connection (its photos stop when it is disconnected, P65). */
export const readsThroughDropbox = (data: Pick<PhotoData, 'provider'> | null | undefined) => data?.provider === 'dropbox' || data?.provider === 'dropbox-link';

export function publicPhotos(viewId: string, data: PhotoData) {
  const shown = data.items.filter((i) => !i.hidden);
  const used = new Set(shown.map((i) => i.set).filter(Boolean));
  return {
    sets: data.sets.filter((s) => used.has(s.id)),
    items: shown.map((i) => ({ key: i.key, name: i.name, set: i.set ?? '', ar: i.ar ?? 1.5 })),
    cover: data.cover && shown.some((i) => i.key === data.cover) ? data.cover : (shown[0]?.key ?? ''),
    coverPos: data.coverPos ?? { x: 50, y: 50 },
    base: photoBase(viewId, data.gen),
    recommended: RECOMMENDED,
    faceSearch: data.faceSearch === true,
  };
}

// ---------- hearts ----------

/** A name as the couple typed it ("מאי", "אמא"), short and tidy. */
export function cleanWho(input: unknown): string {
  return String(input ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30);
}

/**
 * Hearts and Instagram marks of the photos in the gallery's list (fix plan P70), in the order they were given:
 * the couple sees only those of photos they can see, the studio (`includeHidden`) those of every photo in the
 * list, hidden ones too. A heart on a photo no longer in the list (it left the folder) stays in the database
 * (decision D16(3): it may come back with 'טען') but is shown to no one and counted nowhere.
 */
export function heartsFor(
  data: PhotoData | null,
  favBy: Record<string, string[]>,
  insta: string[],
  opts: { includeHidden?: boolean } = {},
): { favBy: Record<string, string[]>; insta: string[] } {
  const keys = new Set((data?.items ?? []).filter((i) => opts.includeHidden || !i.hidden).map((i) => i.key));
  return {
    favBy: Object.fromEntries(Object.entries(favBy).filter(([k]) => keys.has(k))),
    insta: insta.filter((k) => keys.has(k)),
  };
}

/** The couple's favourites, in the order they were first hearted: every photo someone still hearts. */
export function favoritesFrom(favBy: Record<string, string[]>): string[] {
  return Object.keys(favBy);
}

/** Text shown to the couple next to the heart counter. */
export function favoritesMessage(count: number, recommended = RECOMMENDED): { level: 'under' | 'reached' | 'over'; text: string } {
  if (count > recommended) return { level: 'over', text: `בחרתם ${count} · מעבר ל-${recommended} תמונות ייתכן חיוב בדפים נוספים` };
  if (count === recommended) return { level: 'reached', text: `בחרתם ${count} · הגעתם להמלצה לאלבום` };
  return { level: 'under', text: `בחרתם ${count} · מומלץ ${recommended} לאלבום` };
}

// ---------- images ----------

const escapeHtml = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * A download opened as its own page (?dl=1) that could not be sent: a short page with the reason
 * and a way back to the gallery, instead of a bare error (P72).
 */
export function downloadFailedPage(status: number, message: string, back: string): Response {
  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ההורדה לא הצליחה</title>
<style>body{font-family:system-ui,sans-serif;background:#111;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;text-align:center}a{display:inline-block;margin-top:16px;padding:10px 18px;border-radius:999px;background:#eee;color:#111;text-decoration:none}</style></head>
<body><main><h1>ההורדה לא הצליחה</h1><p>${escapeHtml(message)}</p><a href="${escapeHtml(back)}">חזרה לגלריה</a></main></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

/**
 * Cloudflare's edge cache (typed loosely because the browser DOM types also define `caches`); null where there
 * is none (unit tests without it), and then nothing is cached.
 */
export const edge = (): Cache | null => (typeof caches === 'undefined' ? null : (caches as unknown as { default: Cache }).default);

/** Previews: m for the grid, md for sharp screens and big cells, l for full screen. */
const SIZES = {
  m: { dbx: 'w640h480', drive: 'w800', pcloud: '640x480' },
  md: { dbx: 'w1024h768', drive: 'w1200', pcloud: '1024x768' },
  l: { dbx: 'w2048h1536', drive: 'w2048', pcloud: '2048x1024' },
} as const;
export type PhotoSize = 'm' | 'md' | 'l' | 'full';

/**
 * A photo is only ever a picture: a known image type (else image/jpeg), shown inline or saved,
 * and a policy that forbids it any script, style or frame even if a browser opened it as a page.
 */
function asPicture(headers: Headers, download: boolean, name: string): Headers {
  const type = (headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  headers.set('Content-Type', SAFE_IMAGE_TYPE.test(type) ? type : 'image/jpeg');
  headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
  if (download) {
    const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
    headers.set('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  } else headers.set('Content-Disposition', 'inline');
  return headers;
}

/** The edge-cache key's versions: the gallery's visible version (P61) and its generation (P66). */
export interface CacheVersion {
  visible: number;
  gen: number;
}

/**
 * A preview's place in the edge cache: per gallery (two studios' clouds can hold files at the same path), per
 * visible version (P61, 0131: it goes up whenever a photo is hidden or shown again, or the folder is loaded, so a
 * photo hidden since was never cached under the version a request reads now) and per generation (P66: it goes up
 * when the folder's link or a photo's file changed, so another couple's or an older file is never served), and
 * per preview size.
 */
function previewCacheKey(galleryId: string, key: string, size: PhotoSize, at: CacheVersion): Request {
  return new Request(`https://photo-cache.internal/${galleryId}/${encodeURIComponent(key)}/${size}/v${Math.floor(at.visible)}/g${Math.floor(at.gen)}`);
}

/** Only previews shown on a page go to the edge cache; "full quality" and saved files never do. */
export const cachedSize = (size: PhotoSize, download: boolean) => size !== 'full' && !download;

/**
 * How long a browser keeps a preview (P66): a year for an address with the gallery's current generation (it
 * changes when the file does), a day for any other address (links shared before, an older generation).
 */
export const previewCacheControl = (current: boolean) => (current ? 'public, max-age=31536000, immutable' : 'public, max-age=86400');

/** An error answer no browser or cache keeps. */
const failure = (status: number, message: string) => new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

/**
 * A preview already at the edge, under the versions of the gallery row read in this request. Only visible photos
 * are ever put there (photoResponse), so a hit is a photo the public may see at that version. `current`: the
 * address asked has the current generation (the browser may keep it a year).
 */
export async function cachedPreview(galleryId: string, key: string, size: PhotoSize, at: CacheVersion, current = true): Promise<Response | null> {
  const hit = await Promise.resolve(edge()?.match(previewCacheKey(galleryId, key, size, at))).catch(() => undefined);
  if (!hit) return null;
  // Previews cached before these rules came in get them on the way out too.
  const headers = asPicture(new Headers(hit.headers), false, '');
  headers.set('Cache-Control', previewCacheControl(current));
  return new Response(hit.body, { status: hit.status, headers });
}

export interface PhotoOptions {
  /** "Full quality" may send a larger copy the studio hid (the studio's own screens and the print shop only). */
  includeHidden?: boolean;
  /** The versions the photo was read with: its edge-cache key. Not given = no edge cache. */
  cache?: CacheVersion;
  /** The address asked has the gallery's current generation (P66); false = a browser keeps it a day. */
  current?: boolean;
  /** The Worker's waitUntil: the edge-cache write runs after the photo was sent (P66). Not given = awaited. */
  waitUntil?: (p: Promise<unknown>) => void;
}

/**
 * Previews and originals. Previews are cached in the browser (a year for the current generation's address, else a
 * day) and at the edge (per gallery, visible version and generation, `opts.cache`). The caller checked access and
 * that the photo may be seen BEFORE this. A hidden photo (the studio's screens, the print shop) is never read from
 * or put in the edge cache (P61): the public would get it from there. `settings` may be a loader: it runs only when
 * the cloud needs it (Dropbox), so a cached preview, and any Drive or pCloud photo, reads no settings (P62, P61).
 * What the cloud sends is a picture or an error that is kept nowhere (P66): a sign-in page or a JSON error is a
 * 502, a photo Dropbox makes no preview of (HEIC, over 20MB) a 415.
 */
export async function photoResponse(env: Env, settings: Settings | (() => Promise<Settings>), data: PhotoData, item: PhotoItem, size: PhotoSize, request: Request, download: boolean, galleryId: string, opts: PhotoOptions = {}): Promise<Response> {
  // The same photo is sometimes in two folders (a full export and a small copy, e.g. "טופ2"):
  // "full quality" always sends the largest one.
  if (size === 'full') item = await largestCopy(data, item, opts.includeHidden === true);
  const current = opts.current !== false;
  const cacheKey = opts.cache !== undefined && cachedSize(size, download) && !item.hidden ? previewCacheKey(galleryId, item.key, size, opts.cache) : null;
  if (cacheKey) {
    const hit = await cachedPreview(galleryId, item.key, size, opts.cache!, current);
    if (hit) return hit;
  }
  // A Dropbox photo while the studio's Dropbox is disconnected (P65): said plainly, for the couple too — not the
  // studio's "connect in the settings", and not "try again in a few minutes".
  const kind = item.ref.slice(0, 2);
  if (kind === 'p:' || kind === 'l:') {
    const s = typeof settings === 'function' ? await settings() : settings;
    settings = s;
    if (!s.dropbox.refreshToken) {
      if (download) throw new HttpError(503, CLOUD_OFF_WORDS);
      return failure(503, CLOUD_OFF_WORDS);
    }
  }
  const upstream = await fetchImage(env, settings, data, item, size, request);
  const type = (upstream.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  // A preview is always a picture; an original may come as a plain file (octet-stream), but never as a page or JSON.
  const notPicture = size === 'full' ? /^text\/|json|html|javascript/.test(type) : !type.startsWith('image/');
  if ((!upstream.ok && upstream.status !== 206) || notPicture) {
    // The cloud's own error text stays in the log (it can hold paths or account details), never goes out.
    console.error(`[photos] ${galleryId}/${item.key} ${size}: the cloud answered ${upstream.status} ${type || '(no type)'}`);
    await upstream.body?.cancel().catch(() => {});
    const noPreview = upstream.status === 415;
    const message = noPreview ? 'לתמונה הזו אין תצוגה מקדימה (HEIC או קובץ גדול מ-20MB). אפשר להוריד אותה באיכות מלאה.' : 'התמונה לא זמינה כרגע. נסו שוב בעוד כמה דקות.';
    // A saved download: the route answers with a page and a way back (downloadFailedPage).
    if (download) throw new HttpError(noPreview ? 415 : 502, message);
    return failure(noPreview ? 415 : 502, message);
  }
  const headers = new Headers();
  for (const h of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges']) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set('Cache-Control', cachedSize(size, download) && !item.hidden ? previewCacheControl(current) : 'private, max-age=3600');
  asPicture(headers, download, item.name);
  const res = new Response(upstream.body, { status: upstream.status, headers });
  const cache = edge();
  if (cacheKey && cache && res.body) {
    const [a, b] = res.body.tee();
    // At the edge always under the current generation's rules (the key has the versions).
    const kept = new Headers(headers);
    kept.set('Cache-Control', previewCacheControl(true));
    const saving = cache.put(cacheKey, new Response(b, { status: 200, headers: kept })).catch(() => {});
    // The photo goes out now; the copy is written while it does (P66).
    if (opts.waitUntil) opts.waitUntil(saving);
    else await saving;
    return new Response(a, { status: res.status, headers });
  }
  return res;
}

/** Where a photo's original can be fetched directly (Drive; others: null). */
function originalUrl(it: PhotoItem): string | null {
  if (it.ref.startsWith('g:')) return driveDownload(it.ref.slice(2));
  return null;
}

/**
 * The first 64KB of a file: when it was taken, and (from Content-Range) how big the whole file is.
 * Where the file can't be read directly, the saved time — only when `trusted` (times read from the
 * files themselves, timesV 2): an older list may hold times made up for photos that had none.
 */
async function probe(it: PhotoItem, trusted: boolean): Promise<{ t: number | null; size: number }> {
  const url = originalUrl(it);
  if (!url) return { t: trusted ? (it.t ?? null) : null, size: it.size ?? 0 };
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-65535' } });
    const size = Number(/\/(\d+)$/.exec(r.headers.get('Content-Range') ?? '')?.[1]) || Number(r.headers.get('Content-Length')) || 0;
    const head = new Uint8Array(await r.arrayBuffer()).subarray(0, 65536);
    return { t: exifTakenAt(head), size };
  } catch {
    return { t: null, size: 0 };
  }
}

const sameShape = (a: PhotoItem, b: PhotoItem) => !a.ar || !b.ar || Math.abs(a.ar - b.ar) < 0.03;
const hasSubSeconds = (t: number | null | undefined): t is number => typeof t === 'number' && t % 1000 !== 0;

/**
 * The same photo is sometimes in two or three folders (a full export and a small copy, e.g.
 * "טופ2"). "Full quality" sends the largest copy. Copies are found by the exact moment they were
 * taken (to the millisecond) — or, when times weren't read yet, by the same file name in another
 * folder, confirmed from the files' own capture times. Never a different photo. Saved times count
 * only in a list whose times were all read from the files (`timesV` 2, fix plan P64): before it, a
 * photo without a time got the time of the one before it plus 1ms, so two different photos could
 * look like copies.
 */
export async function largestCopy(data: PhotoData, item: PhotoItem, includeHidden = false): Promise<PhotoItem> {
  // A copy the studio hid is not sent to someone who may not see it (P67).
  const pool = includeHidden ? data.items : data.items.filter((i) => !i.hidden || i.key === item.key);
  const trusted = data.timesV === 2;
  let copies: PhotoItem[] = [];
  let itemT = item.t;
  if (trusted && hasSubSeconds(item.t)) copies = pool.filter((i) => i.t === item.t && sameShape(i, item));
  if (copies.length < 2) {
    const lower = item.name.toLowerCase();
    const named = pool.filter((i) => i !== item && i.key !== item.key && i.name.toLowerCase() === lower && sameShape(i, item)).slice(0, 3);
    if (named.length === 0) return item;
    const [mine, ...theirs] = await Promise.all([probe(item, trusted), ...named.map((c) => probe(c, trusted))]);
    itemT = mine.t ?? undefined;
    if (!hasSubSeconds(itemT)) return item;
    const confirmed = named.filter((_, k) => theirs[k].t === itemT);
    if (confirmed.length === 0) return item;
    const all = [{ c: item, n: mine.size }, ...confirmed.map((c) => ({ c, n: theirs[named.indexOf(c)].size }))];
    const best = all.sort((x, y) => y.n - x.n)[0];
    return best.c === item ? item : { ...best.c, name: item.name };
  }
  const sized = await Promise.all(copies.slice(0, 4).map(async (c) => ({ c, n: c.size || (await probe(c, trusted)).size })));
  const best = sized.sort((x, y) => y.n - x.n)[0];
  return best && best.n > 0 ? { ...best.c, name: item.name } : item;
}

/** A public Drive file's original, without an API key (also skips the "can't scan for viruses" page). */
export function driveDownload(id: string): string {
  return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
}

/** The first bytes of a photo's original, from any cloud (for capture time and colour label). */
export function fetchOriginalStart(env: Env, settings: Settings, data: PhotoData, item: PhotoItem, origin: string, bytes = 65536): Promise<Response> {
  return fetchImage(env, settings, data, item, 'full', new Request(`${origin}/`, { headers: { Range: `bytes=0-${bytes - 1}` } }));
}

/**
 * The photo from its cloud. `settings` may be a loader: only Dropbox needs the studio's settings (its
 * connection); Drive's key is the platform's own (settingsFrom takes it from the Worker's secrets).
 */
async function fetchImage(env: Env, settingsOrLoader: Settings | (() => Promise<Settings>), data: PhotoData, item: PhotoItem, size: PhotoSize, request: Request): Promise<Response> {
  const kind = item.ref.slice(0, 2);
  const where = item.ref.slice(2);
  if (kind === 'm:') {
    // Demo photos (tests and local previews only).
    if (!env.CLOUD_MOCK) return new Response('', { status: 404 });
    const origin = new URL(request.url).origin;
    return env.ASSETS.fetch(new Request(`${origin}${where}`, { headers: request.headers }));
  }
  if (kind === 'c:') {
    // pCloud: its own previews (height at most 1024), the original through us.
    if (!/^\d{1,20}$/.test(where)) return new Response('', { status: 404 });
    if (size === 'full') return pcloudFile(data.folderUrl, where, request.headers.get('Range'));
    return pcloudThumb(data.folderUrl, where, SIZES[size].pcloud);
  }
  if (kind === 'g:') {
    if (!/^[A-Za-z0-9_-]{10,}$/.test(where)) return new Response('', { status: 404 });
    if (size === 'full') {
      const range: Record<string, string> = request.headers.get('Range') ? { Range: request.headers.get('Range')! } : {};
      const googleApiKey = typeof settingsOrLoader === 'function' ? (env.GOOGLE_API_KEY ?? '') : settingsOrLoader.googleApiKey;
      if (!googleApiKey) return fetch(driveDownload(where), { headers: range, redirect: 'follow' });
      const u = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(where)}?alt=media&key=${encodeURIComponent(googleApiKey)}`;
      return fetch(u, { headers: { Referer: `${new URL(request.url).origin}/`, ...range } });
    }
    return fetch(`https://drive.google.com/thumbnail?id=${encodeURIComponent(where)}&sz=${SIZES[size].drive}`, { redirect: 'follow' });
  }
  if (kind !== 'p:' && kind !== 'l:') return new Response('', { status: 404 });
  // Dropbox: the studio's connection.
  const settings = typeof settingsOrLoader === 'function' ? await settingsOrLoader() : settingsOrLoader;
  const range = request.headers.get('Range');
  let endpoint: string;
  let arg: unknown;
  if (size === 'full') {
    endpoint = kind === 'p:' ? 'files/download' : 'sharing/get_shared_link_file';
    arg = kind === 'p:' ? { path: where } : { url: data.folderUrl, path: where };
  } else {
    const resource = kind === 'p:' ? { '.tag': 'path', path: where } : { '.tag': 'link', url: data.folderUrl, path: where };
    endpoint = 'files/get_thumbnail_v2';
    arg = { resource, format: 'jpeg', size: SIZES[size].dbx, mode: 'fitone_bestfit' };
  }
  const send = (token: string) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Dropbox-API-Arg': apiArg(arg) };
    if (data.pathRoot) headers['Dropbox-API-Path-Root'] = JSON.stringify({ '.tag': 'root', root: data.pathRoot });
    if (size === 'full' && range) headers.Range = range;
    // Dropbox asks us to slow down when a grid loads many previews at once: retryBusy waits once and retries.
    return retryBusy(() => fetch(`https://content.dropboxapi.com/2/${endpoint}`, { method: 'POST', headers }));
  };
  const token = await accessToken(settings, env);
  const res = await send(token);
  // No preview of this file (HEIC, over 20MB, a type Dropbox can't draw): 415, kept nowhere (P66).
  if (res.status === 409 && size !== 'full') {
    const text = await res.text().catch(() => '');
    if (/unsupported_extension|unsupported_image|conversion_error/.test(text)) return new Response(text, { status: 415 });
    return new Response(text, { status: 409 });
  }
  if (res.status !== 401) return res;
  const text = await res.text().catch(() => '');
  // The connection lacks a permission: a new token won't help, the studio has to reconnect.
  if (/missing_scope/.test(text)) return new Response(text, { status: 401 });
  // A rejected token (expired, revoked): drop it if it is still the cached one, and try once more.
  await forgetAccessToken(env, settings, token);
  return send(await accessToken(settings, env));
}
