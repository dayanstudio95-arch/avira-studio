// Auto-sketch (album editor stage 2, 2026-10-08). Takes the photos in album order (shooting time,
// see sortAssets) and the number of spreads the owner wants (default 30), and fills the album:
//   - spread 1 = the opening spread (2 photos + the couple's names), like all three of his albums;
//   - the rest share the photos evenly, in order — every 5th spread is a "hero" spread with fewer,
//     bigger photos (his albums breathe like that: 4–6 photos, then a big one);
//   - for each spread, the template whose cells best fit the photos' shapes (a portrait photo in a
//     portrait cell), leaning towards the layouts he used most and never the same layout twice in
//     a row. Within a spread photos may move between cells to fit; across spreads the order holds.
// Pure — unit-tested in scripts/test-whatsapp-bot.mjs (PART 40).
import { getTemplate, cellRects, cellAspect, templatesForCount } from "./albumTemplates";
import { newPage, newId, sortAssets } from "./albumDesign";

const MAX_PER_SPREAD = 10;
const HERO_EVERY = 5;

// How many photos go on each of `spreads` spreads.
export function distributeCounts(total, spreads) {
  if (spreads <= 0 || total <= 0) return [];
  if (total <= spreads) return Array.from({ length: total }, () => 1);
  const avg = total / spreads;
  const isHero = (i) => avg >= 3 && i % HERO_EVERY === 2;
  const heroSize = Math.max(1, Math.min(3, Math.round(avg / 2)));
  const heroes = Array.from({ length: spreads }, (_, i) => isHero(i)).filter(Boolean).length;
  const rest = total - heroes * heroSize;
  const others = spreads - heroes;
  const counts = [];
  let given = 0;
  let k = 0;
  for (let i = 0; i < spreads; i++) {
    if (isHero(i)) {
      counts.push(heroSize);
      continue;
    }
    // spread the remainder evenly (Bresenham), so 5,5,6,5,5,6 rather than 6,6,5,5,5,5
    k++;
    const target = Math.round((rest * k) / others);
    counts.push(Math.min(MAX_PER_SPREAD, Math.max(1, target - given)));
    given = target;
  }
  return counts;
}

const photoAspect = (a) => (a?.w && a?.h ? a.w / a.h : 1.5);

// Every layout (+flip) for these photos, best fit first, with which photo goes in which cell.
// Fit = how much each photo's shape differs from its cell's shape (log aspect ratio), with a
// small pull towards the layouts he used most and a push away from repeating the previous one.
export function rankTemplates(photos, prevTemplateId = null) {
  const n = photos.length;
  const candidates = templatesForCount(n);
  const byShape = photos.map((p, i) => ({ i, r: Math.log(photoAspect(p)) })).sort((a, b) => a.r - b.r);
  const ranked = [];
  for (const t of candidates) {
    for (const flip of [false, true]) {
      const cells = cellRects(t, flip).map((r, j) => ({ j, r: Math.log(cellAspect(r)) })).sort((a, b) => a.r - b.r);
      // pair the narrowest photo with the narrowest cell, and so on
      let fit = 0;
      const assign = new Array(n);
      cells.forEach((c, k) => {
        fit += Math.abs(c.r - byShape[k].r);
        assign[c.j] = byShape[k].i;
      });
      fit /= n;
      let cost = fit;
      if (t.id === prevTemplateId) cost += 0.25;
      cost -= 0.04 * Math.log(1 + (t.uses || 0));
      if (flip) cost += 0.01; // tie → unflipped
      ranked.push({ templateId: t.id, flip, assign, cost, fit });
    }
  }
  return ranked.sort((a, b) => a.cost - b.cost);
}

export const pickTemplate = (photos, prevTemplateId = null) => rankTemplates(photos, prevTemplateId)[0] || null;

// A page holding exactly these photos (in the best layout for them).
export function pageFor(photos, prevTemplateId = null) {
  const pick = pickTemplate(photos, prevTemplateId);
  if (!pick) return null;
  const page = newPage(pick.templateId);
  page.flip = pick.flip;
  page.slots = pick.assign.map((photoIndex) => ({ assetId: photos[photoIndex].id, zoom: 1, cx: 0.5, cy: 0.5, filter: "none" }));
  return page;
}

// "פצל" (2026-10-08): keep the first `keep` photos of a spread, move the rest to a new spread right
// after it; both get the best layout for what they now hold.
export function splitPage(doc, pageId, keep, assetsById) {
  const i = doc.pages.findIndex((p) => p.id === pageId);
  if (i < 0) return doc;
  // in album order (shooting time), not in the order of the layout's cells
  const onPage = doc.pages[i].slots.filter((s) => s.assetId).map((s) => assetsById[s.assetId]).filter(Boolean);
  const photos = sortAssets(onPage, doc.cameraOffsets || {});
  if (keep < 1 || keep >= photos.length) return doc;
  const a = pageFor(photos.slice(0, keep));
  const b = pageFor(photos.slice(keep));
  if (!a || !b) return doc;
  a.id = doc.pages[i].id; // the spread keeps its identity (selection, undo)
  const pages = [...doc.pages];
  pages.splice(i, 1, a, b);
  return { ...doc, pages };
}

