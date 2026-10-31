// Ported from the Avira films app's test/photos.test.ts (2026-09-26). MyAirBridge examples use
// Dropbox shared-link paths instead (MyAirBridge is not a photo source here).
import { describe, expect, it } from 'vitest';
import { applyPhotoEdits, buildPhotoData, favoritesMessage, mergePhotoData, photoKey, publicPhotos, setNameFromFolder, sortByName } from '../worker/photos';
import { PRESET_SETS, presetForFolder } from '../shared/photosets';
import { exifTakenAt } from '../shared/exif';

const found = [
  { name: 'IMG_10.jpg', folder: '02 צילומי חוץ', ref: 'l:/02 צילומי חוץ/IMG_10.jpg' },
  { name: 'IMG_2.jpg', folder: '02 צילומי חוץ', ref: 'l:/02 צילומי חוץ/IMG_2.jpg' },
  { name: 'IMG_1.jpg', folder: '01 התארגנות', ref: 'l:/01 התארגנות/IMG_1.jpg' },
  { name: 'notes.txt', folder: '01 התארגנות', ref: 'l:/01 התארגנות/notes.txt' },
  { name: 'loose.JPG', folder: '', ref: 'l:/loose.JPG' },
];

describe('reading a photo folder', () => {
  it("always offers the studio's sets; a folder named like a set fills it, and keeps camera order", () => {
    expect(setNameFromFolder('02 התארגנות')).toBe('התארגנות');
    expect(setNameFromFolder('2. Getting ready')).toBe('Getting ready');
    expect(setNameFromFolder('03_צילומי-חוץ')).toBe('צילומי חוץ');
    expect(setNameFromFolder('מסיבה')).toBe('מסיבה');
    expect(presetForFolder('03_צילומי-חוץ')).toBe('צילומי חוץ');
    expect(presetForFolder('מאי ואופק 1')).toBe('');
    // Avira: the owner's price-list folder is the album choice; his per-part and per-photographer folders are no set.
    expect(presetForFolder('מחירון 2027 אלבומים')).toBe('בחירת אלבום');
    for (const n of ['דניאלה ודן 1', 'דניאלה ודן 2 ערב', 'דניאלה ודן 3 סלבה', 'דניאלה ודן טופ2']) expect(presetForFolder(n), n).toBe('');
    const d = buildPhotoData('https://x', 'dropbox-link', found);
    expect(d.sets.map((s) => s.name)).toEqual([...PRESET_SETS]);
    expect(d.items.map((i) => i.name)).toEqual(['loose.JPG', 'IMG_1.jpg', 'IMG_2.jpg', 'IMG_10.jpg']);
    expect(d.items[0].set).toBeUndefined();
    expect(d.sets.find((s) => s.id === d.items[1].set)?.name).toBe('התארגנות');
    expect(d.items[1].folder).toBe('01 התארגנות');
    expect(d.cover).toBe(d.items[0].key);
  });
  it('folders per photographer are not sets (they stay as folders)', () => {
    const d = buildPhotoData('https://x', 'dropbox-link', [
      { name: 'AVIRA-1.jpg', folder: 'מאי ואופק 1', ref: 'l:/1.jpg' },
      { name: 'AVIRA-1.jpg', folder: 'מאי ואופק אילון', ref: 'l:/2.jpg' },
    ]);
    expect(d.sets.map((s) => s.name)).toEqual([...PRESET_SETS]);
    expect(d.items.every((i) => !i.set)).toBe(true);
    expect(d.items.map((i) => i.folder)).toEqual(['מאי ואופק 1', 'מאי ואופק אילון']);
  });
  it('photos from several photographers interleave by the time they were taken', () => {
    const d = buildPhotoData('https://x', 'dropbox-link', [
      { name: 'A1.jpg', folder: 'מאי ואופק 1', ref: 'l:/a1.jpg' },
      { name: 'A2.jpg', folder: 'מאי ואופק 1', ref: 'l:/a2.jpg' },
      { name: 'E1.jpg', folder: 'מאי ואופק אילון', ref: 'l:/e1.jpg' },
    ]);
    const [a1, a2, e1] = d.items;
    const partly = applyPhotoEdits(d, { items: { [a1.key]: { t: 1_788_961_146_000 }, [e1.key]: { t: 1_788_961_147_000 } } });
    expect(partly.items.map((i) => i.name)).toEqual(['A1.jpg', 'A2.jpg', 'E1.jpg']); // not all known yet: order kept
    const all = applyPhotoEdits(partly, { items: { [a2.key]: { t: 1_788_961_148_000 } } });
    expect(all.items.map((i) => i.name)).toEqual(['A1.jpg', 'E1.jpg', 'A2.jpg']);
    expect(applyPhotoEdits(d, { items: { [a1.key]: { t: 12 } } }).items[0].t).toBeUndefined(); // camera clock not set
  });
  it('gives each photo a stable short key', () => {
    expect(photoKey('l:/a.jpg')).toBe(photoKey('l:/a.jpg'));
    expect(photoKey('l:/a.jpg')).not.toBe(photoKey('l:/b.jpg'));
    expect(photoKey('l:/a.jpg')).toMatch(/^[0-9a-f]{8}$/);
    expect(sortByName([{ name: 'IMG_10.jpg' }, { name: 'IMG_9.jpg' }]).map((x) => x.name)).toEqual(['IMG_9.jpg', 'IMG_10.jpg']);
  });
  it('refuses a folder without photos', () => {
    expect(() => buildPhotoData('https://x', 'gdrive', [{ name: 'a.mp4', folder: '', ref: 'g:1' }])).toThrow(/לא נמצאו תמונות/);
  });
});

