// Is a film still where its link says (fix plan P65)? The nightly link check (worker/cleanup.ts checkFilmLinks) asks
// each cloud once per film, the cheapest way it can, and keeps what it found per gallery in KV (`filmcheck:<gallery>`):
// a broken film is marked (when, why, whether the studio was told) until a later check finds it again; the hub's gallery
// screen shows the mark ("הקישור נשבר"). Only an answer that really says "gone" marks a film; busy, down, a studio whose
// Dropbox is not connected, or an answer we can't read is 'unknown' and leaves the mark as it was.
// Never logs a link, a token or a file name the cloud sent; the caller logs gallery ids and positions.
import { parseDropboxLink, toWatchUrl } from '../shared/dropbox';
import { parseMyAirBridgeLink, parsePcloudLink, pcloudHosts } from '../shared/providers';
import { isPage } from './providers/dropbox';
import { parseMultistatus } from './providers/myairbridge';
import type { Env, Film } from './types';

export type LinkState = { state: 'ok' } | { state: 'broken'; reason: string } | { state: 'unknown'; reason: string };

/** What a check may use: a counted fetch, the studio's Dropbox token (null = not connected), the Drive key. */
export interface ProbeContext {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  dropboxToken: () => Promise<string | null>;
  googleApiKey: string;
  now?: number;
}

const ok: LinkState = { state: 'ok' };
const broken = (reason: string): LinkState => ({ state: 'broken', reason });
const unknown = (reason: string): LinkState => ({ state: 'unknown', reason });

/** Why a film is broken, in the studio's words (the bell, the mail, the editor). */
export const GONE = 'הקובץ נמחק, הועבר או שהשיתוף שלו בוטל';
export const PAGE = 'הספק מחזיר דף שגיאה במקום הסרט';
export const EXPIRED = 'תוקף הקישור פג';
export const BAD_LINK = 'הקישור לא תקין';

const drain = (res: Response) => res.body?.cancel().catch(() => {});

/** A plain HTTP answer for a file: a page or "not found" is broken; busy, down or anything else is unknown. */
async function byStatus(res: Response): Promise<LinkState> {
  await drain(res);
  if (res.ok || res.status === 206) return isPage(res) ? broken(PAGE) : ok;
  if (res.status === 403 || res.status === 404 || res.status === 410) return broken(GONE);
  return unknown(`http ${res.status}`);
}

/** One film, one (at most two) requests. Never throws: a network error is 'unknown'. */
export async function probeFilm(film: Film, ctx: ProbeContext): Promise<LinkState> {
  try {
    return await probe(film, ctx);
  } catch (e) {
    return unknown(e instanceof Error ? e.message.slice(0, 120) : 'error');
  }
}

