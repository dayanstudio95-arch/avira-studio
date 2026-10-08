// Full-size spread rendering (album editor stage 3, 2026-10-08). Each spread is drawn in the
// browser onto a 9449×3543 canvas (80×30 cm at 300dpi) from the ORIGINAL photos, with exactly the
// same geometry as the screen: cellRects() for the cells, computeCrop() for zoom/position, the
// same CSS filter strings for B&W, the same font sizes (percent of the spread width) for the title.
// Verified in Chrome on a real folder: decode ~0.2s, render + JPEG ~1.3s, ~11MB per spread.
// canvas ctx.filter is Chrome/Edge/Firefox only — the editor is "Chrome recommended".
import { SPREAD, getTemplate, layoutRects, textRect } from "./albumTemplates";
import { computeCrop, filterCss, titleFont, isHebrewFont, titleNames } from "./albumDesign";
import { slotFilter } from "./albumAdjust";
import { healedSource } from "./albumHeal";

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

const HEBREW_FALLBACK = "'Bellefair', serif";

async function drawTitle(ctx, rect, title, W, H) {
  const f = titleFont(title.font);
  const scale = title.scale || 1;
  const hebrewFamily = isHebrewFont(title.font) ? f.family : HEBREW_FALLBACK;
  const names = titleNames(title);
  // Same sizes as SpreadView's TitleText (cqw = 1% of the spread width); dx/dy = dragged offset.
  const lines = [];
  if (names) lines.push({ text: names, size: (1.9 * scale * W) / 100, family: f.family, weight: f.weight, spacing: 0.22, gapBefore: 0, rtl: /[\u0590-\u05FF]/.test(names) });
  if (title.date) lines.push({ text: title.date, size: (1.15 * scale * W) / 100, family: f.family, weight: f.weight, spacing: 0.12, gapBefore: (1.1 * W) / 100 });
  if (title.showHebrew && title.hebrewDate) lines.push({ text: title.hebrewDate, size: (0.95 * scale * W) / 100, family: hebrewFamily, weight: 300, spacing: 0, gapBefore: (0.45 * W) / 100, rtl: true });
  if (!lines.length) return;
  await Promise.all(lines.map((l) => document.fonts.load(`${l.weight} ${Math.round(l.size)}px ${l.family}`, l.text).catch(() => null)));
  const cx = rect.x + rect.w / 2 + ((title.dx || 0) / 100) * W;
  const cy = rect.y + rect.h / 2 + ((title.dy || 0) / 100) * H;
  const heights = lines.map((l, i) => (i ? l.gapBefore : 0) + l.size * 1.2);
  let y = cy - heights.reduce((a, b) => a + b, 0) / 2;
  ctx.save();
  ctx.fillStyle = title.color || "#3a3a3a";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((l, i) => {
    y += i ? l.gapBefore : 0;
    ctx.font = `${l.weight} ${l.size}px ${l.family}`;
    ctx.direction = l.rtl ? "rtl" : "ltr";
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${l.spacing * l.size}px`;
    ctx.fillText(l.text, cx, y + (l.size * 1.2) / 2);
    y += l.size * 1.2;
  });
  ctx.restore();
}

const loadImage = (src) =>
  new Promise((res, rej) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => res(im);
    im.onerror = () => rej(new Error("טעינת הלוגו נכשלה"));
    im.src = src;
  });

// Logo + QR + phone, same sizes/positions as SpreadView's BrandingBlock (cqw = 1% of width).
async function drawBranding(ctx, conf, data, W, H) {
  const k = conf.scale || 1;
  const px = (v) => (v * k * W) / 100;
  const logoH = px(2.2);
  const qr = px(3.2);
  const phoneSize = px(0.65);
  const gap = px(0.45);
  const items = [];
  if (data.logoUrl) {
    const im = await loadImage(data.logoUrl).catch(() => null);
    if (im) items.push({ kind: "img", im, w: (logoH * im.naturalWidth) / im.naturalHeight, h: logoH });
  }
  if (data.qrDataUrl) items.push({ kind: "img", im: await loadImage(data.qrDataUrl), w: qr, h: qr });
  if (data.phone) {
    await document.fonts.load(`400 ${Math.round(phoneSize)}px 'Bellefair'`, data.phone).catch(() => null);
    ctx.font = `400 ${phoneSize}px 'Bellefair', serif`;
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${0.08 * phoneSize}px`;
    items.push({ kind: "text", text: data.phone, w: ctx.measureText(data.phone).width, h: phoneSize * 1.2 });
  }
  if (!items.length) return;
  const blockW = Math.max(...items.map((i) => i.w));
  let x0 = ((conf.x ?? 3) / 100) * W;
  let y = ((conf.y ?? 72) / 100) * H;
  ctx.save();
  for (const it of items) {
    const x = x0 + (blockW - it.w) / 2;
    if (it.kind === "img") ctx.drawImage(it.im, x, y, it.w, it.h);
    else {
      ctx.fillStyle = "#555555";
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.direction = "ltr";
      ctx.fillText(it.text, x, y);
    }
    y += it.h + gap;
  }
  ctx.restore();
}

// Fade bands + soft ellipse, exactly as SpreadView's CSS masks.
function applyMasks(c, w, h, rect, slot) {
  c.save();
  c.globalCompositeOperation = "destination-in";
  if (rect.fadeL) {
    const g = c.createLinearGradient(0, 0, (rect.fadeL / 100) * w, 0);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,1)");
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }
  if (rect.fadeT) {
    const g = c.createLinearGradient(0, 0, 0, (rect.fadeT / 100) * h);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,1)");
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }
  if (slot.shape === "ellipse") {
    c.translate(w / 2, h / 2);
    c.scale(w / 2, h / 2);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0.86, "rgba(0,0,0,1)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g;
    c.fillRect(-1, -1, 2, 2);
  }
  c.restore();
}

