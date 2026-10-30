// The album designer's rules, shared by the couple's editor, the server (validation) and the print export.
import templatesFile from './album-templates.json';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AlbumTemplate {
  id: string;
  /** Photo slots as fractions of the spread (0..1). Reading order: right page first. */
  slots: Rect[];
  /** White areas (e.g. the names panel on the opening spread). */
  panels: Rect[];
  uses: number;
  /** Layouts the studio or the couple made (split/removed slots), saved by name. */
  name?: string;
}

export interface AlbumSize {
  key: string;
  label: string;
  /** Written left to right (e.g. "80×30"), shown next to the label. */
  dims: string;
  widthCm: number;
  heightCm: number;
  /** Print file for one spread (both pages). */
  spreadPx: [number, number];
  dpi: number;
  /** The spreads a first draft is laid out on. What the studio charges for (and how many pages it includes) is the
   * studio's own (fix plan P53: films_album_order_state), never a number here. */
  baseSpreads: number;
  recommendedPhotos: number;
  maxSpreads: number;
}

/** Album sizes. Add a line here to offer another size; templates are stored as fractions and fit any size. */
export const ALBUM_SIZES: Record<string, AlbumSize> = {
  '80x30': {
    key: '80x30',
    label: 'אלבום זוג',
    dims: '80×30',
    widthCm: 80,
    heightCm: 30,
    spreadPx: [9449, 3543],
    dpi: 300,
    baseSpreads: 30,
    recommendedPhotos: 150,
    maxSpreads: 60,
  },
};
export const DEFAULT_SIZE = '80x30';

export const TEMPLATES: AlbumTemplate[] = (templatesFile as { templates: AlbumTemplate[] }).templates.map((t) => ({ id: t.id, slots: t.slots, panels: t.panels, uses: t.uses }));
const SEQUENCES = (templatesFile as { sequences: Record<string, string[]> }).sequences;
/** The built-in layouts only; never changed. */
const BUILT_IN = new Map(TEMPLATES.map((t) => [t.id, t]));
/**
 * The browser's registry (the editor and the print page): the built-in layouts plus the custom ones of the album
 * open in that page. The server never writes to it (fix plan P57): one Worker serves every studio, so it checks an
 * album against the album's own layouts (checkAlbum), and nothing an album sends outlives its request.
 */
export const TEMPLATE_BY_ID = new Map(BUILT_IN);
/** Opening spreads: the ones with a white names panel. */
export const COVER_TEMPLATES = TEMPLATES.filter((t) => t.panels.length > 0);

export function template(id: string): AlbumTemplate {
  return TEMPLATE_BY_ID.get(id) ?? TEMPLATES[0];
}

/** Custom layouts ("c_…") travel inside each album; the browser registers them so template() finds them. */
export function registerTemplates(list: AlbumTemplate[] | undefined): void {
  for (const t of list ?? []) if (t && isCustomId(t.id)) TEMPLATE_BY_ID.set(t.id, t);
}
export const isCustomId = (id: string) => /^c_[A-Za-z0-9]{4,40}$/.test(id);

// ---------- the limits (fix plan P57: the editor stops at them, the server refuses past them — never trims) ----------
/** Photo slots in one layout. */
export const MAX_SLOTS = 16;
/** White panels in one layout. */
export const MAX_PANELS = 2;
/** The smallest slot, as fractions of the spread (about 8 mm × 6 mm on 80×30). */
export const MIN_SLOT_W = 0.01;
export const MIN_SLOT_H = 0.02;
/** Texts on one spread, and letters in one text. */
export const MAX_TEXTS = 12;
export const MAX_TEXT_LENGTH = 200;
/** Custom layouts an album may carry, and how many it keeps (every one a spread uses, then the named ones). */
export const MAX_CUSTOM = 80;
export const MAX_KEPT_CUSTOM = 60;
/** What one album save may weigh (the Worker refuses a bigger request before reading it). */
export const MAX_ALBUM_BYTES = 512 * 1024;
/** A photo's key as the Worker makes them (worker/photos.ts: 8 hex characters). */
export const PHOTO_KEY_RE = /^[0-9a-f]{8}$/;

/** The gap between photos in the owner's real albums: 33px of 9449×3543 (about 2.8mm). */
export const GAP_X = 33 / 9449;
export const GAP_Y = 33 / 3543;