async function probe(film: Film, ctx: ProbeContext): Promise<LinkState> {
  const provider = film.provider ?? 'dropbox';
  const now = ctx.now ?? Date.now();
  if (provider === 'dropbox') {
    // A public file link the studio pasted: its first byte, from Dropbox's content host (no redirect).
    const parsed = parseDropboxLink(film.fileId || film.sourceUrl);
    if (!parsed || parsed.kind !== 'file') return broken(BAD_LINK);
    return byStatus(await ctx.fetch(toWatchUrl(parsed.canonical), { headers: { Range: 'bytes=0-0' } }));
  }
  if (provider === 'dropbox-own' || provider === 'dropbox-link') {
    const token = await ctx.dropboxToken();
    if (!token) return unknown('dropbox not connected');
    const own = provider === 'dropbox-own';
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    if (own && film.pathRoot) headers['Dropbox-API-Path-Root'] = JSON.stringify({ '.tag': 'root', root: film.pathRoot });
    const res = await ctx.fetch(`https://api.dropboxapi.com/2/${own ? 'files/get_metadata' : 'sharing/get_shared_link_metadata'}`, {
      method: 'POST',
      headers,
      body: own ? JSON.stringify({ path: film.fileId }) : JSON.stringify({ url: film.sourceUrl, path: film.fileId }),
    });
    if (res.ok) {
      const meta = (await res.json().catch(() => null)) as { '.tag'?: string } | null;
      return meta?.['.tag'] === 'file' ? ok : meta ? broken(GONE) : unknown('unreadable');
    }
    const text = await res.text().catch(() => '');
    if (res.status === 409 && /not_found|shared_link_access_denied|restricted_content|malformed_path/.test(text)) return broken(GONE);
    return unknown(`dropbox ${res.status}`);
  }
  if (provider === 'gdrive') {
    if (!ctx.googleApiKey) return unknown('no google key');
    if (!/^[A-Za-z0-9_-]{10,}$/.test(film.fileId)) return broken(BAD_LINK);
    const u = new URL(`https://www.googleapis.com/drive/v3/files/${film.fileId}`);
    u.searchParams.set('fields', 'id,trashed');
    u.searchParams.set('supportsAllDrives', 'true');
    u.searchParams.set('key', ctx.googleApiKey);
    const res = await ctx.fetch(u.toString());
    if (res.ok) {
      const f = (await res.json().catch(() => null)) as { trashed?: boolean } | null;
      return f?.trashed ? broken(GONE) : f ? ok : unknown('unreadable');
    }
    await drain(res);
    // 403 is usually the key (its limits or the site it is bound to), not the file.
    return res.status === 404 ? broken(GONE) : unknown(`drive ${res.status}`);
  }
  if (provider === 'pcloud') {
    const i = film.fileId.lastIndexOf('#');
    const canonical = i > 0 ? film.fileId.slice(0, i) : '';
    const fileid = i > 0 ? film.fileId.slice(i + 1) : '';
    const code = parsePcloudLink(canonical)?.id;
    if (!code || !/^\d{1,20}$/.test(fileid)) return broken(BAD_LINK);
    // "Invalid link" in one region can mean the other region has it (pcloud.ts pcloudApi).
    for (const host of pcloudHosts(canonical)) {
      const res = await ctx.fetch(`https://${host}/getpublinkdownload?code=${encodeURIComponent(code)}&fileid=${encodeURIComponent(fileid)}`);
      const body = (await res.json().catch(() => null)) as { result?: number } | null;
      if (!body || typeof body.result !== 'number') return unknown(`pcloud ${res.status}`);
      if (body.result === 0) return ok;
      if (body.result === 7001) continue;
      if (body.result === 7004) return broken(EXPIRED);
      // 7002: the link was deleted; 2009 / 2010 / 2002: the file or its folder is gone.
      if ([7002, 2009, 2010, 2002].includes(body.result)) return broken(GONE);
      // 7005 / 7006 (traffic or download limits) pass.
      return unknown(`pcloud ${body.result}`);
    }
    return broken(BAD_LINK);
  }
  if (provider === 'myairbridge') {
    const exp = Date.parse(film.providerExpiresAt ?? '');
    if (Number.isFinite(exp) && exp <= now) return broken(EXPIRED);
    const share = parseMyAirBridgeLink(film.sourceUrl) ? film.sourceUrl : film.fileId;
    if (!parseMyAirBridgeLink(share)) return broken(BAD_LINK);
    const res = await ctx.fetch(share, { method: 'PROPFIND', headers: { Depth: '1' }, redirect: 'follow' });
    if (res.status === 429 || res.status >= 500) {
      await drain(res);
      return unknown(`myairbridge ${res.status}`);
    }
    if ((res.status !== 207 && res.status !== 200) || isPage(res)) {
      await drain(res);
      return broken(res.status === 200 ? PAGE : GONE);
    }
    const text = await res.text();
    const entries = /multistatus/i.test(text) ? parseMultistatus(text, res.url || share) : [];
    if (entries.length === 0) return broken(GONE);
    const until = Date.parse(entries[0].expiresAt ?? '');
    return Number.isFinite(until) && until <= now ? broken(EXPIRED) : ok;
  }
  return unknown(`provider ${String(provider)}`);
}

// ---------- the marks ----------

/** What the check found about one film it could not open. `alerted`: the studio's bell was written for it. */
export interface FilmMark {
  at: string;
  reason: string;
  alerted?: boolean;
}

/** Marks per film key (filmKey), kept 90 days after the last write (a gallery that is gone takes its marks with it). */
export type FilmMarks = Record<string, FilmMark>;

const MARKS_TTL = 90 * 86_400;
export const marksKey = (galleryId: string) => `filmcheck:${galleryId}`;

/** A film's identity across saves and reorders: its cloud and file, hashed (8 bytes, hex). */
export async function filmKey(film: Pick<Film, 'provider' | 'fileId' | 'sourceUrl'>): Promise<string> {
  const text = `${film.provider ?? 'dropbox'}|${film.fileId || film.sourceUrl}`;
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...d.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function readMarks(kv: Env['KV'], galleryId: string): Promise<FilmMarks> {
  const v = await kv.get<FilmMarks>(marksKey(galleryId), 'json');
  return v && typeof v === 'object' ? v : {};
}

/** Writes the marks (none left: the key goes). */
export async function writeMarks(kv: Env['KV'], galleryId: string, marks: FilmMarks): Promise<void> {
  if (Object.keys(marks).length === 0) await kv.delete(marksKey(galleryId));
  else await kv.put(marksKey(galleryId), JSON.stringify(marks), { expirationTtl: MARKS_TTL });
}

/**
 * Each film's mark, by its place in the list (null = none), for the hub's gallery screen. A film the studio replaced
 * has another key, so an old mark never sticks to it. A KV failure shows no marks (never fails the screen).
 */
export async function filmIssues(env: Env, galleryId: string, films: Film[]): Promise<(FilmMark | null)[]> {
  let marks: FilmMarks = {};
  try {
    marks = await readMarks(env.KV, galleryId);
  } catch (e) {
    console.error('[films] link marks could not be read:', (e as Error).message);
  }
  if (!Object.keys(marks).length) return films.map(() => null);
  return Promise.all(films.map(async (f) => marks[await filmKey(f)] ?? null));
}

