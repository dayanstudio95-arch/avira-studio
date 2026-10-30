// Fix plan P62: the couple's ZIP downloads up to 4 photos at a time, keeps their order, and a photo
// downloaded ahead when a part filled up opens the next part instead of being lost.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadPhotosZip, ZIP_PARALLEL, type ZipItem } from '../src/photos/zip';

/** The file names inside a ZIP, in order, from its central directory. */
async function zipEntries(zip: Blob): Promise<string[]> {
  const b = new Uint8Array(await zip.arrayBuffer());
  const v = new DataView(b.buffer);
  let end = b.length - 22;
  while (end >= 0 && v.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('not a ZIP');
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  const names: string[] = [];
  for (let n = 0; n < count; n++) {
    if (v.getUint32(at, true) !== 0x02014b50) throw new Error('bad central directory');
    const nameLen = v.getUint16(at + 28, true);
    const extra = v.getUint16(at + 30, true);
    const comment = v.getUint16(at + 32, true);
    names.push(new TextDecoder().decode(b.subarray(at + 46, at + 46 + nameLen)));
    at += 46 + nameLen + extra + comment;
  }
  return names;
}

/** A photo server that answers after a short, uneven wait and counts how many requests are open at once. */
function photoServer(opts: { bytes: number; missing?: string[]; pages?: string[] }) {
  let open = 0;
  const seen = { maxOpen: 0, requests: 0 };
  const fetchPhoto = vi.fn(async (input: RequestInfo | URL) => {
    const key = /\/([^/?]+)\?/.exec(String(input))![1];
    seen.requests++;
    open++;
    seen.maxOpen = Math.max(seen.maxOpen, open);
    await new Promise((r) => setTimeout(r, 2 + (key.charCodeAt(key.length - 1) % 5)));
    open--;
    if (opts.missing?.includes(key)) return new Response('gone', { status: 404 });
    if (opts.pages?.includes(key)) return new Response('<!doctype html><title>Sign in</title>', { headers: { 'Content-Type': 'text/html' } });
    return new Response(new Uint8Array(opts.bytes).fill(key.charCodeAt(key.length - 1)), { headers: { 'Content-Type': 'image/jpeg' } });
  });
  return { fetchPhoto, seen };
}

const photos = (n: number): ZipItem[] => Array.from({ length: n }, (_, i) => ({ key: `p${String(i).padStart(2, '0')}`, name: `IMG_${i}.jpg` }));

afterEach(() => vi.unstubAllGlobals());

describe("the couple's ZIP (made in the browser)", () => {
  it('a file that is not a picture (an error page with status 200) is left out and counted as failed (P66)', async () => {
    const { fetchPhoto } = photoServer({ bytes: 100, pages: ['p01'] });
    vi.stubGlobal('fetch', fetchPhoto);
    const saved: { zip: Blob; name: string }[] = [];
    const res = await downloadPhotosZip({ items: photos(3), base: '/api/photos/g/v1', quality: 'full', name: 'couple', signal: new AbortController().signal, onProgress: () => {}, save: (zip, name) => saved.push({ zip, name }) });
    expect(res.failed).toBe(1);
    expect(await zipEntries(saved[0].zip)).toEqual(['IMG_0.jpg', 'IMG_2.jpg']);
  });

  it(`downloads at most ${ZIP_PARALLEL} photos at a time and keeps their order`, async () => {
    const { fetchPhoto, seen } = photoServer({ bytes: 1000 });
    vi.stubGlobal('fetch', fetchPhoto);
    const saved: { zip: Blob; name: string }[] = [];
    const items = photos(12);
    const res = await downloadPhotosZip({ items, base: '/api/photos/g', quality: 'full', name: 'couple', signal: new AbortController().signal, onProgress: () => {}, save: (zip, name) => saved.push({ zip, name }) });
    expect(seen.maxOpen).toBeLessThanOrEqual(ZIP_PARALLEL);
    expect(seen.maxOpen, 'photos really come in parallel').toBeGreaterThan(1);
    expect(seen.requests).toBe(12);
    expect(saved.map((s) => s.name)).toEqual(['couple.zip']);
    expect(await zipEntries(saved[0].zip)).toEqual(items.map((i) => i.name));
    expect(res).toMatchObject({ done: 12, total: 12, failed: 0, part: 1, bytes: 12_000 });
  });

  it('a photo downloaded ahead when a part is full opens the next part: none lost, none twice', async () => {
    const { fetchPhoto, seen } = photoServer({ bytes: 1000, missing: ['p05'] });
    vi.stubGlobal('fetch', fetchPhoto);
    const saved: { zip: Blob; name: string }[] = [];
    const items = photos(17);
    // Parts of about 3 photos: every part ends while the next photos are already downloaded.
    const res = await downloadPhotosZip({ items, base: '/api/photos/g', quality: 'small', name: 'couple', signal: new AbortController().signal, onProgress: () => {}, partBytes: 2500, save: (zip, name) => saved.push({ zip, name }) });
    expect(seen.requests, 'each photo asked for once').toBe(17);
    expect(seen.maxOpen).toBeLessThanOrEqual(ZIP_PARALLEL);
    expect(saved.length).toBeGreaterThan(3);
    expect(saved.map((s) => s.name)).toEqual(saved.map((_, i) => `couple-part-${i + 1}.zip`));
    const inZips = (await Promise.all(saved.map((s) => zipEntries(s.zip)))).flat();
    const expected = items.filter((i) => i.key !== 'p05').map((i) => i.name.replace(/\.jpg$/, '-small.jpg'));
    expect(inZips).toEqual(expected);
    expect(res).toMatchObject({ done: 17, total: 17, failed: 1 });
  });

  it('stops when the couple cancels', async () => {
    const { fetchPhoto } = photoServer({ bytes: 1000 });
    vi.stubGlobal('fetch', fetchPhoto);
    const stop = new AbortController();
    const saved: Blob[] = [];
    const res = await downloadPhotosZip({
      items: photos(20),
      base: '/api/photos/g',
      quality: 'full',
      name: 'couple',
      signal: stop.signal,
      onProgress: (p) => p.done >= 3 && stop.abort(),
      save: (zip) => saved.push(zip),
    });
    expect(saved).toEqual([]);
    expect(res.done).toBeLessThan(20);
  });
});
