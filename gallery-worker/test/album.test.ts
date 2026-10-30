import { describe, expect, it } from 'vitest';
import {
  ALBUM_SIZES,
  COVER_TEMPLATES,
  TEMPLATES,
  albumPrice,
  autoAlbum,
  centerFromOffset,
  changeTemplate,
  cleanAlbum,
  crossesFold,
  emptySlots,
  fillSpread,
  placePhoto,
  slotAspect,
  template,
  usedPhotos,
} from '../shared/album';

const size = ALBUM_SIZES['80x30'];
const photos = Array.from({ length: 150 }, (_, i) => ({ key: `k${i}`, ar: i % 3 === 2 ? 0.667 : 1.5 }));

describe('layouts from the real sketches', () => {
  it('has the 42 layouts and a cover with a names panel', () => {
    expect(TEMPLATES.length).toBe(42);
    expect(COVER_TEMPLATES.length).toBeGreaterThan(0);
    for (const t of TEMPLATES) for (const r of t.slots) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(1.001);
      expect(r.y + r.h).toBeLessThanOrEqual(1.001);
    }
  });
  it('80×30 is 9449×3543 pixels at 300 DPI', () => {
    expect(Math.round((size.widthCm / 2.54) * size.dpi)).toBe(size.spreadPx[0]);
    expect(Math.round((size.heightCm / 2.54) * size.dpi)).toBe(size.spreadPx[1]);
  });
  it('knows which slots cross the fold', () => {
    expect(crossesFold({ x: 0.2, y: 0, w: 0.6, h: 1 })).toBe(true);
    expect(crossesFold({ x: 0, y: 0, w: 0.5, h: 1 })).toBe(false);
  });
});

describe('placing a photo in a slot', () => {
  it('always covers the slot, whatever the zoom or focus point', () => {
    for (const [slotAr, ar] of [[1, 1.5], [2, 0.667], [0.5, 1.5], [1.33, 1.33]]) {
      for (const f of [{ zoom: 1, cx: 0.5, cy: 0.5 }, { zoom: 2.5, cx: 0, cy: 1 }, { zoom: 1, cx: 1, cy: 0 }]) {
        const p = placePhoto(slotAr, ar, f);
        expect(p.x).toBeLessThanOrEqual(0.0001);
        expect(p.y).toBeLessThanOrEqual(0.0001);
        expect(p.x + p.w).toBeGreaterThanOrEqual(0.9999);
        expect(p.y + p.h).toBeGreaterThanOrEqual(0.9999);
      }
    }
  });
  it('keeps the chosen point in the middle when there is room', () => {
    const p = placePhoto(1, 1.5, { zoom: 2, cx: 0.5, cy: 0.5 });
    expect(centerFromOffset(p.x, p.y, p.w, p.h)).toEqual({ cx: 0.5, cy: 0.5 });
  });
});

describe('the first draft', () => {
  const album = autoAlbum(photos, 'דניאל & סבינה', '18.9.26');
  it('has 30 spreads, opens with the names panel and texts', () => {
    expect(album.spreads).toHaveLength(30);
    expect(template(album.spreads[0].template).panels.length).toBeGreaterThan(0);
    expect(album.spreads[0].texts.map((t) => t.text)).toEqual(['דניאל & סבינה', '18.9.26']);
    expect(album.spreads.slice(1).every((s) => s.texts.length === 0)).toBe(true);
  });
  it('uses the hearts in order, each photo once', () => {
    const keys = album.spreads.flatMap((s) => s.fills.map((f) => f.photo)).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBeGreaterThan(100);
    // The first spread's photos come from the start of the list.
    expect(album.spreads[0].fills.every((f) => ['k0', 'k1', 'k2', 'k3'].includes(f.photo) || !f.photo)).toBe(true);
  });
  it('puts portrait photos into the tallest slots', () => {
    const t = TEMPLATES.find((x) => x.slots.length === 4 && new Set(x.slots.map((r) => Math.round(slotAspect(r, size) * 10))).size > 1)!;
    const fills = fillSpread(t, [{ key: 'land', ar: 1.5 }, { key: 'port', ar: 0.667 }, { key: 'l2', ar: 1.5 }, { key: 'l3', ar: 1.5 }], size);
    const portSlot = t.slots[fills.findIndex((f) => f.photo === 'port')];
    const minAspect = Math.min(...t.slots.map((r) => slotAspect(r, size)));
    expect(slotAspect(portSlot, size)).toBeCloseTo(minAspect, 5);
  });
  it('a small list leaves empty slots, and changing a layout keeps the photos', () => {
    const small = autoAlbum(photos.slice(0, 10), 'א & ב', '');
    expect(usedPhotos(small).size).toBe(10);
    expect(emptySlots(small)).toBeGreaterThan(50);
    const s = small.spreads[1];
    const other = TEMPLATES.find((t) => t.slots.length === 2)!;
    const changed = changeTemplate(s, other.id, new Map(photos.map((p) => [p.key, p.ar])), size);
    expect(changed.fills).toHaveLength(2);
    expect(changed.fills.map((f) => f.photo).every((k) => s.fills.some((f) => f.photo === k))).toBe(true);
  });
});

