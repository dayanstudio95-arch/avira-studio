// Ported from the Avira films app's test/pcloud.test.ts. pCloud has never been tried against a
// real link yet.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectLink, parsePcloudLink, pcloudHosts } from '../shared/providers';
import { listPhotos, photoResponse } from '../worker/photos';
import { resolveFolder } from '../worker/providers';
import { resolvePcloudFolder, splitPcloudFilm } from '../worker/providers/pcloud';
import { streamFilm } from '../worker/providers/stream';
import type { Env, Film, Settings } from '../worker/types';

const LINK = 'https://u.pcloud.link/publink/show?code=XZabc123DEF456';

const TREE = {
  result: 0,
  metadata: {
    name: 'נועה ואיתי',
    isfolder: true,
    contents: [
      { name: 'cover.jpg', isfolder: false, fileid: 100, size: 9_000_000 },
      { name: '01 טקס', isfolder: true, contents: [{ name: 'Ceremony.mov', isfolder: false, fileid: 201, size: 5_000_000_000 }] },
      { name: 'Highlights.mp4', isfolder: false, fileid: 200, size: 2_000_000_000 },
    ],
  },
};

const PHOTO_TREE = {
  result: 0,
  metadata: {
    name: 'נועה ואיתי',
    isfolder: true,
    contents: [
      { name: 'cover.jpg', isfolder: false, fileid: 100, size: 9_000_000 },
      { name: '01 התארגנות', isfolder: true, contents: [{ name: 'A-1.jpg', isfolder: false, fileid: 101, size: 10_000_000 }, { name: 'notes.txt', isfolder: false, fileid: 102, size: 10 }] },
      { name: 'צלם 2', isfolder: true, contents: [{ name: 'deep', isfolder: true, contents: [{ name: 'B-1.jpg', isfolder: false, fileid: 103, size: 8_000_000 }] }] },
      { name: 'Highlights.mp4', isfolder: false, fileid: 200, size: 2_000_000_000 },
    ],
  },
};

function stubFetch(handler: (url: URL, init?: RequestInit) => Response) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push(url.href);
    return handler(url, init);
  });
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

const ctx = { env: {} as Env, settings: {} as Settings, origin: 'https://x' };

