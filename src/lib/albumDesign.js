// The album design document (2026-10-08, album editor stage 1). One JSON doc per album order
// (album_designs.doc). Everything here is pure — the editor keeps the doc immutable so undo/redo
// is just a stack of docs, and the same functions are unit-tested (scripts/test-whatsapp-bot.mjs).
//
// doc = {
//   v: 1,
//   assets: [{ id, name, w, h, time, size, camera }],   // Drive file id = asset id
//   cameraOffsets: { [camera]: minutes },               // fixes a camera whose clock was off
//   pages: [{ id, templateId, flip, slots: [{ assetId, zoom, cx, cy, filter }], title? }],
// }
// A page is one 80×30 spread. Slots line up with the template's cells by index.

import { getTemplate, templatesForCount, PHOTO_TEMPLATES, cellRects, cellAspect } from "./albumTemplates";

export const PAGE_BASELINE = 30; // spreads included in every album (album-portal PAGE_BASELINE)

// Non-destructive B&W looks — CSS filter strings, used as-is by the DOM and by canvas ctx.filter.
export const FILTERS = [
  { id: "none", label: "צבע", css: "none" },
  { id: "bw-classic", label: "ש/ל קלאסי", css: "grayscale(1)" },
  { id: "bw-soft", label: "ש/ל רך", css: "grayscale(1) contrast(0.9) brightness(1.05)" },
  { id: "bw-contrast", label: "ש/ל קונטרסט", css: "grayscale(1) contrast(1.35)" },
  { id: "bw-matte", label: "ש/ל מט", css: "grayscale(1) contrast(0.8) brightness(1.1)" },
  { id: "bw-warm", label: "ש/ל חם", css: "grayscale(1) sepia(0.25)" },
];
export const filterCss = (id) => (FILTERS.find((f) => f.id === id) || FILTERS[0]).css;

export const TITLE_FONTS = [
  { id: "josefin", label: "Josefin (כמו בסקיצות)", family: "'Josefin Sans', sans-serif", weight: 300, google: "Josefin+Sans:wght@300" },
  { id: "cormorant", label: "Cormorant", family: "'Cormorant Garamond', serif", weight: 400, google: "Cormorant+Garamond:wght@400" },
  { id: "montserrat", label: "Montserrat", family: "'Montserrat', sans-serif", weight: 300, google: "Montserrat:wght@300" },
  { id: "heebo", label: "Heebo (עברית)", family: "'Heebo', sans-serif", weight: 300, google: "Heebo:wght@300" },
  { id: "frank", label: "Frank Ruhl (עברית)", family: "'Frank Ruhl Libre', serif", weight: 400, google: "Frank+Ruhl+Libre:wght@400" },
  { id: "assistant", label: "Assistant (עברית)", family: "'Assistant', sans-serif", weight: 300, google: "Assistant:wght@300" },
];
export const titleFont = (id) => TITLE_FONTS.find((f) => f.id === id) || TITLE_FONTS[0];

let seq = 0;
export const newId = (p = "pg") => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

const emptySlot = () => ({ assetId: null, zoom: 1, cx: 0.5, cy: 0.5, filter: "none" });

export function newPage(templateId = "p4-a") {
  const t = getTemplate(templateId);
  const page = { id: newId(), templateId: t.id, flip: false, slots: t.cells.map(emptySlot) };
  if (t.title) page.title = { names: "", date: "", hebrewDate: "", showHebrew: true, font: "josefin", color: "#3a3a3a" };
  return page;
}

export function emptyDoc({ assets = [], names = "", date = "" } = {}) {
  const title = newPage("t-a");
  title.title = { ...title.title, names, date: formatDotDate(date), hebrewDate: hebrewDateText(date) };
  return { v: 1, assets, cameraOffsets: {}, pages: [title, newPage("p4-a")] };
}

// ---- pages ----------------------------------------------------------------------------------
const setPages = (doc, pages) => ({ ...doc, pages });
const mapPage = (doc, pageId, fn) => setPages(doc, doc.pages.map((p) => (p.id === pageId ? fn(p) : p)));