describe('price and validation', () => {
  it("extra spreads cost the studio's own price, beyond the studio's included pages (fix plan P53)", () => {
    const a = autoAlbum(photos, 'x', '');
    expect(a.spreads).toHaveLength(30);
    expect(albumPrice(a, 52, 30)).toEqual({ extraSpreads: 0, extraCost: 0 });
    a.spreads.push(a.spreads[1], a.spreads[2]);
    expect(albumPrice(a, 52, 30)).toEqual({ extraSpreads: 2, extraCost: 104 });
    // A studio that includes 26 pages: 6 extra.
    expect(albumPrice(a, 52, 26)).toEqual({ extraSpreads: 6, extraCost: 312 });
  });
  it('no price set: the extra spreads are counted but never priced by a number from the code (no 45)', () => {
    const a = autoAlbum(photos, 'x', '');
    a.spreads.push(a.spreads[1]);
    expect(albumPrice(a)).toEqual({ extraSpreads: 1, extraCost: null });
    expect(albumPrice(a, null, 30).extraCost).toBeNull();
    expect(JSON.stringify(ALBUM_SIZES)).not.toMatch(/extraSpreadPrice/);
  });
  it('drops unknown photos, layouts, fonts and colours, and clamps numbers', () => {
    const clean = cleanAlbum(
      {
        size: '80x30',
        status: 'submitted',
        spreads: [
          { id: 'a', template: 'nope', fills: [{ photo: 'k1', zoom: 99, cx: -3, cy: 0.2 }, { photo: 'hacker' }], texts: [{ text: 'x'.repeat(500), font: 'Comic Sans', color: 'red', size: 9, weight: 900, align: 'justify' }] },
        ],
      },
      new Set(['k1']),
    );
    const s = clean.spreads[0];
    expect(s.template).toBe(TEMPLATES[0].id);
    expect(s.fills[0]).toEqual({ photo: 'k1', zoom: 4, cx: 0, cy: 0.2 });
    expect(s.fills[1].photo).toBe('');
    expect(s.texts[0]).toMatchObject({ font: 'Assistant', color: '#222222', size: 0.3, weight: 400, align: 'center' });
    expect(s.texts[0].text.length).toBe(200);
    expect(clean.status).toBe('submitted');
  });
});

