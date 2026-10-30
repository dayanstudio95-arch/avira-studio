import {
  guessTag,
  isPlayable,
  isVideoFile,
  parseDropboxLink,
  titleFromFileName,
  toDownloadUrl,
  toWatchUrl,
} from '../../shared/dropbox';
import type { CachedToken, Env, Film, Settings } from '../types';
import { HttpError } from '../types';

const API = 'https://api.dropboxapi.com/2';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
/**
 * Every permission the gallery uses. Asked for explicitly so a missing one fails at connect time. No `sharing.write`
 * (fix plan P65): films in the studio's own Dropbox are streamed by their file id, never through a public link we make.
 */
export const REQUIRED_SCOPES = ['account_info.read', 'files.metadata.read', 'files.content.read', 'sharing.read'];
const NOT_CONNECTED = 'דרופבוקס לא מחובר. חבר את החשבון בהגדרות או הדבק קישור לכל סרט בנפרד.';
const RECONNECT = 'חיבור הדרופבוקס פג. חבר מחדש בהגדרות';
const UNAVAILABLE = 'דרופבוקס לא זמין כרגע, נסו שוב בעוד רגע';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Dropbox's Retry-After in seconds, at most 3 (1 when missing or unreadable). */
function retryAfterOf(res: Response): number {
  const n = Number(res.headers.get('Retry-After') ?? 1);
  return Math.min(3, Number.isFinite(n) && n >= 0 ? n : 1);
}

/** Sends once more, after Dropbox's Retry-After, when Dropbox answers 429 (slow down) or 503. */
export async function retryBusy(send: () => Promise<Response>): Promise<Response> {
  const res = await send();
  if (res.status !== 429 && res.status !== 503) return res;
  await res.body?.cancel().catch(() => {});
  await sleep(retryAfterOf(res) * 1000);
  return send();
}

/**
 * One place that turns a failed Dropbox answer into something the studio can act on:
 * the platform's Dropbox app lacking a permission → support; this studio's connection lacking one →
 * disconnect and reconnect; a rejected token → reconnect; busy or down → try again soon.
 */
export function dropboxError(status: number, text: string, what = ''): HttpError {
  const appScope = /required scope '([^']+)'/.exec(text)?.[1];
  if (appScope) return new HttpError(400, `לאפליקציית הדרופבוקס של המערכת חסרה ההרשאה ${appScope}. פנו לתמיכה.`);
  if (status === 401 && /missing_scope/.test(text)) {
    const scope = /"required_scope"\s*:\s*"([^"]+)"/.exec(text)?.[1];
    return new HttpError(400, `לחיבור הדרופבוקס חסרה הרשאה${scope ? ` (${scope})` : ''}. נתקו וחברו מחדש את דרופבוקס בהגדרות.`);
  }
  if (status === 401) return new HttpError(400, `${RECONNECT}.`);
  if (status === 429 || status >= 500) return new HttpError(503, UNAVAILABLE);
  return new HttpError(400, `שגיאה מדרופבוקס${what ? ` (${what})` : ''}: ${text.slice(0, 200)}`);
}

export function oauthAuthorizeUrl(appKey: string, redirectUri: string, state: string): string {
  const u = new URL('https://www.dropbox.com/oauth2/authorize');
  u.searchParams.set('client_id', appKey);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('token_access_type', 'offline');
  u.searchParams.set('scope', REQUIRED_SCOPES.join(' '));
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('state', state);
  return u.toString();
}

export async function exchangeCode(settings: Settings, code: string, redirectUri: string): Promise<{ refreshToken: string }> {
  const body = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    client_id: settings.dropbox.appKey,
    client_secret: settings.dropbox.appSecret,
  });
  const res = await fetch(TOKEN_URL, { method: 'POST', body });
  const data = (await res.json().catch(() => ({}))) as { refresh_token?: string; error_description?: string };
  if (res.status === 429 || res.status >= 500) throw new HttpError(503, UNAVAILABLE);
  if (!res.ok || !data.refresh_token) throw new HttpError(400, `דרופבוקס סירב: ${data.error_description ?? res.status}`);
  return { refreshToken: data.refresh_token };
}

const TOKEN_KEY = 'dropbox:access_token';
const memo = new Map<string, CachedToken>();
/** Refreshes in progress, per studio and connection: a grid of previews asks Dropbox once. */
const inflight = new Map<string, Promise<CachedToken>>();
/** A request waits this long for someone else's refresh, then refreshes by itself. */
const SHARED_WAIT_MS = 5_000;

