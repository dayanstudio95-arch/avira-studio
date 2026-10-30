// Recognises share links from every supported cloud. Shared by the browser UI and the Worker.
import { parseDropboxLink } from './dropbox';

/**
 * 'dropbox-link' = a file inside someone else's shared Dropbox folder, streamed through our site.
 * 'dropbox-own' = a file in the studio's own connected Dropbox, kept by its file id and streamed through our site with the
 * studio's connection (fix plan P65): no public link is made for it. 'dropbox' = a public file link the studio pasted
 * (and every Dropbox film saved before P65).
 */
export type Provider = 'dropbox' | 'dropbox-link' | 'dropbox-own' | 'gdrive' | 'myairbridge' | 'pcloud';

/** Films that play only while the studio's Dropbox is connected (the disconnect warning counts them, P65). */
export const CONNECTION_PROVIDERS: readonly Provider[] = ['dropbox-own', 'dropbox-link'];

export const PROVIDER_NAMES: Record<Provider, string> = {
  dropbox: 'דרופבוקס',
  'dropbox-link': 'דרופבוקס (דרך האתר)',
  'dropbox-own': 'דרופבוקס (החשבון המחובר)',
  gdrive: 'גוגל דרייב',
  myairbridge: 'MyAirBridge',
  pcloud: 'pCloud',
};

export interface CloudLink {
  provider: Provider;
  /** 'unknown' when the link alone doesn't say (the cloud is asked when the link is resolved). */
  kind: 'file' | 'folder' | 'unknown';
  /** Dropbox: canonical share link. Drive: file or folder id. MyAirBridge: the share link. */
  id: string;
  canonical: string;
  name: string;
}

const DRIVE_ID = /^[A-Za-z0-9_-]{10,}$/;

function parseUrl(input: string): URL | null {
  try {
    const u = new URL(input.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
  } catch {
    return null;
  }
}

export function driveFileUrl(id: string): string {
  return `https://drive.google.com/file/d/${id}/view`;
}

export function driveFolderUrl(id: string): string {
  return `https://drive.google.com/drive/folders/${id}`;
}

export function parseDriveLink(input: string): CloudLink | null {
  const url = parseUrl(input);
  if (!url) return null;
  const host = url.hostname;
  if (host !== 'drive.google.com' && host !== 'drive.usercontent.google.com' && host !== 'docs.google.com') return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const make = (kind: CloudLink['kind'], id: string | null | undefined): CloudLink | null => {
    if (!id || !DRIVE_ID.test(id)) return null;
    const canonical = kind === 'folder' ? driveFolderUrl(id) : driveFileUrl(id);
    return { provider: 'gdrive', kind, id, canonical, name: '' };
  };
  // drive.google.com/file/d/<id>/view  (also /file/u/1/d/<id>/view)
  const fileIdx = parts.indexOf('file');
  const dIdx = fileIdx >= 0 ? parts.indexOf('d', fileIdx + 1) : -1;
  if (dIdx >= 0) return make('file', parts[dIdx + 1]);
  // drive.google.com/drive/folders/<id>  (also /drive/u/0/folders/<id>)
  const folderIdx = parts.indexOf('folders');
  if (folderIdx >= 0) return make('folder', parts[folderIdx + 1]);
  // drive.google.com/uc?id=  ·  drive.usercontent.google.com/download?id=
  if (parts[0] === 'uc' || parts[0] === 'download') return make('file', url.searchParams.get('id'));
  // drive.google.com/open?id=  — could be a file or a folder
  if (parts[0] === 'open') return make('unknown', url.searchParams.get('id'));
  return null;
}

export function parseMyAirBridgeLink(input: string): CloudLink | null {
  const url = parseUrl(input);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  const isMab =
    host === 'mab.to' ||
    host === 'myairbridge.com' ||
    host === 'myairbridge.cloud' ||
    ((host.endsWith('.myairbridge.com') || host.endsWith('.myairbridge.cloud')) && !host.startsWith('info.'));
  if (!isMab) return null;
  if (url.pathname === '/' && !url.hash) return null; // the home page is not a share link
  url.protocol = 'https:';
  const canonical = url.toString();
  return { provider: 'myairbridge', kind: 'unknown', id: canonical, canonical, name: '' };
}

/**
 * pCloud public links: u.pcloud.link (US) / e.pcloud.link (EU) / my.pcloud.com "…/publink/show?code=…".
 * `id` is the link code; the region's API host is chosen from the link.
 */
export function parsePcloudLink(input: string): CloudLink | null {
  const url = parseUrl(input);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  if (!/(^|\.)pcloud\.(link|com)$/.test(host)) return null;
  const code = url.searchParams.get('code') ?? '';
  if (!/^[A-Za-z0-9]{8,80}$/.test(code)) return null;
  const canonical = `https://${host.startsWith('e.') ? 'e.pcloud.link' : 'u.pcloud.link'}/publink/show?code=${code}`;
  return { provider: 'pcloud', kind: 'unknown', id: code, canonical, name: '' };
}

/** Which pCloud API hosts to try for a link, its own region first. */
export function pcloudHosts(canonical: string): string[] {
  return canonical.startsWith('https://e.') ? ['eapi.pcloud.com', 'api.pcloud.com'] : ['api.pcloud.com', 'eapi.pcloud.com'];
}

export function detectLink(input: string): CloudLink | null {
  const dbx = parseDropboxLink(input);
  if (dbx) return { provider: 'dropbox', kind: dbx.kind, id: dbx.canonical, canonical: dbx.canonical, name: dbx.name };
  return parseDriveLink(input) ?? parseMyAirBridgeLink(input) ?? parsePcloudLink(input);
}

/** Drive: stream through the Drive API (supports seeking). Needs a public file and an API key. */
export function driveWatchUrl(id: string, apiKey: string): string {
  return `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&key=${encodeURIComponent(apiKey)}`;
}

/** Drive: direct download that skips the "too large to scan for viruses" page. */
export function driveDownloadUrl(id: string): string {
  return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
}
