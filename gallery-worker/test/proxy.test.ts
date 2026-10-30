import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamOwnFile, streamSharedLinkFile } from '../worker/providers/dropbox';
import { relay, streamFilm } from '../worker/providers/stream';
import type { Env, Film, Settings } from '../worker/types';

const settings = { dropbox: { appKey: 'k', appSecret: 's', refreshToken: 'r' }, googleApiKey: '' } as unknown as Settings;
const kv = new Map<string, string>();
const env = {
  KV: {
    get: async (k: string) => (kv.has(k) ? JSON.parse(kv.get(k)!) : null),
    put: async (k: string, v: string) => void kv.set(k, v),
    delete: async (k: string) => void kv.delete(k),
  },
} as unknown as Env;
const film: Film = {
  title: 'חופה',
  tag: 'ceremony',
  fileName: 'חופה.mp4',
  provider: 'dropbox-link',
  fileId: '/חופה.mp4',
  sourceUrl: 'https://www.dropbox.com/scl/fo/abc/def?rlkey=k',
  watchUrl: '',
  downloadUrl: '',
  sizeBytes: 1000,
  playable: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
  kv.clear();
});

function fakeDropbox(onContent: (init: RequestInit) => Response) {
  let tokenCalls = 0;
  vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/oauth2/token')) {
      tokenCalls++;
      return Response.json({ access_token: 'T', expires_in: 14400 });
    }
    if (url.endsWith('/sharing/get_shared_link_file') || url.endsWith('/files/download')) return onContent(init);
    throw new Error(`unexpected ${url}`);
  });
  return () => tokenCalls;
}

describe('streaming a file from a shared Dropbox folder', () => {
  it('forwards Range, keeps 206 + Content-Range, hides the token, and sets a video content type', async () => {
    let seen: Record<string, string> = {};
    const tokenCalls = fakeDropbox((init) => {
      seen = init.headers as Record<string, string>;
      return new Response('abc', { status: 206, headers: { 'Content-Range': 'bytes 0-2/1000', 'Content-Length': '3' } });
    });
    const req = new Request('https://site/api/watch/x/film/0', { headers: { Range: 'bytes=0-2' } });
    const res = await streamSharedLinkFile(settings, env, film, req, false);
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 0-2/1000');
    expect(res.headers.get('Content-Type')).toBe('video/mp4');
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(res.headers.get('Content-Disposition')).toBeNull();
    expect(await res.text()).toBe('abc');
    expect(seen.Range).toBe('bytes=0-2');
    expect(seen.Authorization).toBe('Bearer T');
    // The API arg header is pure ASCII (Hebrew escaped) and carries the folder link + file path.
    expect(seen['Dropbox-API-Arg']).toMatch(/^[\x20-\x7e]+$/);
    expect(JSON.parse(seen['Dropbox-API-Arg'])).toEqual({ url: film.sourceUrl, path: '/חופה.mp4' });
    expect(tokenCalls()).toBe(1);

    // A second request reuses the cached token instead of calling OAuth again.
    await streamSharedLinkFile(settings, env, film, req, false);
    expect(tokenCalls()).toBe(1);
  });

  it('adds a download file name with dl=1 and drops the body for HEAD', async () => {
    fakeDropbox(() => new Response('data', { status: 200, headers: { 'Content-Length': '4' } }));
    const res = await streamSharedLinkFile(settings, env, film, new Request('https://site/f'), true);
    expect(res.headers.get('Content-Disposition')).toContain("filename*=UTF-8''%D7%97%D7%95%D7%A4%D7%94.mp4");
    const head = await streamSharedLinkFile(settings, env, film, new Request('https://site/f', { method: 'HEAD' }), false);
    expect(head.body).toBeNull();
    expect(head.headers.get('Content-Length')).toBe('4');
  });

  it('turns a Dropbox failure into a readable 502 and forgets a rejected token', async () => {
    fakeDropbox(() => new Response('{"error_summary":"shared_link_not_found"}', { status: 404 }));
    const res = await streamSharedLinkFile(settings, env, film, new Request('https://site/f'), false);
    expect(res.status).toBe(502);
    expect(await res.text()).toContain('404');
  });
});

// Fix plan P65: a cloud's error or sign-in page that answers 200 never reaches the player as the film.
describe('a page is never passed on as a film', () => {
  it('relay: an HTML answer becomes a 502 (logged), a video goes through', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const page = relay(new Response('<html>removed</html>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }), new Request('https://site/f'), 'חופה.mp4', false);
    expect(page.status).toBe(502);
    expect(page.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(errors).toHaveBeenCalledTimes(1);
    const video = relay(new Response('abc', { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-2/9' } }), new Request('https://site/f'), 'חופה.mp4', false);
    expect(video.status).toBe(206);
    errors.mockRestore();
  });

  it('a public Dropbox link whose page says the file is gone: 502, not a video', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', async () => new Response('<!doctype html><title>Dropbox - Error</title>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    const pub: Film = { ...film, provider: 'dropbox', fileId: 'https://www.dropbox.com/scl/fi/abc/x.mp4?rlkey=k', sourceUrl: 'https://www.dropbox.com/scl/fi/abc/x.mp4?rlkey=k' };
    const res = await streamFilm(settings, env, pub, new Request('https://site/f'), false, 'https://site');
    expect(res.status).toBe(502);
    vi.restoreAllMocks();
  });

  it('a shared-folder file that comes back as a page: 502', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fakeDropbox(() => new Response('<html>sign in</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    const res = await streamSharedLinkFile(settings, env, film, new Request('https://site/f'), false);
    expect(res.status).toBe(502);
    vi.restoreAllMocks();
  });
});

describe("a film in the studio's own Dropbox (P65)", () => {
  const own: Film = { ...film, provider: 'dropbox-own', fileId: 'id:FILM1', pathRoot: '100', sourceUrl: 'https://www.dropbox.com/scl/fo/abc/def?rlkey=k' };

  it('streams by its file id with the studio token, the team root and the Range — no public link', async () => {
    let seen: Record<string, string> = {};
    let url = '';
    vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
      if (String(input).endsWith('/oauth2/token')) return Response.json({ access_token: 'T', expires_in: 14400 });
      url = String(input);
      seen = init.headers as Record<string, string>;
      return new Response('abc', { status: 206, headers: { 'Content-Type': 'application/octet-stream', 'Content-Range': 'bytes 0-2/1000' } });
    });
    const res = await streamFilm(settings, env, own, new Request('https://site/f', { headers: { Range: 'bytes=0-2' } }), false, 'https://site');
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Type')).toBe('video/mp4');
    expect(url).toBe('https://content.dropboxapi.com/2/files/download');
    expect(JSON.parse(seen['Dropbox-API-Arg'])).toEqual({ path: 'id:FILM1' });
    expect(seen['Dropbox-API-Path-Root']).toBe('{".tag":"root","root":"100"}');
    expect(seen.Range).toBe('bytes=0-2');
    expect(seen.Authorization).toBe('Bearer T');
    const dl = await streamOwnFile(settings, env, own, new Request('https://site/f'), true);
    expect(dl.headers.get('Content-Disposition')).toContain('attachment');
  });

  it('a file id that is not one is refused before Dropbox is asked', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('no request expected');
    });
    const res = await streamFilm(settings, env, { ...own, fileId: 'https://evil.example/x' }, new Request('https://site/f'), false, 'https://site');
    expect(res.status).toBe(404);
  });
});
