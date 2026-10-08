// Album spread templates (2026-10-08) — measured from the owner's own 98 SmartAlbums sketches
// (~/Downloads/קולד 2027/album-reference-sketches, 3 albums). Each cell is [x, y, w, h] in
// percent of the spread, in "cut" coordinates: neighbouring cells touch, and the white gutter is
// applied at render time (cellRects), so every template gets the same gutter as his albums.
// `uses` = how many of his spreads used that layout — the auto-sketch (stage 2) leans on it.

// 80×30 cm at 300dpi. The print shop gets exactly this.
export const SPREAD = { widthPx: 9449, heightPx: 3543, widthCm: 80, heightCm: 30 };
// His gutter is ~38px at full size, on both axes.
export const GUTTER_X = (38 / SPREAD.widthPx) * 100;
export const GUTTER_Y = (38 / SPREAD.heightPx) * 100;

export const PHOTO_TEMPLATES = [
  { id: "p1-a", uses: 1, cells: [[0, 0, 100, 100]] },
  { id: "p2-a", uses: 2, cells: [[0, 0, 50, 100], [50, 0, 50, 100]] },
  { id: "p2-b", uses: 1, cells: [[0, 0, 76, 100], [76, 0, 24, 100]] },
  { id: "p3-a", uses: 6, cells: [[0, 0, 50, 100], [50, 0, 25, 100], [75, 0, 25, 100]] },
  { id: "p3-b", uses: 3, cells: [[0, 0, 25, 100], [25, 0, 25, 100], [50, 0, 50, 100]] },
  { id: "p3-c", uses: 1, cells: [[0, 0, 33.5, 100], [33.5, 0, 33, 100], [66.5, 0, 33.5, 100]] },
  { id: "p3-d", uses: 1, cells: [[0, 0, 75, 100], [75, 0, 25, 50], [75, 50, 25, 50]] },
  { id: "p4-a", uses: 18, cells: [[0, 0, 25, 100], [25, 0, 25, 100], [50, 0, 25, 100], [75, 0, 25, 100]] },
  { id: "p4-b", uses: 2, cells: [[0, 0, 59.5, 100], [59.5, 0, 27, 100], [86.5, 0, 13.5, 50], [86.5, 50, 13.5, 50]] },
  { id: "p4-c", uses: 2, cells: [[0, 0, 26.5, 50], [0, 50, 26.5, 50], [26.5, 0, 23.5, 100], [50, 0, 50, 100]] },
  { id: "p4-d", uses: 1, cells: [[0, 0, 24, 100], [24, 0, 26, 50], [24, 50, 26, 50], [50, 0, 50, 100]] },
  { id: "p5-a", uses: 5, cells: [[0, 0, 28.5, 100], [28.5, 0, 28.5, 100], [57, 0, 14.5, 50], [57, 50, 14.5, 50], [71.5, 0, 28.5, 100]] },
  { id: "p5-b", uses: 4, cells: [[0, 0, 56.5, 100], [56.5, 0, 29.5, 50], [56.5, 50, 13.5, 50], [70, 50, 30, 50], [86, 0, 14, 50]] },
  { id: "p5-c", uses: 3, cells: [[0, 0, 50, 100], [50, 0, 25, 50], [50, 50, 25, 50], [75, 0, 25, 50], [75, 50, 25, 50]] },
  { id: "p5-d", uses: 2, cells: [[0, 0, 26.5, 50], [0, 50, 26.5, 50], [26.5, 0, 23.5, 100], [50, 0, 25, 100], [75, 0, 25, 100]] },
  { id: "p5-e", uses: 1, cells: [[0, 0, 25, 100], [25, 0, 25, 100], [50, 0, 26, 50], [50, 50, 26, 50], [76, 0, 24, 100]] },
  { id: "p5-f", uses: 1, cells: [[0, 0, 20, 100], [20, 0, 20, 100], [40, 0, 10, 50], [40, 50, 10, 50], [50, 0, 50, 100]] },
  { id: "p5-g", uses: 1, cells: [[0, 0, 50, 100], [50, 0, 25, 100], [75, 0, 25, 48], [75, 48, 12.5, 52], [87.5, 48, 12.5, 52]] },
  { id: "p5-h", uses: 1, cells: [[0, 0, 28.5, 100], [28.5, 0, 14.5, 50], [28.5, 50, 14.5, 50], [43, 0, 28.5, 100], [71.5, 0, 28.5, 100]] },
  { id: "p5-i", uses: 1, cells: [[0, 0, 14, 50], [0, 50, 30, 50], [14, 0, 29.5, 50], [30, 50, 13.5, 50], [43.5, 0, 56.5, 100]] },
  { id: "p5-j", uses: 1, cells: [[0, 0, 47, 100], [47, 0, 13, 50], [47, 50, 13, 50], [60, 0, 20, 100], [80, 0, 20, 100]] },
  { id: "p5-k", uses: 1, cells: [[0, 0, 37, 100], [37, 0, 12.5, 50], [37, 50, 12.5, 50], [49.5, 0, 25, 100], [74.5, 0, 25.5, 100]] },
  { id: "p6-a", uses: 6, cells: [[0, 0, 30, 50], [0, 50, 30, 50], [30, 0, 20, 33], [30, 33, 20, 34], [30, 67, 20, 33], [50, 0, 50, 100]] },
  { id: "p6-b", uses: 3, cells: [[0, 0, 24, 100], [24, 0, 26, 50], [24, 50, 26, 50], [50, 0, 23.5, 100], [73.5, 0, 26.5, 50], [73.5, 50, 26.5, 50]] },
  { id: "p6-c", uses: 3, cells: [[0, 0, 27, 100], [27, 0, 27.5, 100], [54.5, 0, 18.5, 67], [54.5, 67, 9, 33], [63.5, 67, 9.5, 33], [73, 0, 27, 100]] },
  { id: "p6-d", uses: 2, cells: [[0, 0, 25, 100], [25, 0, 12.5, 50], [25, 50, 12.5, 50], [37.5, 0, 12.5, 50], [37.5, 50, 12.5, 50], [50, 0, 50, 100]] },
  { id: "p6-e", uses: 1, cells: [[0, 0, 50, 100], [50, 0, 19, 100], [69, 0, 20, 50], [69, 50, 11, 50], [80, 50, 20, 50], [89, 0, 11, 50]] },
  { id: "p6-f", uses: 1, cells: [[0, 0, 50, 100], [50, 0, 12.5, 50], [50, 50, 12.5, 50], [62.5, 0, 24.5, 100], [87, 0, 13, 50], [87, 50, 13, 50]] },
  { id: "p6-g", uses: 1, cells: [[0, 0, 24, 40], [0, 40, 36.5, 60], [24, 0, 24.5, 40], [36.5, 40, 36, 60], [48.5, 0, 24, 40], [72.5, 0, 27.5, 100]] },
  { id: "p6-h", uses: 1, cells: [[0, 0, 27.5, 100], [27.5, 0, 24, 40], [27.5, 40, 36, 60], [51.5, 0, 24.5, 40], [63.5, 40, 36.5, 60], [76, 0, 24, 40]] },
  { id: "p6-i", uses: 1, cells: [[0, 0, 26.5, 50], [0, 50, 26.5, 50], [26.5, 0, 23.5, 100], [50, 0, 23.5, 100], [73.5, 0, 26.5, 50], [73.5, 50, 26.5, 50]] },
  { id: "p7-a", uses: 2, cells: [[0, 0, 25, 100], [25, 0, 19, 33.5], [25, 33.5, 37.5, 66.5], [44, 0, 18.5, 33.5], [62.5, 0, 37.5, 66.5], [62.5, 66.5, 18.5, 33.5], [81, 66.5, 19, 33.5]] },
  { id: "p7-b", uses: 1, cells: [[0, 0, 24, 100], [24, 0, 16.5, 69], [24, 69, 16.5, 31], [40.5, 0, 24, 100], [64.5, 0, 35.5, 66.5], [64.5, 66.5, 17.5, 33.5], [82, 66.5, 18, 33.5]] },
  { id: "p7-c", uses: 1, cells: [[0, 0, 50, 100], [50, 0, 25, 48], [50, 48, 12.5, 52], [62.5, 48, 12.5, 52], [75, 0, 25, 48], [75, 48, 12.5, 52], [87.5, 48, 12.5, 52]] },
  { id: "p7-d", uses: 1, cells: [[0, 0, 25, 100], [25, 0, 25, 100], [50, 0, 12.5, 50], [50, 50, 12.5, 50], [62.5, 0, 24.5, 100], [87, 0, 13, 50], [87, 50, 13, 50]] },
  { id: "p7-e", uses: 1, cells: [[0, 0, 25, 43], [0, 43, 33.5, 57], [25, 0, 25, 43], [33.5, 43, 33, 57], [50, 0, 25, 43], [66.5, 43, 33.5, 57], [75, 0, 25, 43]] },
  { id: "p7-f", uses: 1, cells: [[0, 0, 25, 50], [0, 50, 25, 50], [25, 0, 25, 100], [50, 0, 25, 50], [50, 50, 25, 50], [75, 0, 25, 50], [75, 50, 25, 50]] },
  { id: "p7-g", uses: 1, cells: [[0, 0, 25, 100], [25, 0, 25, 100], [50, 0, 20, 33], [50, 33, 20, 34], [50, 67, 20, 33], [70, 0, 30, 50], [70, 50, 30, 50]] },
  { id: "p8-a", uses: 2, cells: [[0, 0, 13, 50], [0, 50, 13, 50], [13, 0, 24.5, 100], [37.5, 0, 12.5, 50], [37.5, 50, 12.5, 50], [50, 0, 23.5, 100], [73.5, 0, 26.5, 50], [73.5, 50, 26.5, 50]] },
  { id: "p8-b", uses: 2, cells: [[0, 0, 25, 50], [0, 50, 25, 50], [25, 0, 25, 50], [25, 50, 25, 50], [50, 0, 25, 50], [50, 50, 25, 50], [75, 0, 25, 50], [75, 50, 25, 50]] },
  { id: "p8-c", uses: 1, cells: [[0, 0, 30, 50], [0, 50, 30, 50], [30, 0, 20, 33], [30, 33, 20, 34], [30, 67, 20, 33], [50, 0, 26, 50], [50, 50, 26, 50], [76, 0, 24, 100]] },
  { id: "p9-a", uses: 1, cells: [[0, 0, 30, 100], [30, 0, 20, 33], [30, 33, 20, 34], [30, 67, 20, 33], [50, 0, 30, 50], [50, 50, 30, 50], [80, 0, 20, 33], [80, 33, 20, 34], [80, 67, 20, 33]] },
  { id: "p10-a", uses: 3, cells: [[0, 0, 30, 50], [0, 50, 30, 50], [30, 0, 20, 33], [30, 33, 20, 34], [30, 67, 20, 33], [50, 0, 30, 50], [50, 50, 30, 50], [80, 0, 20, 33], [80, 33, 20, 34], [80, 67, 20, 33]] },];

