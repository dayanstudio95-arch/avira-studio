// Frames sized by hand (Avira, 2026-11-03, the owner's request): on one spread, the white line between two photos is
// dragged, and the photos on both sides of it grow and shrink together. The spread keeps its template; its own sizes
// are `page.cells` (the template's [x, y, w, h] in percent, same order and count — slots still line up by index) with
// `page.cellsFor` = the template they were made on, so a page whose layout changes in any way drops back to the
// template's sizes. Pure — unit-tested in scripts/test-whatsapp-bot.mjs, and mirrored on the server for the couple's
// sketch (supabase/functions/_shared/albumDesignSanitize.ts, cleanCells).

import { getTemplate, SPREAD } from "./albumTemplates";

/** No frame narrower or lower than 6 cm. */
export const MIN_CM = 6;
export const MIN_X = (MIN_CM / SPREAD.widthCm) * 100;
export const MIN_Y = (MIN_CM / SPREAD.heightCm) * 100;
const EPS = 0.05;

const near = (a, b) => Math.abs(a - b) < EPS;
const round2 = (n) => Math.round(n * 100) / 100;

/** `cells` when they are a valid set of `n` frames inside the spread, else null. */
export function cleanCells(cells, n) {
  if (!Array.isArray(cells) || cells.length !== n) return null;
  const out = [];
  for (const c of cells) {
    if (!Array.isArray(c) || c.length !== 4 || !c.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
    const [x, y, w, h] = c;
    if (x < -EPS || y < -EPS || w < 1 || h < 1 || x + w > 100 + EPS || y + h > 100 + EPS) return null;
    out.push(c.map(round2));
  }
  return out;
}

/** The spread's frames: its own sizes when they were made on its template, else the template's. */
export function pageCells(page) {
  const t = getTemplate(page?.templateId);
  if (page?.cells && page.cellsFor === t.id) {
    const own = cleanCells(page.cells, t.cells.length);
    if (own) return own;
  }
  return t.cells;
}

/** The spread's template with its own frame sizes — what the screen, the export and the fold check draw. */
export function pageTemplate(page) {
  const t = getTemplate(page?.templateId);
  const cells = pageCells(page);
  return cells === t.cells ? t : { ...t, cells };
}

/** Whether the spread's frames were sized by hand. */
export const hasOwnCells = (page) => pageCells(page) !== getTemplate(page?.templateId).cells;

/** The page with these frame sizes (none kept when they are the template's own). */
export function withCells(page, cells) {
  const t = getTemplate(page.templateId);
  const clean = cleanCells(cells, t.cells.length);
  const same = !clean || clean.every((c, i) => c.every((v, j) => near(v, t.cells[i][j])));
  const { cells: _c, cellsFor: _f, ...rest } = page;
  return same ? rest : { ...rest, cells: clean, cellsFor: t.id };
}

/** The page without sizes of its own (a new template, a new layout). */
export const withoutCells = (page) => {
  if (!page?.cells && !page?.cellsFor) return page;
  const { cells: _c, cellsFor: _f, ...rest } = page;
  return rest;
};

/** Left↔right mirror of one frame (a flipped spread). Its own inverse. */
export const mirrorCell = ([x, y, w, h]) => [100 - x - w, y, w, h];

/**
 * The lines that can be dragged: where frames touch edge to edge. A line is the frames on its two sides that overlap
 * along it (`a` = left / above, `b` = right / below, indexes into `cells`), so a long line between a big photo and two
 * stacked ones moves all three, and two lines that only happen to share a position stay separate.
 * { dir: "v" | "h", at, a, b, from, to } — `from`/`to` = where it runs along the other axis.
 */
export function dividers(cells) {
  const out = [];
  for (const dir of ["v", "h"]) {
    const pos = (c) => (dir === "v" ? c[0] : c[1]);
    const len = (c) => (dir === "v" ? c[2] : c[3]);
    const lo = (c) => (dir === "v" ? c[1] : c[0]);
    const hi = (c) => (dir === "v" ? c[1] + c[3] : c[0] + c[2]);
    const lines = [...new Set(cells.map((c) => round2(pos(c) + len(c))).filter((v) => v < 100 - EPS))];
    for (const at of lines) {
      const a = cells.map((c, i) => i).filter((i) => near(pos(cells[i]) + len(cells[i]), at));
      const b = cells.map((c, i) => i).filter((i) => near(pos(cells[i]), at));
      const overlap = (i, j) => lo(cells[i]) < hi(cells[j]) - EPS && lo(cells[j]) < hi(cells[i]) - EPS;
      // Groups of frames joined by overlapping across the line.
      const left = new Set(a);
      const seen = new Set();
      for (const start of [...a, ...b]) {
        if (seen.has(start)) continue;
        const group = [start];
        seen.add(start);
        for (let k = 0; k < group.length; k++) {
          const i = group[k];
          for (const j of left.has(i) ? b : a) {
            if (seen.has(j) || !overlap(i, j)) continue;
            seen.add(j);
            group.push(j);
          }
        }
        const ga = group.filter((i) => left.has(i));
        const gb = group.filter((i) => !left.has(i));
        if (!ga.length || !gb.length) continue;
        out.push({ dir, at, a: ga.sort((x, y) => x - y), b: gb.sort((x, y) => x - y), from: Math.min(...group.map((i) => lo(cells[i]))), to: Math.max(...group.map((i) => hi(cells[i]))) });
      }
    }
  }
  return out;
}

/** How far a line can go: each frame on both sides keeps at least 6 cm. */
export function dividerLimits(cells, d) {
  const min = d.dir === "v" ? MIN_X : MIN_Y;
  const start = (i) => (d.dir === "v" ? cells[i][0] : cells[i][1]);
  const end = (i) => (d.dir === "v" ? cells[i][0] + cells[i][2] : cells[i][1] + cells[i][3]);
  return [Math.max(...d.a.map(start)) + min, Math.min(...d.b.map(end)) - min];
}

/** The frames with the line moved to `at` (kept within its limits). */
export function moveDivider(cells, d, at) {
  const [lo, hi] = dividerLimits(cells, d);
  const p = round2(Math.min(hi, Math.max(lo, at)));
  const next = cells.map((c) => c.slice());
  for (const i of d.a) {
    if (d.dir === "v") next[i][2] = round2(p - next[i][0]);
    else next[i][3] = round2(p - next[i][1]);
  }
  for (const i of d.b) {
    if (d.dir === "v") {
      const end = next[i][0] + next[i][2];
      next[i][0] = p;
      next[i][2] = round2(end - p);
    } else {
      const end = next[i][1] + next[i][3];
      next[i][1] = p;
      next[i][3] = round2(end - p);
    }
  }
  return next;
}

/**
 * Where a dragged line clicks into place: the fold (vertical lines), where the template had it, and in line with the
 * other lines of the same direction. Within 1% of the spread's width (2.5% of its height).
 */
export function snapDivider(at, d, { original, others = [] } = {}) {
  const range = d.dir === "v" ? 1 : 2.5;
  const targets = [];
  if (d.dir === "v") targets.push({ at: 50, why: "fold" });
  if (Number.isFinite(original)) targets.push({ at: original, why: "template" });
  for (const o of others) if (o.dir === d.dir) targets.push({ at: o.at, why: "line" });
  let best = null;
  for (const t of targets) if (Math.abs(at - t.at) <= range && (!best || Math.abs(at - t.at) < Math.abs(at - best.at))) best = t;
  return best || { at, why: null };
}

/** Size of frame `i` along the line's axis, in whole centimetres (what the drag shows). */
export const frameCm = (cells, i, dir) => Math.round(dir === "v" ? (cells[i][2] * SPREAD.widthCm) / 100 : (cells[i][3] * SPREAD.heightCm) / 100);
