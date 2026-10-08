// "מברשת תיקון" — basic clone/heal brush (album editor, 2026-10-08). Each stroke copies a soft
// round patch from a source point onto the target point (Photoshop's clone stamp): good on simple
// backgrounds (wall, grass, sky). Stored on the slot as image-relative numbers
// (slot.heal = [{ x, y, sx, sy, r }], 0..1 of the photo), so the same strokes apply to the screen
// thumbnail and to the full-size original at export.

// `ctx` already holds the photo drawn at (0,0,w,h); patches are applied in order.
export function applyHealPatches(ctx, w, h, patches = []) {
  for (const p of patches) {
    const r = Math.max(2, p.r * w);
    const size = Math.ceil(r * 2);
    const tmp = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(size, size) : Object.assign(document.createElement("canvas"), { width: size, height: size });
    const t = tmp.getContext("2d");
    t.drawImage(ctx.canvas, p.sx * w - r, p.sy * h - r, size, size, 0, 0, size, size);
    // feathered edge so the patch melts in
    const g = t.createRadialGradient(r, r, r * 0.45, r, r, r);
    g.addColorStop(0, "rgba(0,0,0,1)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    t.globalCompositeOperation = "destination-in";
    t.fillStyle = g;
    t.fillRect(0, 0, size, size);
    ctx.drawImage(tmp, p.x * w - r, p.y * h - r);
  }
}

// A canvas with the photo + its heal strokes (for export: from the full-size original).
export function healedSource(bmp, patches) {
  if (!patches?.length) return bmp;
  const w = bmp.width;
  const h = bmp.height;
  const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = c.getContext("2d");
  ctx.drawImage(bmp, 0, 0);
  applyHealPatches(ctx, w, h, patches);
  return c;
}