// ---------- the album itself ----------

export interface SlotFill {
  /** Photo key, or '' when the slot is empty. */
  photo: string;
  /** 1 = the photo just covers the slot; more = closer. */
  zoom: number;
  /** Which point of the photo sits in the middle of the slot (0..1). */
  cx: number;
  cy: number;
}

export interface AlbumText {
  id: string;
  text: string;
  /** Centre of the text, as fractions of the spread. */
  x: number;
  y: number;
  /** Letter height as a fraction of the spread height (0.04 ≈ 1.2 cm on 80×30). */
  size: number;
  font: string;
  color: string;
  weight: 300 | 400 | 600 | 700;
  italic: boolean;
  /** Extra space between letters, in em. */
  spacing: number;
  align: 'right' | 'center' | 'left';
}

export interface AlbumSpread {
  id: string;
  template: string;
  fills: SlotFill[];
  texts: AlbumText[];
}

export interface Album {
  size: string;
  spreads: AlbumSpread[];
  /** Layouts made in this album (or taken from the studio's saved ones) that its spreads use. */
  custom?: AlbumTemplate[];
  status: 'draft' | 'submitted';
  updatedAt: string;
  submittedAt?: string;
  /**
   * The saved copy's number (films_albums.rev, fix plan P57): every save raises it. Kept next to the document,
   * never inside it: the Worker adds it on read, and a save names the one it started from (a stale tab gets 409).
   */
  rev?: number;
}

export const FONTS: { family: string; label: string; hebrew: boolean }[] = [
  { family: 'Assistant', label: 'אסיסטנט', hebrew: true },
  { family: 'Heebo', label: 'היבו', hebrew: true },
  { family: 'Rubik', label: 'רוביק', hebrew: true },
  { family: 'Frank Ruhl Libre', label: 'פרנק רוהל', hebrew: true },
  { family: 'David Libre', label: 'דוד', hebrew: true },
  { family: 'Suez One', label: 'סואץ', hebrew: true },
  { family: 'Secular One', label: 'סקולר', hebrew: true },
  { family: 'Amatic SC', label: 'אמטיק (כתב יד)', hebrew: true },
  { family: 'Karantina', label: 'קרנטינה', hebrew: true },
  { family: 'Josefin Sans', label: 'Josefin Sans', hebrew: false },
  { family: 'Montserrat', label: 'Montserrat', hebrew: false },
  { family: 'Cormorant Garamond', label: 'Cormorant', hebrew: false },
  { family: 'Playfair Display', label: 'Playfair', hebrew: false },
  { family: 'Great Vibes', label: 'Great Vibes (כתב)', hebrew: false },
];

export const FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Amatic+SC:wght@400;700&family=Assistant:wght@300;400;600;700&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,400&family=David+Libre:wght@400;700&family=Frank+Ruhl+Libre:wght@300;400;700&family=Great+Vibes&family=Heebo:wght@300;400;600;700&family=Josefin+Sans:ital,wght@0,300;0,400;0,600;1,300&family=Karantina:wght@300;400;700&family=Montserrat:ital,wght@0,300;0,400;0,600;1,300&family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=Rubik:wght@300;400;600;700&family=Secular+One&family=Suez+One&display=swap';

export function albumSize(key?: string): AlbumSize {
  return ALBUM_SIZES[key ?? DEFAULT_SIZE] ?? ALBUM_SIZES[DEFAULT_SIZE];
}

/** Width / height of a slot in real centimetres. */
export function slotAspect(r: Rect, size: AlbumSize): number {
  return (r.w * size.widthCm) / (r.h * size.heightCm);
}

/** True when a slot crosses the fold in the middle of the spread. */
export function crossesFold(r: Rect): boolean {
  return r.x < 0.49 && r.x + r.w > 0.51;
}

/**
 * Where to draw a photo inside its slot so it always covers the slot (no empty edges).
 * Returned box is relative to the slot, in slot-sized units (1 = slot width / height).
 */
