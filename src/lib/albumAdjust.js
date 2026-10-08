// Photo adjustments, Lightroom-style (album editor, 2026-10-08): exposure, contrast, highlights,
// shadows, temperature, tint, saturation, sharpness. Non-destructive — stored as numbers on the
// slot (slot.adj), never baked into the photo.
// One pipeline for screen AND print: every look becomes an SVG <filter> mounted in the page
// (<AdjustmentDefs>), referenced as `filter: url(#adj-…)` by the <img> on screen and by
// `ctx.filter = "url(#adj-…)"` on the full-size export canvas (Chrome/Edge support both).
// Pure helpers — unit-tested (PART 43).

export const ADJ_FIELDS = [
  { key: "exposure", label: "חשיפה", min: -2, max: 2, step: 0.05, fmt: (v) => `${v > 0 ? "+" : ""}${v.toFixed(2)}` },
  { key: "contrast", label: "קונטרסט", min: -100, max: 100, step: 1 },
  { key: "highlights", label: "הבהרות", min: -100, max: 100, step: 1 },
  { key: "shadows", label: "צללים", min: -100, max: 100, step: 1 },
  { key: "temp", label: "טמפרטורה (WB)", min: -100, max: 100, step: 1 },
  { key: "tint", label: "גוון (ירוק↔מג׳נטה)", min: -100, max: 100, step: 1 },
  { key: "saturation", label: "רוויה", min: -100, max: 100, step: 1 },
  { key: "sharpness", label: "חדות", min: 0, max: 100, step: 1 },
];

const r3 = (n) => Math.round(n * 1000) / 1000;

export function cleanAdj(adj) {
  const out = {};
  for (const f of ADJ_FIELDS) {
    const v = Number(adj?.[f.key]);
    if (Number.isFinite(v) && v !== 0) out[f.key] = Math.min(f.max, Math.max(f.min, v));
  }
  return out;
}

export const isNeutral = (adj) => Object.keys(cleanAdj(adj)).length === 0;

// Stable id per look — identical adjustments share one <filter>.
export function adjId(adj) {
  const a = cleanAdj(adj);
  const key = ADJ_FIELDS.filter((f) => a[f.key]).map((f) => `${f.key[0]}${f.key[1]}${a[f.key]}`).join("_");
  return key ? `adj-${key.replace(/[^a-zA-Z0-9_-]/g, "m")}` : null;
}

// Tone curve for highlights/shadows (+ contrast), 17 points 0..1 — an S-ish curve that lifts or
// pulls the dark end (shadows) and the bright end (highlights) without moving the mid-tones much.
export function toneTable({ contrast = 0, highlights = 0, shadows = 0 } = {}) {
  const c = 1 + contrast / 100; // slope around the middle grey
  const sh = shadows / 100;
  const hl = highlights / 100;
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const x = i / 16;
    let y = 0.5 + (x - 0.5) * c;
    y += sh * 0.5 * x * (1 - x) * (1 - x) * 2.2;
    y += hl * 0.5 * x * x * (1 - x) * 2.2;
    pts.push(r3(Math.min(1, Math.max(0, y))));
  }
  return pts;
}

// The SVG <filter> for one look (string; mounted once per look by AdjustmentDefs).
export function adjFilterSvg(adj) {
  const a = cleanAdj(adj);
  const id = adjId(a);
  if (!id) return "";
  const parts = [];
  if (a.exposure) {
    const k = r3(2 ** a.exposure);
    parts.push(`<feComponentTransfer><feFuncR type="linear" slope="${k}"/><feFuncG type="linear" slope="${k}"/><feFuncB type="linear" slope="${k}"/></feComponentTransfer>`);
  }
  if (a.contrast || a.highlights || a.shadows) {
    const t = toneTable(a).join(" ");
    parts.push(`<feComponentTransfer><feFuncR type="table" tableValues="${t}"/><feFuncG type="table" tableValues="${t}"/><feFuncB type="table" tableValues="${t}"/></feComponentTransfer>`);
  }
  if (a.temp || a.tint) {
    const t = (a.temp || 0) / 100;
    const g = (a.tint || 0) / 100;
    const R = r3(1 + 0.12 * t + 0.04 * g);
    const G = r3(1 - 0.08 * g);
    const B = r3(1 - 0.12 * t + 0.04 * g);
    parts.push(`<feColorMatrix type="matrix" values="${R} 0 0 0 0  0 ${G} 0 0 0  0 0 ${B} 0 0  0 0 0 1 0"/>`);
  }
  if (a.saturation) parts.push(`<feColorMatrix type="saturate" values="${r3(1 + a.saturation / 100)}"/>`);
  if (a.sharpness) {
    const s = r3((a.sharpness / 100) * 0.6);
    parts.push(`<feConvolveMatrix order="3" preserveAlpha="true" kernelMatrix="0 ${-s} 0 ${-s} ${r3(1 + 4 * s)} ${-s} 0 ${-s} 0"/>`);
  }
  return `<filter id="${id}" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%">${parts.join("")}</filter>`;
}

// The full CSS/canvas filter for a slot: adjustments first, then the B&W look (if any).
export function slotFilter(slot, bwCss) {
  const id = adjId(slot?.adj);
  const parts = [];
  if (id) parts.push(`url(#${id})`);
  if (bwCss && bwCss !== "none") parts.push(bwCss);
  return parts.length ? parts.join(" ") : "none";
}

// Every distinct look used in a document → one <filter> each.
export function docFilters(doc) {
  const seen = new Map();
  for (const p of doc?.pages || []) {
    for (const s of p.slots || []) {
      const id = adjId(s.adj);
      if (id && !seen.has(id)) seen.set(id, adjFilterSvg(s.adj));
    }
  }
  return [...seen.values()];
}
