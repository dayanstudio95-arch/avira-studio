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

export function autoLayout(assets, { spreads = 30, title = null, openingCount = 2, openingEmpty = true } = {}) {
  const pages = [];
  const titlePage = newPage(OPENING_TEMPLATE[openingCount] || "t-a");
  if (title) titlePage.title = { ...titlePage.title, ...title };
  const titleCount = getTemplate(titlePage.templateId).cells.length;
  // empty opening → its frames stay empty and the album starts from the first photo
  const used = openingEmpty ? 0 : titleCount;
  if (!openingEmpty) {
    assets.slice(0, titleCount).forEach((a, i) => {
      titlePage.slots[i] = { ...titlePage.slots[i], assetId: a.id };
    });
  }
  pages.push(titlePage);

  const rest = assets.slice(used);
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
