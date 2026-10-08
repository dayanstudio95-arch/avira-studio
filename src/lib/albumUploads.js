// Studio-side files for the album editor (2026-10-08):
//  - photos the studio uploads as an extra source (tab) → album-files/<tenant>/<order>/studio-uploads/
//  - enlargement files for the print shop → album-files/<tenant>/<order>/enlargements/
//    (the original photo, untouched; album-print-access lists them as a separate download).
import { supabase } from "@/api/supabaseClient";
import { fetchOriginal } from "./googleDrive";

const BUCKET = "album-files";
const safe = (n) => String(n || "photo").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);

async function dims(file) {
  try {
    const b = await createImageBitmap(file);
    const d = { w: b.width, h: b.height };
    b.close();
    return d;
  } catch {
    return { w: 0, h: 0 };
  }
}

export async function uploadStudioFiles(files, { tenantId, orderId, group, onProgress = () => {} }) {
  const assets = [];
  for (const [i, file] of files.entries()) {
    onProgress(`${i + 1}/${files.length}`);
    const path = `${tenantId}/${orderId}/studio-uploads/${Date.now()}-${i}-${safe(file.name)}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || "image/jpeg" });
    if (error) throw new Error(`${file.name}: ${error.message}`);
    const { w, h } = await dims(file);
    assets.push({ id: `su_${Math.random().toString(36).slice(2, 12)}`, name: file.name, w, h, size: file.size, source: "upload", fileKey: path, group, camera: group, time: null });
  }
  return assets;
}

async function originalBlob(asset) {
  if (asset.source === "upload" && asset.fileKey) {
    const { data, error } = await supabase.storage.from(BUCKET).download(asset.fileKey);
    if (error) throw new Error(`הורדת ${asset.name} נכשלה`);
    return data;
  }
  return fetchOriginal(asset.id);
}

// → the same list with fileKey filled in for every entry.
export async function prepareEnlargementFiles(list, assetsById, { tenantId, orderId, onProgress = () => {} }) {
  const out = [];
  for (const [i, e] of list.entries()) {
    onProgress(`${i + 1}/${list.length}`);
    const asset = assetsById[e.assetId];
    if (!asset) {
      out.push(e);
      continue;
    }
    const blob = await originalBlob(asset);
    const ext = (/\.(png)$/i.test(asset.name) ? ".png" : ".jpg");
    const path = `${tenantId}/${orderId}/enlargements/${String(i + 1).padStart(2, "0")}-${e.category || "print"}-${e.orientation}-${safe(asset.name).replace(/\.[a-z0-9]+$/i, "")}${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: blob.type || "image/jpeg" });
    if (error) throw new Error(`העלאת קובץ ההגדלה נכשלה: ${error.message}`);
    out.push({ ...e, fileKey: path });
  }
  return out;
}