describe('editing layouts and building by the story', () => {
  it('splits a slot in two with the album gap, and removing a slot lets its neighbour grow', async () => {
    const { splitSlot, removeSlot, GAP_X, GAP_Y, isCustomId } = await import('../shared/album');
    const t = { id: 'x', slots: [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5 + GAP_X, y: 0, w: 0.5 - GAP_X, h: 1 }], panels: [], uses: 0 };
    const side = splitSlot(t, 0, 'side');
    expect(isCustomId(side.id)).toBe(true);
    expect(side.slots).toHaveLength(3);
    expect(side.slots[0].w + side.slots[1].w + GAP_X).toBeCloseTo(0.5, 3);
    const stack = splitSlot(t, 1, 'stack');
    expect(stack.slots[1].h + stack.slots[2].h + GAP_Y).toBeCloseTo(1, 3);
    const { template: merged, grew } = removeSlot(side, 1);
    expect(merged.slots).toHaveLength(2);
    expect(grew).toBe(0);
    expect(merged.slots[0].w).toBeCloseTo(0.5, 3);
  });

  it('picks layouts whose slot shapes fit the photos', async () => {
    const { bestTemplate } = await import('../shared/album');
    const size = ALBUM_SIZES['80x30'];
    const portraits = bestTemplate([{ ar: 0.667 }, { ar: 0.667 }, { ar: 0.667 }], size);
    expect(portraits.slots).toHaveLength(3);
    const tall = portraits.slots.filter((r) => slotAspect(r, size) < 1).length;
    expect(tall).toBeGreaterThanOrEqual(2);
  });

  it('builds the album by the story: opening from outdoor photos, then the sets in order, one set per page', async () => {
    const { storyAlbum } = await import('../shared/album');
    const sets = [
      { id: 's1', name: 'טיזר' },
      { id: 's2', name: 'התארגנות' },
      { id: 's3', name: 'צילומי חוץ' },
      { id: 's4', name: 'משפחות' },
      { id: 's5', name: 'אולם' },
      { id: 's6', name: 'טקס חופה' },
      { id: 's7', name: 'מסיבה' },
    ];
    const mk = (set: string, n: number) => Array.from({ length: n }, (_, i) => ({ key: `${set}-${i}`, ar: i % 3 ? 1.5 : 0.667, set }));
    // Given in a different order on purpose: the album follows the story, not the input.
    const photos = [...mk('s7', 30), ...mk('s3', 25), ...mk('s2', 20), ...mk('s5', 15), ...mk('s6', 20), ...mk('s4', 20)];
    const a = storyAlbum(photos, sets, 'נועה & איתי', '24.9.26');
    expect(a.spreads).toHaveLength(30);
    const opening = a.spreads[0].fills.filter((f) => f.photo).map((f) => f.photo);
    expect(opening.length).toBeGreaterThanOrEqual(1);
    expect(opening.every((k) => k.startsWith('s3-'))).toBe(true);
    expect(a.spreads[0].texts[0].text).toBe('נועה & איתי');
    // Each later page holds photos of one set, and the sets come in the story's order.
    const setOfPage = a.spreads.slice(1).map((s) => [...new Set(s.fills.filter((f) => f.photo).map((f) => f.photo.split('-')[0]))]);
    expect(setOfPage.every((x) => x.length <= 1)).toBe(true);
    const order = setOfPage.flat().filter((x, i, arr) => arr.indexOf(x) === i);
    expect(order).toEqual(['s2', 's3', 's4', 's6', 's5', 's7']);
    // Every photo appears once.
    const all = a.spreads.flatMap((s) => s.fills.map((f) => f.photo)).filter(Boolean);
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(photos.length);
  });

  it('splits a page into two', async () => {
    const { splitSpread } = await import('../shared/album');
    const size = ALBUM_SIZES['80x30'];
    const t = TEMPLATES.find((x) => x.slots.length === 6 && !x.panels.length)!;
    const spread = { id: 'a', template: t.id, fills: t.slots.map((_, i) => ({ photo: `p${i}`, zoom: 1, cx: 0.5, cy: 0.5 })), texts: [] as never[] };
    const [one, two] = splitSpread(spread, new Map(), size);
    const photosIn = (s: { fills: { photo: string }[] }) => s.fills.filter((f) => f.photo).map((f) => f.photo);
    expect([...photosIn(one), ...photosIn(two)].sort()).toEqual(spread.fills.map((f) => f.photo).sort());
    expect(photosIn(two).length).toBeGreaterThan(0);
  });

  it('keeps custom layouts that the album uses, and refuses broken ones', async () => {
    const { cleanCustom, splitSlot } = await import('../shared/album');
    const custom = splitSlot(TEMPLATES[0], 0, 'side');
    expect(cleanCustom([custom, { id: 'c_bad1', slots: [{ x: 0.9, y: 0, w: 0.5, h: 1 }] }, { id: 'nope', slots: [{ x: 0, y: 0, w: 1, h: 1 }] }])).toHaveLength(1);
    const album = { size: '80x30', spreads: [{ id: 's', template: custom.id, fills: custom.slots.map(() => ({ photo: 'k1', zoom: 1, cx: 0.5, cy: 0.5 })), texts: [] }], custom: [custom], status: 'draft' };
    const cleaned = cleanAlbum(album, new Set(['k1']));
    expect(cleaned.spreads[0].template).toBe(custom.id);
    expect(cleaned.spreads[0].fills).toHaveLength(custom.slots.length);
    expect(cleaned.custom?.map((c) => c.id)).toEqual([custom.id]);
  });
});

// ---------- fix plan P57: the limits are the editor's and the server's; nothing is trimmed in silence ----------

