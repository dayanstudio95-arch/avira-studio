// pCloud public links: no login needed. showpublink lists a folder (recursively), getpubthumb
// gives ready previews, getpublinkdownload gives a short-lived address of the original (which we
// stream through our own site, so seeking in films and "download" work, the link stays private
// and a closed gallery stops playing). Ported from the Avira films app (2026-09-26).
import { guessTag, isPlayable, isVideoFile, titleFromFileName } from '../../shared/dropbox';
import { parsePcloudLink, pcloudHosts } from '../../shared/providers';
import type { Film } from '../types';
import { HttpError } from '../types';
import type { CloudContext } from './context';

export interface PcloudItem {
  name: string;
  isfolder: boolean;
  fileid?: number;
  size?: number;
  /** pCloud's hash of the file's content (fix plan P66: with the size, the photo's version). */
  hash?: number | string;
  contents?: PcloudItem[];
}

/** Which host answered for a link (per Worker instance), so later calls skip the wrong region. */
const hostFor = new Map<string, string>();

const ERRORS: Record<number, string> = {
  7001: 'הקישור של pCloud לא תקין. בדוק שהעתקת את כולו.',
  7002: 'הקישור של pCloud נמחק.',
  7003: 'הקישור של pCloud מוגן בסיסמה. צריך קישור בלי סיסמה.',
  7004: 'הקישור של pCloud פג תוקף.',
  7005: 'הקישור של pCloud הגיע למגבלת התעבורה. אפשר לנסות שוב מאוחר יותר או לשדרג את החשבון ב-pCloud.',
  7006: 'הקישור של pCloud הגיע למגבלת ההורדות שהוגדרה לו.',
};

/** Calls a public-link method, trying the link's region first and the other one after. */
export async function pcloudApi<T>(canonical: string, method: string, params: Record<string, string>): Promise<{ data: T; host: string }> {
  const code = parsePcloudLink(canonical)?.id ?? '';
  const known = hostFor.get(code);
  const hosts = known ? [known, ...pcloudHosts(canonical).filter((h) => h !== known)] : pcloudHosts(canonical);
  let last: { result: number; error?: string } = { result: 0 };
  for (const host of hosts) {
    const u = new URL(`https://${host}/${method}`);
    u.searchParams.set('code', code);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const res = await fetch(u);
    const body = (await res.json().catch(() => ({ result: -1, error: `pCloud ${res.status}` }))) as { result: number; error?: string };
    if (body.result === 0) {
      hostFor.set(code, host);
      return { data: body as unknown as T, host };
    }
    last = body;
    // "Invalid link" in one region can mean the link lives in the other one; anything else is final.
    if (body.result !== 7001) break;
  }
  throw new HttpError(400, ERRORS[last.result] ?? `pCloud החזיר שגיאה: ${last.error ?? last.result}`);
}

/** The whole shared folder (or the one shared file), with every subfolder's contents. */
export async function pcloudTree(canonical: string): Promise<PcloudItem> {
  const { data } = await pcloudApi<{ metadata: PcloudItem }>(canonical, 'showpublink', {});
  return data.metadata;
}

/**
 * A ready preview from pCloud (width up to 2048, height up to 1024). Used by photo galleries. pCloud answers an
 * error (over its traffic limit, a removed link) as JSON with status 200: when no host sent a picture, the answer
 * is a 502 with the reason in our words (fix plan P66), never pCloud's JSON passed on as a photo.
 */
