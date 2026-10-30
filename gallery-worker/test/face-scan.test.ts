// The studio's face scan (src/faces/faceIndex.ts, fix plan P68): a photo whose preview did not download, or whose
// search failed, is never recorded as scanned (it was "scanned, 0 faces" for good); a 429 is tried once more after a
// longer wait; ten failures in a row stop the scan; a batch leaves the queue only after the server took it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeChunk } from '../shared/faces';
import { addFacesChunk } from '../worker/faces';
import { MemoryStore } from '../worker/store-memory';
import type { Gallery } from '../worker/types';

// One face per photo; a photo whose bytes say BOOM breaks the detector.
vi.mock('../src/faces/engine', () => ({
  getFaceEngine: async () => ({
    detectAll: async (img: Blob) => {
      if ((await img.text()) === 'BOOM') throw new Error('webgl lost');
      return [{ box: [0.1, 0.1, 0.2, 0.2], vec: Array.from({ length: 128 }, () => 0.1) }];
    },
    detectOne: async () => null,
  }),
  toCanvas: async (blob: Blob) => blob,
}));

const { indexFaces, MAX_FAILURES_IN_A_ROW, RETRY_WAIT_429_MS } = await import('../src/faces/faceIndex');

const G = '1234123412341234';
const key = (i: number) => i.toString(16).padStart(8, '0');

/** Previews answer per key: a list of answers, one per try (the last repeats); POSTs go to addFacesChunk. */
function server(answers: Record<string, (number | 'net' | 'boom')[]>, opts: { failPosts?: number } = {}) {
  const store = new MemoryStore();
  const g = { id: G, tenantId: 't1', kind: 'photos' } as unknown as Gallery;
  const tries = new Map<string, number>();
  const posts: string[][] = [];
  let failPosts = opts.failPosts ?? 0;
  const waits: number[] = [];
  const realTimeout = globalThis.setTimeout;
  vi.stubGlobal('setTimeout', (fn: () => void, ms?: number) => {
    waits.push(ms ?? 0);
    return realTimeout(fn, 0);
  });
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      if (failPosts > 0) {
        failPosts--;
        return Response.json({ error: 'down' }, { status: 500 });
      }
      const bytes = new Uint8Array(init.body as Uint8Array);
      posts.push(decodeChunk(bytes).map((p) => p.key));
      const all = new Set(decodeChunk(bytes).map((p) => p.key));
      return Response.json(await addFacesChunk(store, g, bytes, all));
    }
    const k = /\/([0-9a-f]{8})\?s=l$/.exec(url)![1];
    const n = tries.get(k) ?? 0;
    tries.set(k, n + 1);
    const list = answers[k] ?? [200];
    const a = list[Math.min(n, list.length - 1)];
    if (a === 'net') throw new TypeError('network');
    if (a === 'boom') return new Response('BOOM');
    return a === 200 ? new Response(`photo ${k}`) : new Response('no', { status: a });
  });
  return { store, posts, tries, waits };
}

const run = (keys: string[], done: Iterable<string> = []) =>
  indexFaces({ galleryId: G, base: `/api/photos/${G}/v1`, keys, alreadyDone: new Set(done), onProgress: () => {}, signal: new AbortController().signal });

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('face scan: failures are not "scanned"', () => {
  it('a preview that failed or a search that broke is left out; a 429 recovered after a longer wait is in', async () => {
    const keys = [1, 2, 3, 4, 5, 6].map(key);
    const s = server({ [key(2)]: [502], [key(3)]: [429, 200], [key(4)]: ['net'], [key(5)]: ['boom'] });
    const p = await run(keys);
    expect(p.failed).toBe(3);
    expect(s.posts).toEqual([[key(1), key(3), key(6)]]);
    expect((await s.store.facesDone(G)).sort()).toEqual([key(1), key(3), key(6)]);
    // One more try for each failed download; the 429 waited longer.
    expect(s.tries.get(key(2))).toBe(2);
    expect(s.tries.get(key(3))).toBe(2);
    expect(s.waits).toContain(RETRY_WAIT_429_MS);

    // Running again tries exactly the photos that failed, and finds them now.
    const again = server({});
    again.store.faces.set(G, s.store.faces.get(G)!);
    await run(keys, await s.store.facesDone(G));
    expect(again.posts).toEqual([[key(2), key(4), key(5)]]);
    expect((await again.store.facesDone(G)).sort()).toEqual(keys);
  });

  it(`${MAX_FAILURES_IN_A_ROW} failures in a row stop the scan; what was found before is kept`, async () => {
    const keys = Array.from({ length: 15 }, (_, i) => key(i + 1));
    const s = server(Object.fromEntries(keys.slice(2).map((k) => [k, [502]])));
    await expect(run(keys)).rejects.toThrow('נעצרה');
    expect(s.posts).toEqual([[key(1), key(2)]]);
    expect([...s.tries.keys()].length).toBeLessThan(15);
  });

  it('a batch the server did not take stays queued and goes with the next upload', async () => {
    const keys = Array.from({ length: 125 }, (_, i) => key(i + 1));
    const s = server({}, { failPosts: 1 });
    await expect(run(keys)).rejects.toThrow('down');
    // The first 120 were refused once, then sent with the rest: nothing found is lost.
    expect(s.posts.flat()).toHaveLength(120);
    expect((await s.store.facesDone(G)).length).toBe(120);
  });
});