// → JPEG Blob at full print size. `getBitmap(asset)` returns an ImageBitmap of the original.
export async function renderSpread(page, assetsById, getBitmap, { canvas = document.createElement("canvas"), width = SPREAD.widthPx, height = SPREAD.heightPx, quality = 0.95, branding = null } = {}) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = "high";
  const t = getTemplate(page.templateId);
  const rects = layoutRects(t, page.flip, page.blend);
  // draw order = z (left→right, top→bottom) so faded edges lie over their neighbour
  const order = rects.map((r, i) => i).sort((a, b) => rects[a].z - rects[b].z);
  for (const i of order) {
    const slot = page.slots[i];
    const asset = slot?.assetId ? assetsById[slot.assetId] : null;
    if (!asset) continue;
    const bmp = await getBitmap(asset);
    const src = healedSource(bmp, slot.heal);
    const r = pixelRect(rects[i], width, height);
    const c = computeCrop(r.w, r.h, src.width, src.height, slot);
    const filter = slotFilter(slot, filterCss(slot.filter));
    if (rects[i].fadeL || rects[i].fadeT || slot.shape === "ellipse") {
      const cell = document.createElement("canvas");
      cell.width = r.w;
      cell.height = r.h;
      const cc = cell.getContext("2d");
      cc.imageSmoothingQuality = "high";
      cc.filter = filter;
      cc.drawImage(src, c.offX, c.offY, c.drawW, c.drawH);
      cc.filter = "none";
      applyMasks(cc, r.w, r.h, rects[i], slot);
      ctx.drawImage(cell, r.x, r.y);
      cell.width = cell.height = 0;
    } else {
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      ctx.filter = filter;
      ctx.drawImage(src, r.x + c.offX, r.y + c.offY, c.drawW, c.drawH);
      ctx.restore();
    }
  }
  const tr = textRect(t, page.flip);
  if (tr && page.title) await drawTitle(ctx, pixelRect(tr, width, height), page.title, width, height);
  if (page.title && page.branding?.show && branding) await drawBranding(ctx, page.branding, branding, width, height);
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