export const addPage = (doc, afterIndex = doc.pages.length - 1, templateId = "p4-a") => {
  const pages = [...doc.pages];
  pages.splice(afterIndex + 1, 0, newPage(templateId));
  return setPages(doc, pages);
};
export const removePage = (doc, pageId) => setPages(doc, doc.pages.filter((p) => p.id !== pageId));
export const duplicatePage = (doc, pageId) => {
  const i = doc.pages.findIndex((p) => p.id === pageId);
  if (i < 0) return doc;
  const copy = { ...structuredClone(doc.pages[i]), id: newId() };
  const pages = [...doc.pages];
  pages.splice(i + 1, 0, copy);
  return setPages(doc, pages);
};
export const movePage = (doc, from, to) => {
  if (from === to || from < 0 || to < 0 || from >= doc.pages.length || to >= doc.pages.length) return doc;
  const pages = [...doc.pages];
  const [p] = pages.splice(from, 1);
  pages.splice(to, 0, p);
  return setPages(doc, pages);
};

// Switching template keeps the photos, in order: slot 1 → new cell 1, … Photos that no longer
// fit are dropped from this spread (they stay in the bank, marked as unused).
export const setTemplate = (doc, pageId, templateId) =>
  mapPage(doc, pageId, (p) => {
    const t = getTemplate(templateId);
    const filled = p.slots.filter((s) => s.assetId);
    const slots = t.cells.map((_, i) => (filled[i] ? { ...filled[i], zoom: 1, cx: 0.5, cy: 0.5 } : emptySlot()));
    const next = { ...p, templateId: t.id, slots };
    if (t.title && !next.title) next.title = newPage(t.id).title;
    if (!t.title) delete next.title;
    return next;
  });

export const toggleFlip = (doc, pageId) => mapPage(doc, pageId, (p) => ({ ...p, flip: !p.flip }));

export const setTitle = (doc, pageId, patch) => mapPage(doc, pageId, (p) => ({ ...p, title: { ...p.title, ...patch } }));

// ---- slots ----------------------------------------------------------------------------------
const mapSlot = (doc, pageId, i, fn) =>
  mapPage(doc, pageId, (p) => ({ ...p, slots: p.slots.map((s, j) => (j === i ? fn(s) : s)) }));

export const placeAsset = (doc, pageId, i, assetId) =>
  mapSlot(doc, pageId, i, () => ({ ...emptySlot(), assetId }));
export const clearSlot = (doc, pageId, i) => mapSlot(doc, pageId, i, emptySlot);
export const updateSlot = (doc, pageId, i, patch) => mapSlot(doc, pageId, i, (s) => ({ ...s, ...patch }));

// Drag a photo from one cell to another (same spread or another one): the two swap.
export function swapSlots(doc, a, b) {
  const pa = doc.pages.find((p) => p.id === a.pageId);
  const pb = doc.pages.find((p) => p.id === b.pageId);
  if (!pa || !pb) return doc;
  const sa = pa.slots[a.index];
  const sb = pb.slots[b.index];
  let next = mapSlot(doc, a.pageId, a.index, () => ({ ...sb, zoom: 1, cx: 0.5, cy: 0.5 }));
  next = mapSlot(next, b.pageId, b.index, () => ({ ...sa, zoom: 1, cx: 0.5, cy: 0.5 }));
  return next;
}

// ---- crop -----------------------------------------------------------------------------------
// The one crop formula, shared by the screen and the full-size export so they can't disagree.
// Cell and image sizes in any unit; returns the drawn image size/offset in the same unit.
// zoom 1 = "cover" (fills the cell, nothing white); cx/cy = which point of the photo (0..1) sits
// in the middle of the cell, clamped so the photo always covers the cell.
export function computeCrop(cellW, cellH, imgW, imgH, { zoom = 1, cx = 0.5, cy = 0.5 } = {}) {
  const scale = Math.max(cellW / imgW, cellH / imgH) * Math.max(1, zoom);
  const drawW = imgW * scale;
  const drawH = imgH * scale;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const offX = clamp(cellW / 2 - cx * drawW, cellW - drawW, 0);
  const offY = clamp(cellH / 2 - cy * drawH, cellH - drawH, 0);
  return { drawW, drawH, offX, offY };
}

