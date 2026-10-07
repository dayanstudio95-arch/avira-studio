// Full-size spread rendering (album editor stage 3, 2026-10-08). Each spread is drawn in the
// browser onto a 9449×3543 canvas (80×30 cm at 300dpi) from the ORIGINAL photos, with exactly the
// same geometry as the screen: cellRects() for the cells, computeCrop() for zoom/position, the
// same CSS filter strings for B&W, the same font sizes (percent of the spread width) for the title.
// Verified in Chrome on a real folder: decode ~0.2s, render + JPEG ~1.3s, ~11MB per spread.
// canvas ctx.filter is Chrome/Edge/Firefox only — the editor is "Chrome recommended".
import { SPREAD, getTemplate, cellRects, textRect } from "./albumTemplates";
import { computeCrop, filterCss, titleFont } from "./albumDesign";

// Canvas JPEGs come out as "1 dot per 1 dot" (no DPI). Print shops read the JFIF density, so
// stamp 300×300 dpi into the header (bytes 13–17 of the APP0 segment). Pure — unit-tested.
export function setJpegDpi(bytes, dpi = 300) {
  const b = new Uint8Array(bytes);
  const isJfif = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && b[3] === 0xe0 && b[6] === 0x4a && b[7] === 0x46 && b[8] === 0x49 && b[9] === 0x46;
  if (!isJfif) return b;
  b[13] = 1; // units: dots per inch
  b[14] = dpi >> 8;
  b[15] = dpi & 0xff;
  b[16] = dpi >> 8;
  b[17] = dpi & 0xff;
  return b;
}

// Percent rect → whole pixels, so neighbouring cells meet the gutter exactly.
export function pixelRect(r, W, H) {
  const x = Math.round((r.x / 100) * W);
  const y = Math.round((r.y / 100) * H);
  return { x, y, w: Math.round(((r.x + r.w) / 100) * W) - x, h: Math.round(((r.y + r.h) / 100) * H) - y };
}

const HEBREW_FALLBACK = "'Heebo', sans-serif";

async function drawTitle(ctx, rect, title, W) {
  const f = titleFont(title.font);
  const scale = title.scale || 1;
  const hebrewFamily = /heebo|frank|assistant/.test(title.font) ? f.family : HEBREW_FALLBACK;
  // Same sizes as SpreadView's TitleText (cqw = 1% of the spread width).
  const lines = [];
  if (title.names) lines.push({ text: title.names, size: (1.9 * scale * W) / 100, family: f.family, weight: f.weight, spacing: 0.22, gapBefore: 0 });
  if (title.date) lines.push({ text: title.date, size: (1.15 * scale * W) / 100, family: f.family, weight: f.weight, spacing: 0.12, gapBefore: (1.1 * W) / 100 });
  if (title.showHebrew && title.hebrewDate) lines.push({ text: title.hebrewDate, size: (0.95 * scale * W) / 100, family: hebrewFamily, weight: 300, spacing: 0, gapBefore: (0.45 * W) / 100, rtl: true });
  if (!lines.length) return;
  await Promise.all(lines.map((l) => document.fonts.load(`${l.weight} ${Math.round(l.size)}px ${l.family}`, l.text).catch(() => null)));
  const heights = lines.map((l, i) => (i ? l.gapBefore : 0) + l.size * 1.2);
  let y = rect.y + rect.h / 2 - heights.reduce((a, b) => a + b, 0) / 2;
  ctx.save();
  ctx.fillStyle = title.color || "#3a3a3a";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((l, i) => {
    y += i ? l.gapBefore : 0;
    ctx.font = `${l.weight} ${l.size}px ${l.family}`;
    ctx.direction = l.rtl ? "rtl" : "ltr";
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${l.spacing * l.size}px`;
    ctx.fillText(l.text, rect.x + rect.w / 2, y + (l.size * 1.2) / 2);
    y += l.size * 1.2;
  });
  ctx.restore();
}

// → JPEG Blob at full print size. `getBitmap(asset)` returns an ImageBitmap of the original.
export async function renderSpread(page, assetsById, getBitmap, { canvas = document.createElement("canvas"), width = SPREAD.widthPx, height = SPREAD.heightPx, quality = 0.95 } = {}) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = "high";
  const t = getTemplate(page.templateId);
  const rects = cellRects(t, page.flip);
  for (let i = 0; i < rects.length; i++) {
    const slot = page.slots[i];
    const asset = slot?.assetId ? assetsById[slot.assetId] : null;
    if (!asset) continue;
    const bmp = await getBitmap(asset);
    const r = pixelRect(rects[i], width, height);
    const c = computeCrop(r.w, r.h, bmp.width, bmp.height, slot);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.filter = filterCss(slot.filter);
    ctx.drawImage(bmp, r.x + c.offX, r.y + c.offY, c.drawW, c.drawH);
    ctx.restore();
  }
  const tr = textRect(t, page.flip);
  if (tr && page.title) await drawTitle(ctx, pixelRect(tr, width, height), page.title, width);
  const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("יצירת התמונה נכשלה (הדפדפן)"))), "image/jpeg", quality));
  return new Blob([setJpegDpi(await blob.arrayBuffer())], { type: "image/jpeg" });
}

// Small LRU of decoded originals — a photo used on two spreads is downloaded once, and memory
// stays bounded (a 24MP bitmap is ~100MB).
export function bitmapCache(load, max = 6) {
  const m = new Map();
  return {
    async get(asset) {
      if (m.has(asset.id)) {
        const v = m.get(asset.id);
        m.delete(asset.id);
        m.set(asset.id, v);
        return v;
      }
      const bmp = await load(asset);
      m.set(asset.id, bmp);
      while (m.size > max) {
        const [k, v] = m.entries().next().value;
        v.close?.();
        m.delete(k);
      }
      return bmp;
    },
    clear() {
      for (const v of m.values()) v.close?.();
      m.clear();
    },
  };
}
