// Where a photo's picture comes from, and the couple-upload quality check (album editor stage 4).
// Studio photos live in Google Drive (lh3 thumbnails, see googleDrive.js); photos the couple
// uploads live in our private album-files bucket and are shown through short-lived signed URLs
// (`asset.url`, filled in by whoever loaded them — never stored in the design document).
import { thumbUrl } from "./googleDrive";

export const assetSrc = (asset, width = 400) =>
  !asset ? "" : asset.source === "upload" ? asset.url || "" : thumbUrl(asset.id, width);

// Phone screen widths (px) — a PNG at one of these, phone-shaped, is almost surely a screenshot.
const SCREEN_WIDTHS = new Set([640, 720, 750, 828, 1080, 1125, 1170, 1179, 1242, 1284, 1290, 1440]);

// The couple's own photo, before upload. Warnings, not blocks (the decision of 2026-10-08):
// the couple sees why it may print badly and can still choose to upload.
export function uploadQualityWarnings({ name = "", type = "", size = 0, width = 0, height = 0 }) {
  const warnings = [];
  const longSide = Math.max(width, height);
  const shortSide = Math.min(width, height);
  const ratio = shortSide ? longSide / shortSide : 0;
  if (!/^image\/(jpeg|png)$/.test(type) && !/\.(jpe?g|png)$/i.test(name)) warnings.push({ code: "type", text: "רק JPG או PNG" });
  if (longSide && longSide < 2500) warnings.push({ code: "small", text: `התמונה קטנה (${width}×${height}) — עלולה לצאת מטושטשת בהדפסה` });
  if ((type === "image/png" || /\.png$/i.test(name)) && SCREEN_WIDTHS.has(shortSide) && ratio > 1.7) {
    warnings.push({ code: "screenshot", text: "נראה כמו צילום מסך — עדיף את הקובץ המקורי" });
  }
  if (size && size < 1_000_000) warnings.push({ code: "compressed", text: "קובץ קטן מאוד — אולי נשלח בוואטסאפ ונדחס. עדיף את המקור" });
  return warnings;
}
