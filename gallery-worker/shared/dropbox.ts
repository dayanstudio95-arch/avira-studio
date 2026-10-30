// Shared between the browser UI and the Worker: Dropbox link handling and film tagging.

export type FilmTag = 'highlights' | 'teaser' | 'ceremony' | 'feature' | 'reels' | 'other';

export const TAGS: Record<FilmTag, { label: string; badge: string }> = {
  highlights: { label: 'הייליטס', badge: 'HIGHLIGHTS' },
  teaser: { label: 'טיזר', badge: 'TEASER' },
  ceremony: { label: 'חופה', badge: 'CEREMONY' },
  feature: { label: 'הסרט המלא', badge: 'FEATURE FILM' },
  reels: { label: 'טיזר רילס', badge: 'REELS (9:16)' },
  other: { label: 'סרט', badge: 'FILM' },
};

export const TAG_ORDER: FilmTag[] = ['highlights', 'teaser', 'ceremony', 'feature', 'reels', 'other'];

export type LinkKind = 'file' | 'folder';

export interface ParsedLink {
  kind: LinkKind;
  /** Canonical www.dropbox.com URL without dl/raw/st parameters. */
  canonical: string;
  /** File or folder name taken from the URL path, when present. */
  name: string;
}

const DROPBOX_HOSTS = new Set(['www.dropbox.com', 'dropbox.com', 'dl.dropboxusercontent.com']);

/** Understands the shared-link shapes Dropbox produces today and in the past. */
export function parseDropboxLink(input: string): ParsedLink | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (!DROPBOX_HOSTS.has(url.hostname)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  let kind: LinkKind | null = null;
  let name = '';
  if (parts[0] === 'scl' && parts[1] === 'fi') {
    kind = 'file';
    name = safeDecode(parts[3] ?? '');
  } else if (parts[0] === 'scl' && parts[1] === 'fo') {
    kind = 'folder';
    name = safeDecode(parts[3] ?? '');
  } else if (parts[0] === 's') {
    kind = 'file';
    name = safeDecode(parts[2] ?? '');
  } else if (parts[0] === 'sh') {
    kind = 'folder';
    name = safeDecode(parts[2] ?? '');
  }
  if (!kind) return null;
  const canonical = new URL(url.toString());
  canonical.hostname = 'www.dropbox.com';
  canonical.searchParams.delete('dl');
  canonical.searchParams.delete('raw');
  canonical.searchParams.delete('st');
  canonical.hash = '';
  return { kind, canonical: canonical.toString(), name };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** URL the <video> element streams from: served inline with Range support, no preview page. */
export function toWatchUrl(link: string): string {
  const parsed = parseDropboxLink(link);
  if (!parsed) return link;
  const u = new URL(parsed.canonical);
  u.hostname = 'dl.dropboxusercontent.com';
  u.searchParams.set('raw', '1');
  return u.toString();
}

/** URL that forces the browser to save the file (works for files and for whole folders as ZIP). */
export function toDownloadUrl(link: string): string {
  const parsed = parseDropboxLink(link);
  if (!parsed) return link;
  const u = new URL(parsed.canonical);
  u.searchParams.set('dl', '1');
  return u.toString();
}

const VIDEO_EXT = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'mxf', 'm2ts', 'mts'];
const PLAYABLE_EXT = new Set(['mp4', 'm4v', 'webm']);

export function extensionOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : '';
}

export function isVideoFile(name: string): boolean {
  return VIDEO_EXT.includes(extensionOf(name));
}

/** True when a browser <video> can be expected to play the file. MOV is download-only. */
export function isPlayable(name: string): boolean {
  return PLAYABLE_EXT.has(extensionOf(name));
}

/** Guess the film type from its file name (Hebrew and English spellings). */
export function guessTag(name: string): FilmTag {
  const n = name.toLowerCase();
  if (/(reel|9x16|9-16|9_16|vertical|story|stories|רילס|סטורי|אנכי)/.test(n)) return 'reels';
  if (/(teaser|trailer|טיזר|טריילר)/.test(n)) return 'teaser';
  if (/(highlight|hl\b|היילייט|הייליט|תקציר)/.test(n)) return 'highlights';
  if (/(ceremony|chuppah|chupa|huppah|חופה)/.test(n)) return 'ceremony';
  if (/(full|feature|long|complete|מלא|ארוך|הסרט)/.test(n) || /(^|[\s_-])סרט(\.[a-z0-9]+)?$/.test(n)) return 'feature';
  return 'other';
}