export function placePhoto(slotAspectRatio: number, photoAr: number, fill: Pick<SlotFill, 'zoom' | 'cx' | 'cy'>): { x: number; y: number; w: number; h: number } {
  const ar = photoAr > 0 ? photoAr : 1.5;
  const zoom = Math.max(1, Math.min(4, fill.zoom || 1));
  // Cover: the photo's short side matches the slot, then zoom.
  let w: number;
  let h: number;
  if (ar > slotAspectRatio) {
    h = 1;
    w = ar / slotAspectRatio;
  } else {
    w = 1;
    h = slotAspectRatio / ar;
  }
  w *= zoom;
  h *= zoom;
  const cx = Math.max(0, Math.min(1, fill.cx ?? 0.5));
  const cy = Math.max(0, Math.min(1, fill.cy ?? 0.5));
  // Put the chosen point in the middle, then keep the photo covering the slot.
  const x = Math.min(0, Math.max(1 - w, 0.5 - cx * w));
  const y = Math.min(0, Math.max(1 - h, 0.5 - cy * h));
  return { x, y, w, h };
}

/** The opposite of placePhoto's positioning: which photo point is at the slot's centre for a given offset. */
export function centerFromOffset(x: number, y: number, w: number, h: number): { cx: number; cy: number } {
  return { cx: Math.max(0, Math.min(1, (0.5 - x) / w)), cy: Math.max(0, Math.min(1, (0.5 - y) / h)) };
}

