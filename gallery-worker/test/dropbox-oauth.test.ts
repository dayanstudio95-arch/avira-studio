// Dropbox connect must be finished by the same signed-in admin, in the same
// studio, that started it (no OAuth login CSRF). And the connection's tokens:
// the right permissions, one refresh at a time, nothing stale after a reconnect.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import { sign } from '../worker/auth';
import { accessToken, api, forgetAccessToken, oauthAuthorizeUrl, streamSharedLinkFile } from '../worker/providers/dropbox';
import { storeFor } from '../worker/store';
import { HttpError, type Env, type Film, type Settings } from '../worker/types';
import { fakeEnv } from './fake-kv';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const env = { ...fakeEnv(), CLOUD_MOCK: '1', DROPBOX_APP_KEY: 'k', DROPBOX_APP_SECRET: 's' } as Env;

async function finish(token: string, state: string) {
  const req = new Request('https://films/api/admin/dropbox/finish', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'abc', state }),
  });
  return worker.fetch(req, env);
}

describe('Dropbox OAuth finish', () => {
  it('refuses a state started by another person, even in the same studio', async () => {
    const state = await sign('mock-state-secret', `dbx:${A}:alice:${Date.now()}`);
    expect((await finish(`test:bob:${A}:owner`, state)).status).toBe(403);
  });

  it('refuses a state from another studio', async () => {
    const state = await sign('mock-state-secret', `dbx:${A}:alice:${Date.now()}`);
    expect((await finish(`test:alice:${B}:owner`, state)).status).toBe(403);
  });

  it('refuses expired and forged states', async () => {
    const old = await sign('mock-state-secret', `dbx:${A}:alice:${Date.now() - 20 * 60_000}`);
    expect((await finish(`test:alice:${A}:owner`, old)).status).toBe(400);
    const forged = await sign('wrong-secret', `dbx:${A}:alice:${Date.now()}`);
    expect((await finish(`test:alice:${A}:owner`, forged)).status).toBe(400);
  });
});

// ---------- the connection's tokens ----------

/**
 * A fake Dropbox. Authorization code `code-X` gives refresh token `X`; refresh token `X` gives
 * access tokens `X-at1`, `X-at2`, … Account `X` owns the files under `/X/`.
 */
const dbx = {
  calls: [] as { url: string; auth?: string; grant?: string }[],
  issued: 0,
  rejected: new Set<string>(),
  /** Every content call answers 401 with this body (e.g. missing_scope), when set. */
  content401: '',
  /** Answers for the token endpoint, used up one by one before the normal answer. */
  tokenAnswers: [] as (() => Response)[],
  /** Answers for the API endpoints, used up one by one before the normal answer. */
  apiAnswers: [] as (() => Response)[],
  tokenDelayMs: 0,
};
const refreshes = () => dbx.calls.filter((c) => c.grant === 'refresh_token').length;
const bearers = (frag: string) => dbx.calls.filter((c) => c.url.includes(frag)).map((c) => c.auth);

async function fakeDropbox(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const h = (init?.headers ?? {}) as Record<string, string>;
  if (url === 'https://api.dropboxapi.com/oauth2/token') {
    const p = new URLSearchParams(String(init?.body));
    dbx.calls.push({ url, grant: p.get('grant_type') ?? '' });
    if (dbx.tokenDelayMs) await new Promise((r) => setTimeout(r, dbx.tokenDelayMs));
    const next = dbx.tokenAnswers.shift();
    if (next) return next();
    if (p.get('grant_type') === 'authorization_code') return Response.json({ refresh_token: p.get('code')!.replace(/^code-/, '') });
    return Response.json({ access_token: `${p.get('refresh_token')}-at${++dbx.issued}`, expires_in: 14400 });
  }
  const auth = h.Authorization?.replace(/^Bearer /, '');
  dbx.calls.push({ url, auth });
  const account = auth?.replace(/-at\d+$/, '');
  if (url.startsWith('https://api.dropboxapi.com/2/')) {
    const next = dbx.apiAnswers.shift();
    if (next) return next();
    if (url.endsWith('/users/get_current_account')) return Response.json({ name: { display_name: `Account ${account}` } });
    return Response.json({});
  }
  if (auth && dbx.rejected.has(auth)) return Response.json({ error_summary: 'expired_access_token/', error: { '.tag': 'expired_access_token' } }, { status: 401 });
  if (dbx.content401) return new Response(dbx.content401, { status: 401 });
  if (url.endsWith('/sharing/get_shared_link_file')) return new Response('video', { status: 200 });
  const arg = JSON.parse(h['Dropbox-API-Arg']);
  const path: string = arg.resource?.path ?? arg.path;
  if (!path.startsWith(`/${account}/`)) return Response.json({ error_summary: 'path/not_found/' }, { status: 409 });
  return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
}

