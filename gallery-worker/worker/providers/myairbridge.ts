// MyAirBridge speaks WebDAV: PROPFIND on a shared folder lists it, GET on a file redirects (303)
// to a download URL that accepts Range requests, so <video> can stream and seek.
// Built from the API docs (info.myairbridge.com/en/api); confirm against a real share link.
import { guessTag, isPlayable, isVideoFile, titleFromFileName } from '../../shared/dropbox';
import { parseMyAirBridgeLink } from '../../shared/providers';
import type { Film } from '../types';
import { HttpError } from '../types';
import type { CloudContext } from './context';

interface DavEntry {
  name: string;
  size: number;
  isFolder: boolean;
  url: string;
  /** When the share stops working (ISO), when MyAirBridge says so (P65). */
  expiresAt?: string;
}

/** A link MyAirBridge no longer answers with a file list for: removed, expired, or never a share (P65). */
export const MAB_LINK_GONE = 'הקישור של MyAirBridge לא תקין או שפג תוקפו. בקשו מהשולח קישור חדש.';

/**
 * The share's end date, from the first of the properties MyAirBridge may use for it (the API documentation names no
 * single one; confirm against a real share link). '' when there is none or it is not a date.
 */
function expiryOf(block: string): string {
  for (const name of ['expiration-date', 'expiration', 'expires-at', 'expires', 'expire-date', 'valid-until']) {
    const raw = tag(block, name);
    if (!raw) continue;
    const n = Number(raw);
    // Seconds or milliseconds since 1970, or a date text.
    const t = /^\d{9,13}$/.test(raw) ? (raw.length > 11 ? n : n * 1000) : Date.parse(raw);
    if (Number.isFinite(t) && t > Date.UTC(2000, 0, 1)) return new Date(t).toISOString();
  }
  return '';
}

function tag(xml: string, name: string): string {
  const m = new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'i').exec(xml);
  return m ? decodeXml(m[1].trim()) : '';
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export function parseMultistatus(xml: string, base: string): DavEntry[] {
  const blocks = xml.match(/<(?:[\w-]+:)?response\b[\s\S]*?<\/(?:[\w-]+:)?response>/gi) ?? [];
  return blocks.map((b) => {
    const href = tag(b, 'href');
    const nodeUrl = tag(b, 'node-url');
    let url = nodeUrl || href;
    try {
      url = new URL(url, base).toString();
    } catch {
      /* keep as is */
    }
    let name = tag(b, 'displayname');
    if (!name && href) {
      try {
        name = decodeURIComponent(href.replace(/\/$/, '').split('/').pop() ?? '');
      } catch {
        name = href;
      }
    }
    const expiresAt = expiryOf(b);
    return {
      name,
      size: Number(tag(b, 'getcontentlength')) || 0,
      isFolder: /<(?:[\w-]+:)?collection\b/i.test(tag(b, 'resourcetype') || b),
      url,
      ...(expiresAt ? { expiresAt } : {}),
    };
  });
}

/**
 * Lists a share (WebDAV PROPFIND). Anything that is not a file list — a 404 / 410, an error or sign-in page, an empty
 * answer — is MAB_LINK_GONE (P65: an expired transfer's page was read as an empty folder, or its page reached the
 * player). 5xx and 429 say "try again". The link's end date, when MyAirBridge gives one, is on the entries.
 */
export async function propfind(url: string): Promise<{ entries: DavEntry[]; finalUrl: string }> {
  const res = await fetch(url, { method: 'PROPFIND', headers: { Depth: '1' }, redirect: 'follow' });
  if (res.status === 429 || res.status >= 500) {
    await res.body?.cancel().catch(() => {});
    throw new HttpError(503, `MyAirBridge לא זמין כרגע (קוד ${res.status}). נסו שוב בעוד רגע.`);
  }
  const type = (res.headers.get('Content-Type') ?? '').toLowerCase();
  if ((res.status !== 207 && res.status !== 200) || /html/.test(type)) {
    await res.body?.cancel().catch(() => {});
    throw new HttpError(400, MAB_LINK_GONE);
  }
  const text = await res.text();
  const entries = /multistatus/i.test(text) ? parseMultistatus(text, res.url || url) : [];
  if (entries.length === 0) throw new HttpError(400, MAB_LINK_GONE);
  return { entries, finalUrl: res.url || url };
}

function filmFrom(e: DavEntry, shareLink: string, expiresAt = e.expiresAt): Film {
  return {
    title: titleFromFileName(e.name),
    tag: guessTag(e.name),
    fileName: e.name,
    provider: 'myairbridge',
    fileId: e.url,
    sourceUrl: shareLink,
    watchUrl: e.url,
    downloadUrl: e.url,
    sizeBytes: e.size,
    playable: isPlayable(e.name),
    // The share's end (P65): the studio's editor warns, the nightly check knows the film will stop.
    ...(expiresAt ? { providerExpiresAt: expiresAt } : {}),
  };
}

export async function resolveMabFolder(ctx: CloudContext, url: string): Promise<{ folderName: string; films: Film[] }> {
  const link = parseMyAirBridgeLink(url);
  if (!link) throw new HttpError(400, 'זה לא נראה כמו קישור של MyAirBridge');
  if (ctx.env.CLOUD_MOCK) return mockMabFolder(link.canonical);
  const { entries } = await propfind(link.canonical);
  const [self, ...children] = entries;
  if (!self.isFolder) throw new HttpError(400, 'זה קישור לקובץ בודד ב-MyAirBridge. הדבק אותו בשדה של סרט בודד.');
  const videos = children.filter((e) => !e.isFolder && isVideoFile(e.name));
  if (videos.length === 0) throw new HttpError(400, 'לא נמצאו קבצי וידאו בתיקייה (רק ברמה הראשונה, לא בתיקיות פנימיות).');
  // A file's own end date, else the folder's.
  return { folderName: self.name, films: videos.map((v) => filmFrom(v, link.canonical, v.expiresAt ?? self.expiresAt)) };
}

export async function resolveMabFile(ctx: CloudContext, url: string): Promise<Film> {
  const link = parseMyAirBridgeLink(url);
  if (!link) throw new HttpError(400, 'זה לא נראה כמו קישור של MyAirBridge');
  if (ctx.env.CLOUD_MOCK) return filmFrom({ name: 'סרט מ-MyAirBridge.mp4', size: 1_234_567, isFolder: false, url: `${link.canonical}/file.mp4` }, link.canonical);
  const { entries } = await propfind(link.canonical);
  const self = entries[0];
  if (self.isFolder) {
    const videos = entries.slice(1).filter((e) => !e.isFolder && isVideoFile(e.name));
    if (videos.length !== 1) throw new HttpError(400, 'זה קישור לתיקייה. הדבק אותו בשדה התיקייה למעלה.');
    return filmFrom(videos[0], link.canonical, videos[0].expiresAt ?? self.expiresAt);
  }
  return filmFrom(self, link.canonical);
}

function mockMabFolder(shareLink: string): { folderName: string; films: Film[] } {
  const mk = (name: string, size: number, demo?: string) => {
    const film = filmFrom({ name, size, isFolder: false, url: `https://mock.myairbridge.com/f/${encodeURIComponent(name)}` }, shareLink);
    return demo ? { ...film, watchUrl: demo } : film;
  };
  return {
    folderName: 'שירה ועומר - 20.9.26',
    films: [mk('Highlights.mp4', 2_100_000_000, '/demo/highlights.mp4'), mk('Teaser.mp4', 180_000_000), mk('Full Film.mp4', 12_000_000_000)],
  };
}