export async function pcloudThumb(canonical: string, fileid: string, size: string): Promise<Response> {
  const code = parsePcloudLink(canonical)?.id ?? '';
  const hosts = hostFor.get(code) ? [hostFor.get(code)!] : pcloudHosts(canonical);
  let reason = '';
  for (const host of hosts) {
    const res = await fetch(`https://${host}/getpubthumb?code=${encodeURIComponent(code)}&fileid=${encodeURIComponent(fileid)}&size=${size}`);
    const type = res.headers.get('Content-Type') ?? '';
    if (res.ok && type.startsWith('image/')) {
      hostFor.set(code, host);
      return res;
    }
    const body = (await res.json().catch(() => null)) as { result?: number; error?: string } | null;
    reason = (body?.result !== undefined && ERRORS[body.result]) || `pCloud ${body?.result ?? res.status}`;
  }
  return new Response(reason || 'pCloud', { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

/** Download addresses for a few hours, in memory (not worth a storage write per film). */
const addressFor = new Map<string, { url: string; until: number }>();

async function downloadAddress(canonical: string, fileid: string, fresh = false): Promise<string> {
  const key = `${canonical}#${fileid}`;
  const hit = addressFor.get(key);
  if (hit && hit.until > Date.now() && !fresh) return hit.url;
  const { data } = await pcloudApi<{ hosts: string[]; path: string; expires?: string }>(canonical, 'getpublinkdownload', { fileid });
  const url = `https://${data.hosts[0]}${data.path}`;
  const expires = data.expires ? Date.parse(data.expires) : NaN;
  addressFor.set(key, { url, until: Number.isFinite(expires) ? expires - 5 * 60_000 : Date.now() + 60 * 60_000 });
  if (addressFor.size > 2000) addressFor.delete(addressFor.keys().next().value!);
  return url;
}

/** The original file, with Range forwarded (films seek; downloads resume). */
export async function pcloudFile(canonical: string, fileid: string, range: string | null): Promise<Response> {
  const headers: Record<string, string> = range ? { Range: range } : {};
  const res = await fetch(await downloadAddress(canonical, fileid), { headers });
  if (res.status === 403 || res.status === 404 || res.status === 410) {
    // The address expired early: ask once more.
    return fetch(await downloadAddress(canonical, fileid, true), { headers });
  }
  return res;
}

// ---------- films ----------

function filmFrom(item: PcloudItem, canonical: string): Film {
  return {
    title: titleFromFileName(item.name),
    tag: guessTag(item.name),
    fileName: item.name,
    provider: 'pcloud',
    fileId: `${canonical}#${item.fileid}`,
    sourceUrl: canonical,
    watchUrl: '',
    downloadUrl: '',
    sizeBytes: item.size ?? 0,
    playable: isPlayable(item.name),
  };
}

/** "…link#fileid" → the link and the file id. */
export function splitPcloudFilm(fileId: string): { canonical: string; fileid: string } {
  const i = fileId.lastIndexOf('#');
  return { canonical: fileId.slice(0, i), fileid: fileId.slice(i + 1) };
}

export async function resolvePcloudFolder(ctx: CloudContext, url: string): Promise<{ folderName: string; films: Film[] }> {
  const link = parsePcloudLink(url);
  if (!link) throw new HttpError(400, 'זה לא נראה כמו קישור של pCloud');
  if (ctx.env.CLOUD_MOCK) return mockFolder(link.canonical);
  const root = await pcloudTree(link.canonical);
  if (!root.isfolder) throw new HttpError(400, 'זה קישור לקובץ בודד ב-pCloud. הדבק אותו בשדה של סרט בודד.');
  const videos: PcloudItem[] = [];
  const walk = (items: PcloudItem[] | undefined, depth: number) => {
    for (const it of items ?? []) {
      if (it.isfolder) {
        if (depth < 2) walk(it.contents, depth + 1);
      } else if (isVideoFile(it.name) && it.fileid) videos.push(it);
    }
  };
  walk(root.contents, 0);
  if (videos.length === 0) throw new HttpError(400, 'לא נמצאו קבצי וידאו בתיקייה.');
  return { folderName: root.name, films: videos.map((v) => filmFrom(v, link.canonical)) };
}

export async function resolvePcloudFile(ctx: CloudContext, url: string): Promise<Film> {
  const link = parsePcloudLink(url);
  if (!link) throw new HttpError(400, 'זה לא נראה כמו קישור של pCloud');
  if (ctx.env.CLOUD_MOCK) return { ...filmFrom({ name: 'סרט מ-pCloud.mp4', isfolder: false, fileid: 1, size: 1_234_567 }, link.canonical), watchUrl: '/demo/highlights.mp4' };
  const root = await pcloudTree(link.canonical);
  if (root.isfolder) {
    const videos = (root.contents ?? []).filter((it) => !it.isfolder && isVideoFile(it.name));
    if (videos.length !== 1) throw new HttpError(400, 'זה קישור לתיקייה. הדבק אותו בשדה התיקייה למעלה.');
    return filmFrom(videos[0], link.canonical);
  }
  return filmFrom(root, link.canonical);
}

function mockFolder(canonical: string): { folderName: string; films: Film[] } {
  const mk = (name: string, size: number, fileid: number) => ({ ...filmFrom({ name, isfolder: false, fileid, size }, canonical), watchUrl: '/demo/highlights.mp4' });
  return { folderName: 'נועה ואיתי - pCloud', films: [mk('Highlights.mp4', 1_900_000_000, 11), mk('Full Film.mp4', 9_000_000_000, 12)] };
}