// Inverse for panning: from a drawn offset back to cx/cy.
export function centerFromOffset(cellW, cellH, drawW, drawH, offX, offY) {
  return { cx: (cellW / 2 - offX) / drawW, cy: (cellH / 2 - offY) / drawH };
}

// ---- photo bank -----------------------------------------------------------------------------
export function usageCounts(doc) {
  const n = {};
  for (const p of doc.pages) for (const s of p.slots) if (s.assetId) n[s.assetId] = (n[s.assetId] || 0) + 1;
  return n;
}

// "AVIRA-S-801.jpg" → "AVIRA-S" ; "AVIRA-3.jpg" → "AVIRA". Two photographers usually export with
// different prefixes, so the prefix stands for "which camera".
export const cameraOf = (name) =>
  String(name || "").replace(/\.[a-z0-9]+$/i, "").replace(/[-_ ]*\d+$/, "") || "—";

// "2026:07:05 13:22:56" (EXIF, camera local time) → ms. Not a real timezone — only used to order.
export function exifTimeMs(t) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(t || ""));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}

const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });

// Album order (decided 2026-10-08): by shooting time, so two photographers interleave the way the
// day happened; a camera offset (minutes) fixes a camera whose clock was wrong. Photos with no
// shooting time keep their file-name order, after the timed ones.
export function sortAssets(assets, offsets = {}) {
  const key = (a) => {
    const t = exifTimeMs(a.time);
    return t == null ? null : t + (offsets[a.camera] || 0) * 60000;
  };
  return [...assets].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka != null && kb != null && ka !== kb) return ka - kb;
    if (ka != null && kb == null) return -1;
    if (ka == null && kb != null) return 1;
    return natural(a.name, b.name);
  });
}

// Is the photo big enough for its cell at 300dpi? Returns the effective dpi.
export function effectiveDpi(asset, rect, zoom = 1) {
  if (!asset?.w || !asset?.h) return null;
  const cellWcm = (rect.w / 100) * 80;
  const cellHcm = (rect.h / 100) * 30;
  const scale = Math.max(cellWcm / asset.w, cellHcm / asset.h) * Math.max(1, zoom); // cm per px
  return Math.round(2.54 / scale);
}

export { cellRects, cellAspect, templatesForCount, PHOTO_TEMPLATES };

// ---- price ----------------------------------------------------------------------------------
export function priceSummary(pageCount, pricePerExtra) {
  const extra = Math.max(0, pageCount - PAGE_BASELINE);
  return { pages: pageCount, included: PAGE_BASELINE, extra, extraCost: extra * (Number(pricePerExtra) || 0) };
}

// ---- dates for the title page ---------------------------------------------------------------
export function formatDotDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
}

const ONES = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
const TENS = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
const HUNDREDS = ["", "ק", "ר", "ש", "ת", "תק", "תר", "תש", "תת", "תתק"];

// 16 → ט״ז, 785 → תשפ״ה (15/16 are written ט״ו / ט״ז by convention).
export function hebrewNumeral(n) {
  let s = HUNDREDS[Math.floor(n / 100)] || "";
  const r = n % 100;
  if (r === 15) s += "טו";
  else if (r === 16) s += "טז";
  else s += TENS[Math.floor(r / 10)] + ONES[r % 10];
  return s.length > 1 ? `${s.slice(0, -1)}״${s.slice(-1)}` : `${s}׳`;
}

// "2025-03-16" → "ט״ז באדר, תשפ״ה" (same shape as his title spreads).
export function hebrewDateText(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "";
  try {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
    const parts = new Intl.DateTimeFormat("he-u-ca-hebrew", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).formatToParts(d);
    const get = (t) => parts.find((p) => p.type === t)?.value || "";
    const day = parseInt(get("day"), 10);
    const year = parseInt(get("year"), 10);
    if (!day || !year) return "";
    return `${hebrewNumeral(day)} ב${get("month")}, ${hebrewNumeral(year % 1000)}`;
  } catch {
    return "";
  }
}