const cacheKeyOf = (settings?: Pick<Settings, 'dropbox'>) => `${TOKEN_KEY}:${settings?.dropbox.tokenOwnerId ?? 'default'}`;

/** Which connection a cached token belongs to (a hash, so the refresh token itself is never stored). */
async function refreshHashOf(refreshToken: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(refreshToken)));
  return [...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Short-lived access token, cached in memory and in KV (per studio) so video seeking doesn't hammer
 * OAuth. A cached token counts only for the connection that made it (after a reconnect it is ignored).
 */
export async function accessToken(settings: Settings, env?: Env): Promise<string> {
  const { refreshToken } = settings.dropbox;
  if (!refreshToken) throw new HttpError(400, NOT_CONNECTED);
  const cacheKey = cacheKeyOf(settings);
  const refreshHash = await refreshHashOf(refreshToken);
  const now = Date.now();
  const usable = (t: CachedToken | null | undefined): t is CachedToken => Boolean(t && t.refreshHash === refreshHash && t.expiresAt > now + 60_000);
  const inMemory = memo.get(cacheKey);
  if (usable(inMemory)) return inMemory.token;
  if (env) {
    const cached = await env.KV.get<CachedToken>(cacheKey, 'json').catch(() => null);
    if (usable(cached)) {
      memo.set(cacheKey, cached);
      return cached.token;
    }
  }
  const flightKey = `${cacheKey}:${refreshHash}`;
  const running = inflight.get(flightKey);
  if (running) {
    // Someone else is already refreshing: use theirs, but don't wait forever.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((r) => (timer = setTimeout(() => r(null), SHARED_WAIT_MS)));
    const shared = await Promise.race([running, late]).finally(() => clearTimeout(timer));
    if (shared) return shared.token;
    return (await refreshAccessToken(settings, cacheKey, refreshHash, env)).token;
  }
  const mine = refreshAccessToken(settings, cacheKey, refreshHash, env).finally(() => {
    if (inflight.get(flightKey) === mine) inflight.delete(flightKey);
  });
  inflight.set(flightKey, mine);
  return (await mine).token;
}

type TokenAnswer = { status: number; data: { access_token?: string; expires_in?: number; error?: string; error_description?: string } | null; retryAfter: number };

/** One call to Dropbox's token endpoint. Never throws: a network error or a non-JSON page is an answer too. */
async function postToken(body: URLSearchParams): Promise<TokenAnswer> {
  try {
    const res = await fetch(TOKEN_URL, { method: 'POST', body });
    const text = await res.text();
    let data: TokenAnswer['data'] = null;
    try {
      data = JSON.parse(text);
    } catch {
      /* an HTML error page */
    }
    return { status: res.status, data, retryAfter: retryAfterOf(res) };
  } catch {
    return { status: 0, data: null, retryAfter: 1 };
  }
}

/** Busy, down, unreachable, or an answer without a token: temporary, not a rejected connection. */
const temporary = (a: TokenAnswer) => a.status === 0 || a.status === 429 || a.status >= 500 || (a.status < 300 && !a.data?.access_token);

async function refreshAccessToken(settings: Settings, cacheKey: string, refreshHash: string, env?: Env): Promise<CachedToken> {
  const { appKey, appSecret, refreshToken } = settings.dropbox;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken!,
    client_id: appKey,
    client_secret: appSecret,
  });
  let answer = await postToken(body);
  if (temporary(answer)) {
    await sleep(answer.retryAfter * 1000);
    answer = await postToken(body);
  }
  if (temporary(answer)) throw new HttpError(503, UNAVAILABLE);
  const data = answer.data!;
  if (answer.status >= 300 || !data.access_token) {
    // Dropbox really refused: the platform's app keys (support) or this studio's connection (reconnect).
    if (data.error === 'invalid_client') throw new HttpError(400, 'אפליקציית הדרופבוקס של המערכת לא מוגדרת נכון. פנו לתמיכה.');
    throw new HttpError(400, `${RECONNECT} (${data.error_description ?? data.error ?? answer.status})`);
  }
  const ttl = Math.max(600, Math.min(data.expires_in ?? 14_400, 14_400));
  const fresh: CachedToken = { token: data.access_token, expiresAt: Date.now() + ttl * 1000, refreshHash };
  memo.set(cacheKey, fresh);
  // KV allows one write per second per key: a failed write only costs a later refresh.
  if (env) await env.KV.put(cacheKey, JSON.stringify(fresh), { expirationTtl: ttl }).catch((e) => console.error('dropbox token: KV write failed', String(e)));
  return fresh;
}

