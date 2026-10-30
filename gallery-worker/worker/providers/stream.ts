// Streams a film (or a whole Dropbox folder as a zip) from the studio's cloud to
// the couple's browser, forwarding Range so the player can seek. The couple only
// ever sees our URL; the gallery's expiry is checked by the caller on every request.
import { parseDropboxLink, toDownloadUrl, toWatchUrl } from '../../shared/dropbox';
import { parseMyAirBridgeLink, parsePcloudLink } from '../../shared/providers';
import type { Env, Film, Settings } from '../types';
import { isPage, streamOwnFile, streamSharedLinkFile } from './dropbox';
import { pcloudFile, splitPcloudFilm } from './pcloud';

const CONTENT_TYPES: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska' };

function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** Copies the upstream body and the headers a player needs, with our own content type. */
export function relay(upstream: Response, request: Request, fileName: string, download: boolean, fallbackType = 'application/octet-stream'): Response {
  if (!upstream.ok && upstream.status !== 206) {
    void upstream.body?.cancel().catch(() => {});
    return new Response(`הקובץ לא זמין כרגע (${upstream.status})`, { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  // A cloud's error or sign-in page answered 200 (a removed or private file): never passed on as the video (fix plan P65,
  // it played as a broken film). Logged with the address's host only.
  if (isPage(upstream)) {
    let host = '';
    try {
      host = new URL(upstream.url).host;
    } catch {
      host = '';
    }
    console.error(`[films] stream: ${host || 'the cloud'} sent a page (${upstream.headers.get('Content-Type')}) instead of "${fileName.slice(0, 80)}"`);
    void upstream.body?.cancel().catch(() => {});
    return new Response('הקובץ לא זמין כרגע', { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  const ext = (fileName.split('.').pop() ?? '').toLowerCase();
  const out = new Headers();
  out.set('Content-Type', CONTENT_TYPES[ext] ?? fallbackType);
  out.set('Accept-Ranges', 'bytes');
  out.set('Cache-Control', 'private, max-age=3600');
  for (const h of ['Content-Length', 'Content-Range', 'ETag', 'Last-Modified']) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  if (download) out.set('Content-Disposition', contentDisposition(fileName));
  return new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: out });
}

function forwardHeaders(request: Request, extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra };
  const range = request.headers.get('Range');
  if (range) h.Range = range;
  return h;
}

export async function streamFilm(settings: Settings, env: Env, film: Film, request: Request, download: boolean, origin: string): Promise<Response> {
  const provider = film.provider ?? 'dropbox';
  if (provider === 'dropbox-link') return streamSharedLinkFile(settings, env, film, request, download);
  if (provider === 'dropbox-own') {
    if (!/^(id:[A-Za-z0-9_-]+|\/.+)$/.test(film.fileId)) return new Response('bad file', { status: 404 });
    return streamOwnFile(settings, env, film, request, download);
  }

  if (provider === 'pcloud') {
    const { canonical, fileid } = splitPcloudFilm(film.fileId);
    if (!parsePcloudLink(canonical) || !/^\d{1,20}$/.test(fileid)) return new Response('bad file', { status: 404 });
    return relay(await pcloudFile(canonical, fileid, request.headers.get('Range')), request, film.fileName, download);
  }

  if (provider === 'myairbridge') {
    if (!parseMyAirBridgeLink(film.fileId)) return new Response('bad file', { status: 404 });
    return Response.redirect(film.fileId, 302);
  }

  if (provider === 'gdrive') {
    if (!/^[A-Za-z0-9_-]{10,}$/.test(film.fileId)) return new Response('bad file', { status: 404 });
    if (!settings.googleApiKey) return new Response('Google Drive is not configured', { status: 503 });
    const u = new URL(`https://www.googleapis.com/drive/v3/files/${film.fileId}`);
    u.searchParams.set('alt', 'media');
    u.searchParams.set('supportsAllDrives', 'true');
    u.searchParams.set('key', settings.googleApiKey);
    const upstream = await fetch(u, { headers: forwardHeaders(request, { Referer: `${origin}/` }) });
    return relay(upstream, request, film.fileName, download);
  }

  // Public Dropbox file link.
  const parsed = parseDropboxLink(film.fileId || film.sourceUrl);
  if (!parsed || parsed.kind !== 'file') return new Response('bad file', { status: 404 });
  const upstream = await fetch(download ? toDownloadUrl(parsed.canonical) : toWatchUrl(parsed.canonical), {
    headers: forwardHeaders(request),
    redirect: 'follow',
  });
  return relay(upstream, request, film.fileName, download);
}

/** A whole Dropbox folder, zipped by Dropbox, streamed as a download. */
export async function streamFolderZip(folderUrl: string, request: Request, zipName: string): Promise<Response> {
  const parsed = parseDropboxLink(folderUrl);
  if (!parsed || parsed.kind !== 'folder') return new Response('bad folder', { status: 404 });
  const upstream = await fetch(toDownloadUrl(parsed.canonical), { redirect: 'follow' });
  return relay(upstream, request, `${zipName}.zip`, true, 'application/zip');
}