// Opening spread: photos on one side, the couple's names on a white page (his three albums all
// open this way). `text` is the white area the title is centred in.
export const TITLE_TEMPLATES = [
  { id: "t-a", title: true, uses: 2, cells: [[0, 0, 25, 100], [25, 0, 25, 100]], text: [50, 0, 50, 100] },
  { id: "t-b", title: true, uses: 1, cells: [[0, 0, 50, 100], [50, 0, 25, 100]], text: [75, 0, 25, 100] },
  { id: "t-c", title: true, uses: 0, cells: [[0, 0, 50, 100]], text: [50, 0, 50, 100] },
  // 2026-10-08 (the owner): 3 photos on the opening spread, the names don't need a whole page
  { id: "t-d", title: true, uses: 0, cells: [[0, 0, 25, 100], [25, 0, 25, 100], [50, 0, 25, 100]], text: [75, 0, 25, 100] },
  { id: "t-e", title: true, uses: 0, cells: [[0, 0, 25, 100], [25, 0, 50, 100]], text: [75, 0, 25, 100] },
];

// ---- generated layouts (2026-10-08) -----------------------------------------------------------
// His sketches stop at 10 photos and have 1–6 layouts per count. These add, for 1–20 photos,
// layouts that are all-landscape, all-portrait or mixed, built from simple columns in the same
// style (full bleed, one gutter): P = one full-height photo, L2/L3 = 2 or 3 stacked photos.
const COL = { P: { n: 1, w: 25 }, L2: { n: 2, w: 25 }, L3: { n: 3, w: 19 } };