/** Clean title from a file name: strip extension and tidy separators. */
export function titleFromFileName(name: string): string {
  const base = name.replace(/\.[a-z0-9]+$/i, '');
  return base.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Sort films the way the couple expects: highlights, teaser, chuppah, full film, reels, then anything else. */
export function sortByTag<T extends { tag: FilmTag }>(films: T[]): T[] {
  return [...films].sort((a, b) => TAG_ORDER.indexOf(a.tag) - TAG_ORDER.indexOf(b.tag));
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 ** 2;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

// ---------- quality versions ----------
// Studios that export the same film in more than one size (e.g. "היילייטס 4K.mp4" and
// "היילייטס 1080p.mp4") get a quality menu. Nothing is transcoded here.

export interface Quality {
  /** Pixel height, used for ordering and for picking a default. */
  height: number;
  /** What the couple sees in the menu. */
  label: string;
}

const QUALITY_PATTERNS: { re: RegExp; height: number; label: string }[] = [
  { re: /(?:^|[\s_\-().\[\]])(2160p|4k|uhd|4קיי)(?=$|[\s_\-().\[\]])/i, height: 2160, label: '4K' },
  { re: /(?:^|[\s_\-().\[\]])(1440p|2k|qhd)(?=$|[\s_\-().\[\]])/i, height: 1440, label: '1440p' },
  { re: /(?:^|[\s_\-().\[\]])(1080p|1080|fhd|fullhd|full hd)(?=$|[\s_\-().\[\]])/i, height: 1080, label: '1080p' },
  { re: /(?:^|[\s_\-().\[\]])(720p|720|hd)(?=$|[\s_\-().\[\]])/i, height: 720, label: '720p' },
  { re: /(?:^|[\s_\-().\[\]])(480p|480|sd)(?=$|[\s_\-().\[\]])/i, height: 480, label: '480p' },
  { re: /(?:^|[\s_\-().\[\]])(360p|360)(?=$|[\s_\-().\[\]])/i, height: 360, label: '360p' },
];

/** The quality written in the file name, or null when there is none. */
export function qualityOf(fileName: string): Quality | null {
  const base = fileName.replace(/\.[a-z0-9]+$/i, '');
  for (const p of QUALITY_PATTERNS) if (p.re.test(base)) return { height: p.height, label: p.label };
  return null;
}

/** File name without extension and without the quality token, tidied. */
export function baseTitle(fileName: string): string {
  let base = fileName.replace(/\.[a-z0-9]+$/i, '');
  for (const p of QUALITY_PATTERNS) base = base.replace(p.re, ' ');
  return base.replace(/[_]+/g, ' ').replace(/[\s\-–.()[\]]+$/g, '').replace(/^[\s\-–.()[\]]+/g, '').replace(/\s+/g, ' ').trim();
}

export interface VersionLike {
  fileName: string;
  sizeBytes: number;
  playable: boolean;
}

/**
 * Groups files that are the same film in different sizes. Returns one entry per film with its
 * versions ordered from the largest picture down. A file with no quality in its name is its own film.
 */
export function groupVersions<T extends VersionLike & { tag: FilmTag }>(files: T[]): { title: string; tag: FilmTag; versions: (T & Quality)[] }[] {
  const groups = new Map<string, { title: string; tag: FilmTag; versions: (T & Quality)[] }>();
  const singles: { title: string; tag: FilmTag; versions: (T & Quality)[] }[] = [];
  for (const f of files) {
    const q = qualityOf(f.fileName);
    const title = baseTitle(f.fileName) || titleFromFileName(f.fileName);
    if (!q) {
      singles.push({ title, tag: f.tag, versions: [{ ...f, height: 0, label: '' }] });
      continue;
    }
    const key = `${f.tag}|${title.toLowerCase()}`;
    const g = groups.get(key) ?? { title, tag: f.tag, versions: [] };
    g.versions.push({ ...f, ...q });
    groups.set(key, g);
  }
  const out = [...groups.values(), ...singles];
  for (const g of out) g.versions.sort((a, b) => b.height - a.height);
  return out;
}
