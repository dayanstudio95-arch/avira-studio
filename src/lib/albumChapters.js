// Chapters of the album (2026-11-05, the owner's request): in the photo bank's "הכל" (shooting order) a divider
// closes a chapter — "the photos up to here are התארגנות" — and the page planner gives each chapter its pages by how
// many photos it has, their shape, and how important the chapter is (more important = fewer photos on a page).
// Decided with the owner:
//   - his chapters, in his order, each with an importance (the list is the studio's and can grow);
//   - photos per page by importance: high ≈ 3.5, medium 5, low 7 — 150 photos ≈ 30 pages with the opening;
//   - more photos than the 150 the couple paid for → extra pages (one per 5 photos), with the price; "לדחוס" keeps 30.
// Pure: the doc keeps `chapterOf` ({ assetId: chapterId }); the list and the numbers are in app_settings.

export const DEFAULT_CHAPTERS = [
  { id: "prep", label: "התארגנות", importance: "low" },
  { id: "outdoor", label: "צילומי חוץ", importance: "high" },
  { id: "venue", label: "אולם", importance: "low" },
  { id: "families", label: "משפחות", importance: "high" },
  { id: "chuppah", label: "טקס חופה", importance: "mid" },
  { id: "dancing", label: "ריקודים", importance: "low" },
];
export const DEFAULT_PER_PAGE = { high: 3.5, mid: 5, low: 7 };
export const IMPORTANCE = [
  { id: "low", label: "נמוכה" },
  { id: "mid", label: "בינונית" },
  { id: "high", label: "גבוהה" },
];
export const LANDSCAPE_WEIGHT = 1.5; // a landscape photo takes more of a 80×30 spread than a portrait one
const MAX_ON_PAGE = 10; // albumAutoLayout's MAX_PER_SPREAD

export const isLandscape = (a) => (a?.w || 3) > (a?.h || 2);

export function shapeCounts(photos) {
  const landscape = photos.filter(isLandscape).length;
  return { portrait: photos.length - landscape, landscape };
}

// The sorted photos as runs of the same chapter (null = not in a chapter yet), in order.
// → [{ chapterId, start, end, ids }]  (start / end = indexes in `sorted`)
export function chapterRuns(sorted, chapterOf = {}) {
  const runs = [];
  sorted.forEach((a, i) => {
    const c = chapterOf[a.id] || null;
    const last = runs[runs.length - 1];
    if (last && last.chapterId === c) {
      last.end = i;
      last.ids.push(a.id);
    } else runs.push({ chapterId: c, start: i, end: i, ids: [a.id] });
  });
  return runs;
}

const runAt = (runs, x) => runs.find((r) => r.start <= x && x <= r.end);

// The photos a divider after index `x` closes: from the start of x's run up to x.
export function dividerRange(sorted, chapterOf, x) {
  const run = runAt(chapterRuns(sorted, chapterOf), x);
  return run ? { from: run.start, to: x, ids: sorted.slice(run.start, x + 1).map((a) => a.id) } : null;
}

// Divider after index `x`: those photos become `chapterId`; the rest of the run keeps what it had.
export function setDivider(chapterOf, sorted, x, chapterId) {
  const range = dividerRange(sorted, chapterOf, x);
  if (!range) return chapterOf;
  const next = { ...chapterOf };
  for (const id of range.ids) {
    if (chapterId) next[id] = chapterId;
    else delete next[id];
  }
  return next;
}

// A whole run to another chapter (or none).
export function setRun(chapterOf, ids, chapterId) {
  const next = { ...chapterOf };
  for (const id of ids) {
    if (chapterId) next[id] = chapterId;
    else delete next[id];
  }
  return next;
}

// Nudge the line between run k-1 and run k by one photo: dir -1 = run k's first photo goes up to run k-1,
// dir +1 = run k-1's last photo comes down to run k.
export function shiftBoundary(chapterOf, sorted, k, dir) {
  const runs = chapterRuns(sorted, chapterOf);
  const cur = runs[k];
  const prev = runs[k - 1];
  if (!cur || !prev) return chapterOf;
  if (dir < 0 && cur.ids.length < 2) return chapterOf; // the run would vanish — remove it with × instead
  if (dir > 0 && prev.ids.length < 2) return chapterOf;
  const id = dir < 0 ? cur.ids[0] : prev.ids[prev.ids.length - 1];
  return setRun(chapterOf, [id], dir < 0 ? prev.chapterId : cur.chapterId);
}