function columnsTemplate(id, cols) {
  const total = cols.reduce((a, c) => a + COL[c].w, 0);
  const cells = [];
  let x = 0;
  cols.forEach((c, i) => {
    const w = i === cols.length - 1 ? 100 - x : Math.round((COL[c].w / total) * 1000) / 10;
    const k = COL[c].n;
    for (let r = 0; r < k; r++) {
      const y = Math.round((100 / k) * r * 10) / 10;
      const h = r === k - 1 ? 100 - y : Math.round((100 / k) * 10) / 10;
      cells.push([x, y, w, h]);
    }
    x = Math.round((x + w) * 10) / 10;
  });
  return { id, uses: 0, gen: true, cells };
}

function rowsTemplate(id, rows) {
  // rows: photos per row, e.g. [3, 2] — every cell in a row has the same width
  const cells = [];
  rows.forEach((k, r) => {
    const y = Math.round((100 / rows.length) * r * 10) / 10;
    const h = r === rows.length - 1 ? 100 - y : Math.round((100 / rows.length) * 10) / 10;
    for (let c = 0; c < k; c++) {
      const x = Math.round((100 / k) * c * 10) / 10;
      const w = c === k - 1 ? 100 - x : Math.round((100 / k) * 10) / 10;
      cells.push([x, y, w, h]);
    }
  });
  return { id, uses: 0, gen: true, cells };
}