// Put a group of chosen photos (multi-select in the bank) on a spread: a new one after `afterIndex`,
// or replacing the photos of an existing one. Up to 20 photos a spread; more → several spreads.
export function placeGroup(doc, photos, { afterIndex = doc.pages.length - 1, replacePageId = null } = {}) {
  const chunks = [];
  for (let k = 0; k < photos.length; k += 20) chunks.push(photos.slice(k, k + 20));
  const made = chunks.map((c) => pageFor(c)).filter(Boolean);
  if (!made.length) return { doc, pageIds: [] };
  const pages = [...doc.pages];
  if (replacePageId) {
    const i = pages.findIndex((p) => p.id === replacePageId);
    made[0].id = replacePageId;
    pages.splice(i, 1, ...made);
  } else {
    pages.splice(afterIndex + 1, 0, ...made);
  }
  return { doc: { ...doc, pages }, pageIds: made.map((p) => p.id) };
}

// Apply a saved layout preset (a list of templates) to the photos in album order.
export function applyPreset(assets, preset, { title = null, openingEmpty = true } = {}) {
  const pages = [];
  let at = 0;
  for (const step of preset.pages) {
    const t = getTemplate(step.templateId);
    const page = newPage(t.id);
    page.flip = !!step.flip;
    if (t.title && title) page.title = { ...page.title, ...title };
    if (t.title && openingEmpty) {
      pages.push(page); // the opening's frames stay empty for the owner to choose
      continue;
    }
    page.slots = t.cells.map((_, k) => ({ assetId: assets[at + k]?.id || null, zoom: 1, cx: 0.5, cy: 0.5, filter: "none" }));
    at += t.cells.length;
    pages.push(page);
  }
  return { pages, unused: Math.max(0, assets.length - at) };
}

export const presetFromDoc = (doc, name) => ({ id: newId("pr"), name: String(name || "").slice(0, 60), pages: doc.pages.map((p) => ({ templateId: p.templateId, flip: !!p.flip })) });

// → { pages, unused } — `unused` = photos that didn't fit (more than 10 per spread needed).
// Opening spread by how many photos it holds (2026-10-08: the owner picks the opening photo
// himself — usually the couple from the outdoor shoot, not the first photo of the day).
export const OPENING_TEMPLATE = { 1: "t-c", 2: "t-a", 3: "t-d" };

// Photos → the cells of a fixed template, narrowest photo in the narrowest cell.
function assignByShape(templateId, photos) {
  const cells = cellRects(getTemplate(templateId)).map((r, j) => ({ j, r: Math.log(cellAspect(r)) })).sort((a, b) => a.r - b.r);
  const byShape = photos.map((p) => ({ p, r: Math.log(photoAspect(p)) })).sort((a, b) => a.r - b.r);
  const out = new Array(cells.length).fill(null);
  cells.forEach((c, k) => {
    out[c.j] = byShape[k]?.p || null;
  });
  return out;
}

// `openingIds` (2026-10-08): the photos the owner picked for the opening spread — usually the
// couple from the outdoor shoot. They fill the opening and don't appear again later in the album.
// Without them the opening stays empty (openingEmpty) and the album starts from the first photo.
export function autoLayout(assets, { spreads = 30, title = null, openingCount = 2, openingEmpty = true, openingIds = null } = {}) {
  const pages = [];
  const titlePage = newPage(OPENING_TEMPLATE[openingCount] || "t-a");
  if (title) titlePage.title = { ...titlePage.title, ...title };
  const titleCount = getTemplate(titlePage.templateId).cells.length;
  let pool = assets;
  if (openingIds?.length) {
    const chosen = openingIds.map((id) => assets.find((a) => a.id === id)).filter(Boolean).slice(0, titleCount);
    assignByShape(titlePage.templateId, chosen).forEach((a, i) => {
      if (a) titlePage.slots[i] = { ...titlePage.slots[i], assetId: a.id };
    });
    const taken = new Set(chosen.map((a) => a.id));
    pool = assets.filter((a) => !taken.has(a.id));
  } else if (!openingEmpty) {
    assets.slice(0, titleCount).forEach((a, i) => {
      titlePage.slots[i] = { ...titlePage.slots[i], assetId: a.id };
    });
    pool = assets.slice(titleCount);
  }
  pages.push(titlePage);

  const rest = pool;
  const counts = distributeCounts(rest.length, Math.max(1, spreads - 1));
  let at = 0;
  let prev = null;
  for (const n of counts) {
    const photos = rest.slice(at, at + n);
    at += n;
    const page = pageFor(photos, prev);
    if (!page) continue;
    pages.push(page);
    prev = page.templateId;
  }
  return { pages, unused: Math.max(0, rest.length - at) };
}

