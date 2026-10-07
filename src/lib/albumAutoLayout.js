// Auto-sketch (album editor stage 2, 2026-10-08). Takes the photos in album order (shooting time,
// see sortAssets) and the number of spreads the owner wants (default 30), and fills the album:
//   - spread 1 = the opening spread (2 photos + the couple's names), like all three of his albums;
//   - the rest share the photos evenly, in order — every 5th spread is a "hero" spread with fewer,
//     bigger photos (his albums breathe like that: 4–6 photos, then a big one);
//   - for each spread, the template whose cells best fit the photos' shapes (a portrait photo in a
//     portrait cell), leaning towards the layouts he used most and never the same layout twice in
//     a row. Within a spread photos may move between cells to fit; across spreads the order holds.
// Pure — unit-tested in scripts/test-whatsapp-bot.mjs (PART 40).
import { PHOTO_TEMPLATES, getTemplate, cellRects, cellAspect } from "./albumTemplates";
import { newPage } from "./albumDesign";

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

// Best template (+flip) for these photos, and which photo goes in which cell.
export function pickTemplate(photos, prevTemplateId = null) {
  const n = photos.length;
  const candidates = PHOTO_TEMPLATES.filter((t) => t.cells.length === n);
  if (!candidates.length) return null;
  const byShape = photos.map((p, i) => ({ i, r: Math.log(photoAspect(p)) })).sort((a, b) => a.r - b.r);
  let best = null;
  for (const t of candidates) {
    for (const flip of [false, true]) {
      const cells = cellRects(t, flip).map((r, j) => ({ j, r: Math.log(cellAspect(r)) })).sort((a, b) => a.r - b.r);
      // pair the narrowest photo with the narrowest cell, and so on
      let cost = 0;
      const assign = new Array(n);
      cells.forEach((c, k) => {
        cost += Math.abs(c.r - byShape[k].r);
        assign[c.j] = byShape[k].i;
      });
      cost /= n;
      if (t.id === prevTemplateId) cost += 0.25;
      cost -= 0.04 * Math.log(1 + (t.uses || 0));
      if (flip) cost += 0.01; // tie → unflipped
      if (!best || cost < best.cost) best = { templateId: t.id, flip, assign, cost };
    }
  }
  return best;
}

// → { pages, unused } — `unused` = photos that didn't fit (more than 10 per spread needed).
export function autoLayout(assets, { spreads = 30, title = null } = {}) {
  const pages = [];
  const titlePage = newPage("t-a");
  if (title) titlePage.title = { ...titlePage.title, ...title };
  const titleCount = getTemplate("t-a").cells.length;
  assets.slice(0, titleCount).forEach((a, i) => {
    titlePage.slots[i] = { ...titlePage.slots[i], assetId: a.id };
  });
  pages.push(titlePage);

  const rest = assets.slice(titleCount);
  const counts = distributeCounts(rest.length, Math.max(1, spreads - 1));
  let at = 0;
  let prev = null;
  for (const n of counts) {
    const photos = rest.slice(at, at + n);
    at += n;
    const pick = pickTemplate(photos, prev);
    if (!pick) continue;
    const page = newPage(pick.templateId);
    page.flip = pick.flip;
    page.slots = pick.assign.map((photoIndex) => ({ assetId: photos[photoIndex].id, zoom: 1, cx: 0.5, cy: 0.5, filter: "none" }));
    pages.push(page);
    prev = pick.templateId;
  }
  return { pages, unused: Math.max(0, rest.length - at) };
}

// A sensible default for the dialog: his albums average ~5 photos a spread, 30 included.
export function suggestedSpreads(photoCount) {
  return Math.max(10, Math.min(60, Math.round(photoCount / 5) || 30));
}