describe('owner edits', () => {
  const d = buildPhotoData('https://x', 'dropbox-link', found);
  const [a, b, c] = d.items;
  it('assigns sets, hides, measures, and picks a cover; ignores unknown keys and sets', () => {
    const next = applyPhotoEdits(d, {
      sets: [...d.sets, { id: 'fam', name: 'משפחות' }],
      items: { [a.key]: { set: 'fam', ar: 1.5 }, [b.key]: { hidden: true }, [c.key]: { set: 'nope', ar: 99 }, zzzz: { set: 'fam' } },
      cover: c.key,
    });
    expect(next.items[0]).toMatchObject({ set: 'fam', ar: 1.5 });
    expect(next.items[1].hidden).toBe(true);
    expect(next.items[2].set).toBeUndefined();
    expect(next.items[2].ar).toBeUndefined();
    expect(next.cover).toBe(c.key);
    // Deleting a set frees its photos.
    const fewer = applyPhotoEdits(next, { sets: next.sets.filter((s) => s.id !== 'fam') });
    expect(fewer.items[0].set).toBeUndefined();
  });
  it('re-reading the folder keeps sets, shapes, hidden photos and the cover', () => {
    const edited = applyPhotoEdits(d, { sets: [{ id: 'x', name: 'טיזר' }], items: { [a.key]: { set: 'x', ar: 0.667 }, [b.key]: { hidden: true } }, cover: b.key });
    const fresh = buildPhotoData('https://x', 'dropbox-link', [...found, { name: 'IMG_11.jpg', folder: '02 צילומי חוץ', ref: 'l:/02 צילומי חוץ/IMG_11.jpg' }]);
    const merged = mergePhotoData(fresh, edited);
    expect(merged.sets).toEqual([{ id: 'x', name: 'טיזר' }]);
    expect(merged.items.find((i) => i.key === a.key)).toMatchObject({ set: 'x', ar: 0.667 });
    expect(merged.items.find((i) => i.key === b.key)?.hidden).toBe(true);
    expect(merged.items).toHaveLength(5);
    expect(merged.cover).toBe(b.key);
  });
  it('the couple never sees file locations or hidden photos', () => {
    const next = applyPhotoEdits(d, { items: { [b.key]: { hidden: true } } });
    const pub = publicPhotos('g1', next);
    expect(pub.items.map((i) => i.key)).not.toContain(b.key);
    expect(JSON.stringify(pub)).not.toContain('l:/');
    expect(pub.base).toBe('/api/photos/g1/v0');
    expect(pub.items[0].ar).toBe(1.5);
  });
});

describe('hearts counter', () => {
  it('guides toward 150', () => {
    expect(favoritesMessage(37)).toEqual({ level: 'under', text: 'בחרתם 37 · מומלץ 150 לאלבום' });
    expect(favoritesMessage(150).level).toBe('reached');
    expect(favoritesMessage(151).text).toContain('ייתכן חיוב');
  });
});

describe('when a photo was taken', () => {
  it('reads DateTimeOriginal and fractions of a second from the EXIF block', () => {
    // A little-endian TIFF with IFD0 → Exif sub-IFD holding DateTimeOriginal and SubSecTimeOriginal.
    const tiff: number[] = [];
    const u16 = (v: number) => tiff.push(v & 0xff, v >> 8);
    const u32 = (v: number) => tiff.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24);
    tiff.push(0x49, 0x49); u16(42); u32(8);
    u16(1); u16(0x8769); u16(4); u32(1); u32(26); u32(0); // IFD0: pointer to sub-IFD at 26
    u16(2); u16(0x9003); u16(2); u32(20); u32(56); u16(0x9291); u16(2); u32(3); tiff.push(0x34, 0x38, 0, 0); u32(0);
    const date = '2026:09:09 13:39:06';
    for (const ch of date) tiff.push(ch.charCodeAt(0));
    tiff.push(0);
    const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    const len = body.length + 2;
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...body, 0xff, 0xda]);
    expect(exifTakenAt(jpeg)).toBe(Date.UTC(2026, 8, 9, 13, 39, 6) + 480);
    expect(exifTakenAt(new Uint8Array([0xff, 0xd8, 0xff, 0xda]))).toBeNull();
  });
});

describe('Google Drive without an API key', () => {
  it("reads files and subfolders from Google's embedded folder view", async () => {
    const { parseEmbeddedFolder } = await import('../worker/photos');
    const entry = (id: string, name: string, folder: boolean) =>
      `<div class="flip-entry" id="entry-${id}" tabindex="0" role="link"><div class="flip-entry-info"><a href="https://drive.google.com/${folder ? 'drive/folders' : 'file/d'}/${id}/view"><div class="flip-entry-title">${name}</div></a></div></div>`;
    const html = `<html>${entry('F1', '02 התארגנות', true)}${entry('A1', 'AVIRA-10.jpg', false)}${entry('A2', 'Tom &amp; Dana.jpg', false)}</html>`;
    expect(parseEmbeddedFolder(html)).toEqual([
      { id: 'F1', name: '02 התארגנות', folder: true },
      { id: 'A1', name: 'AVIRA-10.jpg', folder: false },
      { id: 'A2', name: 'Tom & Dana.jpg', folder: false },
    ]);
  });
});

describe('full-quality download', () => {
  it('sends the largest copy of the same photo (same moment to the millisecond, same shape)', async () => {
    const { largestCopy } = await import('../worker/photos');
    const t = 1_788_960_575_940;
    const data = {
      folderUrl: 'x',
      provider: 'dropbox-link' as const,
      timesV: 2 as const,
      sets: [],
      items: [
        { key: 'a', name: 'AVIRA-3.jpg', ref: 'l:/1/AVIRA-3.jpg', t, ar: 0.667, size: 9_182_233 },
        { key: 'b', name: 'AVIRA-T-2.jpg', ref: 'l:/טופ2/AVIRA-T-2.jpg', t, ar: 0.667, size: 436_296 },
        { key: 'c', name: 'AVIRA-9.jpg', ref: 'l:/1/AVIRA-9.jpg', t: t + 5, ar: 0.667, size: 20_000_000 },
      ],
    };
    const best = await largestCopy(data, data.items[1]);
    expect(best.ref).toBe('l:/1/AVIRA-3.jpg');
    expect(best.name).toBe('AVIRA-T-2.jpg'); // keeps the name the couple clicked
    // Whole seconds only (no sub-seconds): too risky to call two photos the same one.
    const coarse = { ...data, items: data.items.map((i) => ({ ...i, t: 1_788_960_575_000 })) };
    expect((await largestCopy(coarse, coarse.items[1])).ref).toBe('l:/טופ2/AVIRA-T-2.jpg');
  });
});

