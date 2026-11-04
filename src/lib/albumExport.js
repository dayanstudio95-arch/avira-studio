// Export a design as a normal album version (album editor stage 3, 2026-10-08). Same storage
// layout, thumbnails and rows as the manual "העלאת גרסה חדשה" in AlbumOrderDetail.jsx, so the
// couple's portal, approval, purchase wizard and print link all work unchanged.
// Differences from the manual upload, on purpose:
//   - the order is pointed at the new version only after EVERY spread is in (never half an album);
//   - a half-made version is removed again (files + rows) when the export is given up, so nothing dangling.
// Stopping is not giving up (2026-11-05, the owner hit "Failed to fetch" on a real 30-spread album): every network
// step is retried (netRetry.js), and an export that still stops keeps the spreads it made — "להמשיך" goes on from the
// spread it stopped at (continueExport with the same job); only closing the window or "ביטול" removes it (discardExport).
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { compressImageForThumb } from "./imageCompress";
import { renderSpread, bitmapCache } from "./albumRender";
import { fetchDriveImage } from "./googleDrive";
import { withRetry, reasonText } from "./netRetry";

const BUCKET = "album-files";
const pad = (n, w) => String(n).padStart(w, "0");

// Storage / PostgREST hand errors back instead of throwing — throw them so withRetry sees them.
const must = async (p) => {
  const { data, error } = await p;
  if (error) throw error;
  return data;
};

// Original of a photo: Drive for the studio's photos, our storage for the couple's uploads.
// `retry` = withRetry options (isCancelled, onRetry).
// A Drive photo that came from Google's image server (the API refused, googleDrive.js) must be the full size —
// a smaller one would print soft, so it counts as a failed try.
export async function loadOriginalBitmap(asset, retry = {}) {
  try {
    return await withRetry(async () => {
      if (asset.source === "upload" && asset.fileKey) return createImageBitmap(await must(supabase.storage.from(BUCKET).download(asset.fileKey)));
      const { blob, via } = await fetchDriveImage(asset.id);
      const bmp = await createImageBitmap(blob);
      if (via === "image" && asset.w && asset.h && Math.max(bmp.width, bmp.height) < Math.max(asset.w, asset.h)) {
        bmp.close();
        throw Object.assign(new Error(`התמונה הגיעה קטנה מהמקור (${bmp.width}×${bmp.height})`), { transient: true, hebrew: true });
      }
      return bmp;
    }, retry);
  } catch (e) {
    const drive = asset.source !== "upload";
    throw new Error(`הורדת התמונה ${asset.name}${drive ? " מהדרייב" : ""} נכשלה — ${reasonText(e, { drive })}`);
  }
}

