// Google Drive, read-only, for the album editor (2026-10-08). The couple's photos stay in the
// studio's Drive folder (shared "anyone with the link"); nothing is copied to our storage.
// Verified on a real 150-photo folder (Chrome):
//   - list: Drive API v3 files.list with a browser API key (VITE_GOOGLE_API_KEY, restricted to
//     the Drive API and to our site's address) — one call, ~0.4s.
//   - thumbnails: lh3.googleusercontent.com/d/<id>=w<size> — ONLY with referrerPolicy
//     "no-referrer"; sent with our site as referrer Google refuses the image.
//   - originals: files/<id>?alt=media&key=… (needs our referrer for the key) ~2s per 10–19MB.
import { cameraOf } from "./albumDesign";

const KEY = import.meta.env.VITE_GOOGLE_API_KEY;
const API = "https://www.googleapis.com/drive/v3/files";

export const hasDriveKey = () => Boolean(KEY);

// Accepts a folder link (…/folders/<id>?usp=sharing, ?id=<id>) or a bare id.
export function parseFolderId(input) {
  const s = String(input || "").trim();
  const m = s.match(/\/folders\/([A-Za-z0-9_-]{10,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{10,}$/.test(s) ? s : null;
}

const SUPPORTED = new Set(["image/jpeg", "image/png"]);

// → { assets, skipped: [{ name, reason }] }. Throws an Error with a Hebrew message.
export async function listFolderImages(folderId) {
  if (!KEY) throw new Error("חסר מפתח Google במערכת (VITE_GOOGLE_API_KEY)");
  const fields = "nextPageToken,files(id,name,mimeType,size,imageMediaMetadata(width,height,rotation,time))";
  const files = [];
  let pageToken = "";
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const url = `${API}?q=${q}&pageSize=1000&fields=${encodeURIComponent(fields)}&key=${KEY}${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const res = await fetch(url);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = body?.error?.message || "";
      if (res.status === 404 || /not found/i.test(msg)) throw new Error("התיקייה לא נמצאה — צריך לשתף אותה ב\"כל מי שיש לו את הקישור\"");
      if (res.status === 403) throw new Error("גוגל לא מאשר גישה לתיקייה (שיתוף או מפתח)");
      throw new Error(`שגיאה מגוגל דרייב (${res.status})`);
    }
    files.push(...(body.files || []));
    pageToken = body.nextPageToken || "";
  } while (pageToken);

  const assets = [];
  const skipped = [];
  for (const f of files) {
    if (f.mimeType === "application/vnd.google-apps.folder") continue;
    if (!SUPPORTED.has(f.mimeType)) {
      skipped.push({ name: f.name, reason: /heic|heif/i.test(f.mimeType + f.name) ? "HEIC — צריך לייצא כ-JPG" : "לא JPG/PNG" });
      continue;
    }
    const meta = f.imageMediaMetadata || {};
    const turned = meta.rotation === 1 || meta.rotation === 3;
    assets.push({
      id: f.id,
      name: f.name,
      w: turned ? meta.height : meta.width,
      h: turned ? meta.width : meta.height,
      time: meta.time || null,
      size: Number(f.size) || 0,
      camera: cameraOf(f.name),
    });
  }
  if (!assets.length && !skipped.length) throw new Error("התיקייה ריקה");
  return { assets, skipped };
}

export const thumbUrl = (id, width = 400) => `https://lh3.googleusercontent.com/d/${id}=w${width}`;

export async function fetchOriginal(id) {
  const res = await fetch(`${API}/${id}?alt=media&key=${KEY}`);
  if (!res.ok) throw new Error(`הורדת התמונה המקורית נכשלה (${res.status})`);
  return res.blob();
}