describe('teaser folders, Lightroom colours and the time-order switch', () => {
  it('recognises the "top" folders in all their spellings', async () => {
    const { isTopFolder } = await import('../shared/photosets');
    for (const n of ['טופ1', 'טופ 2', '2טופ', 'top1', 'Top2', '2top', '1 top', 'מאי ואופק טופ2', 'מאי ואופק top1', 'TOP'])
      expect(isTopFolder(n), n).toBe(true);
    for (const n of ['מאי ואופק 1', 'אילון', 'desktop', 'טופס', 'stop2'])
      expect(isTopFolder(n), n).toBe(false);
  });
  it("reads the Lightroom label from the file's XMP (English or Hebrew names)", async () => {
    const { xmpLabel, normalizeLabel } = await import('../shared/exif');
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(normalizeLabel(xmpLabel(enc('<x:xmpmeta><rdf:Description xmp:Label="Yellow" xmp:Rating="3"/>')))).toBe('yellow');
    expect(normalizeLabel(xmpLabel(enc('<xmp:Label>סגול</xmp:Label>')))).toBe('purple');
    expect(xmpLabel(enc('no label here'))).toBe('');
  });
  it("the owner's colours by default, and an unmarked photo is the hall (Avira)", async () => {
    const { DEFAULT_LABEL_MAP } = await import('../shared/exif');
    expect(DEFAULT_LABEL_MAP).toEqual({ red: 'התארגנות', yellow: 'צילומי חוץ', green: 'משפחות', blue: 'טקס חופה', purple: 'מסיבה', none: 'אולם' });
    for (const set of Object.values(DEFAULT_LABEL_MAP)) expect(PRESET_SETS as readonly string[]).toContain(set);
  });
  it('turning time order off goes back to folder and file-name order', () => {
    const d = buildPhotoData('https://x', 'dropbox-link', [
      { name: 'A1.jpg', folder: 'צלם 1', ref: 'l:/a1.jpg' },
      { name: 'A2.jpg', folder: 'צלם 1', ref: 'l:/a2.jpg' },
      { name: 'B1.jpg', folder: 'צלם 2', ref: 'l:/b1.jpg' },
    ]);
    const [a1, a2, b1] = d.items;
    const timed = applyPhotoEdits(d, { items: { [a1.key]: { t: 1_788_961_146_100 }, [a2.key]: { t: 1_788_961_146_900 }, [b1.key]: { t: 1_788_961_146_500 } } });
    expect(timed.items.map((i) => i.name)).toEqual(['A1.jpg', 'B1.jpg', 'A2.jpg']);
    const off = applyPhotoEdits(timed, { timeOrder: false });
    expect(off.items.map((i) => i.name)).toEqual(['A1.jpg', 'A2.jpg', 'B1.jpg']);
    expect(off.timeOrder).toBe(false);
    expect(applyPhotoEdits(off, { timeOrder: true }).items.map((i) => i.name)).toEqual(['A1.jpg', 'B1.jpg', 'A2.jpg']);
  });
  it('keeps where the cover is centred, within 0–100%', () => {
    const d = buildPhotoData('https://x', 'dropbox-link', found);
    expect(applyPhotoEdits(d, { coverPos: { x: 30.4, y: 140 } }).coverPos).toEqual({ x: 30, y: 100 });
    expect(publicPhotos('g', applyPhotoEdits(d, { coverPos: { x: 20, y: 70 } })).coverPos).toEqual({ x: 20, y: 70 });
  });
});

describe('hearts (stored per person)', () => {
  it('keeps who hearted what; a photo stays a favourite while anyone hearts it', async () => {
    const { MemoryStore } = await import('../worker/store-memory');
    const { favoritesFrom, cleanWho } = await import('../worker/photos');
    const store = new MemoryStore();
    await store.setHearts('t', 'g1', ['aaaaaaaa'], true, 'מאי');
    await store.setHearts('t', 'g1', ['aaaaaaaa'], true, 'אמא');
    await store.setHearts('t', 'g1', ['bbbbbbbb'], true, '');
    await store.setHearts('t', 'g1', ['bbbbbbbb'], true, ''); // twice = once
    expect(await store.listHearts('g1')).toEqual({ aaaaaaaa: ['מאי', 'אמא'], bbbbbbbb: [''] });
    await store.setHearts('t', 'g1', ['aaaaaaaa'], false, 'מאי');
    expect(favoritesFrom(await store.listHearts('g1'))).toEqual(['aaaaaaaa', 'bbbbbbbb']);
    await store.setHearts('t', 'g1', ['aaaaaaaa'], false, 'אמא');
    expect(favoritesFrom(await store.listHearts('g1'))).toEqual(['bbbbbbbb']);
    expect(cleanWho('  מאי   כהן ')).toBe('מאי כהן');
    expect(cleanWho('x'.repeat(50))).toHaveLength(30);
  });
});

describe('sources', () => {
  it('MyAirBridge folders are for films only; a single file is not a gallery', async () => {
    const { listPhotos } = await import('../worker/photos');
    const env = { CLOUD_MOCK: '1' } as never;
    await expect(listPhotos(env, {} as never, 'https://mab.to/abcdef', 'https://x')).rejects.toThrow(/MyAirBridge נתמך רק לסרטים/);
    await expect(listPhotos(env, {} as never, 'https://drive.google.com/file/d/1234567890abcdef/view', 'https://x')).rejects.toThrow(/קובץ בודד/);
    const d = await listPhotos(env, {} as never, 'https://www.dropbox.com/scl/fo/abc/def?rlkey=k', 'https://x');
    expect(d.items).toHaveLength(30);
  });
  it('a demo photo is never served outside tests, and odd references are refused', async () => {
    const { photoResponse } = await import('../worker/photos');
    const data = { folderUrl: 'x', provider: 'mock' as const, sets: [], items: [] };
    const req = new Request('https://x/api/photos/g/k');
    const res = await photoResponse({} as never, {} as never, data, { key: 'k', name: 'a.jpg', ref: 'm:/demo/photos/01.jpg' }, 'full', req, false, 'g');
    expect(res.status).toBe(502);
    const odd = await photoResponse({} as never, {} as never, data, { key: 'k', name: 'a.jpg', ref: 'z:whatever' }, 'full', req, false, 'g');
    expect(odd.status).toBe(502);
  });
});

describe('ZIP names (ported)', () => {
  it('keeps the photo names, unique, and marks small copies', async () => {
    const { zipNames } = await import('../src/photos/zip');
    expect(zipNames([{ key: '1', name: 'IMG_1.jpg' }, { key: '2', name: 'img_1.JPG' }, { key: '3', name: 'a/b.jpg' }, { key: '4', name: '' }], false)).toEqual(['IMG_1.jpg', 'img_1 (2).JPG', 'a_b.jpg', '4.jpg']);
    expect(zipNames([{ key: '1', name: 'IMG_1.CR3' }], true)).toEqual(['IMG_1-small.jpg']);
  });
});