// What the divider should offer first: the chapter after the one just before these photos, in the studio's order,
// that isn't in the album yet; else the first one not used yet.
export function suggestChapter(chapters, sorted, chapterOf, x) {
  const range = dividerRange(sorted, chapterOf, x);
  if (!range || !chapters.length) return chapters[0]?.id || null;
  const used = new Set(Object.values(chapterOf));
  const before = range.from > 0 ? chapterOf[sorted[range.from - 1].id] || null : null;
  const own = chapterOf[sorted[x].id] || null; // splitting a run that already has a chapter: keep it on top
  if (own) return own;
  const at = before ? chapters.findIndex((c) => c.id === before) : -1;
  for (let i = at + 1; i < chapters.length; i++) if (!used.has(chapters[i].id)) return chapters[i].id;
  return chapters.find((c) => !used.has(c.id))?.id || chapters[Math.min(chapters.length - 1, at + 1)]?.id || chapters[0].id;
}

// The album's chapters in the order they first appear (shooting order), with their photos.
// → [{ id, label, importance, photos }]  — photos outside any chapter, if any, last as id null.
export function chapterSections(sorted, chapterOf, chapters, { skip = [] } = {}) {
  const skipSet = new Set(skip);
  const byId = Object.fromEntries(chapters.map((c) => [c.id, c]));
  const out = [];
  const index = {};
  const loose = [];
  for (const a of sorted) {
    if (skipSet.has(a.id)) continue;
    const c = chapterOf[a.id];
    if (!c || !byId[c]) {
      loose.push(a);
      continue;
    }
    if (index[c] == null) {
      index[c] = out.length;
      out.push({ id: c, label: byId[c].label, importance: byId[c].importance || "mid", photos: [] });
    }
    out[index[c]].photos.push(a);
  }
  if (loose.length) out.push({ id: null, label: "בלי פרק", importance: "low", photos: loose });
  return out;
}

// How many pages each section gets. `sections`: [{ importance, photos }]. `overrides`: { index: pages } typed by hand.
// → { target, pages: [n…], total (with the opening), extra (over the included pages), photos }
export function planPages(sections, { perPage = DEFAULT_PER_PAGE, pagesIncluded = 30, baselinePhotos = 150, extraEvery = 5, openingPhotos = 0, squeeze = false, overrides = {} } = {}) {
  const photos = sections.reduce((n, s) => n + s.photos.length, 0) + openingPhotos;
  const over = squeeze ? 0 : Math.max(0, Math.ceil((photos - baselinePhotos) / extraEvery));
  const target = Math.max(1, pagesIncluded - 1 + over);
  const min = sections.map((s) => (s.photos.length ? Math.max(1, Math.ceil(s.photos.length / MAX_ON_PAGE)) : 0));
  const weight = sections.map((s) => {
    const { portrait, landscape } = shapeCounts(s.photos);
    const units = (portrait + LANDSCAPE_WEIGHT * landscape) / ((1 + LANDSCAPE_WEIGHT) / 2);
    return s.photos.length ? units / (perPage[s.importance] || perPage.mid || 5) : 0;
  });
  const fixed = sections.map((s, i) => (overrides[i] != null && s.photos.length ? Math.max(min[i], Math.round(overrides[i])) : null));
  const free = target - fixed.reduce((n, f) => n + (f || 0), 0);
  const open = sections.map((_, i) => fixed[i] == null && sections[i].photos.length > 0);
  const sumW = weight.reduce((n, w, i) => n + (open[i] ? w : 0), 0) || 1;
  const pages = sections.map((_, i) => (fixed[i] != null ? fixed[i] : open[i] ? Math.max(min[i], Math.floor((weight[i] * free) / sumW)) : 0));
  // largest remainder fills what rounding down left; never below a section's minimum
  let left = target - pages.reduce((n, p) => n + p, 0);
  const order = sections.map((_, i) => i).filter((i) => open[i]).sort((a, b) => ((weight[b] * free) / sumW) % 1 - ((weight[a] * free) / sumW) % 1);
  for (let k = 0; left > 0 && order.length; k++) {
    pages[order[k % order.length]]++;
    left--;
  }
  for (let k = 0; left < 0 && k < 1000; k++) {
    // over target (minimums, or more by hand): take back from the free sections with the most pages per photo
    const i = order.filter((j) => pages[j] > min[j]).sort((a, b) => pages[b] / sections[b].photos.length - pages[a] / sections[a].photos.length)[0];
    if (i == null) break;
    pages[i]--;
    left++;
  }
  const total = pages.reduce((n, p) => n + p, 0) + 1;
  return { target, pages, total, extra: Math.max(0, total - pagesIncluded), photos };
}
