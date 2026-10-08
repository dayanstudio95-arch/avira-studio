// "פנים בקפל" (album editor, 2026-10-08): warn when a person's face lands on the album's fold
// (the middle of the spread). Google's MediaPipe face detector, run in the browser (free, nothing
// leaves the computer), loaded from the CDN only the first time it's needed.
// Only the vertical band of the photo around the fold is checked, enlarged — wedding photos often
// have people at a distance, and the small model finds faces much better when they're bigger.
import { getTemplate, layoutRects } from "./albumTemplates";
import { computeCrop } from "./albumDesign";
import { assetSrc } from "./albumAssets";

const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

let detectorP = null;
function detector() {
  if (!detectorP) {
    detectorP = (async () => {
      const vision = await import(/* @vite-ignore */ `${MP}/vision_bundle.mjs`);
      const files = await vision.FilesetResolver.forVisionTasks(`${MP}/wasm`);
      return vision.FaceDetector.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL }, runningMode: "IMAGE", minDetectionConfidence: 0.45 });
    })().catch((e) => {
      detectorP = null;
      throw e;
    });
  }
  return detectorP;
}

const bitmaps = new Map();
const loadBitmap = (url) => {
  if (!bitmaps.has(url)) {
    bitmaps.set(url, fetch(url, { referrerPolicy: "no-referrer" }).then((r) => r.blob()).then((b) => createImageBitmap(b)));
  }
  return bitmaps.get(url);
};

const results = new Map(); // `${assetId}:${band}` → faces [{x0,x1,y0,y1}] in 0..1 of the photo

// Faces inside a vertical band of the photo (0..1 of its width), in photo coordinates.
async function facesInBand(asset, bandX0, bandX1) {
  const key = `${asset.id}:${bandX0.toFixed(2)}:${bandX1.toFixed(2)}`;
  if (results.has(key)) return results.get(key);
  const [det, bmp] = await Promise.all([detector(), loadBitmap(assetSrc(asset, 1400))]);
  const sx = Math.max(0, Math.floor(bandX0 * bmp.width));
  const sw = Math.max(1, Math.ceil((bandX1 - bandX0) * bmp.width));
  const scale = Math.min(3, 900 / Math.max(sw, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(sw * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d").drawImage(bmp, sx, 0, sw, bmp.height, 0, 0, c.width, c.height);
  const out = (det.detect(c).detections || []).map((d) => {
    const b = d.boundingBox;
    return {
      x0: (sx + b.originX / scale) / bmp.width,
      x1: (sx + (b.originX + b.width) / scale) / bmp.width,
      y0: b.originY / scale / bmp.height,
      y1: (b.originY + b.height) / scale / bmp.height,
    };
  });
  results.set(key, out);
  return out;
}

// → { [slotIndex]: true } for every photo on this spread with a face on the fold.
export async function foldFaceWarnings(page, assetsById) {
  const t = getTemplate(page.templateId);
  const rects = layoutRects(t, page.flip, page.blend);
  const warn = {};
  await Promise.all(
    rects.map(async (r, i) => {
      if (!(r.x < 49.5 && r.x + r.w > 50.5)) return; // doesn't cross the fold
      const slot = page.slots[i];
      const asset = slot?.assetId ? assetsById[slot.assetId] : null;
      if (!asset?.w) return;
      const cw = r.w * 80;
      const ch = r.h * 30;
      const c = computeCrop(cw, ch, asset.w, asset.h, slot);
      const foldInCell = ((50 - r.x) / r.w) * cw;
      const ix = (foldInCell - c.offX) / c.drawW; // fold position in the photo, 0..1
      if (ix <= 0 || ix >= 1) return;
      const visTop = -c.offY / c.drawH;
      const visBottom = (ch - c.offY) / c.drawH;
      const faces = await facesInBand(asset, Math.max(0, ix - 0.14), Math.min(1, ix + 0.14)).catch(() => []);
      // a face counts when the fold passes through its inner part and it's in the visible crop
      if (faces.some((f) => {
        const m = (f.x1 - f.x0) * 0.15;
        return ix > f.x0 + m && ix < f.x1 - m && f.y1 > visTop && f.y0 < visBottom;
      })) warn[i] = true;
    })
  );
  return warn;
}