describe('slideshow songs', () => {
  it("the gallery's choice, else the studio's default, else silent", async () => {
    const { musicUrl } = await import('../worker/settings');
    const f = { music: [{ id: 'aaaaaa1', name: 'x', type: 'audio/mpeg', size: 1 }, { id: 'bbbbbb2', name: 'y', type: 'audio/mpeg', size: 1 }], musicDefault: 'aaaaaa1' } as never;
    expect(musicUrl('t1', f, undefined)).toBe('/api/music/t1/aaaaaa1');
    expect(musicUrl('t1', f, 'bbbbbb2')).toBe('/api/music/t1/bbbbbb2');
    expect(musicUrl('t1', f, 'none')).toBe('');
    expect(musicUrl('t1', f, 'deleted1')).toBe('');
    expect(musicUrl('t1', { music: [] } as never, undefined)).toBe('');
  });
  it('songs are stored per studio and stream with Range', async () => {
    const { MemoryStore } = await import('../worker/store-memory');
    const store = new MemoryStore();
    await store.putMusic('t1', 'aaaaaa1', new Uint8Array([1, 2, 3, 4, 5]).buffer, 'audio/mpeg');
    const part = await store.getMusic('t1', 'aaaaaa1', 'bytes=1-2');
    expect(part?.status).toBe(206);
    expect(part?.headers.get('Content-Range')).toBe('bytes 1-2/5');
    expect(await store.getMusic('t2', 'aaaaaa1', null)).toBeNull();
    await store.deleteMusic('t1', 'aaaaaa1');
    expect(await store.getMusic('t1', 'aaaaaa1', null)).toBeNull();
  });
});