// A sensible default for the dialog: his albums average ~5 photos a spread, 30 included.
export function suggestedSpreads(photoCount) {
  return Math.max(10, Math.min(60, Math.round(photoCount / 5) || 30));
}

// ---- drop a photo ON a page in the strip (2026-10-08) -------------------------------------------
// The photo joins that page and both pages re-layout for their new number of photos: the target
// gets the best layout for one more, the page it came from for one less. Each photo keeps its look
// (B&W, colour adjustments, shape, heal strokes); crops reset because the frames changed.
const MAX_ON_PAGE = 20;

function relayout(page, photos, looks) {
  if (!photos.length) {
    return { ...page, slots: page.slots.map(() => ({ assetId: null, zoom: 1, cx: 0.5, cy: 0.5, filter: "none" })) };
  }
  if (page.title) {
    const tid = OPENING_TEMPLATE[photos.length];
    if (!tid) return null; // the opening takes 1–3 photos
    const t = getTemplate(tid);
    return { ...page, templateId: tid, slots: t.cells.map((_, i) => slotFor(photos[i], looks)) };
  }
  const made = pageFor(photos);
  if (!made) return null;
  return { ...page, templateId: made.templateId, flip: made.flip, slots: made.slots.map((s) => slotFor({ id: s.assetId }, looks)) };
}

function slotFor(asset, looks) {
  if (!asset?.id) return { assetId: null, zoom: 1, cx: 0.5, cy: 0.5, filter: "none" };
  const look = looks[asset.id] || {};
  return { filter: "none", ...look, assetId: asset.id, zoom: 1, cx: 0.5, cy: 0.5 };
}

// `from` = { pageId, index } when the photo was dragged out of a frame (it leaves that page),
// or null when it comes from the bank. → { doc, error }
export function addToPage(doc, targetPageId, assetIds, assetsById, from = null, extraLooks = {}) {
  const ti = doc.pages.findIndex((p) => p.id === targetPageId);
  if (ti < 0) return { doc };
  if (from && from.pageId === targetPageId) return { doc }; // already on this page
  const looks = {};
  for (const p of doc.pages) for (const s of p.slots) if (s.assetId) looks[s.assetId] = { filter: s.filter, adj: s.adj, shape: s.shape, heal: s.heal };
  Object.assign(looks, extraLooks); // e.g. a cut photo: its frame is already empty
  const target = doc.pages[ti];
  const have = target.slots.filter((s) => s.assetId).map((s) => assetsById[s.assetId]).filter(Boolean);
  const adding = assetIds.map((id) => assetsById[id]).filter((a) => a && !have.some((h) => h.id === a.id));
  if (!adding.length) return { doc };
  const all = sortAssets([...have, ...adding], doc.cameraOffsets || {});
  if (all.length > MAX_ON_PAGE) return { doc, error: `בדף יכולות להיות עד ${MAX_ON_PAGE} תמונות` };
  const newTarget = relayout(target, all, looks);
  if (!newTarget) return { doc, error: "בדף הפתיחה יכולות להיות 1–3 תמונות" };
  const pages = [...doc.pages];
  pages[ti] = newTarget;
  if (from) {
    const si = pages.findIndex((p) => p.id === from.pageId);
    if (si >= 0) {
      const src = pages[si];
      const left = src.slots.filter((s, k) => s.assetId && k !== from.index).map((s) => assetsById[s.assetId]).filter(Boolean);
      const newSrc = relayout(src, sortAssets(left, doc.cameraOffsets || {}), looks) || { ...src, slots: src.slots.map((s, k) => (k === from.index ? { ...s, assetId: null } : s)) };
      pages[si] = newSrc;
    }
  }
  return { doc: { ...doc, pages } };
}

// Cut (⌘X) a photo out of a page → the page re-layouts for one photo less (no empty frame left).
export function removeFromPage(doc, pageId, index, assetsById) {
  const i = doc.pages.findIndex((p) => p.id === pageId);
  if (i < 0) return doc;
  const page = doc.pages[i];
  const looks = {};
  for (const s of page.slots) if (s.assetId) looks[s.assetId] = { filter: s.filter, adj: s.adj, shape: s.shape, heal: s.heal };
  const left = page.slots.filter((s, k) => s.assetId && k !== index).map((s) => assetsById[s.assetId]).filter(Boolean);
  const next = relayout(page, sortAssets(left, doc.cameraOffsets || {}), looks) || { ...page, slots: page.slots.map((s, k) => (k === index ? { ...s, assetId: null } : s)) };
  const pages = [...doc.pages];
  pages[i] = next;
  return { ...doc, pages };
}