function palindromes(maxCols) {
  // column sequences that read the same from both ends (calm, symmetric spreads)
  const types = ["P", "L2", "L3"];
  const out = [];
  const half = (len, acc) => {
    if (acc.length === Math.ceil(len / 2)) {
      const mirror = [...acc].reverse().slice(len % 2);
      out.push([...acc, ...mirror]);
      return;
    }
    for (const t of types) half(len, [...acc, t]);
  };
  for (let len = 2; len <= maxCols; len++) half(len, []);
  return out;
}

function generated() {
  const out = [];
  // never a copy of one of his measured layouts (rounded so 25 vs 25.0 count as the same)
  const keyOf = (cells) => JSON.stringify(cells.map((c) => c.map((v) => Math.round(v))));
  const seen = new Set(PHOTO_TEMPLATES.map((t) => keyOf(t.cells)));
  const add = (t) => {
    const key = keyOf(t.cells);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  };
  for (let n = 1; n <= 20; n++) {
    // portrait-only: n full-height columns (up to 6), or two rows of narrow cells (12+)
    if (n <= 6) add(columnsTemplate(`g${n}-p1`, Array(n).fill("P")));
    if (n >= 12 && n % 2 === 0) add(rowsTemplate(`g${n}-p2`, [n / 2, n / 2]));
    // landscape-only: two rows (≤ 5 a row), or three rows (≤ 7 a row)
    if (n >= 2 && n <= 10) add(rowsTemplate(`g${n}-l1`, [Math.ceil(n / 2), Math.floor(n / 2)]));
    if (n >= 6 && n <= 20) add(rowsTemplate(`g${n}-l2`, [Math.ceil(n / 3), Math.ceil((n - Math.ceil(n / 3)) / 2), n - Math.ceil(n / 3) - Math.ceil((n - Math.ceil(n / 3)) / 2)]));
    // mixed: symmetric column sequences with both a full-height and a stacked column
    let k = 0;
    for (const cols of palindromes(8)) {
      if (k >= 4) break;
      const cells = cols.reduce((a, c) => a + COL[c].n, 0);
      if (cells !== n || !cols.includes("P") || cols.every((c) => c === "P")) continue;
      add(columnsTemplate(`g${n}-m${++k}`, cols));
    }
  }
  return out;
}