const T = '33333333-3333-4333-8333-333333333333';
const env2 = { ...fakeEnv(), CLOUD_MOCK: '1', DROPBOX_APP_KEY: 'k', DROPBOX_APP_SECRET: 's' } as Env & { dump: () => Record<string, string> };
const owner = (tid: string) => ({ Authorization: `Bearer test:owner:${tid}:owner` });
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  worker.fetch(
    new Request(`https://films.test${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.0.0.9', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env2,
  );

async function connect(tid: string, code: string) {
  const state = await sign('mock-state-secret', `dbx:${tid}:owner:${Date.now()}`);
  const res = await call('POST', '/api/admin/dropbox/finish', { code, state }, owner(tid));
  return (await res.json()) as { dropbox?: { accountName?: string }; error?: string };
}

async function photoGallery(tid: string, paths: string[]) {
  const res = await call('POST', '/api/admin/galleries', { coupleName: 'זוג בדיקה', kind: 'photos' }, owner(tid));
  const g = (await res.json()) as { id: string };
  await (await storeFor(env2)).savePhotos(tid, g.id, {
    folderUrl: 'https://www.dropbox.com/scl/fo/fake/abc?rlkey=x',
    provider: 'dropbox',
    sets: [],
    items: paths.map((p, i) => ({ key: `k${i}`, name: `IMG_${i}.jpg`, ref: `p:${p}` })),
  } as never);
  return g.id;
}

const settingsFor = (tid: string, refreshToken: string) =>
  ({ dropbox: { appKey: 'k', appSecret: 's', refreshToken, tokenOwnerId: tid }, googleApiKey: '' }) as unknown as Settings;

/** The HttpError a call fails with (a call that succeeds fails the test). */
const failure = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error('expected the call to fail');
    },
    (e: HttpError) => e,
  );

const edgeCache = new Map<string, Response>();
beforeEach(() => {
  Object.assign(dbx, { calls: [], issued: 0, rejected: new Set(), content401: '', tokenAnswers: [], apiAnswers: [], tokenDelayMs: 0 });
  edgeCache.clear();
  vi.stubGlobal('fetch', fakeDropbox);
  vi.stubGlobal('caches', {
    default: {
      match: async (req: Request) => edgeCache.get(req.url)?.clone(),
      put: async (req: Request, res: Response) => void edgeCache.set(req.url, res),
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Dropbox connection tokens', () => {
  it('asks for files.content.read (previews and originals need it) when connecting', () => {
    const scopes = new URL(oauthAuthorizeUrl('k', 'https://films.test/cb', 'st')).searchParams.get('scope')!.split(' ');
    expect(scopes).toContain('files.content.read');
    expect(scopes).toContain('files.metadata.read');
  });

  it('20 requests at once refresh the token once, and a failing KV write or delete does not fail them', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    dbx.tokenDelayMs = 20;
    const kvEnv = { KV: { get: async () => null, put: async () => Promise.reject(new Error('KV PUT failed: 429 Too Many Requests')), delete: async () => Promise.reject(new Error('KV down')) } } as unknown as Env;
    const s = settingsFor('stampede', 'R1');
    const tokens = await Promise.all(Array.from({ length: 20 }, () => accessToken(s, kvEnv)));
    expect(refreshes()).toBe(1);
    expect(new Set(tokens)).toEqual(new Set(['R1-at1']));
    await expect(forgetAccessToken(kvEnv, s)).resolves.toBeUndefined();
  });

  it('after a reconnect the new token and the new account name are used at once', async () => {
    expect((await connect(T, 'code-A')).dropbox?.accountName).toBe('Account A');
    const gid = await photoGallery(T, ['/A/one.jpg', '/B/two.jpg']);
    expect((await call('GET', `/api/photos/${gid}/k0?s=m`)).status).toBe(200);

    dbx.calls = [];
    const again = await connect(T, 'code-B');
    expect(again.dropbox?.accountName).toBe('Account B');
    expect((await (await storeFor(env2)).getFilmsStudio(T)).dropboxAccountName).toBe('Account B');
    expect(bearers('get_current_account')).toEqual(['B-at2']);

    dbx.calls = [];
    expect((await call('GET', `/api/photos/${gid}/k1?s=m`)).status).toBe(200);
    expect(bearers('get_thumbnail_v2')).toEqual(['B-at2']);

    // A token another isolate cached in KV for the old connection is not used either
    // (this isolate's memory is emptied first, KV kept).
    await forgetAccessToken({ KV: { get: async () => null, delete: async () => undefined } } as unknown as Env, settingsFor(T, 'B'));
    await env2.KV.put(`dropbox:access_token:${T}`, JSON.stringify({ token: 'A-at9', expiresAt: Date.now() + 3_600_000 }));
    expect(await accessToken(settingsFor(T, 'B'), env2)).toBe('B-at3');
  });

  it('a busy or failing token endpoint is tried once more, then says "try again", not "reconnect"', async () => {
    const html503 = () => new Response('<html>503 Service Unavailable</html>', { status: 503, headers: { 'Retry-After': '0' } });
    dbx.tokenAnswers = [html503, html503];
    const err = await failure(accessToken(settingsFor('busy1', 'R'), env2));
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(503);
    expect(err.message).toBe('דרופבוקס לא זמין כרגע, נסו שוב בעוד רגע');
    expect(refreshes()).toBe(2);

    dbx.tokenAnswers = [() => new Response('{}', { status: 429, headers: { 'Retry-After': '0' } })];
    expect(await accessToken(settingsFor('busy2', 'R'), env2)).toMatch(/^R-at/);

    dbx.tokenAnswers = [() => Response.json({ error: 'invalid_grant', error_description: 'refresh token is invalid or revoked' }, { status: 400 })];
    const rejected = await failure(accessToken(settingsFor('busy3', 'R'), env2));
    expect(rejected.status).toBe(400);
    expect(rejected.message).toContain('חבר מחדש');
  });

  it('API calls wait out a 429 once, and turn busy, missing-permission and app answers into clear messages', async () => {
    dbx.apiAnswers = [() => new Response('{"error_summary":"too_many_requests/"}', { status: 429, headers: { 'Retry-After': '0' } })];
    expect(await api('tok', 'files/list_folder/continue', { cursor: 'c' })).toEqual({});
    expect(bearers('list_folder/continue')).toHaveLength(2);

    const unavailable = () => new Response('upstream connect error', { status: 503, headers: { 'Retry-After': '0' } });
    dbx.apiAnswers = [unavailable, unavailable];
    const busy = await failure(api('tok', 'files/list_folder', {}));
    expect([busy.status, busy.message]).toEqual([503, 'דרופבוקס לא זמין כרגע, נסו שוב בעוד רגע']);

    dbx.apiAnswers = [() => Response.json({ error_summary: 'missing_scope/', error: { '.tag': 'missing_scope', required_scope: 'files.content.read' } }, { status: 401 })];
    const scope = await failure(api('tok', 'files/list_folder', {}));
    expect(scope.message).toContain('files.content.read');
    expect(scope.message).toContain('נתקו וחברו מחדש');

    dbx.apiAnswers = [() => new Response("Your app is not permitted to access this endpoint because it does not have the required scope 'files.content.read'.", { status: 400 })];
    const app = await failure(api('tok', 'files/list_folder', {}));
    expect(app.message).toContain('פנו לתמיכה');
    expect(app.message).not.toContain('Permissions');
  });

  it('a photo or a film whose token was rejected gets one new token and loads', async () => {
    const tid = '44444444-4444-4444-8444-444444444444';
    await connect(tid, 'code-C');
    const gid = await photoGallery(tid, ['/C/0.jpg', '/C/1.jpg', '/C/2.jpg', '/C/3.jpg', '/C/4.jpg', '/C/5.jpg']);
    expect((await call('GET', `/api/photos/${gid}/k0?s=m`)).status).toBe(200);
    const first = bearers('get_thumbnail_v2')[0]!;

    dbx.rejected.add(first);
    dbx.calls = [];
    const statuses = await Promise.all([1, 2, 3, 4, 5].map(async (i) => (await call('GET', `/api/photos/${gid}/k${i}?s=m`)).status));
    expect(statuses).toEqual([200, 200, 200, 200, 200]);
    expect(refreshes()).toBe(1);

    const s = settingsFor(tid, 'C');
    dbx.rejected.add(await accessToken(s, env2));
    const film = { fileName: 'a.mp4', fileId: '/a.mp4', sourceUrl: 'https://www.dropbox.com/scl/fo/x' } as Film;
    const res = await streamSharedLinkFile(s, env2, film, new Request('https://films.test/'), false);
    expect(res.status).toBe(200);
  });

  it('reading photo dates says "reconnect" on a Dropbox 401 instead of empty dates', async () => {
    const tid = '55555555-5555-4555-8555-555555555555';
    await connect(tid, 'code-D');
    const gid = await photoGallery(tid, ['/D/0.jpg', '/D/1.jpg']);
    const dates = () => call('POST', `/api/admin/galleries/${gid}/photos/dates`, { keys: ['k0', 'k1'] }, owner(tid));

    const ok = await dates();
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ dates: { k0: null, k1: null }, labels: { k0: '', k1: '' }, failed: [], skipped: [], batch: 20 });

    dbx.content401 = JSON.stringify({ error_summary: 'invalid_access_token/', error: { '.tag': 'invalid_access_token' } });
    const revoked = await dates();
    expect(revoked.status).toBe(400);
    expect(((await revoked.json()) as { error: string }).error).toContain('חבר מחדש');

    dbx.content401 = JSON.stringify({ error_summary: 'missing_scope/', error: { '.tag': 'missing_scope', required_scope: 'files.content.read' } });
    const scope = await dates();
    expect(scope.status).toBe(400);
    expect(((await scope.json()) as { error: string }).error).toContain('נתקו וחברו מחדש');
  });
});

// Fix plan P65: disconnect and a reconnect end the old connection at Dropbox itself (its token stops everywhere), one
// try that never keeps the studio connected; the cache is cleared; a couple whose photos came through it is told so.
describe('ending the connection at Dropbox (P65)', () => {
  const revokes = () => dbx.calls.filter((c) => c.url.endsWith('/auth/token/revoke'));

  it('a reconnect revokes the previous connection before storing the new one; a disconnect revokes it and clears the cache', async () => {
    const tid = '66666666-6666-4666-8666-666666666666';
    await connect(tid, 'code-E');
    const oldToken = bearers('get_current_account')[0];
    expect(oldToken).toMatch(/^E-at/);
    dbx.calls = [];
    expect((await connect(tid, 'code-F')).dropbox?.accountName).toBe('Account F');
    expect(revokes().map((c) => c.auth)).toEqual([oldToken]);
    // Revoked after the new code was exchanged (a failed exchange keeps the old connection), before F was used.
    const order = dbx.calls.map((c) => (c.grant === 'authorization_code' ? 'exchange' : c.url.endsWith('/auth/token/revoke') ? 'revoke' : c.url.endsWith('/get_current_account') ? 'account' : 'other'));
    expect(order.filter((x) => x !== 'other')).toEqual(['exchange', 'revoke', 'account']);
    expect(env2.dump()[`dropbox:access_token:${tid}`]).toContain('F-at');

    dbx.calls = [];
    const res = await call('POST', '/api/admin/dropbox/disconnect', undefined, owner(tid));
    expect(((await res.json()) as { dropbox: { connected: boolean } }).dropbox.connected).toBe(false);
    expect(revokes().map((c) => c.auth)).toEqual([expect.stringMatching(/^F-at/)]);
    expect(env2.dump()[`dropbox:access_token:${tid}`]).toBeUndefined();
    // Nothing to revoke any more: a second disconnect asks Dropbox nothing.
    dbx.calls = [];
    await call('POST', '/api/admin/dropbox/disconnect', undefined, owner(tid));
    expect(revokes()).toEqual([]);
  });

  it('a revoke Dropbox refuses or never answers does not keep the studio connected, and logs no token', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tid = '77777777-7777-4777-8777-777777777777';
    await connect(tid, 'code-G');
    dbx.apiAnswers = [() => new Response('{"error_summary":"internal"}', { status: 500 })];
    const res = await call('POST', '/api/admin/dropbox/disconnect', undefined, owner(tid));
    expect(((await res.json()) as { dropbox: { connected: boolean } }).dropbox.connected).toBe(false);
    expect(revokes()).toHaveLength(1);
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/G-at|\bG\b/);
  });

  it("a couple whose photos came through the disconnected Dropbox is told so, not shown a studio message", async () => {
    const tid = '88888888-8888-4888-8888-888888888888';
    await connect(tid, 'code-H');
    const gid = await photoGallery(tid, ['/H/0.jpg']);
    const before = (await (await call('GET', `/api/watch/${gid}`)).json()) as { photos: { cloudOff?: boolean } };
    expect(before.photos.cloudOff).toBeUndefined();
    await call('POST', '/api/admin/dropbox/disconnect', undefined, owner(tid));
    const after = (await (await call('GET', `/api/watch/${gid}`)).json()) as { photos: { cloudOff?: boolean } };
    expect(after.photos.cloudOff).toBe(true);
    const photo = await call('GET', `/api/photos/${gid}/k0?s=m`);
    expect(photo.status).toBe(503);
    expect(photo.headers.get('Cache-Control')).toBe('no-store');
    expect(await photo.text()).toBe('התמונות לא זמינות כרגע: החיבור של הסטודיו לאחסון התמונות נותק. פנו לסטודיו.');
  });

  it('asks Dropbox for no permission to make public links', () => {
    const scopes = new URL(oauthAuthorizeUrl('k', 'https://films.test/cb', 'st')).searchParams.get('scope')!.split(' ');
    expect(scopes).not.toContain('sharing.write');
  });
});