// A new, empty version of the order. A retry after a lost answer finds the row the first try made (same number).
async function createVersion(orderId, retry) {
  const { data: last } = await supabase
    .from("album_versions")
    .select("version_number")
    .eq("album_order_id", orderId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const versionNumber = (last?.version_number || 0) + 1;
  const version = await withRetry(async () => {
    try {
      return await base44.entities.AlbumVersion.create({ albumOrderId: orderId, versionNumber });
    } catch (e) {
      if (e?.code !== "23505") throw e;
      const mine = await must(supabase.from("album_versions").select("id, created_at").eq("album_order_id", orderId).eq("version_number", versionNumber).maybeSingle());
      if (!mine || Date.now() - new Date(mine.created_at).getTime() > 5 * 60 * 1000) throw e;
      return mine;
    }
  }, retry);
  return { versionId: version.id, versionNumber };
}

// → job: everything a later "להמשיך" needs. The doc is a snapshot — what was on screen when the export started.
export async function startExport({ doc, orderId, isCancelled = () => false, onRetry = () => {} }) {
  const { versionId, versionNumber } = await createVersion(orderId, { isCancelled, onRetry });
  return { doc, orderId, versionId, versionNumber, done: 0, uploaded: [], published: false };
}

// Builds and uploads the spreads from job.done on, then publishes. Progress lives on the job, so after a throw the
// same job goes on from the spread that stopped.
export async function continueExport(job, { design, tenantId, branding = null, onProgress = () => {}, isCancelled = () => false, onRetry = () => {} }) {
  const { doc, orderId, versionId } = job;
  const retry = { isCancelled, onRetry };
  const assetsById = Object.fromEntries(doc.assets.map((a) => [a.id, a]));
  const cache = bitmapCache((a) => loadOriginalBitmap(a, retry));
  const canvas = document.createElement("canvas");
  const total = doc.pages.length;
  try {
    for (let i = job.done; i < total; i++) {
      if (isCancelled() || job.discarded) throw Object.assign(new Error("הייצוא בוטל"), { cancelled: true });
      const seq = i + 1;
      onProgress({ done: i, total, step: "מוריד תמונות ובונה כפולה" });
      const blob = await renderSpread(doc.pages[i], assetsById, cache.get, { canvas, branding });
      onProgress({ done: i, total, step: "מעלה" });
      const path = `${tenantId}/${orderId}/${versionId}/spread-${pad(seq, 2)}-design-${pad(seq, 3)}.jpg`;
      try {
        await withRetry(() => must(supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: true })), retry);
      } catch (e) {
        throw new Error(`העלאת כפולה ${seq} נכשלה — ${reasonText(e)}`);
      }
      if (!job.uploaded.includes(path)) job.uploaded.push(path);
      let thumbPath = null;
      try {
        const thumb = await compressImageForThumb(blob);
        thumbPath = `${tenantId}/${orderId}/${versionId}/thumbs/spread-${pad(seq, 2)}.jpg`;
        await withRetry(() => must(supabase.storage.from(BUCKET).upload(thumbPath, thumb, { contentType: "image/jpeg", upsert: true })), retry);
        if (!job.uploaded.includes(thumbPath)) job.uploaded.push(thumbPath);
      } catch {
        thumbPath = null; // the order page backfills a missing thumb on first view
      }
      try {
        await withRetry(async () => {
          try {
            await base44.entities.AlbumSpread.create({ versionId, sequenceNumber: seq, fileKey: path, thumbFileKey: thumbPath, processingStatus: "ready" });
          } catch (e) {
            if (e?.code !== "23505") throw e; // the row is already there (an earlier try whose answer was lost)
          }
        }, retry);
      } catch (e) {
        throw new Error(`שמירת כפולה ${seq} נכשלה — ${reasonText(e)}`);
      }
      job.done = seq;
    }
    onProgress({ done: total, total, step: "מפרסם" });
    // Publish only now — the couple never sees a half-built version.
    try {
      await withRetry(() => base44.entities.AlbumOrder.update(orderId, { currentVersionId: versionId, workflowStatus: "in_review" }), retry);
    } catch (e) {
      throw new Error(`פרסום הגרסה נכשל — ${reasonText(e)}`);
    }
    job.published = true;
    // Bookkeeping after the publish: a failure here must not take the published version back.
    await withRetry(() => must(supabase.from("album_designs").update({ status: "exported", last_exported_version_id: versionId }).eq("id", design.id))).catch(() => {});
    await withRetry(() => must(supabase.from("album_design_revisions").insert({ design_id: design.id, doc, label: "exported" }))).catch(() => {});
    return { versionId, versionNumber: job.versionNumber, spreads: total };
  } finally {
    cache.clear();
    canvas.width = canvas.height = 0;
  }
}

// Given up: the half-made version goes — files, spread rows, the version row. Never a published one.
export async function discardExport(job) {
  if (!job || job.published || job.discarded) return;
  job.discarded = true; // a run still going stops at the next spread instead of writing into the deleted version
  try {
    if (job.uploaded.length) await supabase.storage.from(BUCKET).remove(job.uploaded);
    await supabase.from("album_spreads").delete().eq("version_id", job.versionId);
    await supabase.from("album_versions").delete().eq("id", job.versionId);
  } catch {
    /* best effort */
  }
}

// One spread at full size, downloaded to the computer — for checking quality before sending.
export async function downloadSpreadFile(page, doc, fileName, branding = null) {
  const assetsById = Object.fromEntries(doc.assets.map((a) => [a.id, a]));
  const cache = bitmapCache((a) => loadOriginalBitmap(a));
  try {
    const blob = await renderSpread(page, assetsById, cache.get, { branding });
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