let seq = 0;
export function newId(prefix: string): string {
  seq = (seq + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}`;
}

function emptyFill(): SlotFill {
  return { photo: '', zoom: 1, cx: 0.5, cy: 0.5 };
}

/** Pairs photos with slots of a similar shape (portrait photos to tall slots). */
export function fillSpread(t: AlbumTemplate, photos: { key: string; ar: number }[], size: AlbumSize): SlotFill[] {
  const fills = t.slots.map(emptyFill);
  const slots = t.slots.map((r, i) => ({ i, a: slotAspect(r, size) })).sort((p, q) => p.a - q.a);
  const ph = photos.slice(0, t.slots.length).map((p) => ({ ...p })).sort((p, q) => p.ar - q.ar);
  ph.forEach((p, j) => {
    const s = slots[Math.round((j * (slots.length - 1)) / Math.max(1, ph.length - 1))] ?? slots[j];
    if (s && !fills[s.i].photo) fills[s.i].photo = p.key;
    else {
      const free = fills.findIndex((f) => !f.photo);
      if (free >= 0) fills[free].photo = p.key;
    }
  });
  return fills;
}

/** The layout order of the longest real album, used for new albums. */
export function defaultSequence(count: number): string[] {
  const seqs = Object.values(SEQUENCES).sort((a, b) => b.length - a.length);
  const base = seqs[0] ?? TEMPLATES.map((t) => t.id);
  const inner = base.slice(1);
  const out = [COVER_TEMPLATES[0]?.id ?? base[0]];
  for (let i = 0; out.length < count; i++) out.push(inner[i % inner.length]);
  return out;
}

/** A first draft: the opening spread with the names, then the couple's hearts in order across 30 spreads. */
export function autoAlbum(photos: { key: string; ar: number }[], coupleName: string, date: string, sizeKey = DEFAULT_SIZE): Album {
  const size = albumSize(sizeKey);
  const ids = defaultSequence(size.baseSpreads);
  let next = 0;
  const spreads: AlbumSpread[] = ids.map((id, i) => {
    const t = template(id);
    const photosHere = photos.slice(next, next + t.slots.length);
    next += photosHere.length;
    const texts: AlbumText[] = [];
    if (i === 0 && t.panels[0]) {
      const p = t.panels[0];
      texts.push(
        { id: newId('t'), text: coupleName, x: p.x + p.w / 2, y: p.y + p.h / 2 - 0.03, size: 0.045, font: 'Assistant', color: '#2b2b2b', weight: 300, italic: false, spacing: 0.15, align: 'center' },
        { id: newId('t'), text: date, x: p.x + p.w / 2, y: p.y + p.h / 2 + 0.035, size: 0.022, font: 'Assistant', color: '#555555', weight: 400, italic: false, spacing: 0.2, align: 'center' },
      );
    }
    return { id: newId('s'), template: t.id, fills: fillSpread(t, photosHere, size), texts };
  });
  return { size: size.key, spreads, status: 'draft', updatedAt: new Date().toISOString() };
}

/** Changing a spread's layout keeps its photos in order; photos that no longer fit go back to the bank. */
export function changeTemplate(spread: AlbumSpread, templateId: string, ars: Map<string, number>, size: AlbumSize): AlbumSpread {
  const t = template(templateId);
  const photos = spread.fills.filter((f) => f.photo).map((f) => ({ key: f.photo, ar: ars.get(f.photo) ?? 1.5 }));
  return { ...spread, template: t.id, fills: fillSpread(t, photos, size) };
}

export function usedPhotos(album: Album): Set<string> {
  const used = new Set<string>();
  for (const s of album.spreads) for (const f of s.fills) if (f.photo) used.add(f.photo);
  return used;
}

export function emptySlots(album: Album): number {
  return album.spreads.reduce((n, s) => n + s.fills.filter((f) => !f.photo).length, 0);
}

/**
 * Spreads beyond the ones the studio includes (`includedSpreads`, else the size's draft length) and what they cost
 * at the studio's own price (fix plan P53). No price set → `extraCost` null: nothing is charged by a number the
 * studio did not set.
 */
export function albumPrice(album: Album, extraSpreadPrice?: number | null, includedSpreads?: number | null): { extraSpreads: number; extraCost: number | null } {
  const size = albumSize(album.size);
  const extraSpreads = Math.max(0, album.spreads.length - (includedSpreads ?? size.baseSpreads));
  return { extraSpreads, extraCost: extraSpreadPrice === null || extraSpreadPrice === undefined ? null : extraSpreads * extraSpreadPrice };
}

/** A spread with the most common 4–5 photo layout, for "+ דף". */
export function extraSpreadTemplate(): string {
  const pick = [...TEMPLATES].filter((t) => t.panels.length === 0 && t.slots.length >= 4 && t.slots.length <= 5).sort((a, b) => b.uses - a.uses)[0];
  return (pick ?? TEMPLATES[0]).id;
}

// ---------- editing layouts ----------

const round4 = (n: number) => Math.round(n * 10000) / 10000;

function splitParts(r: Rect, dir: 'side' | 'stack'): Rect[] {
  return dir === 'side'
    ? [
        { x: r.x, y: r.y, w: (r.w - GAP_X) / 2, h: r.h },
        { x: r.x + (r.w + GAP_X) / 2, y: r.y, w: (r.w - GAP_X) / 2, h: r.h },
      ]
    : [
        { x: r.x, y: r.y, w: r.w, h: (r.h - GAP_Y) / 2 },
        { x: r.x, y: r.y + (r.h + GAP_Y) / 2, w: r.w, h: (r.h - GAP_Y) / 2 },
      ];
}

/** Whether splitSlot keeps the layout within the limits (at most MAX_SLOTS slots, none smaller than the smallest). */
export function canSplitSlot(t: AlbumTemplate, index: number, dir: 'side' | 'stack'): boolean {
  const r = t.slots[index];
  if (!r || t.slots.length >= MAX_SLOTS) return false;
  return splitParts(r, dir).every((q) => round4(q.w) >= MIN_SLOT_W && round4(q.h) >= MIN_SLOT_H);
}

/** A copy of a layout with one slot split in two (side by side, or one above the other), keeping the gap. */
export function splitSlot(t: AlbumTemplate, index: number, dir: 'side' | 'stack'): AlbumTemplate {
  const parts = splitParts(t.slots[index], dir);
  const slots = [...t.slots.slice(0, index), ...parts, ...t.slots.slice(index + 1)].map((q) => ({ x: round4(q.x), y: round4(q.y), w: round4(q.w), h: round4(q.h) }));
  return { id: `c_${newId('').replace(/[^A-Za-z0-9]/g, '')}`, slots, panels: t.panels, uses: 0 };
}

/** A copy of a layout without one slot; a neighbour that shares its whole edge grows into the space. */
export function removeSlot(t: AlbumTemplate, index: number): { template: AlbumTemplate; grew: number } {
  const r = t.slots[index];
  const near = (a: number, b: number) => Math.abs(a - b) < 0.004;
  let grew = -1;
  const slots = t.slots.map((q) => ({ ...q }));
  for (let j = 0; j < slots.length && grew < 0; j++) {
    if (j === index) continue;
    const q = slots[j];
    if (near(q.y, r.y) && near(q.h, r.h)) {
      if (near(q.x + q.w + GAP_X, r.x)) (q.w = r.x + r.w - q.x), (grew = j);
      else if (near(r.x + r.w + GAP_X, q.x)) (q.w = q.x + q.w - r.x), (q.x = r.x), (grew = j);
    } else if (near(q.x, r.x) && near(q.w, r.w)) {
      if (near(q.y + q.h + GAP_Y, r.y)) (q.h = r.y + r.h - q.y), (grew = j);
      else if (near(r.y + r.h + GAP_Y, q.y)) (q.h = q.y + q.h - r.y), (q.y = r.y), (grew = j);
    }
  }
  slots.splice(index, 1);
  return { template: { id: `c_${newId('').replace(/[^A-Za-z0-9]/g, '')}`, slots, panels: t.panels, uses: 0 }, grew: grew < 0 ? -1 : grew > index ? grew - 1 : grew };
}

/**
 * The best layout for a group of photos: same number of slots, slot shapes matching the photos'
 * shapes (portrait photos to tall slots), and not the same as the page before.
 */
export function bestTemplate(photos: { ar: number }[], size: AlbumSize, avoid = '', pool: AlbumTemplate[] = TEMPLATES.filter((t) => !t.panels.length)): AlbumTemplate {
  const n = Math.max(1, photos.length);
  const counts = [...new Set(pool.map((t) => t.slots.length))].sort((a, b) => Math.abs(a - n) - Math.abs(b - n) || b - a);
  const want = counts.find((c) => c >= n) ?? counts[0];
  const cands = pool.filter((t) => t.slots.length === (pool.some((t2) => t2.slots.length === n) ? n : want));
  const photoShapes = photos.map((p) => Math.log(p.ar > 0 ? p.ar : 1.5)).sort((a, b) => a - b);
  const score = (t: AlbumTemplate) => {
    const slotShapes = t.slots.map((r) => Math.log(slotAspect(r, size))).sort((a, b) => a - b);
    let d = 0;
    for (let i = 0; i < Math.min(slotShapes.length, photoShapes.length); i++) d += Math.abs(slotShapes[i] - photoShapes[i]);
    return d - Math.log(1 + t.uses) * 0.15 + (t.id === avoid ? 1.5 : 0);
  };
  return [...cands].sort((a, b) => score(a) - score(b))[0] ?? TEMPLATES[0];
}

/** The order of the story in a wedding album (after the opening). "ריקודים" is the party set. */
export const STORY_ORDER = ['התארגנות', 'צילומי חוץ', 'משפחות', 'טקס חופה', 'אולם', 'מסיבה'];

export interface StoryPhoto {
  key: string;
  ar: number;
  set: string;
}

/**
 * An album built by the story: the opening spread from 1–2 "צילומי חוץ" photos with the names,
 * then pages set by set in STORY_ORDER (other sets after, photos without a set last), each page
 * with photos of one set only, spread over the album's included pages.
 */
export function storyAlbum(photos: StoryPhoto[], sets: { id: string; name: string }[], coupleName: string, date: string, sizeKey = DEFAULT_SIZE): Album {
  const size = albumSize(sizeKey);
  const nameOf = new Map(sets.map((s) => [s.id, s.name === 'ריקודים' ? 'מסיבה' : s.name]));
  const rank = (setId: string) => {
    const name = nameOf.get(setId) ?? '';
    const i = STORY_ORDER.indexOf(name);
    if (i >= 0) return i;
    const j = sets.findIndex((s) => s.id === setId);
    return j >= 0 ? 10 + j : 100;
  };
  const groups = new Map<string, StoryPhoto[]>();
  for (const p of photos) groups.set(p.set, [...(groups.get(p.set) ?? []), p]);
  const ordered = [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));

  // Opening: 1–2 photos from צילומי חוץ (or the first photos when that set is empty).
  const outdoorId = sets.find((s) => s.name === 'צילומי חוץ')?.id ?? '';
  const outdoor = groups.get(outdoorId) ?? ordered[0]?.[1] ?? [];
  const cover = COVER_TEMPLATES.filter((t) => t.slots.length <= 2).sort((a, b) => b.slots.length - a.slots.length || b.uses - a.uses);
  const coverT = (outdoor.length >= 2 ? cover.find((t) => t.slots.length === 2) : cover.find((t) => t.slots.length === 1)) ?? COVER_TEMPLATES[0];
  const opening = outdoor.slice(0, coverT.slots.length);
  const openKeys = new Set(opening.map((p) => p.key));
  const rest = ordered.map(([id, list]) => [id, list.filter((p) => !openKeys.has(p.key))] as const).filter(([, list]) => list.length > 0);
  const total = rest.reduce((n, [, l]) => n + l.length, 0);

  // Pages per set, in proportion to its photos (at least one each), over the included pages.
  const pagesLeft = size.baseSpreads - 1;
  const maxSlots = Math.max(...TEMPLATES.filter((t) => !t.panels.length).map((t) => t.slots.length));
  const pages = rest.map(([, l]) => Math.max(1, Math.ceil(l.length / maxSlots), Math.round((l.length / Math.max(1, total)) * pagesLeft)));
  let sum = pages.reduce((a, b) => a + b, 0);
  while (sum > pagesLeft) {
    // Take pages back from the set with the fewest photos per page lost.
    let best = -1;
    rest.forEach(([, l], i) => {
      if (pages[i] > Math.max(1, Math.ceil(l.length / maxSlots)) && (best < 0 || l.length / (pages[i] - 1) < rest[best][1].length / (pages[best] - 1))) best = i;
    });
    if (best < 0) break; // more photos than the included pages can hold: extra pages are added
    pages[best]--;
    sum--;
  }
  while (sum < pagesLeft && total > sum) {
    let best = 0;
    rest.forEach(([, l], i) => {
      if (l.length / pages[i] > rest[best][1].length / pages[best]) best = i;
    });
    if (rest[best][1].length <= pages[best]) break;
    pages[best]++;
    sum++;
  }

  const spreads: AlbumSpread[] = [];
  const p0 = coverT.panels[0];
  spreads.push({
    id: newId('s'),
    template: coverT.id,
    fills: fillSpread(coverT, opening, size),
    texts: p0
      ? [
          { id: newId('t'), text: coupleName, x: p0.x + p0.w / 2, y: p0.y + p0.h / 2 - 0.03, size: 0.045, font: 'Assistant', color: '#2b2b2b', weight: 300, italic: false, spacing: 0.15, align: 'center' },
          { id: newId('t'), text: date, x: p0.x + p0.w / 2, y: p0.y + p0.h / 2 + 0.035, size: 0.022, font: 'Assistant', color: '#555555', weight: 400, italic: false, spacing: 0.2, align: 'center' },
        ]
      : [],
  });
  let prev = '';
  rest.forEach(([, list], gi) => {
    const n = pages[gi];
    let at = 0;
    for (let k = 0; k < n; k++) {
      const count = Math.round(((k + 1) * list.length) / n) - Math.round((k * list.length) / n);
      const chunk = list.slice(at, at + count);
      at += count;
      const t = bestTemplate(chunk, size, prev);
      prev = t.id;
      spreads.push({ id: newId('s'), template: t.id, fills: fillSpread(t, chunk, size), texts: [] });
    }
  });
  while (spreads.length < size.baseSpreads) {
    const t = template(extraSpreadTemplate());
    spreads.push({ id: newId('s'), template: t.id, fills: t.slots.map(emptyFill), texts: [] });
  }
  return { size: size.key, spreads: spreads.slice(0, size.maxSpreads), status: 'draft', updatedAt: new Date().toISOString() };
}

/** Splits a spread's photos over two spreads (this one and a new one after it). */
export function splitSpread(spread: AlbumSpread, ars: Map<string, number>, size: AlbumSize): [AlbumSpread, AlbumSpread] {
  const photos = spread.fills.filter((f) => f.photo).map((f) => ({ key: f.photo, ar: ars.get(f.photo) ?? 1.5 }));
  const half = Math.ceil(photos.length / 2);
  const a = photos.slice(0, half);
  const b = photos.slice(half);
  const ta = template(spread.template).panels.length ? template(spread.template) : bestTemplate(a, size);
  const tb = bestTemplate(b.length ? b : [{ ar: 1.5 }], size, ta.id);
  return [
    { ...spread, template: ta.id, fills: ta.id === spread.template ? spread.fills.map((f) => (a.some((p) => p.key === f.photo) || !f.photo ? f : emptyFill())) : fillSpread(ta, a, size) },
    { id: newId('s'), template: tb.id, fills: fillSpread(tb, b, size), texts: [] },
  ];
}

// ---------- validation (the server trusts nothing it receives) ----------

const clamp = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
};

/** An album as the server keeps it, and what it could not keep as sent (in words for the couple). */
export interface AlbumCheck {
  album: Album;
  /** Pages, layouts, photos or texts past the limits or unknown: a save with any of these is refused (P57). */
  cut: string[];
  /** Photos no longer among `photoKeys` (hidden by the studio since): taken out of their slots. */
  dropped: number;
}

/**
 * Checks an album from the browser. `photoKeys` null = a draft: only the shape of each photo key is checked (the
 * photo list is not read on every save); a set = the photos the couple may use (the send). Numbers (zoom, text
 * sizes, colours) are clamped; anything that would lose or move the couple's work — pages past the size's
 * maximum, a layout with a slot out of bounds, a page on an unknown layout, more photos than slots, too many or
 * too long texts — is reported in `cut`. Layouts resolve against the album's own custom ones and the built-in
 * ones only: nothing is registered anywhere (P57).
 */
export function checkAlbum(input: unknown, photoKeys: Set<string> | null, sizeKey = DEFAULT_SIZE): AlbumCheck {
  const a = (input ?? {}) as Partial<Album>;
  const size = albumSize(a.size ?? sizeKey);
  const cut: string[] = [];
  let dropped = 0;
  const spreadsAll = Array.isArray(a.spreads) ? a.spreads : [];
  if (spreadsAll.length > size.maxSpreads) cut.push(`אפשר עד ${size.maxSpreads} דפים באלבום`);
  const spreadsIn = spreadsAll.slice(0, size.maxSpreads);
  const fonts = new Set(FONTS.map((f) => f.family));
  const customIn = Array.isArray(a.custom) ? a.custom : [];
  if (customIn.length > MAX_CUSTOM) cut.push(`אפשר עד ${MAX_CUSTOM} פריסות באלבום`);
  const custom = cleanCustom(customIn);
  const customIds = new Set(custom.map((t) => t.id));
  const brokenIds = new Set(customIn.slice(0, MAX_CUSTOM).map((t) => String((t as AlbumTemplate)?.id ?? '')).filter((id) => isCustomId(id) && !customIds.has(id)));
  const own = new Map(custom.map((t) => [t.id, t]));
  const lookup = (id: string) => (isCustomId(id) ? own.get(id) : BUILT_IN.get(id));
  const spreads: AlbumSpread[] = spreadsIn.map((s, si) => {
    const page = si === 0 ? 'בדף הפתיחה' : `בדף ${si + 1}`;
    const asked = String(s?.template ?? '');
    const found = lookup(asked);
    if (!found) cut.push(brokenIds.has(asked) ? `${page}: הפריסה לא תקינה (משבצת קטנה מדי או מחוץ לדף, או יותר מ-${MAX_SLOTS} משבצות)` : `${page}: פריסה לא מוכרת`);
    const t = found ?? TEMPLATES[0];
    const fillsIn = Array.isArray(s?.fills) ? s.fills : [];
    if (fillsIn.slice(t.slots.length).some((f) => typeof f?.photo === 'string' && f.photo)) cut.push(`${page}: יותר תמונות ממשבצות`);
    const fills = t.slots.map((_, i) => {
      const f: Partial<SlotFill> = fillsIn[i] ?? {};
      let photo = typeof f.photo === 'string' ? f.photo : '';
      if (photo && photoKeys === null && !PHOTO_KEY_RE.test(photo)) {
        cut.push(`${page}: תמונה לא מוכרת`);
        photo = '';
      } else if (photo && photoKeys !== null && !photoKeys.has(photo)) {
        dropped++;
        photo = '';
      }
      return { photo, zoom: clamp(f.zoom, 1, 4, 1), cx: clamp(f.cx, 0, 1, 0.5), cy: clamp(f.cy, 0, 1, 0.5) };
    });
    const textsAll = Array.isArray(s?.texts) ? s.texts : [];
    if (textsAll.length > MAX_TEXTS) cut.push(`${page}: אפשר עד ${MAX_TEXTS} טקסטים בדף`);
    if (textsAll.some((x) => String(x?.text ?? '').length > MAX_TEXT_LENGTH)) cut.push(`${page}: טקסט ארוך מ-${MAX_TEXT_LENGTH} תווים`);
    const texts: AlbumText[] = textsAll.slice(0, MAX_TEXTS).map((x) => ({
      id: String(x?.id ?? newId('t')).slice(0, 40),
      text: String(x?.text ?? '').slice(0, MAX_TEXT_LENGTH),
      x: clamp(x?.x, 0, 1, 0.5),
      y: clamp(x?.y, 0, 1, 0.5),
      size: clamp(x?.size, 0.01, 0.3, 0.04),
      font: fonts.has(String(x?.font)) ? String(x?.font) : 'Assistant',
      color: /^#[0-9a-f]{6}$/i.test(String(x?.color)) ? String(x?.color) : '#222222',
      weight: ([300, 400, 600, 700] as const).includes(Number(x?.weight) as 300) ? (Number(x?.weight) as AlbumText['weight']) : 400,
      italic: Boolean(x?.italic),
      spacing: clamp(x?.spacing, 0, 1, 0),
      align: x?.align === 'right' || x?.align === 'left' ? x.align : 'center',
    }));
    return { id: String(s?.id || `s${si}`).slice(0, 40), template: t.id, fills, texts };
  });
  // Every custom layout a spread uses is kept, then the named (saved) ones, up to MAX_KEPT_CUSTOM in all.
  const usedIds = new Set(spreads.map((sp) => sp.template));
  const used = custom.filter((t) => usedIds.has(t.id));
  const keep = [...used, ...custom.filter((t) => !usedIds.has(t.id) && t.name)].slice(0, Math.max(MAX_KEPT_CUSTOM, used.length));
  const album: Album = { size: size.key, spreads, ...(keep.length ? { custom: keep } : {}), status: a.status === 'submitted' ? 'submitted' : 'draft', updatedAt: new Date().toISOString(), submittedAt: a.submittedAt };
  return { album, cut: [...new Set(cut)], dropped };
}

/** checkAlbum's album alone (what it could keep), for callers that only read. */
export function cleanAlbum(input: unknown, photoKeys: Set<string> | null, sizeKey = DEFAULT_SIZE): Album {
  return checkAlbum(input, photoKeys, sizeKey).album;
}

/**
 * Custom layouts from the browser (an album's, or the studio's saved ones): a layout is kept whole or not at all —
 * one slot out of bounds or too small, more than MAX_SLOTS slots or MAX_PANELS panels, and the layout is refused
 * (P57: dropping one slot moved every photo after it).
 */
export function cleanCustom(input: unknown): AlbumTemplate[] {
  if (!Array.isArray(input)) return [];
  const rect = (r: unknown, minW: number, minH: number): Rect | null => {
    const q = r as Rect;
    const x = Number(q?.x), y = Number(q?.y), w = Number(q?.w), h = Number(q?.h);
    if (![x, y, w, h].every(Number.isFinite) || round4(w) < minW || round4(h) < minH || x < -0.001 || y < -0.001 || x + w > 1.001 || y + h > 1.001) return null;
    return { x: round4(x), y: round4(y), w: round4(w), h: round4(h) };
  };
  const out: AlbumTemplate[] = [];
  for (const t of input.slice(0, MAX_CUSTOM)) {
    const id = String((t as AlbumTemplate)?.id ?? '');
    if (!isCustomId(id)) continue;
    const slotsIn = Array.isArray((t as AlbumTemplate).slots) ? (t as AlbumTemplate).slots : [];
    const panelsIn = Array.isArray((t as AlbumTemplate).panels) ? (t as AlbumTemplate).panels : [];
    if (slotsIn.length === 0 || slotsIn.length > MAX_SLOTS || panelsIn.length > MAX_PANELS) continue;
    const slots = slotsIn.map((r) => rect(r, MIN_SLOT_W, MIN_SLOT_H));
    const panels = panelsIn.map((r) => rect(r, 0.01, 0.02));
    if (slots.some((r) => r === null) || panels.some((r) => r === null)) continue;
    const name = typeof (t as AlbumTemplate).name === 'string' ? (t as AlbumTemplate).name!.trim().slice(0, 40) : '';
    out.push({ id, slots: slots as Rect[], panels: panels as Rect[], uses: 0, ...(name ? { name } : {}) });
  }
  return out;
}