describe('pCloud links', () => {
  it('recognises US and EU public links', () => {
    expect(parsePcloudLink(LINK)).toMatchObject({ provider: 'pcloud', id: 'XZabc123DEF456', canonical: LINK });
    expect(pcloudHosts(parsePcloudLink('https://e.pcloud.link/publink/show?code=XZabc123DEF456')!.canonical)).toEqual(['eapi.pcloud.com', 'api.pcloud.com']);
    expect(detectLink('https://my.pcloud.com/publink/show?code=kZabc123DEF456')?.provider).toBe('pcloud');
    expect(parsePcloudLink('https://www.pcloud.com/')).toBeNull();
    expect(parsePcloudLink('https://u.pcloud.link/publink/show?code=a/../b')).toBeNull();
  });

  it('finds the films in a folder (one level down too), trying the other region when needed', async () => {
    const calls = stubFetch((url) => (url.hostname === 'api.pcloud.com' ? Response.json({ result: 7001, error: 'Invalid link' }) : Response.json(TREE)));
    const r = await resolvePcloudFolder(ctx, LINK);
    expect(r.folderName).toBe('נועה ואיתי');
    expect(r.films.map((f) => [f.title, f.provider, f.sizeBytes])).toEqual([
      ['Ceremony', 'pcloud', 5_000_000_000],
      ['Highlights', 'pcloud', 2_000_000_000],
    ]);
    expect(splitPcloudFilm(r.films[1].fileId)).toEqual({ canonical: LINK, fileid: '200' });
    expect(calls.map((c) => new URL(c).hostname)).toEqual(['api.pcloud.com', 'eapi.pcloud.com']);
  });

  it('goes through the same folder lookup as every other cloud', async () => {
    stubFetch(() => Response.json(TREE));
    const r = await resolveFolder(ctx, LINK);
    expect(r.provider).toBe('pcloud');
    expect(r.folderUrl).toBe(LINK);
  });

  it('explains pCloud errors in Hebrew', async () => {
    stubFetch(() => Response.json({ result: 7005, error: 'traffic limit' }));
    await expect(resolvePcloudFolder(ctx, LINK)).rejects.toThrow('מגבלת התעבורה');
  });

  it('streams a film through our site with Range, and saves it under its own name on download', async () => {
    const seen: Record<string, string>[] = [];
    const calls = stubFetch((url, init) => {
      if (url.pathname === '/getpublinkdownload') return Response.json({ result: 0, hosts: ['c1.pcloud.com'], path: '/dl/abc/Highlights.mp4', expires: new Date(Date.now() + 3600_000).toUTCString() });
      if (url.hostname === 'c1.pcloud.com') {
        seen.push((init?.headers ?? {}) as Record<string, string>);
        return new Response('abc', { status: 206, headers: { 'Content-Range': 'bytes 0-2/2000000000', 'Content-Length': '3' } });
      }
      return new Response('', { status: 404 });
    });
    const film = { title: 'Highlights', tag: 'highlights', fileName: 'Highlights.mp4', provider: 'pcloud', fileId: `${LINK}#200`, sourceUrl: LINK, watchUrl: '', downloadUrl: '', sizeBytes: 3, playable: true } as Film;
    const req = new Request('https://x/api/watch/g/film/0?dl=1', { headers: { Range: 'bytes=0-2' } });
    const res = await streamFilm({} as Settings, {} as Env, film, req, true, 'https://x');
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 0-2/2000000000');
    expect(res.headers.get('Content-Type')).toBe('video/mp4');
    expect(res.headers.get('Content-Disposition')).toContain('Highlights.mp4');
    expect(seen[0].Range).toBe('bytes=0-2');
    // The download address is remembered: a second request asks pCloud only for the file.
    await streamFilm({} as Settings, {} as Env, film, new Request('https://x/api/watch/g/film/0'), false, 'https://x');
    expect(calls.filter((c) => c.includes('/getpublinkdownload'))).toHaveLength(1);
  });

  it('refuses a stored pCloud film that is not a pCloud link', async () => {
    const film = { fileName: 'x.mp4', provider: 'pcloud', fileId: 'https://evil.example/x#1' } as Film;
    const res = await streamFilm({} as Settings, {} as Env, film, new Request('https://x/'), false, 'https://x');
    expect(res.status).toBe(404);
  });

  it('reads a photo folder: photos only, first-level folders kept, sizes kept', async () => {
    stubFetch(() => Response.json(PHOTO_TREE));
    const d = await listPhotos({} as Env, {} as Settings, LINK, 'https://x');
    expect(d.provider).toBe('pcloud');
    expect(d.items.map((i) => [i.name, i.folder ?? '', i.ref, i.size])).toEqual([
      ['cover.jpg', '', 'c:100', 9_000_000],
      ['A-1.jpg', '01 התארגנות', 'c:101', 10_000_000],
      ['B-1.jpg', 'צלם 2', 'c:103', 8_000_000],
    ]);
    // "01 התארגנות" is one of the studio's sets; "צלם 2" is just a folder.
    expect(d.sets.find((s) => s.id === d.items[1].set)?.name).toBe('התארגנות');
    expect(d.items[2].set).toBeUndefined();
  });

  it("uses pCloud's own previews and streams the original through us", async () => {
    const calls = stubFetch((url) => {
      if (url.pathname === '/showpublink') return Response.json(PHOTO_TREE);
      if (url.pathname === '/getpubthumb') return new Response(new Uint8Array([0xff, 0xd8]), { headers: { 'Content-Type': 'image/jpeg' } });
      if (url.pathname === '/getpublinkdownload') return Response.json({ result: 0, hosts: ['c1.pcloud.com'], path: '/dl/abc/A-1.jpg', expires: new Date(Date.now() + 3600_000).toUTCString() });
      if (url.hostname === 'c1.pcloud.com') return new Response('x'.repeat(10), { status: 206, headers: { 'Content-Type': 'image/jpeg', 'Content-Range': 'bytes 0-9/10000000' } });
      return new Response('', { status: 404 });
    });
    // Cloudflare's edge cache isn't there in tests.
    vi.stubGlobal('caches', { default: { match: async () => undefined, put: async () => {} } });
    const data = await listPhotos({} as Env, {} as Settings, LINK, 'https://x');
    const item = data.items[1];
    const small = await photoResponse({} as Env, {} as Settings, data, item, 'm', new Request('https://x/api/photos/g/k?s=m'), false, 'g');
    expect(small.status).toBe(200);
    expect(calls.some((c) => c.includes('/getpubthumb') && c.includes('fileid=101') && c.includes('size=640x480'))).toBe(true);
    const full = await photoResponse({} as Env, {} as Settings, data, item, 'full', new Request('https://x/api/photos/g/k?s=full', { headers: { Range: 'bytes=0-9' } }), true, 'g');
    expect(full.status).toBe(206);
    expect(full.headers.get('Content-Disposition')).toContain('A-1.jpg');
    expect(calls.some((c) => c.startsWith('https://c1.pcloud.com/dl/abc/A-1.jpg'))).toBe(true);
  });

  it('a link over its traffic limit (JSON with status 200) is a 502 with the reason, never JSON passed on as a photo (P66)', async () => {
    const { pcloudThumb } = await import('../worker/providers/pcloud');
    stubFetch((url) => {
      if (url.pathname === '/showpublink') return Response.json(PHOTO_TREE);
      if (url.pathname === '/getpubthumb') return Response.json({ result: 7005, error: 'Link has reached its traffic limit.' });
      return new Response('', { status: 404 });
    });
    const puts: string[] = [];
    vi.stubGlobal('caches', { default: { match: async () => undefined, put: async (req: Request) => void puts.push(req.url) } });
    const thumb = await pcloudThumb(LINK, '101', '640x480');
    expect(thumb.status).toBe(502);
    expect(thumb.headers.get('Cache-Control')).toBe('no-store');
    expect(await thumb.text()).toContain('מגבלת התעבורה');
    const data = await listPhotos({} as Env, {} as Settings, LINK, 'https://x');
    const res = await photoResponse({} as Env, {} as Settings, data, data.items[1], 'm', new Request('https://x/api/photos/g/k?s=m'), false, 'g', { cache: { visible: 1, gen: 1 } });
    expect(res.status).toBe(502);
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(puts, 'nothing at the edge').toEqual([]);
  });

  it('keeps each file\'s version (hash and size) from the listing (P66)', async () => {
    const tree = structuredClone(PHOTO_TREE);
    (tree.metadata.contents[0] as { hash?: number }).hash = 1234567890123;
    stubFetch((url) => (url.pathname === '/showpublink' ? Response.json(tree) : new Response('', { status: 404 })));
    const data = await listPhotos({} as Env, {} as Settings, LINK, 'https://x');
    const cover = data.items.find((i) => i.name === 'cover.jpg')!;
    expect(cover.v).toMatch(/^[0-9a-f]{8}$/);
    expect(cover.size).toBe(9_000_000);
    (tree.metadata.contents[0] as { hash?: number }).hash = 1234567890124;
    expect((await listPhotos({} as Env, {} as Settings, LINK, 'https://x')).items.find((i) => i.name === 'cover.jpg')!.v).not.toBe(cover.v);
  });
});
