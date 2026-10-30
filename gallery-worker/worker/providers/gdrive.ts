import { guessTag, isPlayable, isVideoFile, titleFromFileName } from '../../shared/dropbox';
import { driveDownloadUrl, driveFileUrl, driveWatchUrl, parseDriveLink } from '../../shared/providers';
import type { Film } from '../types';
import { HttpError } from '../types';
import type { CloudContext } from './context';

const API = 'https://www.googleapis.com/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const PLAYABLE_MIME = new Set(['video/mp4', 'video/webm']);
const NO_KEY = 'כדי לעבוד עם גוגל דרייב צריך להזין מפתח גוגל בעמוד ההגדרות (יש שם הסבר).';

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
}

async function driveGet<T>(ctx: CloudContext, path: string, params: Record<string, string>): Promise<T> {
  const key = ctx.settings.googleApiKey;
  if (!key) throw new HttpError(400, NO_KEY);
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('key', key);
  // The key is restricted to our site, so identify ourselves the same way the couple's browser will.
  const res = await fetch(url, { headers: { Referer: `${ctx.origin}/` } });
  if (res.ok) return (await res.json()) as T;
  const body = await res.text();
  if (res.status === 404) {
    throw new HttpError(400, 'גוגל דרייב לא מצא את הקובץ. בדוק שהשיתוף מוגדר ל"כל מי שיש לו את הקישור".');
  }
  if (/has not been used|is disabled|SERVICE_DISABLED/i.test(body)) {
    throw new HttpError(400, 'ה-Google Drive API לא מופעל בפרויקט של המפתח. מפעילים אותו ב-console.cloud.google.com.');
  }
  if (/API key|API_KEY|referer|referrer/i.test(body)) {
    throw new HttpError(400, 'מפתח גוגל לא תקין או מוגבל לכתובת אחרת. בדוק אותו בעמוד ההגדרות.');
  }
  throw new HttpError(400, `שגיאה מגוגל דרייב (${res.status}): ${body.slice(0, 160)}`);
}

function isFolder(f: DriveFile): boolean {
  return f.mimeType === FOLDER_MIME;
}

function filmFrom(f: DriveFile, _apiKey: string): Film {
  return {
    title: titleFromFileName(f.name),
    tag: guessTag(f.name),
    fileName: f.name,
    provider: 'gdrive',
    fileId: f.id,
    sourceUrl: driveFileUrl(f.id),
    // No direct URL: it would carry the API key. Couples stream through /api/watch.
    watchUrl: '',
    downloadUrl: driveDownloadUrl(f.id),
    sizeBytes: Number(f.size ?? 0) || 0,
    playable: isPlayable(f.name) || PLAYABLE_MIME.has(f.mimeType),
  };
}

export async function resolveDriveFolder(ctx: CloudContext, url: string): Promise<{ folderName: string; films: Film[] }> {
  const link = parseDriveLink(url);
  if (!link || link.kind === 'file') throw new HttpError(400, 'זה קישור לקובץ בגוגל דרייב, לא לתיקייה. הדבק אותו בשדה של סרט בודד.');
  if (ctx.env.CLOUD_MOCK) return mockDriveFolder();
  const meta = await driveGet<DriveFile>(ctx, `/files/${link.id}`, { fields: 'id,name,mimeType' });
  if (!isFolder(meta)) throw new HttpError(400, 'זה קישור לקובץ בגוגל דרייב, לא לתיקייה. הדבק אותו בשדה של סרט בודד.');

  const files: DriveFile[] = [];
  let pageToken = '';
  do {
    const page = await driveGet<{ files: DriveFile[]; nextPageToken?: string }>(ctx, '/files', {
      q: `'${link.id}' in parents and trashed = false`,
      fields: 'nextPageToken,files(id,name,mimeType,size)',
      pageSize: '1000',
      includeItemsFromAllDrives: 'true',
      ...(pageToken ? { pageToken } : {}),
    });
    files.push(...page.files);
    pageToken = page.nextPageToken ?? '';
  } while (pageToken);

  const videos = files.filter((f) => !isFolder(f) && (f.mimeType.startsWith('video/') || isVideoFile(f.name)));
  if (videos.length === 0) throw new HttpError(400, 'לא נמצאו קבצי וידאו בתיקייה (רק ברמה הראשונה, לא בתיקיות פנימיות).');
  return { folderName: meta.name, films: videos.map((f) => filmFrom(f, ctx.settings.googleApiKey)) };
}

export async function resolveDriveFile(ctx: CloudContext, url: string): Promise<Film> {
  const link = parseDriveLink(url);
  if (!link || link.kind === 'folder') throw new HttpError(400, 'זה קישור לתיקייה. הדבק אותו בשדה התיקייה למעלה.');
  if (ctx.env.CLOUD_MOCK) return filmFrom({ id: link.id, name: 'סרט מגוגל דרייב.mp4', mimeType: 'video/mp4', size: '1234567' }, 'MOCK');
  const meta = await driveGet<DriveFile>(ctx, `/files/${link.id}`, { fields: 'id,name,mimeType,size' });
  if (isFolder(meta)) throw new HttpError(400, 'זה קישור לתיקייה. הדבק אותו בשדה התיקייה למעלה.');
  return filmFrom(meta, ctx.settings.googleApiKey);
}

export function driveUrls(fileId: string, apiKey: string): { watchUrl: string; downloadUrl: string } {
  return { watchUrl: apiKey ? driveWatchUrl(fileId, apiKey) : '', downloadUrl: driveDownloadUrl(fileId) };
}

function mockDriveFolder(): { folderName: string; films: Film[] } {
  const mk = (id: string, name: string, size: number, demo?: string) => {
    const film = filmFrom({ id, name, mimeType: name.endsWith('.mov') ? 'video/quicktime' : 'video/mp4', size: String(size) }, 'MOCK');
    return demo ? { ...film, watchUrl: demo } : film;
  };
  return {
    folderName: 'נועה ואיתי - 3.9.26',
    films: [
      mk('1MockDriveHighlights0001', 'היילייטס.mp4', 2_460_912_400, '/demo/highlights.mp4'),
      mk('1MockDriveCeremony00002', 'חופה.mp4', 4_737_222_232),
      mk('1MockDriveFullFilm00003', 'סרט.mp4', 14_935_771_682),
    ],
  };
}