describe('P57: checking an album', () => {
  const page = (template = 't01', photo = '') => ({ id: 'p', template, fills: [{ photo }], texts: [] });

  it('reports what it could not keep: pages past the maximum, an unknown layout, more photos than slots, bad keys', async () => {
    const { checkAlbum, ALBUM_SIZES: sizes } = await import('../shared/album');
    const max = sizes['80x30'].maxSpreads;
    expect(checkAlbum({ spreads: Array.from({ length: max + 1 }, () => page()) }, null).cut[0]).toContain(`${max} דפים`);
    expect(checkAlbum({ spreads: Array.from({ length: max }, () => page()) }, null).cut).toEqual([]);
    expect(checkAlbum({ spreads: [page('nope')] }, null).cut).toEqual(['בדף הפתיחה: פריסה לא מוכרת']);
    const t = TEMPLATES[1];
    const fills = Array.from({ length: t.slots.length + 1 }, (_, i) => ({ photo: (i + 10).toString(16).padStart(8, '0') }));
    expect(checkAlbum({ spreads: [page(), { id: 'x', template: t.id, fills, texts: [] }] }, null).cut).toEqual(['בדף 2: יותר תמונות ממשבצות']);
    expect(checkAlbum({ spreads: [page('t01', 'not-a-key')] }, null).cut).toEqual(['בדף הפתיחה: תמונה לא מוכרת']);
    expect(checkAlbum({ spreads: [{ ...page(), texts: Array.from({ length: 13 }, () => ({ text: 'x' })) }] }, null).cut[0]).toContain('12 טקסטים');
    // A draft keeps any well-formed key; the send drops the photos not in the gallery and counts them.
    expect(checkAlbum({ spreads: [page('t01', 'aaaaaaaa')] }, null)).toMatchObject({ cut: [], dropped: 0 });
    expect(checkAlbum({ spreads: [page('t01', 'aaaaaaaa')] }, new Set(['bbbbbbbb']))).toMatchObject({ cut: [], dropped: 1 });
  });

  it('a layout with one slot too small, or more than 16 slots, is refused whole (no photo moves to another slot)', async () => {
    const { checkAlbum, cleanCustom, splitSlot, MAX_SLOTS } = await import('../shared/album');
    const ok = splitSlot(TEMPLATES[0], 0, 'side');
    const thin = { ...ok, id: 'c_thin1', slots: [...ok.slots.slice(0, -1), { x: 0.9, y: 0.1, w: 0.05, h: 0.01 }] };
    const many = { ...ok, id: 'c_many1', slots: Array.from({ length: MAX_SLOTS + 1 }, (_, i) => ({ x: 0, y: i * 0.05, w: 0.5, h: 0.03 })) };
    expect(cleanCustom([ok, thin, many]).map((t) => t.id)).toEqual([ok.id]);
    const r = checkAlbum({ spreads: [{ id: 's', template: thin.id, fills: thin.slots.map(() => ({ photo: 'aaaaaaaa' })), texts: [] }], custom: [thin] }, null);
    expect(r.cut[0]).toContain('הפריסה לא תקינה');
  });

  it('the editor can tell when a split would pass the limits', async () => {
    const { canSplitSlot, splitSlot, MAX_SLOTS } = await import('../shared/album');
    let t: import('../shared/album').AlbumTemplate = { id: 'x', slots: [{ x: 0, y: 0, w: 1, h: 1 }], panels: [], uses: 0 };
    let splits = 0;
    while (canSplitSlot(t, 0, 'stack')) {
      t = splitSlot(t, 0, 'stack');
      splits++;
    }
    expect(splits).toBeGreaterThan(2);
    expect(t.slots.every((r) => r.h >= 0.02)).toBe(true);
    const full = { id: 'y', slots: Array.from({ length: MAX_SLOTS }, (_, i) => ({ x: (i % 4) * 0.25, y: Math.floor(i / 4) * 0.25, w: 0.24, h: 0.24 })), panels: [], uses: 0 };
    expect(canSplitSlot(full, 0, 'side')).toBe(false);
  });

  it("checking albums never grows the browser's layout registry (one Worker serves every studio)", async () => {
    const { checkAlbum, splitSlot, TEMPLATE_BY_ID } = await import('../shared/album');
    const before = TEMPLATE_BY_ID.size;
    for (let i = 0; i < 20; i++) {
      const custom = Array.from({ length: 10 }, (_, j) => ({ ...splitSlot(TEMPLATES[0], 0, 'side'), id: `c_reg${i}x${j}` }));
      checkAlbum({ spreads: [{ id: 's', template: custom[0].id, fills: [], texts: [] }], custom }, null);
    }
    expect(TEMPLATE_BY_ID.size).toBe(before);
    // An album's own layout is found without registering it.
    const own = { ...splitSlot(TEMPLATES[0], 0, 'side'), id: 'c_ownlayout1' };
    const r = checkAlbum({ spreads: [{ id: 's', template: own.id, fills: [], texts: [] }], custom: [own] }, null);
    expect(r.album.spreads[0].template).toBe(own.id);
    expect(TEMPLATE_BY_ID.has(own.id)).toBe(false);
  });
});