/**
 * Drops the studio's cached token. With `failedToken`, only when that is still the cached one (so a
 * late 401 doesn't throw away the token another request just refreshed).
 */
export async function forgetAccessToken(env: Env, settings?: Pick<Settings, 'dropbox'>, failedToken?: string): Promise<void> {
  const cacheKey = cacheKeyOf(settings);
  if (!failedToken || memo.get(cacheKey)?.token === failedToken) memo.delete(cacheKey);
  try {
    if (failedToken) {
      const stored = await env.KV.get<CachedToken>(cacheKey, 'json');
      if (stored && stored.token !== failedToken) return;
    }
    await env.KV.delete(cacheKey);
  } catch (e) {
    console.error('dropbox token: KV delete failed', String(e));
  }
}

/**
 * Ends the studio's connection at Dropbox itself (fix plan P65): disconnect and a reconnect over an earlier connection
 * call this BEFORE the stored token is removed or replaced. Dropbox's revoke disables the access token used to call it,
 * its refresh token and every other access token of that refresh token. One try: a failure (Dropbox down, a token
 * already dead, the platform app not set up) is logged — never the token — and the disconnect on our side goes on.
 * True when Dropbox confirmed it.
 */
export async function revokeConnection(settings: Settings, env: Env): Promise<boolean> {
  const { refreshToken, appKey, appSecret } = settings.dropbox;
  // No connection, or no platform app to turn the refresh token into an access token with (local previews).
  if (!refreshToken || !appKey || !appSecret) return false;
  try {
    const token = await accessToken(settings, env);
    const res = await fetch(`${API}/auth/token/revoke`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    await res.body?.cancel().catch(() => {});
    if (!res.ok) console.error(`dropbox revoke: Dropbox answered ${res.status}; the connection is removed on our side only`);
    return res.ok;
  } catch (e) {
    console.error(`dropbox revoke failed (${e instanceof HttpError ? e.status : 'network'}); the connection is removed on our side only`);
    return false;
  }
}

/** An authorised Dropbox session. `pathRoot` switches team accounts to the team's root folder. */
export interface Session {
  token: string;
  pathRoot?: string;
}

export async function call(session: Session | string, path: string, body: unknown): Promise<Response> {
  const s = typeof session === 'string' ? { token: session } : session;
  const headers: Record<string, string> = { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' };
  if (s.pathRoot) headers['Dropbox-API-Path-Root'] = JSON.stringify({ '.tag': 'root', root: s.pathRoot });
  const payload = JSON.stringify(body);
  return retryBusy(() => fetch(`${API}/${path}`, { method: 'POST', headers, body: payload }));
}

export async function api<T>(session: Session | string, path: string, body: unknown): Promise<T> {
  const res = await call(session, path, body);
  if (!res.ok) throw dropboxError(res.status, await res.text().catch(() => ''), path);
  return (await res.json()) as T;
}

export interface Account {
  name?: { display_name?: string };
  email?: string;
  root_info?: { '.tag'?: string; root_namespace_id?: string; home_namespace_id?: string };
}

export interface Entry {
  '.tag': 'file' | 'folder';
  name: string;
  id?: string;
  path_lower?: string;
  path_display?: string;
  size?: number;
  /** A file's revision and Dropbox's hash of its content (fix plan P66: the photo's version). */
  rev?: string;
  content_hash?: string;
}

export async function accountName(settings: Settings, env?: Env): Promise<string> {
  const token = await accessToken(settings, env);
  const me = await api<Account>(token, 'users/get_current_account', null);
  return me.name?.display_name || me.email || '';
}

/** Lists a folder (all pages). Returns null when Dropbox says the path doesn't exist from this root. */
async function listAll(session: Session, path: string): Promise<Entry[] | null> {
  const first = await call(session, 'files/list_folder', { path, recursive: false });
  if (!first.ok) {
    const text = await first.text();
    if (first.status === 409 && /not_found/.test(text)) return null;
    throw dropboxError(first.status, text, 'files/list_folder');
  }
  let page = (await first.json()) as { entries: Entry[]; cursor: string; has_more: boolean };
  const entries = [...page.entries];
  while (page.has_more) {
    page = await api(session, 'files/list_folder/continue', { cursor: page.cursor });
    entries.push(...page.entries);
  }
  return entries;
}

function filmFrom(name: string, size: number, link: string): Film {
  const canonical = parseDropboxLink(link)?.canonical ?? link;
  return {
    title: titleFromFileName(name),
    tag: guessTag(name),
    fileName: name,
    provider: 'dropbox',
    fileId: canonical,
    sourceUrl: canonical,
    watchUrl: toWatchUrl(link),
    downloadUrl: toDownloadUrl(link),
    sizeBytes: size,
    playable: isPlayable(name),
  };
}

/** A shared folder link → the video files inside it, each with its own share link. */
/**
 * Finds a shared folder inside the connected account (home folder or team root, by path or id).
 * `entries`/`ref` are null when the folder lives in someone else's Dropbox.
 */
export async function locateOwnFolder(token: string, canonicalUrl: string) {
  const me = await api<Account>(token, 'users/get_current_account', null);
  const rootNs = me.root_info?.root_namespace_id;
  const teamRoot = rootNs && rootNs !== me.root_info?.home_namespace_id ? rootNs : undefined;
  const sessions: Session[] = [{ token }];
  if (teamRoot) sessions.push({ token, pathRoot: teamRoot });
  let session: Session = sessions[0];
  let meta: Entry | null = null;
  let entries: Entry[] | null = null;
  let ref: string | null = null;
  const tried: string[] = [];
  for (const candidate of sessions) {
    const m = await api<Entry>(candidate, 'sharing/get_shared_link_metadata', { url: canonicalUrl });
    if (m['.tag'] !== 'folder') throw new HttpError(400, 'הקישור הזה הוא לקובץ, לא לתיקייה');
    meta = m;
    for (const r of [m.path_lower, m.id]) {
      if (!r) continue;
      const listed = await listAll(candidate, r);
      tried.push(`${candidate.pathRoot ? 'team' : 'home'}:${r.startsWith('id:') ? 'id' : 'path'}:${listed ? 'ok' : 'not_found'}`);
      if (listed) {
        session = candidate;
        entries = listed;
        ref = r;
        break;
      }
    }
    if (entries) break;
  }
  return { me, meta, entries, ref, session, tried };
}

export async function resolveDropboxFolder(env: Env, settings: Settings, url: string): Promise<{ folderName: string; films: Film[] }> {
  const parsed = parseDropboxLink(url);
  if (!parsed || parsed.kind !== 'folder') throw new HttpError(400, 'זה לא קישור לתיקיית דרופבוקס');
  if (env.CLOUD_MOCK) return mockDropboxFolder(parsed.canonical);

  const token = await accessToken(settings, env);
  const found = await locateOwnFolder(token, parsed.canonical);
  const { me, meta, tried } = found;
  const session = found.session;
  const entries = found.entries;

  if (!meta || !entries) {
    // Not in this account (a friend's studio, for example): read it through the public link and
    // stream the files through our own site later.
    console.log('dropbox folder not in account, using shared link', JSON.stringify({ tried, rootInfo: me.root_info }));
    return resolveViaSharedLink(token, parsed.canonical, meta?.name ?? parsed.name);
  }

  const videos = entries.filter((e) => e['.tag'] === 'file' && isVideoFile(e.name) && (e.path_lower || e.id));
  if (videos.length === 0) throw new HttpError(400, 'לא נמצאו קבצי וידאו בתיקייה (רק ברמה הראשונה, לא בתיקיות פנימיות)');

  // In the studio's own account (fix plan P65): each film is kept by Dropbox's file id (a renamed or moved file keeps
  // it) and streamed through our site with the studio's connection — no public link is made or reused for it.
  const films = videos.map((v) => ownFilm(v, parsed.canonical, session.pathRoot));
  return { folderName: meta.name, films };
}

/** A film in the studio's connected Dropbox ('dropbox-own'): its id, the folder link it came from, the team root. */
function ownFilm(v: Entry, folderUrl: string, pathRoot?: string): Film {
  return {
    title: titleFromFileName(v.name),
    tag: guessTag(v.name),
    fileName: v.name,
    provider: 'dropbox-own',
    fileId: (v.id ?? v.path_lower)!,
    ...(pathRoot ? { pathRoot } : {}),
    sourceUrl: folderUrl,
    watchUrl: '',
    downloadUrl: '',
    sizeBytes: v.size ?? 0,
    playable: isPlayable(v.name),
  };
}

/** Lists a public folder link that lives in someone else's Dropbox. Files become `dropbox-link` films. */
async function resolveViaSharedLink(token: string, folderUrl: string, fallbackName: string): Promise<{ folderName: string; films: Film[] }> {
  const res = await call(token, 'files/list_folder', { path: '', shared_link: { url: folderUrl }, recursive: false });
  if (!res.ok) {
    const text = await res.text();
    if (/shared_link_access_denied|password/i.test(text)) throw new HttpError(400, 'הקישור מוגן בסיסמה או לא ציבורי. בקש מבעל התיקייה קישור פתוח ("כל מי שיש לו את הקישור").');
    if (/not_found/i.test(text)) throw new HttpError(400, 'דרופבוקס לא מצא את התיקייה. בדוק שהקישור עדיין פעיל.');
    throw dropboxError(res.status, text, 'files/list_folder');
  }
  let page = (await res.json()) as { entries: Entry[]; cursor: string; has_more: boolean };
  const entries = [...page.entries];
  while (page.has_more) {
    page = await api(token, 'files/list_folder/continue', { cursor: page.cursor });
    entries.push(...page.entries);
  }
  const videos = entries.filter((e) => e['.tag'] === 'file' && isVideoFile(e.name));
  if (videos.length === 0) throw new HttpError(400, 'לא נמצאו קבצי וידאו בתיקייה (רק ברמה הראשונה, לא בתיקיות פנימיות)');
  const films = videos.map((v) => {
    const rel = v.path_lower && v.path_lower.startsWith('/') ? v.path_lower : `/${v.name}`;
    return {
      title: titleFromFileName(v.name),
      tag: guessTag(v.name),
      fileName: v.name,
      provider: 'dropbox-link' as const,
      fileId: rel,
      sourceUrl: folderUrl,
      watchUrl: '',
      downloadUrl: '',
      sizeBytes: v.size ?? 0,
      playable: isPlayable(v.name),
    };
  });
  return { folderName: fallbackName, films };
}

const CONTENT_TYPES: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska' };

/** An answer that is a web page (an error or sign-in page), not a file. */
export function isPage(res: Response): boolean {
  return /^text\/html|application\/xhtml/i.test((res.headers.get('Content-Type') ?? '').trim());
}

/** Escapes non-ASCII for the Dropbox-API-Arg header (HTTP headers must be ASCII). */
export function apiArg(obj: unknown): string {
  return JSON.stringify(obj).replace(/[\u007f-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

/**
 * Streams one file from inside a shared folder link, forwarding the browser's Range so the
 * player can seek. The couple never sees the Dropbox token.
 */
export function streamSharedLinkFile(settings: Settings, env: Env, film: Film, request: Request, download: boolean): Promise<Response> {
  return streamContent(settings, env, film, request, download, 'sharing/get_shared_link_file', { url: film.sourceUrl, path: film.fileId });
}

/**
 * Streams a film from the studio's own Dropbox by its file id ('dropbox-own', fix plan P65), with the studio's
 * connection, the way photos are read (files/download, Range forwarded). The couple never sees a Dropbox address.
 */
export function streamOwnFile(settings: Settings, env: Env, film: Film, request: Request, download: boolean): Promise<Response> {
  return streamContent(settings, env, film, request, download, 'files/download', { path: film.fileId }, film.pathRoot);
}

/** One content call with the studio's token (one more try with a new token after a 401), relayed to the browser. */
async function streamContent(
  settings: Settings,
  env: Env,
  film: Film,
  request: Request,
  download: boolean,
  endpoint: string,
  arg: unknown,
  pathRoot?: string,
): Promise<Response> {
  const range = request.headers.get('Range');
  const open = (token: string) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Dropbox-API-Arg': apiArg(arg),
    };
    if (pathRoot) headers['Dropbox-API-Path-Root'] = JSON.stringify({ '.tag': 'root', root: pathRoot });
    if (range) headers.Range = range;
    return fetch(`https://content.dropboxapi.com/2/${endpoint}`, { method: 'POST', headers });
  };
  let token = await accessToken(settings, env);
  let upstream = await open(token);
  let failure = '';
  if (upstream.status === 401) {
    failure = await upstream.text();
    // A rejected token (expired, revoked): drop it if it is still the cached one, and try once more.
    if (!/missing_scope/.test(failure)) {
      await forgetAccessToken(env, settings, token);
      token = await accessToken(settings, env);
      upstream = await open(token);
      failure = '';
    }
  }
  if (!upstream.ok && upstream.status !== 206) {
    const text = failure || (await upstream.text());
    const reason = upstream.status === 401 ? dropboxError(401, text).message : text.slice(0, 200);
    return new Response(`הקובץ לא זמין כרגע (${upstream.status}): ${reason}`, { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  // A page is never a film (P65): it would reach the player as if it were the video.
  if (isPage(upstream)) {
    console.error(`[films] dropbox ${endpoint}: a page (${upstream.headers.get('Content-Type')}) instead of the file`);
    await upstream.body?.cancel().catch(() => {});
    return new Response('הקובץ לא זמין כרגע', { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  const ext = (film.fileName.split('.').pop() ?? '').toLowerCase();
  const out = new Headers();
  out.set('Content-Type', CONTENT_TYPES[ext] ?? 'application/octet-stream');
  out.set('Accept-Ranges', 'bytes');
  out.set('Cache-Control', 'private, max-age=3600');
  for (const h of ['Content-Length', 'Content-Range', 'ETag', 'Last-Modified']) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  if (download) {
    const ascii = film.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
    out.set('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(film.fileName)}`);
  }
  return new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: out });
}

/** A single file link → film details. Uses the API when connected, otherwise a HEAD request. */
export async function resolveDropboxFile(env: Env, settings: Settings, url: string): Promise<Film> {
  const parsed = parseDropboxLink(url);
  if (!parsed) throw new HttpError(400, 'זה לא נראה כמו קישור דרופבוקס');
  if (parsed.kind === 'folder') throw new HttpError(400, 'זה קישור לתיקייה. הדבק אותו בשדה התיקייה למעלה');
  if (env.CLOUD_MOCK) return filmFrom(parsed.name || 'mock.mp4', 1_234_567, parsed.canonical);

  if (settings.dropbox.refreshToken) {
    try {
      const token = await accessToken(settings, env);
      const meta = await api<Entry>(token, 'sharing/get_shared_link_metadata', { url: parsed.canonical });
      return filmFrom(meta.name, meta.size ?? 0, parsed.canonical);
    } catch {
      // fall through to the plain HTTP check
    }
  }
  const res = await fetch(toWatchUrl(parsed.canonical), { method: 'HEAD', redirect: 'follow' });
  if (!res.ok) throw new HttpError(400, `הקישור לא נפתח (קוד ${res.status}). בדוק שהקובץ עדיין משותף`);
  const size = Number(res.headers.get('content-length') ?? 0);
  const name = parsed.name || nameFromDisposition(res.headers.get('content-disposition')) || 'film.mp4';
  return filmFrom(name, size, parsed.canonical);
}

function nameFromDisposition(header: string | null): string {
  if (!header) return '';
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      /* ignore */
    }
  }
  const plain = /filename="([^"]+)"/i.exec(header);
  return plain ? plain[1] : '';
}

export function mockDropboxFolder(canonical: string): { folderName: string; films: Film[] } {
  const folderId = /\/scl\/fo\/([^/]+)/.exec(canonical)?.[1] ?? 'mock';
  const mk = (name: string, size: number, i: number, demo?: string) => {
    const film = filmFrom(name, size, `https://www.dropbox.com/scl/fi/${folderId}${i}/${encodeURIComponent(name)}?rlkey=mock${i}`);
    // Local demo clips so playback can be tried without a real Dropbox connection.
    return demo ? { ...film, watchUrl: demo } : film;
  };
  return {
    folderName: 'רוני ורז - 11.8.26',
    films: [
      mk('רוני ורז - הייליטס 4K.mp4', 2_460_912_400, 1, '/demo/highlights.mp4'),
      mk('רוני ורז - הייליטס 1080p.mp4', 354_600_000, 5, '/demo/highlights-1080p.mp4'),
      mk('רוני ורז - טיזר.mp4', 55_700_000, 2),
      mk('רוני ורז - הסרט המלא.mov', 6_764_573_000, 3),
      mk('רוני ורז - רילס.mp4', 52_800_000, 4, '/demo/reels.mp4'),
    ],
  };
}

/** Dropbox URLs for the couple's page. */
export function dropboxUrls(fileId: string): { watchUrl: string; downloadUrl: string } {
  return { watchUrl: toWatchUrl(fileId), downloadUrl: toDownloadUrl(fileId) };
}