describe('folders inside folders (ported 2026-09-27)', () => {
  it('Drive: reads photos two levels down and keeps the top folder name ("תמונות לבחירה/My_Favorites")', async () => {
    const { vi } = await import('vitest');
    const { listPhotos } = await import('../worker/photos');
    const entry = (id: string, name: string, folder: boolean) =>
      `<div class="flip-entry" id="entry-${id}"><a href="https://drive.google.com/${folder ? 'drive/folders' : 'file/d'}/${id}/view"><div class="flip-entry-title">${name}</div></a></div>`;
    const tree: Record<string, string> = {
      ROOTFOLDER1234: entry('F1', 'ניב וחמוטל 1', true) + entry('F2', 'תמונות לבחירה', true),
      F1: entry('a', 'A-1.jpg', false),
      F2: entry('F3', 'My_Favorites', true) + entry('x', '.ignore', false),
      F3: entry('b', 'B-1.jpg', false) + entry('c', 'B-2.jpg', false) + entry('F4', 'deeper', true),
      F4: entry('F5', 'even deeper', true),
      F5: entry('F6', 'too deep', true),
      F6: entry('z', 'Z.jpg', false),
    };
    vi.stubGlobal('fetch', async (input: string) => {
      const id = new URL(String(input)).searchParams.get('id') ?? '';
      return new Response(`<html>${tree[id] ?? ''}</html>`);
    });
    try {
      const data = await listPhotos({} as never, { googleApiKey: '' } as never, 'https://drive.google.com/drive/folders/ROOTFOLDER1234?usp=sharing', 'https://x');
      expect(data.items.map((i) => [i.name, i.folder]).sort()).toEqual([
        ['A-1.jpg', 'ניב וחמוטל 1'],
        ['B-1.jpg', 'תמונות לבחירה'],
        ['B-2.jpg', 'תמונות לבחירה'],
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('P67: hidden copies and pictures that are only pictures', () => {
  const t = 1_788_960_575_940;
  const data = {
    folderUrl: 'x',
    provider: 'mock' as const,
    timesV: 2 as const,
    sets: [],
    items: [
      { key: 'aaaaaaaa', name: 'AVIRA-3.jpg', ref: 'm:/big.jpg', t, ar: 0.667, size: 9_182_233, hidden: true },
      { key: 'bbbbbbbb', name: 'AVIRA-T-2.jpg', ref: 'm:/small.jpg', t, ar: 0.667, size: 436_296 },
    ],
  };

  it('"full quality" never sends a larger copy the studio hid, except to the studio and the print shop', async () => {
    const { largestCopy } = await import('../worker/photos');
    expect((await largestCopy(data, data.items[1])).ref).toBe('m:/small.jpg');
    expect((await largestCopy(data, data.items[1], true)).ref).toBe('m:/big.jpg');
  });

  it('an SVG (or anything not a known picture) goes out as a JPEG, with a policy that runs nothing, also from the cache', async () => {
    const { vi } = await import('vitest');
    const { photoResponse } = await import('../worker/photos');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const env = { CLOUD_MOCK: '1', ASSETS: { fetch: async () => new Response(svg, { headers: { 'Content-Type': 'image/svg+xml' } }) } } as never;
    const req = new Request('https://films.test/api/photos/x/bbbbbbbb?s=full');
    const full = await photoResponse(env, {} as never, data, data.items[1], 'full', req, false, 'g1');
    expect(full.headers.get('Content-Type')).toBe('image/jpeg');
    expect(full.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
    expect(full.headers.get('Content-Disposition')).toBe('inline');
    const dl = await photoResponse(env, {} as never, data, data.items[1], 'full', req, true, 'g1');
    expect(dl.headers.get('Content-Disposition')).toMatch(/^attachment; filename="AVIRA-T-2.jpg"/);
    expect(dl.headers.get('Content-Type')).toBe('image/jpeg');
    // A preview kept at the edge before this rule came in: the same headers on the way out.
    const old = new Response(svg, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=31536000, immutable' } });
    vi.stubGlobal('caches', { default: { match: async () => old, put: async () => {} } });
    try {
      const cached = await photoResponse(env, {} as never, data, data.items[1], 'm', req, false, 'g1', { cache: { visible: 1, gen: 0 } });
      expect(cached.headers.get('Content-Type')).toBe('image/jpeg');
      expect(cached.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
      expect(cached.headers.get('Cache-Control')).toContain('public');
    } finally {
      vi.unstubAllGlobals();
    }
    // A real picture type passes as it is.
    const png = { CLOUD_MOCK: '1', ASSETS: { fetch: async () => new Response('x', { headers: { 'Content-Type': 'image/png' } }) } } as never;
    expect((await photoResponse(png, {} as never, data, data.items[1], 'full', req, false, 'g1')).headers.get('Content-Type')).toBe('image/png');
  });

  it('Drive with an API key: a file is a photo by the type Google reports, not by its name', async () => {
    const { vi } = await import('vitest');
    const { listPhotos } = await import('../worker/photos');
    vi.stubGlobal('fetch', async () =>
      Response.json({
        files: [
          { id: 'good0000001', name: 'a.jpg', mimeType: 'image/jpeg' },
          { id: 'evil0000001', name: 'b.jpg', mimeType: 'image/svg+xml' },
          { id: 'html0000001', name: 'c.jpg', mimeType: 'text/html' },
          { id: 'heic0000001', name: 'd.heic', mimeType: 'image/heif' },
        ],
      }),
    );
    try {
      const d = await listPhotos({} as never, { googleApiKey: 'AIzaTestKey' } as never, 'https://drive.google.com/drive/folders/ROOTFOLDER1234', 'https://x');
      expect(d.items.map((i) => i.name).sort()).toEqual(['a.jpg', 'd.heic']);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ---------- fix plan P64: a photo's key, its place in time, and reading its time ----------

describe('P64: every photo its own key, kept when the folder is read again', () => {
  // Two real paths whose 8-character hashes are the same (FNV-1a clash).
  const A = 'p:/wedding/IMG_122588.jpg';
  const B = 'p:/wedding/IMG_1326996.jpg';

  it('two photos that used to get the same key get different keys, the same ones every time', () => {
    expect(photoKey(A)).toBe(photoKey(B));
    const read = () => buildPhotoData('https://x', 'dropbox', [
      { name: 'IMG_122588.jpg', folder: '', ref: A },
      { name: 'IMG_1326996.jpg', folder: '', ref: B },
    ]);
    const d = read();
    expect(d.items[0].key).not.toBe(d.items[1].key);
    expect(d.items.map((i) => i.key)).toEqual(read().items.map((i) => i.key));
    // And again through a re-read that keeps the saved keys.
    expect(mergePhotoData(read(), d).items.map((i) => [i.ref, i.key])).toEqual(d.items.map((i) => [i.ref, i.key]));
  });

  it('an old list where two photos shared a key: the first keeps it, the other gets its own; edits to the shared key are refused', () => {
    const shared = photoKey(A);
    const old = { folderUrl: 'x', provider: 'dropbox' as const, sets: [{ id: 's1', name: 'טקס' }], items: [
      { key: shared, name: 'IMG_122588.jpg', ref: A, set: 's1' },
      { key: shared, name: 'IMG_1326996.jpg', ref: B, hidden: true },
    ] };
    const notes = { ambiguous: [] as string[] };
    const edited = applyPhotoEdits(old, { items: { [shared]: { hidden: true } }, cover: shared }, notes);
    expect(notes.ambiguous).toEqual([shared]);
    expect(edited.items.map((i) => i.hidden)).toEqual([undefined, true]);
    expect(edited.cover).toBeUndefined();
    const fresh = buildPhotoData('x', 'dropbox', old.items.map((i) => ({ name: i.name, folder: '', ref: i.ref })));
    const merged = mergePhotoData(fresh, old);
    const a = merged.items.find((i) => i.ref === A)!;
    const b = merged.items.find((i) => i.ref === B)!;
    expect(a.key).toBe(shared);
    expect(b.key).not.toBe(shared);
    expect(a.set).toBe('s1');
    expect(b.hidden).toBe(true);
  });

  const t0 = 1_788_961_146_000;
  const savedByPath = () => {
    const d = buildPhotoData('https://www.dropbox.com/scl/fo/x/y', 'dropbox', [
      { name: 'A1.jpg', folder: '02 התארגנות', ref: 'p:/clients/roni/02 התארגנות/a1.jpg' },
      { name: 'A2.jpg', folder: '02 התארגנות', ref: 'p:/clients/roni/02 התארגנות/a2.jpg' },
      { name: 'B1.jpg', folder: 'אילון', ref: 'p:/clients/roni/אילון/b1.jpg' },
    ]);
    const [a1, a2, b1] = d.items;
    return applyPhotoEdits(d, {
      sets: [...d.sets, { id: 'fam', name: 'משפחות' }],
      items: { [a1.key]: { set: 'fam', t: t0 }, [a2.key]: { hidden: true, t: t0 + 1000 }, [b1.key]: { t: t0 + 500, ar: 0.667 } },
      cover: b1.key,
    });
  };

  it('a list saved by path, read again by Dropbox id (same folder): every key, set, hidden photo and the cover stay', () => {
    const old = savedByPath();
    const fresh = buildPhotoData(old.folderUrl, 'dropbox', [
      { name: 'A1.jpg', folder: '02 התארגנות', ref: 'p:id:AAA1', alt: 'p:/clients/roni/02 התארגנות/a1.jpg' },
      { name: 'A2.jpg', folder: '02 התארגנות', ref: 'p:id:AAA2', alt: 'p:/clients/roni/02 התארגנות/a2.jpg' },
      { name: 'B1.jpg', folder: 'אילון', ref: 'p:id:BBB1', alt: 'p:/clients/roni/אילון/b1.jpg' },
    ]);
    const merged = mergePhotoData(fresh, old);
    const byName = (d: typeof merged, n: string) => d.items.find((i) => i.name === n)!;
    for (const n of ['A1.jpg', 'A2.jpg', 'B1.jpg']) expect(byName(merged, n).key, n).toBe(byName(old, n).key);
    expect(byName(merged, 'A1.jpg').set).toBe('fam');
    expect(byName(merged, 'A2.jpg').hidden).toBe(true);
    expect(merged.cover).toBe(byName(old, 'B1.jpg').key);
    expect(merged.items.every((i) => !('alt' in i)), 'the old path is not saved').toBe(true);
    // Then the folders are renamed: the ids stay, so everything stays again.
    const renamed = buildPhotoData(old.folderUrl, 'dropbox', [
      { name: 'A1.jpg', folder: '03 התארגנות', ref: 'p:id:AAA1', alt: 'p:/ארכיון/רוני/03 התארגנות/a1.jpg' },
      { name: 'A2.jpg', folder: '03 התארגנות', ref: 'p:id:AAA2', alt: 'p:/ארכיון/רוני/03 התארגנות/a2.jpg' },
      { name: 'B1.jpg', folder: 'אילון 2', ref: 'p:id:BBB1', alt: 'p:/ארכיון/רוני/אילון 2/b1.jpg' },
    ]);
    const again = mergePhotoData(renamed, merged);
    for (const n of ['A1.jpg', 'A2.jpg', 'B1.jpg']) expect(byName(again, n).key, n).toBe(byName(old, n).key);
    expect(byName(again, 'A1.jpg').set).toBe('fam');
    expect(byName(again, 'A2.jpg').hidden).toBe(true);
    expect(again.cover).toBe(byName(old, 'B1.jpg').key);
  });

  it('the main folder renamed under a list saved by path: found by folder and name (only when one photo has them)', () => {
    const old = savedByPath();
    const fresh = buildPhotoData(old.folderUrl, 'dropbox', [
      { name: 'A1.jpg', folder: '02 התארגנות', ref: 'p:/archive/roni/02 התארגנות/a1.jpg' },
      { name: 'A2.jpg', folder: '02 התארגנות', ref: 'p:/archive/roni/02 התארגנות/a2.jpg' },
      { name: 'B1.jpg', folder: 'אילון', ref: 'p:/archive/roni/אילון/b1.jpg' },
      { name: 'B2.jpg', folder: 'אילון', ref: 'p:/archive/roni/אילון/b2.jpg' },
    ]);
    const merged = mergePhotoData(fresh, old);
    const keyOf = (d: typeof merged, n: string) => d.items.find((i) => i.name === n)!.key;
    expect(['A1.jpg', 'A2.jpg', 'B1.jpg'].map((n) => keyOf(merged, n))).toEqual(['A1.jpg', 'A2.jpg', 'B1.jpg'].map((n) => keyOf(old, n)));
    expect(merged.items.find((i) => i.name === 'A1.jpg')?.set).toBe('fam');
    expect(merged.items.find((i) => i.name === 'A2.jpg')?.hidden).toBe(true);
    expect(merged.cover).toBe(keyOf(old, 'B1.jpg'));
    expect(new Set(merged.items.map((i) => i.key)).size).toBe(4);
    // Two photographers' "IMG_1.jpg" in one folder name each is fine; two fresh photos with one place are not guessed.
    const twice = buildPhotoData('x', 'dropbox-link', [{ name: 'X.jpg', folder: 'f', ref: 'l:/new/f/X.jpg' }, { name: 'X.jpg', folder: 'f', ref: 'l:/new2/f/X.jpg' }]);
    const one = buildPhotoData('x', 'dropbox-link', [{ name: 'X.jpg', folder: 'f', ref: 'l:/old/f/X.jpg' }]);
    expect(mergePhotoData(twice, one).items.map((i) => i.key)).not.toContain(one.items[0].key);
  });

  it('chosenLost counts only chosen photos that were in the list and are gone now', async () => {
    const { chosenLost } = await import('../worker/photos');
    const before = buildPhotoData('x', 'mock', ['a', 'b', 'c', 'd'].map((n) => ({ name: `${n}.jpg`, folder: '', ref: `m:/${n}.jpg` })));
    const after = mergePhotoData(buildPhotoData('x', 'mock', ['a', 'b'].map((n) => ({ name: `${n}.jpg`, folder: '', ref: `m:/${n}.jpg` }))), before);
    const [a, , c, d] = before.items.map((i) => i.key);
    expect(chosenLost(new Set([a, c, d, 'ffffffff']), before, after)).toEqual({ lost: 2, total: 3 });
  });
});

describe('P64: a photo without a capture time goes next to its neighbour by name', () => {
  const t0 = 1_788_961_146_000;
  const d = buildPhotoData('https://x', 'dropbox-link', [
    { name: 'A1.jpg', folder: 'צלם 1', ref: 'l:/a1.jpg' },
    { name: 'A2.jpg', folder: 'צלם 1', ref: 'l:/a2.jpg' },
    { name: 'A3.jpg', folder: 'צלם 1', ref: 'l:/a3.jpg' },
    { name: 'B1.jpg', folder: 'צלם 2', ref: 'l:/b1.jpg' },
    { name: 'B2.jpg', folder: 'צלם 2', ref: 'l:/b2.jpg' },
  ]);
  const k = Object.fromEntries(d.items.map((i) => [i.name, i.key]));

  it('right after the photo before it in its folder; the rest stays in time order', () => {
    const r = applyPhotoEdits(d, { items: { [k['A1.jpg']]: { t: t0 }, [k['A3.jpg']]: { t: t0 + 3000 }, [k['B1.jpg']]: { t: t0 + 1000 }, [k['B2.jpg']]: { t: t0 + 4000 } } });
    // A2 has no time: after A1 (not at the end, and B1 still between A1 and A3 by time).
    expect(r.items.map((i) => i.name)).toEqual(['A1.jpg', 'A2.jpg', 'B1.jpg', 'A3.jpg', 'B2.jpg']);
  });

  it('no photo before it in its folder: after the one before it by name; none at all: at the start', () => {
    const r = applyPhotoEdits(d, { items: { [k['A2.jpg']]: { t: t0 + 5000 }, [k['A3.jpg']]: { t: t0 + 6000 }, [k['B2.jpg']]: { t: t0 } } });
    // A1 is first by name: the start. B1 has nothing before it in "צלם 2": after A3, the one before it by name.
    expect(r.items.map((i) => i.name)).toEqual(['A1.jpg', 'B2.jpg', 'A2.jpg', 'A3.jpg', 'B1.jpg']);
  });

  it('a time can be taken away (t: null); a camera without its clock set stays ignored', () => {
    const timed = applyPhotoEdits(d, { items: { [k['A1.jpg']]: { t: t0 } } });
    expect(applyPhotoEdits(timed, { items: { [k['A1.jpg']]: { t: null } } }).items.find((i) => i.name === 'A1.jpg')?.t).toBeUndefined();
    expect(applyPhotoEdits(timed, { items: { [k['A1.jpg']]: { t: 12 } } }).items.find((i) => i.name === 'A1.jpg')?.t).toBe(t0);
  });
});

describe('P64: "full quality" trusts saved times only when they were all read from the files', () => {
  it('a list without timesV (times may be made up: the photo before + 1ms): no other photo is sent', async () => {
    const { largestCopy } = await import('../worker/photos');
    const t = 1_788_960_575_940;
    const items = [
      { key: 'aaaaaaaa', name: 'A.jpg', ref: 'l:/1/A.jpg', t, ar: 0.667, size: 9_000_000 },
      // B had no time; the old screen gave it A's time + 1ms, then C got the same "time" from B.
      { key: 'bbbbbbbb', name: 'B.jpg', ref: 'l:/1/B.jpg', t: t + 1, ar: 0.667, size: 400_000 },
      { key: 'cccccccc', name: 'C.jpg', ref: 'l:/2/C.jpg', t: t + 1, ar: 0.667, size: 20_000_000 },
    ];
    const old = { folderUrl: 'x', provider: 'dropbox-link' as const, sets: [], items };
    expect((await largestCopy(old, items[1])).ref).toBe('l:/1/B.jpg');
    // Same name in another folder: the saved time is not trusted either (no file to read it from).
    const named = { ...old, items: [...items, { key: 'dddddddd', name: 'B.jpg', ref: 'l:/2/B.jpg', t: t + 1, ar: 0.667, size: 30_000_000 }] };
    expect((await largestCopy(named, items[1])).ref).toBe('l:/1/B.jpg');
    // Read the P64 way: the same moment really is the same photo.
    expect((await largestCopy({ ...named, timesV: 2 }, items[1])).ref).toBe('l:/2/B.jpg');
  });

  it('timesV comes from the studio screen and stays through a re-read', () => {
    const d = buildPhotoData('x', 'mock', [{ name: 'a.jpg', folder: '', ref: 'm:/a.jpg' }]);
    const v2 = applyPhotoEdits(d, { timesV: 2 });
    expect(v2.timesV).toBe(2);
    expect(applyPhotoEdits(d, { timesV: 3 }).timesV).toBeUndefined();
    expect(mergePhotoData(buildPhotoData('x', 'mock', [{ name: 'a.jpg', folder: '', ref: 'm:/a.jpg' }]), v2).timesV).toBe(2);
  });
});

/** A little-endian TIFF block: IFD0 → Exif sub-IFD with DateTimeOriginal (and sub-seconds "48"). */
function tiffBlock(date: string): number[] {
  const tiff: number[] = [];
  const u16 = (v: number) => tiff.push(v & 0xff, v >> 8);
  const u32 = (v: number) => tiff.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24);
  tiff.push(0x49, 0x49); u16(42); u32(8);
  u16(1); u16(0x8769); u16(4); u32(1); u32(26); u32(0);
  u16(2); u16(0x9003); u16(2); u32(20); u32(56); u16(0x9291); u16(2); u32(3); tiff.push(0x34, 0x38, 0, 0); u32(0);
  for (const ch of date) tiff.push(ch.charCodeAt(0));
  tiff.push(0);
  return tiff;
}

describe('P64: capture time from TIFF and HEIC files', () => {
  const when = Date.UTC(2026, 8, 9, 13, 39, 6) + 480;

  it('a TIFF file', () => {
    expect(exifTakenAt(new Uint8Array(tiffBlock('2026:09:09 13:39:06')))).toBe(when);
  });

  it('a HEIC file (the Exif item after the boxes at the start)', async () => {
    const { pictureKind } = await import('../shared/exif');
    const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
    const ftyp = [0, 0, 0, 24, ...ascii('ftypheic'), 0, 0, 0, 0, ...ascii('mif1heic')];
    const heic = new Uint8Array([...ftyp, 0, 0, 0, 16, ...ascii('meta'), 0, 0, 0, 0, 1, 2, 3, 4, 0, 0, 0, 6, ...ascii('Exif'), 0, 0, ...tiffBlock('2026:09:09 13:39:06')]);
    expect(pictureKind(heic)).toBe('heif');
    expect(exifTakenAt(heic)).toBe(when);
    expect(exifTakenAt(new Uint8Array(ftyp))).toBeNull();
  });

  it('what is and is not a picture', async () => {
    const { pictureKind } = await import('../shared/exif');
    expect(pictureKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(pictureKind(new Uint8Array(tiffBlock('2026:09:09 13:39:06')))).toBe('tiff');
    expect(pictureKind(new TextEncoder().encode('<!doctype html><title>Sign in</title>'))).toBe('');
    expect(pictureKind(new TextEncoder().encode('{"error":"quota"}'))).toBe('');
    expect(pictureKind(new Uint8Array(0))).toBe('');
  });

  it('batch sizes per cloud: Drive without the studio\'s API key reads fewer', async () => {
    const { datesBatchSize } = await import('../shared/photosets');
    expect([datesBatchSize('dropbox'), datesBatchSize('dropbox-link'), datesBatchSize('gdrive'), datesBatchSize('gdrive', { googleApiKey: false }), datesBatchSize('pcloud')]).toEqual([20, 20, 20, 10, 8]);
  });
});

describe('P64: loading the folder again asks first when chosen photos would be gone', async () => {
  const { default: worker } = await import('../worker/index');
  const { storeFor } = await import('../worker/store');
  const { fakeEnv } = await import('./fake-kv');
  const env = { ...fakeEnv(), CLOUD_MOCK: '1' } as never;
  const call = (method: string, path: string, body: unknown, headers: Record<string, string>) =>
    worker.fetch(new Request(`https://films.test${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }), env);
  const FOLDER = 'https://www.dropbox.com/scl/fo/abc/def?rlkey=k&dl=0';
  let n = 0;

  /** A gallery whose saved list is the demo folder's 30 photos plus `gone` photos no longer in it. */
  async function gallery(gone: number) {
    n++;
    const tid = `00000000-0000-4000-8000-0000000640${String(n).padStart(2, '0')}`;
    const studio = { Authorization: `Bearer test:u64${n}:${tid}:owner` };
    const store = (await storeFor(env)) as import('../worker/store-memory').MemoryStore;
    store.seedTenant({ id: tid, slug: `p64-studio-${n}` });
    const g = (await (await call('POST', '/api/admin/galleries', { coupleName: 'מאי & אופק', kind: 'photos' }, studio)).json()) as { id: string };
    const refs = [...Array.from({ length: 30 }, (_, i) => `m:/demo/photos/${String(i + 1).padStart(2, '0')}.jpg`), ...Array.from({ length: gone }, (_, i) => `m:/gone/${i}.jpg`)];
    const items = refs.map((ref) => ({ key: photoKey(ref), name: ref.slice(ref.lastIndexOf('/') + 1), ref }));
    await store.savePhotos(tid, g.id, { folderUrl: FOLDER, provider: 'dropbox', sets: [], items });
    return { tid, studio, id: g.id, store, items };
  }

  it('3 of 13 hearted photos gone (23%): nothing saved, `needsConfirm`; with confirm the folder is loaded', async () => {
    const { tid, studio, id, store, items } = await gallery(3);
    for (const it of [...items.slice(0, 10), ...items.slice(30)]) await store.setHearts(tid, id, [it.key], true, 'מאי');
    const r = await call('POST', `/api/admin/galleries/${id}/photos/load`, { url: FOLDER }, studio);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ needsConfirm: true, lost: 3, total: 13 });
    expect((await store.getPhotos(id))!.items).toHaveLength(33);
    const ok = (await (await call('POST', `/api/admin/galleries/${id}/photos/load`, { url: FOLDER, confirm: true }, studio)).json()) as { items: { key: string }[] };
    expect(ok.items).toHaveLength(30);
    expect(ok.items.map((i) => i.key)).toEqual(expect.arrayContaining(items.slice(0, 10).map((i) => i.key)));
  });

  it('an Instagram mark, a list or an album slot counts like a heart; 1 of 11 gone (9%) loads without asking', async () => {
    const { tid, studio, id, store, items } = await gallery(2);
    for (const it of items.slice(0, 8)) await store.setInstaMany(tid, id, [it.key], true);
    await store.createList(id, { id: 'l1', name: 'לאמא', keys: [items[30].key] });
    const asked = (await (await call('POST', `/api/admin/galleries/${id}/photos/load`, { url: FOLDER }, studio)).json()) as { needsConfirm?: boolean; lost?: number; total?: number };
    expect(asked).toMatchObject({ needsConfirm: true, lost: 1, total: 9 });
    const fill = (photo: string) => ({ photo, zoom: 1, cx: 0.5, cy: 0.5 });
    await store.putAlbum(tid, id, { size: '30x30', status: 'draft', updatedAt: '2026-09-30T10:00:00.000Z', spreads: [{ id: 's1', template: 't', fills: [fill(items[8].key), fill(items[9].key)], texts: [] }] });
    const loaded = (await (await call('POST', `/api/admin/galleries/${id}/photos/load`, { url: FOLDER }, studio)).json()) as { needsConfirm?: boolean; items: unknown[] };
    expect(loaded.needsConfirm).toBeUndefined();
    expect(loaded.items).toHaveLength(30);
  });

  it('an edit of a key two photos share is not saved; the answer says to load again', async () => {
    const { studio, id, store, tid } = await gallery(0);
    const data = (await store.getPhotos(id))!;
    data.items[1] = { ...data.items[1], key: data.items[0].key };
    await store.savePhotos(tid, id, data);
    const r = (await (await call('PUT', `/api/admin/galleries/${id}/photos`, { items: { [data.items[0].key]: { hidden: true }, [data.items[2].key]: { hidden: true } } }, studio)).json()) as { ambiguous: string[]; warning: string; items: { hidden?: boolean }[] };
    expect(r.ambiguous).toEqual([data.items[0].key]);
    expect(r.warning).toContain('טענו את התיקייה מחדש');
    expect(r.items.filter((i) => i.hidden)).toHaveLength(1);
  });
});

describe('P70: hearts and marks shown only for photos in the list (decision D16(3): kept in the database)', async () => {
  const { heartsFor, photoKey: pk } = await import('../worker/photos');
  const { default: worker } = await import('../worker/index');
  const { storeFor } = await import('../worker/store');
  const { fakeEnv } = await import('./fake-kv');
  const env = { ...fakeEnv(), CLOUD_MOCK: '1' } as never;
  const call = (method: string, path: string, body: unknown, headers: Record<string, string> = {}) =>
    worker.fetch(new Request(`https://films.test${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env);

  it('heartsFor: the couple gets the shown photos, the studio every photo in the list, nobody a photo that left it', () => {
    const data = { folderUrl: '', provider: 'dropbox', sets: [], items: [{ key: 'aaaaaaa1', name: 'a', ref: 'a' }, { key: 'aaaaaaa2', name: 'b', ref: 'b', hidden: true }] } as never;
    const favBy = { aaaaaaa9: ['מאי'], aaaaaaa2: [''], aaaaaaa1: ['אמא'] };
    expect(heartsFor(data, favBy, ['aaaaaaa2', 'aaaaaaa9', 'aaaaaaa1'])).toEqual({ favBy: { aaaaaaa1: ['אמא'] }, insta: ['aaaaaaa1'] });
    const studio = heartsFor(data, favBy, ['aaaaaaa2', 'aaaaaaa9', 'aaaaaaa1'], { includeHidden: true });
    expect(studio).toEqual({ favBy: { aaaaaaa2: [''], aaaaaaa1: ['אמא'] }, insta: ['aaaaaaa2', 'aaaaaaa1'] });
    // Kept in their order.
    expect(Object.keys(studio.favBy)).toEqual(['aaaaaaa2', 'aaaaaaa1']);
    expect(heartsFor(null, favBy, ['aaaaaaa1'])).toEqual({ favBy: {}, insta: [] });
  });

  it('a photo the studio hides takes its hearts off the couple\'s counter (not out of the database); a gone photo\'s hearts stay unseen', async () => {
    const tid = '00000000-0000-4000-8000-000000070001';
    const studio = { Authorization: `Bearer test:u70:${tid}:owner` };
    const store = (await storeFor(env)) as import('../worker/store-memory').MemoryStore;
    store.seedTenant({ id: tid, slug: 'p70-hearts' });
    const g = (await (await call('POST', '/api/admin/galleries', { coupleName: 'לב & לב', kind: 'photos' }, studio)).json()) as { id: string };
    const items = Array.from({ length: 4 }, (_, i) => ({ key: pk(`m:/p70/${i}.jpg`), name: `${i}.jpg`, ref: `m:/p70/${i}.jpg` }));
    await store.savePhotos(tid, g.id, { folderUrl: 'https://www.dropbox.com/scl/fo/p70/x', provider: 'dropbox', sets: [], items });
    const [a, b, c] = items.map((i) => i.key);
    // A heart on a photo that left the folder (kept, D16(3)).
    const gone = 'fedcba98';
    await store.setHearts(tid, g.id, [gone], true, 'מאי');
    await store.setInstaMany(tid, g.id, [gone], true);
    const r = (await (await call('POST', `/api/watch/${g.id}/fav`, { keys: [a, b, c], on: true, who: 'מאי' })).json()) as { favorites: string[]; favBy: Record<string, string[]> };
    expect(r.favorites).toEqual([a, b, c].sort());
    await call('POST', `/api/watch/${g.id}/insta`, { keys: [b, c], on: true });
    await call('PUT', `/api/admin/galleries/${g.id}/photos`, { items: { [b]: { hidden: true } } }, studio);

    const couple = (await (await call('GET', `/api/watch/${g.id}`, undefined)).json()) as { favorites: string[]; favBy: Record<string, string[]>; insta: string[] };
    expect(couple.favorites.sort()).toEqual([a, c].sort());
    expect(Object.keys(couple.favBy).sort()).toEqual([a, c].sort());
    expect(couple.insta).toEqual([c]);
    const fav = (await (await call('POST', `/api/watch/${g.id}/fav`, { key: a, on: false, who: 'מאי' })).json()) as { favorites: string[] };
    expect(fav.favorites).toEqual([c]);

    const admin = (await (await call('GET', `/api/admin/galleries/${g.id}/photos`, undefined, studio)).json()) as { favorites: string[]; insta: string[] };
    expect(admin.favorites.sort()).toEqual([b, c].sort());
    expect(admin.insta.sort()).toEqual([b, c].sort());
    // Still in the database, for when the photo comes back.
    expect(Object.keys(await store.listHearts(g.id))).toEqual(expect.arrayContaining([gone, b]));
    expect(await store.listInsta(g.id)).toEqual(expect.arrayContaining([gone, b]));
  });
});
