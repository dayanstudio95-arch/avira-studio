// Export a design as a normal album version (album editor stage 3, 2026-10-08). Same storage
// layout, thumbnails and rows as the manual "העלאת גרסה חדשה" in AlbumOrderDetail.jsx, so the
// couple's portal, approval, purchase wizard and print link all work unchanged.
// Differences from the manual upload, on purpose:
//   - the order is pointed at the new version only after EVERY spread is in (never half an album);
//   - on any failure the half-made version is removed again (files + rows), so nothing dangling.
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { compressImageForThumb } from "./imageCompress";
import { renderSpread, bitmapCache } from "./albumRender";
import { fetchOriginal } from "./googleDrive";

const BUCKET = "album-files";
const pad = (n, w) => String(n).padStart(w, "0");

// Original of a photo: Drive for the studio's photos, our storage for the couple's uploads.
export async function loadOriginalBitmap(asset) {
  let blob;
  if (asset.source === "upload" && asset.fileKey) {
    const { data, error } = await supabase.storage.from(BUCKET).download(asset.fileKey);
    if (error) throw new Error(`הורדת התמונה ${asset.name} נכשלה`);
    blob = data;
  } else {
    blob = await fetchOriginal(asset.id);
  }
  return createImageBitmap(blob);
}

export async function exportDesignAsVersion({ design, doc, orderId, tenantId, onProgress = () => {}, isCancelled = () => false }) {
  const assetsById = Object.fromEntries(doc.assets.map((a) => [a.id, a]));
  const { data: last } = await supabase
    .from("album_versions")
    .select("version_number")
    .eq("album_order_id", orderId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const versionNumber = (last?.version_number || 0) + 1;
  const version = await base44.entities.AlbumVersion.create({ albumOrderId: orderId, versionNumber });

  const uploaded = [];
  const cache = bitmapCache(loadOriginalBitmap);
  const canvas = document.createElement("canvas");
  const total = doc.pages.length;
  try {
    for (let i = 0; i < total; i++) {
      if (isCancelled()) throw new Error("הייצוא בוטל");
      const seq = i + 1;
      onProgress({ done: i, total, step: "מוריד תמונות ובונה כפולה" });
      const blob = await renderSpread(doc.pages[i], assetsById, cache.get, { canvas });
      onProgress({ done: i, total, step: "מעלה" });
      const path = `${tenantId}/${orderId}/${version.id}/spread-${pad(seq, 2)}-design-${pad(seq, 3)}.jpg`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: true });
      if (upErr) throw new Error(`העלאת כפולה ${seq} נכשלה: ${upErr.message}`);
      uploaded.push(path);
      let thumbPath = null;
      try {
        const thumb = await compressImageForThumb(blob);
        thumbPath = `${tenantId}/${orderId}/${version.id}/thumbs/spread-${pad(seq, 2)}.jpg`;
        const { error } = await supabase.storage.from(BUCKET).upload(thumbPath, thumb, { contentType: "image/jpeg", upsert: true });
        if (error) thumbPath = null;
        else uploaded.push(thumbPath);
      } catch {
        thumbPath = null; // the order page backfills a missing thumb on first view
      }
      await base44.entities.AlbumSpread.create({ versionId: version.id, sequenceNumber: seq, fileKey: path, thumbFileKey: thumbPath, processingStatus: "ready" });
    }
    onProgress({ done: total, total, step: "מפרסם" });
    // Publish only now — the couple never sees a half-built version.
    await base44.entities.AlbumOrder.update(orderId, { currentVersionId: version.id, workflowStatus: "in_review" });
    await supabase.from("album_designs").update({ status: "exported", last_exported_version_id: version.id }).eq("id", design.id);
    await supabase.from("album_design_revisions").insert({ design_id: design.id, doc, label: "exported" });
    return { versionId: version.id, versionNumber, spreads: total };
  } catch (err) {
    // Roll the half-made version back: files, spread rows, the version row.
    try {
      if (uploaded.length) await supabase.storage.from(BUCKET).remove(uploaded);
      await supabase.from("album_spreads").delete().eq("version_id", version.id);
      await supabase.from("album_versions").delete().eq("id", version.id);
    } catch {
      /* best effort */
    }
    throw err;
  } finally {
    cache.clear();
    canvas.width = canvas.height = 0;
  }
}

// One spread at full size, downloaded to the computer — for checking quality before sending.
export async function downloadSpreadFile(page, doc, fileName) {
  const assetsById = Object.fromEntries(doc.assets.map((a) => [a.id, a]));
  const cache = bitmapCache(loadOriginalBitmap);
  try {
    const blob = await renderSpread(page, assetsById, cache.get);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return blob;
  } finally {
    cache.clear();
  }
}