export const GENERATED_TEMPLATES = generated();

const ALL = [...PHOTO_TEMPLATES, ...GENERATED_TEMPLATES, ...TITLE_TEMPLATES];
const BY_ID = Object.fromEntries(ALL.map((t) => [t.id, t]));

export const getTemplate = (id) => BY_ID[id] || PHOTO_TEMPLATES[0];

// His measured layouts first (most used first), then the generated ones.
export const templatesForCount = (n, { title = false } = {}) =>
  title
    ? TITLE_TEMPLATES
    : [...PHOTO_TEMPLATES.filter((t) => t.cells.length === n).sort((a, b) => (b.uses || 0) - (a.uses || 0)), ...GENERATED_TEMPLATES.filter((t) => t.cells.length === n)];

export const PHOTO_COUNTS = [...new Set([...PHOTO_TEMPLATES, ...GENERATED_TEMPLATES].map((t) => t.cells.length))].sort((a, b) => a - b);

const mirror = ([x, y, w, h]) => [100 - x - w, y, w, h];

// Cell rectangles with the gutter applied: inner edges move in by half a gutter, the spread's
// outer edge stays full bleed (his spreads have no white border). `flip` mirrors left↔right.
export function cellRects(template, flip = false) {
  return template.cells.map((c) => inset(flip ? mirror(c) : c));
}

export function textRect(template, flip = false) {
  if (!template.text) return null;
  return inset(flip ? mirror(template.text) : template.text);
}

function inset([x, y, w, h]) {
  const l = x > 0.01 ? GUTTER_X / 2 : 0;
  const r = x + w < 99.99 ? GUTTER_X / 2 : 0;
  const t = y > 0.01 ? GUTTER_Y / 2 : 0;
  const b = y + h < 99.99 ? GUTTER_Y / 2 : 0;
  return { x: x + l, y: y + t, w: w - l - r, h: h - t - b };
}

// Width ÷ height of a cell in real centimetres (a 25%×100% cell is 20×30 cm → portrait).
export const cellAspect = (rect) => (rect.w * SPREAD.widthCm) / (rect.h * SPREAD.heightCm);

// "לרוחב" / "לאורך" / "משולב" — what kind of photos a layout is made for.
export function templateKind(t) {
  const a = cellRects(t).map(cellAspect);
  if (a.every((x) => x > 1.05)) return "landscape";
  if (a.every((x) => x < 0.95)) return "portrait";
  return "mixed";
}

// ---- fade between photos (2026-10-08) ----------------------------------------------------------
// page.blend = "fade": no white gutter — each photo reaches OVER its left/top neighbour by an
// overlap band and fades in across it, so the photos melt into each other. Overlap = 3% of the
// spread width (2.4 cm) sideways, the same 2.4 cm up/down. Cells are drawn left→right, top→bottom;
// only a cell's left/top inner edges fade (the neighbour there is already drawn underneath).
export const FADE_X = 3;
export const FADE_Y = (FADE_X * SPREAD.widthCm) / SPREAD.heightCm;

const mirrorRect = ([x, y, w, h]) => [100 - x - w, y, w, h];

export function layoutRects(template, flip = false, blend = "none") {
  if (blend !== "fade") return cellRects(template, flip).map((r, i) => ({ ...r, z: i, fadeL: 0, fadeT: 0 }));
  const raw = template.cells.map((c) => (flip ? mirrorRect(c) : c));
  const order = raw.map((c, i) => i).sort((a, b) => raw[a][0] - raw[b][0] || raw[a][1] - raw[b][1]);
  return raw.map(([x, y, w, h], i) => {
    const left = x > 0.01 ? FADE_X : 0;
    const top = y > 0.01 ? FADE_Y : 0;
    const nw = w + left;
    const nh = h + top;
    return { x: x - left, y: y - top, w: nw, h: nh, z: order.indexOf(i), fadeL: (left / nw) * 100, fadeT: (top / nh) * 100 };
  });
}
