import { toDownloadUrl } from '../../shared/dropbox';
import { detectLink, type Provider } from '../../shared/providers';
import type { Env, Film, Gallery, Settings } from '../types';
import { HttpError } from '../types';
import type { CloudContext } from './context';
import { dropboxUrls, resolveDropboxFile, resolveDropboxFolder } from './dropbox';
import { resolveDriveFile, resolveDriveFolder } from './gdrive';
import { resolveMabFile, resolveMabFolder } from './myairbridge';
import { resolvePcloudFile, resolvePcloudFolder } from './pcloud';

export type { CloudContext } from './context';

const UNKNOWN = 'הקישור לא מזוהה. אפשר להדביק קישור מדרופבוקס, מגוגל דרייב, מ-pCloud או מ-MyAirBridge.';

export async function resolveFolder(ctx: CloudContext, url: string): Promise<{ provider: Provider; folderUrl: string; folderName: string; films: Film[] }> {
  const link = detectLink(url);
  if (!link) throw new HttpError(400, UNKNOWN);
  if (link.kind === 'file') throw new HttpError(400, 'זה קישור לקובץ, לא לתיקייה. הדבק אותו בשדה של סרט בודד למטה.');
  const r =
    link.provider === 'dropbox'
      ? await resolveDropboxFolder(ctx.env, ctx.settings, url)
      : link.provider === 'gdrive'
        ? await resolveDriveFolder(ctx, url)
        : link.provider === 'pcloud'
          ? await resolvePcloudFolder(ctx, url)
          : await resolveMabFolder(ctx, url);
  return { provider: link.provider, folderUrl: link.canonical, ...r };
}

export async function resolveFile(ctx: CloudContext, url: string): Promise<Film> {
  const link = detectLink(url);
  if (!link) throw new HttpError(400, UNKNOWN);
  if (link.kind === 'folder') throw new HttpError(400, 'זה קישור לתיקייה. הדבק אותו בשדה התיקייה למעלה.');
  if (link.provider === 'dropbox') return resolveDropboxFile(ctx.env, ctx.settings, url);
  if (link.provider === 'gdrive') return resolveDriveFile(ctx, url);
  if (link.provider === 'pcloud') return resolvePcloudFile(ctx, url);
  return resolveMabFile(ctx, url);
}

/** Where a film is streamed from: our own site, by gallery id and film position. */
export function proxyUrls(galleryId: string, index: number): { watchUrl: string; downloadUrl: string } {
  const base = `/api/watch/${galleryId}/film/${index}`;
  return { watchUrl: base, downloadUrl: `${base}?dl=1` };
}

/**
 * The URLs a browser uses for a film.
 *
 * Couple's page (`place` given): every Dropbox, Google Drive and pCloud film goes through
 * our own /api/watch route. That is what makes a closed gallery really closed
 * (the route checks the expiry on every request) and keeps the Google API key on
 * the server. MyAirBridge links can't be proxied and stay direct.
 *
 * Admin preview (no `place`): public Dropbox links play directly; Drive and
 * shared-folder films have no preview (they need a key or a token).
 */
export function filmUrls(film: Film, settings: Settings, env: Env, place?: { galleryId: string; index: number }): { watchUrl: string; downloadUrl: string } {
  void settings;
  const provider = film.provider ?? 'dropbox';
  const fileId = film.fileId || film.sourceUrl;
  let urls: { watchUrl: string; downloadUrl: string };
  if (provider === 'myairbridge') urls = { watchUrl: fileId, downloadUrl: fileId };
  else if (place) urls = proxyUrls(place.galleryId, place.index);
  else if (provider === 'dropbox') urls = dropboxUrls(fileId);
  else urls = { watchUrl: '', downloadUrl: '' };
  // Local previews: films resolved from the mock cloud carry a bundled demo clip.
  if (env.CLOUD_MOCK && !place && film.watchUrl?.startsWith('/')) urls.watchUrl = film.watchUrl;
  return urls;
}

/**
 * "Download all". Dropbox folders are zipped by Dropbox and streamed through
 * /api/watch/:id/all (closes with the gallery). Drive and MyAirBridge offer it
 * on their own folder page, which we can only link to.
 */
export function folderDownloadUrl(g: Gallery, galleryId?: string): string {
  if (!g.folderUrl) return '';
  const p = g.folderProvider ?? 'dropbox';
  if (p === 'dropbox' || p === 'dropbox-link') return galleryId ? `/api/watch/${galleryId}/all` : toDownloadUrl(g.folderUrl);
  return g.folderUrl;
}
