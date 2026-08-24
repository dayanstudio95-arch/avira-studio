import React, { useState, useRef, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { createPageUrl } from "@/utils";
import { generateRawToken, hashToken } from "@/lib/albumTokens";
import { getCachedPortalTokenRaw, saveCachedPortalToken, clearCachedPortalToken } from "@/lib/albumPortalTokenCache";
import { compressImageForThumb } from "@/lib/imageCompress";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  ArrowRight, Upload, Copy, Link2, Ban, RefreshCw, ImageIcon, CheckCircle2,
  CreditCard, Printer, Loader2, ChevronDown, ChevronUp, AlertTriangle, ExternalLink,
  Package, Gift, Download, Eye, Trash2, Truck, PackageCheck,
} from "lucide-react";
import { WORKFLOW_STATUS_LABELS, WORKFLOW_STATUS_COLORS, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_COLORS, getOrderNameColorClass } from "./AlbumOrders";

// Wedding Albums module -- single order's full lifecycle control: upload sketch
// versions, generate/revoke the couple's portal link, view review-round history,
// confirm manual bank-transfer payment, and generate print-shop access links. See
// CLAUDE.md's "Wedding Albums module" section. All Storage access here goes directly
// through the RLS-scoped Supabase client (album-files bucket policies already gate
// select/insert/update/delete to owner/admin/studio_manager/album_manager) -- no
// dedicated Edge Function needed for any of these admin actions.

const BUCKET = "album-files";

const ENGRAVING_TYPE_LABELS = { colored: "צבעונית", blind: "שקופה (ללא צבע)" };
const ENGRAVING_SCOPE_LABELS = { main_only: "אלבום ראשי בלבד", full_set: "כל הסט" };

// Manual admin-driven production/delivery status progression -- see
// updateWorkflowStatusMutation's comment for why this exists (these workflow_status
// values were previously unreachable dead code, no UI ever set them).
const PRODUCTION_STATUS_STEPS = [
  { value: "in_print", label: "נשלח להדפסה", icon: Printer },
  { value: "delivered", label: "נמסר ללקוח", icon: Truck },
  { value: "completed", label: "הושלם", icon: PackageCheck },
];

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

// Runs `fn` over `items` with at most `limit` calls in flight at once. Firing all
// 30-40 spreads' signed-URL (transform) requests at once in a single Promise.all
// can overwhelm/rate-limit Supabase's image-render pipeline (observed as bulk
// network failures on the whole grid) -- a small concurrency cap is much gentler.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await fn(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export default function AlbumOrderDetail() {
  const { orderId } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [failedUploads, setFailedUploads] = useState([]); // [{file, sequenceNumber, versionId, fileName, errorMessage}] -- files that failed this batch, kept in memory so "נסה שוב" can retry the exact same File objects without re-selecting
  const [retryingUploads, setRetryingUploads] = useState(false);
  const [expandedVersionId, setExpandedVersionId] = useState(null);
  const [versionPreviews, setVersionPreviews] = useState({}); // versionId -> [{id, sequenceNumber, fileKey, thumbUrl}] -- full-res is fetched lazily on demand (handleOpenFullRes), never eagerly for the whole grid
  const [backfillProgress, setBackfillProgress] = useState({}); // versionId -> {current, total} -- only set while legacy spreads (no thumb_file_key yet) are being backfilled in toggleExpandVersion; absent once done
  const [showOnlyFlagged, setShowOnlyFlagged] = useState({}); // versionId -> bool
  const [newPortalToken, setNewPortalToken] = useState(null); // raw token, shown once
  const [newPrintToken, setNewPrintToken] = useState(null);
  const replaceFileInputRef = useRef(null);
  const [replaceTarget, setReplaceTarget] = useState(null); // {spreadId, versionId, sequenceNumber, oldFileKey}
  const [replacingSpreadId, setReplacingSpreadId] = useState(null);
  const [sendingMessageType, setSendingMessageType] = useState(null);

  const invalidateOrder = () => queryClient.invalidateQueries({ queryKey: ["albumOrder", orderId] });

  const { data: order, isLoading: orderLoading } = useQuery({
    queryKey: ["albumOrder", orderId],
    queryFn: () => base44.entities.AlbumOrder.get(orderId),
  });

  const { data: event } = useQuery({
    queryKey: ["albumOrderEvent", order?.eventId],
    queryFn: () => base44.entities.Event.get(order.eventId),
    enabled: !!order?.eventId,
  });

  const { data: versions = [] } = useQuery({
    queryKey: ["albumVersions", orderId],
    queryFn: () => base44.entities.AlbumVersion.filter({ albumOrderId: orderId }, "-versionNumber"),
  });

  const { data: spreadCounts = {} } = useQuery({
    queryKey: ["albumSpreadCounts", orderId, versions.map((v) => v.id).join(",")],
    queryFn: async () => {
      const counts = {};
      for (const v of versions) {
        const spreads = await base44.entities.AlbumSpread.filter({ versionId: v.id }, "sequenceNumber");
        counts[v.id] = spreads;
      }
      return counts;
    },
    enabled: versions.length > 0,
  });

  const { data: reviewRounds = [] } = useQuery({
    queryKey: ["albumReviewRounds", orderId],
    queryFn: () => base44.entities.AlbumReviewRound.filter({ albumOrderId: orderId }, "-roundNumber"),
  });

  const { data: decisionsByRound = {} } = useQuery({
    queryKey: ["albumSpreadDecisions", orderId, reviewRounds.map((r) => r.id).join(",")],
    queryFn: async () => {
      const map = {};
      for (const round of reviewRounds) {
        map[round.id] = await base44.entities.AlbumSpreadDecision.filter({ reviewRoundId: round.id });
      }
      return map;
    },
    enabled: reviewRounds.length > 0,
  });

  const { data: printLinks = [] } = useQuery({
    queryKey: ["printAccessLinks", orderId],
    queryFn: () => base44.entities.PrintAccessLink.filter({ albumOrderId: orderId }, "-createdDate"),
  });

  const { data: selections = [] } = useQuery({
    queryKey: ["albumOrderSelections", orderId],
    queryFn: () => base44.entities.AlbumOrderSelection.filter({ albumOrderId: orderId }),
  });
  const selection = selections[0] || null;

  const { data: orderAddons = [] } = useQuery({
    queryKey: ["albumOrderAddons", orderId],
    queryFn: () => base44.entities.AlbumOrderAddon.filter({ albumOrderId: orderId }),
  });

  const displayName = order?.eventId ? event?.coupleNames : order?.coupleNamesManual;
  const displayDate = order?.eventId ? event?.date : order?.weddingDateManual;
  const displayPhone = order?.eventId ? event?.phoneNumber : order?.phoneManual;

  // --- Sketch version upload ---------------------------------------------------
  const handleUploadClick = () => fileInputRef.current?.click();

  // Small preview file's path is independent of the original's filename -- always
  // predictable from versionId+sequenceNumber, so re-uploads/replacements just
  // overwrite the same thumb slot (upsert:true) instead of accumulating orphans.
  const thumbPathFor = (versionId, sequenceNumber) =>
    `${user.tenant_id}/${orderId}/${versionId}/thumbs/spread-${String(sequenceNumber).padStart(2, "0")}.jpg`;

  // Compresses + uploads the small preview file for one spread. Never throws --
  // a thumb failure must not block the (much more important) original upload；on
  // failure this just leaves thumb_file_key null, and the grid backfills it lazily
  // later (see toggleExpandVersion).
  const uploadThumbForSpread = async (file, versionId, sequenceNumber) => {
    try {
      const thumbBlob = await compressImageForThumb(file);
      const thumbPath = thumbPathFor(versionId, sequenceNumber);
      const { error } = await supabase.storage.from(BUCKET).upload(thumbPath, thumbBlob, {
        upsert: true,
        contentType: "image/jpeg",
      });
      if (error) throw error;
      return thumbPath;
    } catch (err) {
      console.error("[AlbumOrderDetail] thumb generation/upload failed:", err);
      return null;
    }
  };

  // Uploads a single spread's file + registers its DB row. Throws on failure so
  // callers (handleFilesSelected / retryFailedUploads) can isolate one file's
  // failure from the rest of the batch instead of aborting everything. upsert
  // defaults to false for a brand-new upload (never silently overwrite), but is
  // passed true on retry so re-attempting the same sequenceNumber/path is safe.
  const uploadOneSpread = async (file, sequenceNumber, versionId, { upsert = false } = {}) => {
    const path = `${user.tenant_id}/${orderId}/${versionId}/spread-${String(sequenceNumber).padStart(2, "0")}-${sanitizeFileName(file.name)}`;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { upsert });
    if (uploadError) throw uploadError;
    const thumbFileKey = await uploadThumbForSpread(file, versionId, sequenceNumber);
    await base44.entities.AlbumSpread.create({
      versionId,
      sequenceNumber,
      fileKey: path,
      thumbFileKey,
      processingStatus: "ready",
    });
  };

  const handleFilesSelected = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;
    setIsUploading(true);
    setFailedUploads([]);
    const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
    setUploadProgress({ current: 0, total: sorted.length });
    try {
      const nextVersionNumber = (versions[0]?.versionNumber || 0) + 1;
      const newVersion = await base44.entities.AlbumVersion.create({
        albumOrderId: orderId,
        versionNumber: nextVersionNumber,
      });

      // Each file is uploaded in its own try/catch -- a single failed file (bad
      // network blip, storage error, etc.) no longer aborts every remaining file
      // in the batch. Failures are collected so the studio can see exactly which
      // pages are missing and retry just those, instead of losing files silently.
      const failures = [];
      let successCount = 0;
      for (let i = 0; i < sorted.length; i++) {
        const file = sorted[i];
        const sequenceNumber = i + 1;
        try {
          await uploadOneSpread(file, sequenceNumber, newVersion.id);
          successCount++;
        } catch (fileErr) {
          failures.push({
            file,
            sequenceNumber,
            versionId: newVersion.id,
            fileName: file.name,
            errorMessage: fileErr?.message || "שגיאה לא ידועה",
          });
        }
        setUploadProgress({ current: i + 1, total: sorted.length });
      }

      // Only point the order at the new version if at least one spread actually
      // made it in -- never leave the order referencing an empty version.
      if (successCount > 0) {
        await base44.entities.AlbumOrder.update(orderId, {
          currentVersionId: newVersion.id,
          workflowStatus: "in_review",
        });
      }

      queryClient.invalidateQueries({ queryKey: ["albumVersions", orderId] });
      queryClient.invalidateQueries({ queryKey: ["albumSpreadCounts", orderId] });
      invalidateOrder();

      if (failures.length === 0) {
        toast.success(`גרסה ${nextVersionNumber} הועלתה בהצלחה (${sorted.length} כפולות)`);
      } else if (successCount > 0) {
        toast.error(`הועלו ${successCount} מתוך ${sorted.length} כפולות. ${failures.length} נכשלו -- ראו פירוט למטה ולחצו "נסה שוב"`);
        setFailedUploads(failures);
      } else {
        toast.error(`ההעלאה נכשלה לחלוטין (0 מתוך ${sorted.length} כפולות) -- ראו פירוט למטה`);
        setFailedUploads(failures);
      }
    } catch (err) {
      toast.error(err.message || "שגיאה בהעלאת הסקיצה");
    } finally {
      setIsUploading(false);
      setUploadProgress({ current: 0, total: 0 });
    }
  };

  // Re-attempts exactly the files that failed in the last batch (same in-memory
  // File objects, same version/sequence numbers), with upsert:true so retrying a
  // partially-created path is safe. Only the still-failing subset remains in
  // failedUploads afterward.
  const retryFailedUploads = async () => {
    if (failedUploads.length === 0) return;
    setRetryingUploads(true);
    setUploadProgress({ current: 0, total: failedUploads.length });
    const stillFailing = [];
    let recoveredCount = 0;
    const versionId = failedUploads[0]?.versionId;
    for (let i = 0; i < failedUploads.length; i++) {
      const item = failedUploads[i];
      try {
        await uploadOneSpread(item.file, item.sequenceNumber, item.versionId, { upsert: true });
        recoveredCount++;
      } catch (err) {
        stillFailing.push({ ...item, errorMessage: err?.message || "שגיאה לא ידועה" });
      }
      setUploadProgress({ current: i + 1, total: failedUploads.length });
    }
    setFailedUploads(stillFailing);
    setRetryingUploads(false);
    setUploadProgress({ current: 0, total: 0 });

    if (recoveredCount > 0 && versionId) {
      // If this version had zero successful spreads until now, make sure the
      // order actually points at it -- mirrors the same guard in handleFilesSelected.
      if (order?.currentVersionId !== versionId) {
        try {
          await base44.entities.AlbumOrder.update(orderId, {
            currentVersionId: versionId,
            workflowStatus: "in_review",
          });
        } catch {
          // best-effort -- don't block reporting the retry result on this
        }
      }
      queryClient.invalidateQueries({ queryKey: ["albumVersions", orderId] });
      queryClient.invalidateQueries({ queryKey: ["albumSpreadCounts", orderId] });
      invalidateOrder();
    }

    if (stillFailing.length === 0) {
      toast.success(`כל הכפולות שנכשלו הועלו בהצלחה (${recoveredCount})`);
    } else {
      toast.error(`הועלו ${recoveredCount} מתוך ${failedUploads.length} בניסיון החוזר. ${stillFailing.length} עדיין נכשלו`);
    }
  };

  // Updates a single spread's thumb fields in-place inside versionPreviews, so the
  // grid can render progressively (each tile appears as soon as ITS thumbnail is
  // ready) instead of the whole section staying blank until every spread -- possibly
  // 30+, each requiring a full 25-30MB legacy backfill -- has finished.
  const patchPreviewThumb = (versionId, spreadId, patch) => {
    setVersionPreviews((prev) => {
      const current = prev[versionId];
      if (!current) return prev;
      return { ...prev, [versionId]: current.map((p) => (p.id === spreadId ? { ...p, ...patch } : p)) };
    });
  };

  const toggleExpandVersion = async (version) => {
    if (expandedVersionId === version.id) {
      setExpandedVersionId(null);
      return;
    }
    setExpandedVersionId(version.id);
    if (versionPreviews[version.id]) return;
    const spreads = spreadCounts[version.id] || [];
    if (spreads.length === 0) return;

    // Paint the grid immediately with placeholder tiles (thumbUrl: null -- shows the
    // existing ImageIcon placeholder in the JSX below) instead of waiting for every
    // thumbnail to resolve first. Each tile is then patched in place as its own
    // signed URL / backfill finishes, via patchPreviewThumb.
    setVersionPreviews((prev) => ({
      ...prev,
      [version.id]: spreads.map((s) => ({
        id: s.id,
        sequenceNumber: s.sequenceNumber,
        fileKey: s.fileKey,
        thumbFileKey: s.thumbFileKey || null,
        thumbUrl: null,
      })),
    }));

    // Grid only ever needs the small preview file (album_spreads.thumb_file_key,
    // generated client-side at upload time -- see src/lib/imageCompress.js and
    // 0043_album_spread_thumbnails.sql). This replaces the earlier resize-on-read
    // approach (Supabase Storage Image Transformations): confirmed 2026-08-24 that
    // the transform endpoint has a hard source-file-size cap this studio's real
    // spread files (25-30MB originals) are all over, so every transform request
    // failed with "The source image file is too large to process" -- not a bug to
    // patch, resize-on-read cannot work for this content at all. Signing the
    // already-small thumb file needs no transform option.
    const withThumbs = spreads.filter((s) => s.thumbFileKey);
    const legacySpreads = spreads.filter((s) => !s.thumbFileKey);

    if (withThumbs.length > 0) {
      mapWithConcurrency(withThumbs, 6, async (s) => {
        const { data } = await supabase.storage.from(BUCKET).createSignedUrl(s.thumbFileKey, 60 * 10);
        patchPreviewThumb(version.id, s.id, { thumbFileKey: s.thumbFileKey, thumbUrl: data?.signedUrl || null });
      });
    }

    // Legacy spreads uploaded before the thumb_file_key column existed have none yet
    // -- backfill lazily on first view: download the full-resolution original once,
    // compress it client-side (same helper used at upload time), upload it as the
    // spread's thumb, and persist thumb_file_key so every later view is instant.
    // Never blocks the rest of the grid on failure -- unresolved spreads just fall
    // back to the placeholder icon (see the p.thumbUrl ternary in the grid JSX).
    // Capped at 3 concurrent (vs. 6 for the already-small thumbs above) since each
    // one means downloading a full 25-30MB original. A visible progress counter
    // (see backfillProgress state + JSX) shows this is actively working, since with
    // 30+ legacy spreads it can take a couple of minutes end-to-end.
    if (legacySpreads.length > 0) {
      let completed = 0;
      setBackfillProgress((prev) => ({ ...prev, [version.id]: { current: 0, total: legacySpreads.length } }));
      await mapWithConcurrency(legacySpreads, 3, async (s) => {
        try {
          const { data: signedOriginal, error: signError } = await supabase.storage
            .from(BUCKET)
            .createSignedUrl(s.fileKey, 60 * 5);
          if (signError || !signedOriginal?.signedUrl) throw signError || new Error("sign failed");
          const res = await fetch(signedOriginal.signedUrl);
          if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
          const blob = await res.blob();
          const originalFile = new File([blob], "original.jpg", { type: blob.type || "image/jpeg" });
          const thumbFileKey = await uploadThumbForSpread(originalFile, version.id, s.sequenceNumber);
          if (!thumbFileKey) return;
          await base44.entities.AlbumSpread.update(s.id, { thumbFileKey });
          const { data: signedThumb } = await supabase.storage.from(BUCKET).createSignedUrl(thumbFileKey, 60 * 10);
          patchPreviewThumb(version.id, s.id, { thumbFileKey, thumbUrl: signedThumb?.signedUrl || null });
        } catch (err) {
          console.error(`[AlbumOrderDetail] legacy thumb backfill failed for spread ${s.id}:`, err);
        } finally {
          completed += 1;
          setBackfillProgress((prev) => ({ ...prev, [version.id]: { current: completed, total: legacySpreads.length } }));
        }
      });
      setBackfillProgress((prev) => {
        const next = { ...prev };
        delete next[version.id];
        return next;
      });
      // Keep the shared spreadCounts cache in sync so thumb_file_key persists across
      // re-expanding this version (or other flows reading spreadCounts) without
      // re-running the backfill every time.
      queryClient.invalidateQueries({ queryKey: ["albumSpreadCounts", orderId] });
    }
  };

  // Full-resolution original, signed on demand only when the studio explicitly
  // wants to inspect one spread closely -- never fetched eagerly for the whole
  // grid. (The couple's approved-spread print-shop download is a separate,
  // dedicated flow -- see AlbumPrintAccess.jsx / the album-print-access Edge
  // Function -- this is purely for the studio's own "open original" action here.)
  const handleOpenFullRes = async (fileKey) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(fileKey, 60 * 10);
    if (error || !data?.signedUrl) {
      toast.error("שגיאה בפתיחת התמונה המקורית");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  // Auto-expand the version currently shown to the couple, once, on load --
  // so the studio sees the actual preview thumbnails without an extra click.
  useEffect(() => {
    if (order?.currentVersionId && !expandedVersionId) {
      const v = versions.find((ver) => ver.id === order.currentVersionId);
      if (v) toggleExpandVersion(v);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.currentVersionId, versions.length]);

  // --- Single-spread replace (fix one page without re-uploading the whole version) ---
  const handleReplaceClick = (versionId, spread) => {
    setReplaceTarget({
      spreadId: spread.id,
      versionId,
      sequenceNumber: spread.sequenceNumber,
      oldFileKey: spread.fileKey,
      oldThumbFileKey: spread.thumbFileKey,
    });
    replaceFileInputRef.current?.click();
  };

  const handleReplaceFileSelected = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !replaceTarget) return;
    const { spreadId, versionId, sequenceNumber, oldFileKey, oldThumbFileKey } = replaceTarget;
    setReplacingSpreadId(spreadId);
    try {
      const path = `${user.tenant_id}/${orderId}/${versionId}/spread-${String(sequenceNumber).padStart(2, "0")}-replaced-${Date.now()}-${sanitizeFileName(file.name)}`;
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
      if (uploadError) throw uploadError;
      // thumbPathFor is deterministic per versionId+sequenceNumber (upsert:true), so
      // this naturally overwrites the previous thumb file in place -- no separate
      // Storage cleanup needed for it. If compression/upload fails here, fall back to
      // keeping the previous thumbFileKey (still on disk, still valid) instead of
      // losing the reference entirely.
      const newThumbFileKey = await uploadThumbForSpread(file, versionId, sequenceNumber);
      const thumbFileKey = newThumbFileKey || oldThumbFileKey || null;
      await base44.entities.AlbumSpread.update(spreadId, { fileKey: path, thumbFileKey, processingStatus: "ready" });
      if (order?.workflowStatus !== "in_review") {
        await base44.entities.AlbumOrder.update(orderId, { workflowStatus: "in_review" });
      }
      if (oldFileKey) {
        supabase.storage.from(BUCKET).remove([oldFileKey]).catch(() => {});
      }
      // Now that the studio has uploaded a replacement file, resolve any outstanding
      // "needs_revision" decision(s) on this spread -- otherwise the red "תיקון"
      // badge in the grid keeps showing even though the underlying issue was just
      // fixed, and there'd be no visible confirmation the replace actually worked.
      const staleDecisions = Object.values(decisionsByRound)
        .flat()
        .filter((d) => d.spreadId === spreadId && d.decision === "needs_revision");
      if (staleDecisions.length > 0) {
        await Promise.all(staleDecisions.map((d) => base44.entities.AlbumSpreadDecision.delete(d.id)));
        queryClient.invalidateQueries({ queryKey: ["albumSpreadDecisions", orderId] });
      }
      let thumbUrl = null;
      if (thumbFileKey) {
        const { data: thumbSignedData, error: thumbSignedError } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(thumbFileKey, 60 * 10);
        if (thumbSignedError) {
          console.error("[AlbumOrderDetail] thumbnail sign failed:", thumbSignedError);
        }
        thumbUrl = thumbSignedData?.signedUrl || null;
      }
      setVersionPreviews((prev) => ({
        ...prev,
        [versionId]: (prev[versionId] || []).map((p) =>
          p.id === spreadId ? { ...p, fileKey: path, thumbFileKey, thumbUrl } : p
        ),
      }));
      queryClient.invalidateQueries({ queryKey: ["albumSpreadCounts", orderId] });
      invalidateOrder();
      toast.success("הכפולה הוחלפה בהצלחה" + (staleDecisions.length > 0 ? " -- וסומנה כמטופלת" : ""));
    } catch (err) {
      toast.error(err.message || "שגיאה בהחלפת הקובץ");
    } finally {
      setReplacingSpreadId(null);
      setReplaceTarget(null);
    }
  };

  const approveVersionMutation = useMutation({
    mutationFn: (versionId) => base44.entities.AlbumOrder.update(orderId, { approvedVersionId: versionId, workflowStatus: "approved" }),
    onSuccess: () => {
      invalidateOrder();
      toast.success("הגרסה סומנה כמאושרת");
    },
    onError: (err) => toast.error(err.message || "שגיאה"),
  });

  // --- Delete a sketch version -----------------------------------------------------
  // DB-level FKs cascade-delete the version's spreads/review-rounds/decisions
  // automatically (see 0031_wedding_albums.sql), but the actual Storage *files*
  // are not touched by that cascade -- best-effort clean them up here too so
  // deleted versions don't leave orphaned objects in the album-files bucket.
  const deleteVersionMutation = useMutation({
    mutationFn: async (version) => {
      // Removes both the full-resolution original (fileKey) and its separately
      // stored small preview (thumbFileKey, see 0043_album_spread_thumbnails.sql) --
      // leaving the thumb behind would orphan it in the bucket forever.
      const paths = (spreadCounts[version.id] || [])
        .flatMap((s) => [s.fileKey, s.thumbFileKey])
        .filter(Boolean);
      if (paths.length > 0) {
        await supabase.storage.from(BUCKET).remove(paths).catch(() => {});
      }
      await base44.entities.AlbumVersion.delete(version.id);
    },
    onSuccess: (_result, version) => {
      queryClient.invalidateQueries({ queryKey: ["albumVersions", orderId] });
      queryClient.invalidateQueries({ queryKey: ["albumSpreadCounts", orderId] });
      queryClient.invalidateQueries({ queryKey: ["albumReviewRounds", orderId] });
      queryClient.invalidateQueries({ queryKey: ["albumSpreadDecisions", orderId] });
      setVersionPreviews((prev) => {
        const next = { ...prev };
        delete next[version.id];
        return next;
      });
      setExpandedVersionId((prev) => (prev === version.id ? null : prev));
      invalidateOrder();
      toast.success("הגרסה נמחקה");
    },
    onError: (err) => toast.error(err.message || "שגיאה במחיקת הגרסה"),
  });

  const handleDeleteVersion = (version) => {
    if (order.currentVersionId === version.id) {
      toast.error("לא ניתן למחוק את הגרסה המוצגת כרגע לזוג");
      return;
    }
    if (order.approvedVersionId === version.id) {
      toast.error("לא ניתן למחוק גרסה מאושרת");
      return;
    }
    if (!confirm(`למחוק לצמיתות את גרסה ${version.versionNumber}? כל הקבצים, סבב/י הבדיקה וההערות של הזוג לגרסה זו יימחקו ולא ניתן יהיה לשחזר.`)) {
      return;
    }
    deleteVersionMutation.mutate(version);
  };

  // --- Portal link ---------------------------------------------------------------
  const generatePortalLinkMutation = useMutation({
    mutationFn: async () => {
      const raw = generateRawToken();
      const hash = await hashToken(raw);
      await base44.entities.AlbumOrder.update(orderId, { portalTokenHash: hash, portalTokenRevokedAt: null });
      return raw;
    },
    onSuccess: (raw) => {
      setNewPortalToken(raw);
      saveCachedPortalToken(orderId, raw);
      invalidateOrder();
      toast.success("קישור לזוג נוצר");
    },
    onError: (err) => toast.error(err.message || "שגיאה ביצירת קישור"),
  });

  const revokePortalLinkMutation = useMutation({
    mutationFn: () => base44.entities.AlbumOrder.update(orderId, { portalTokenRevokedAt: new Date().toISOString() }),
    onSuccess: () => {
      setNewPortalToken(null);
      clearCachedPortalToken(orderId);
      invalidateOrder();
      toast.success("הקישור בוטל");
    },
    onError: (err) => toast.error(err.message || "שגיאה בביטול הקישור"),
  });

  // Re-hydrate the raw portal token from this browser's localStorage cache on
  // load/refresh -- but only trust it after re-hashing and confirming it still
  // matches the DB's current portal_token_hash (link may have been
  // revoked/regenerated from a different browser/device since it was cached).
  useEffect(() => {
    if (!order) return;
    if (newPortalToken) return;
    if (!order.portalTokenHash || order.portalTokenRevokedAt) {
      clearCachedPortalToken(orderId);
      return;
    }
    const cachedRaw = getCachedPortalTokenRaw(orderId);
    if (!cachedRaw) return;
    let cancelled = false;
    hashToken(cachedRaw).then((hash) => {
      if (cancelled) return;
      if (hash === order.portalTokenHash) setNewPortalToken(cachedRaw);
      else clearCachedPortalToken(orderId);
    });
    return () => { cancelled = true; };
  }, [order?.portalTokenHash, order?.portalTokenRevokedAt, orderId, newPortalToken]);

  // --- Payment ---------------------------------------------------------------
  const [proofUrl, setProofUrl] = useState(null);
  const viewTransferProof = async () => {
    if (!order?.transferProofFileKey) return;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(order.transferProofFileKey, 60 * 10);
    if (error) {
      toast.error("שגיאה בטעינת האסמכתא");
      return;
    }
    setProofUrl(data.signedUrl);
    window.open(data.signedUrl, "_blank");
  };

  // --- Addon-uploaded images (e.g. canvas/glass enlargement source photo) ----
  // Admin-authenticated session, direct Storage calls (same pattern as viewTransferProof
  // above) -- no dedicated Edge Function needed since album-files bucket policies already
  // gate access to owner/admin/studio_manager/album_manager.
  const viewAddonImage = async (path) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 10);
    if (error) {
      toast.error("שגיאה בטעינת התמונה");
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const downloadAddonImage = async (path) => {
    const fileName = path.split("/").pop() || "image";
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 10, { download: fileName });
    if (error) {
      toast.error("שגיאה בהורדת התמונה");
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const createAddonImagePrintLink = async (path) => {
    // A long-lived signed URL handed to the print shop -- simple, no new DB row needed
    // (unlike the order-wide print_access_links flow below, which covers approved
    // spreads). 30 days is generous enough for a print shop to pick up the file.
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 30);
    if (error) {
      toast.error("שגיאה ביצירת קישור");
      return;
    }
    copyToClipboard(data.signedUrl);
    toast.success("קישור לבית הדפוס הועתק ללוח");
  };

  const markPaidMutation = useMutation({
    mutationFn: () =>
      base44.entities.AlbumOrder.update(orderId, {
        paymentStatus: "paid",
        workflowStatus: order.workflowStatus === "awaiting_payment" ? "paid" : order.workflowStatus,
      }),
    onSuccess: () => {
      invalidateOrder();
      toast.success("ההזמנה סומנה כשולמה");
    },
    onError: (err) => toast.error(err.message || "שגיאה"),
  });

  // --- Print access links ---------------------------------------------------------------
  const generatePrintLinkMutation = useMutation({
    mutationFn: async () => {
      const raw = generateRawToken();
      const hash = await hashToken(raw);
      await base44.entities.PrintAccessLink.create({ albumOrderId: orderId, tokenHash: hash });
      return raw;
    },
    onSuccess: (raw) => {
      setNewPrintToken(raw);
      queryClient.invalidateQueries({ queryKey: ["printAccessLinks", orderId] });
      toast.success("קישור למעבדת הדפסה נוצר");
    },
    onError: (err) => toast.error(err.message || "שגיאה ביצירת קישור"),
  });

  const revokePrintLinkMutation = useMutation({
    mutationFn: (linkId) => base44.entities.PrintAccessLink.update(linkId, { revokedAt: new Date().toISOString() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["printAccessLinks", orderId] });
      toast.success("הקישור בוטל");
    },
    onError: (err) => toast.error(err.message || "שגיאה בביטול הקישור"),
  });

  // Production/delivery status ('in_print' / 'delivered' / 'completed') was a valid
  // workflow_status per the DB check constraint since 0031_wedding_albums.sql, and has
  // full label/color support (WORKFLOW_STATUS_LABELS/COLORS in AlbumOrders.jsx) and even
  // couple-portal display support (AlbumPortal.jsx's POST_PAYMENT_STATUSES), but no admin
  // action anywhere ever set it -- these three states were unreachable dead code. Plain
  // manual buttons here, not auto-triggered by generatePrintLinkMutation above, since
  // "created a print-shop link" and "actually sent the files" are two different real-world
  // moments (the studio might generate the link well before actually handing files off).
  const updateWorkflowStatusMutation = useMutation({
    mutationFn: (workflowStatus) => base44.entities.AlbumOrder.update(orderId, { workflowStatus }),
    onSuccess: (_data, workflowStatus) => {
      invalidateOrder();
      toast.success(`ההזמנה סומנה כ"${WORKFLOW_STATUS_LABELS[workflowStatus]}"`);
    },
    onError: (err) => toast.error(err.message || "שגיאה"),
  });

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success("הועתק ללוח");
  };

  if (orderLoading || !order) {
    return (
      <div className="min-h-screen bg-gray-950 p-4 md:p-8">
        <div className="max-w-4xl mx-auto animate-pulse space-y-6">
          <div className="h-10 bg-gray-800 rounded-lg w-48"></div>
          <div className="h-32 bg-gray-800 rounded-xl"></div>
        </div>
      </div>
    );
  }

  const portalLink = newPortalToken ? `${window.location.origin}/album/${newPortalToken}` : null;

  // Which spreads (in the version currently shown to the couple) were flagged
  // "needs_revision" in the latest review round for that version -- used to
  // highlight/filter the preview grid so the studio can find them at a glance.
  const currentVersionLatestRound = reviewRounds.find((r) => r.versionId === order.currentVersionId);
  const flaggedSpreadIds = new Set(
    currentVersionLatestRound
      ? (decisionsByRound[currentVersionLatestRound.id] || [])
          .filter((d) => d.decision === "needs_revision")
          .map((d) => d.spreadId)
      : []
  );

  // spreadId -> sequenceNumber, across every version -- lets the review-rounds
  // history show "עמוד X" instead of a meaningless truncated UUID.
  const spreadSeqById = {};
  Object.values(spreadCounts).forEach((arr) => {
    (arr || []).forEach((s) => { spreadSeqById[s.id] = s.sequenceNumber; });
  });

  const buildAlbumMessage = (type) => {
    const linkLine = portalLink ? `\nלצפייה ואישור: ${portalLink}` : "";
    if (type === "sketch") return `שלום! הכנו עבורכם תצוגה מקדימה של האלבום לבדיקה ואישור 💛${linkLine}`;
    if (type === "fix") return `שלום! ביצענו את התיקונים שביקשתם באלבום, אפשר לבדוק שוב 🙏${linkLine}`;
    return "";
  };

  // Studio-editable via Settings -> תבניות הודעות ("template_album_portal_link"),
  // unlike buildAlbumMessage above which stays hardcoded for the sketch/fix buttons.
  const buildSendToCoupleMessage = async () => {
    try {
      const rows = await base44.entities.AppSetting.filter({ key: "template_album_portal_link" });
      const tpl = rows?.[0]?.value;
      if (tpl) {
        return tpl
          .replace(/\{\{names\}\}/g, displayName || "")
          .replace(/\{\{link\}\}/g, portalLink || "");
      }
    } catch {
      // fall through to the hardcoded default below
    }
    return `שלום ${displayName || ""} 😊\nהכנו עבורכם תצוגה מקדימה של האלבום לצפייה ואישור 💛${portalLink ? `\n${portalLink}` : ""}`;
  };

  const handleSendWhatsApp = async (type) => {
    if (!displayPhone) return;
    setSendingMessageType(type);
    try {
      const message = type === "send_to_couple" ? await buildSendToCoupleMessage() : buildAlbumMessage(type);
      const result = await base44.functions.invoke("sendWhatsAppMessage", { to: displayPhone, message });
      if (result?.data?.error) throw new Error(result.data.error);
      toast.success("ההודעה נשלחה");
    } catch (err) {
      toast.error(err.message || "שגיאה בשליחת ההודעה");
    } finally {
      setSendingMessageType(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8" dir="rtl">
      <div className="max-w-4xl mx-auto space-y-6">
        <Link to={createPageUrl("AlbumOrders")} className="inline-flex items-center gap-2 text-gray-400 hover:text-white text-sm">
          <ArrowRight className="w-4 h-4" />
          חזרה לרשימת ההזמנות
        </Link>

        <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
          <div>
            <h1 className={`text-2xl md:text-3xl font-bold ${getOrderNameColorClass(order)}`}>{displayName || "ללא שם"}</h1>
            <p className="text-gray-400 mt-1">
              {displayDate || "ללא תאריך"}{displayPhone ? ` · ${displayPhone}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={WORKFLOW_STATUS_COLORS[order.workflowStatus] || "bg-gray-500/20 text-gray-400 border-gray-500/30"}>
              {WORKFLOW_STATUS_LABELS[order.workflowStatus] || order.workflowStatus}
            </Badge>
            <Badge
              variant="outline"
              className={PAYMENT_STATUS_COLORS[order.paymentStatus] || "border-gray-700 bg-gray-800 text-gray-400"}
            >
              {PAYMENT_STATUS_LABELS[order.paymentStatus]}
            </Badge>
          </div>
        </div>

        {/* Sketch versions */}
        <Card className="bg-gray-900/50 border-gray-800">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-white text-lg flex items-center gap-2">
              <ImageIcon className="w-5 h-5 text-yellow-400" />
              גרסאות סקיצה
            </CardTitle>
            <div>
              <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFilesSelected} />
              <Button onClick={handleUploadClick} disabled={isUploading} className="bg-yellow-400 text-gray-900 hover:bg-yellow-500">
                {isUploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                {isUploading && uploadProgress.total > 0
                  ? `מעלה קובץ ${uploadProgress.current} מתוך ${uploadProgress.total}...`
                  : "העלאת גרסה חדשה"}
              </Button>
              {isUploading && uploadProgress.total > 0 && (
                <div className="mt-2 w-48 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-yellow-400 transition-all duration-200"
                    style={{ width: `${Math.round((uploadProgress.current / uploadProgress.total) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <input ref={replaceFileInputRef} type="file" accept="image/*" className="hidden" onChange={handleReplaceFileSelected} />
            {failedUploads.length > 0 && (
              <div className="border border-red-800 bg-red-950/30 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-red-400 text-sm flex items-center gap-1.5 font-medium">
                    <AlertTriangle className="w-4 h-4" />
                    {failedUploads.length} כפולות לא הועלו -- לא הועלה קובץ בטעות
                  </p>
                  <Button
                    size="sm"
                    onClick={retryFailedUploads}
                    disabled={retryingUploads}
                    className="bg-red-600 hover:bg-red-700 text-white"
                  >
                    {retryingUploads ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                    {retryingUploads && uploadProgress.total > 0
                      ? `מנסה שוב ${uploadProgress.current} מתוך ${uploadProgress.total}...`
                      : "נסה שוב"}
                  </Button>
                </div>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {failedUploads.map((f) => (
                    <p key={`${f.versionId}-${f.sequenceNumber}`} className="text-red-300/90 text-xs">
                      עמוד {f.sequenceNumber} · {f.fileName} -- {f.errorMessage}
                    </p>
                  ))}
                </div>
              </div>
            )}
            {versions.length === 0 ? (
              <p className="text-gray-500 text-sm">עדיין לא הועלתה סקיצה</p>
            ) : (
              versions.map((v) => {
                const spreads = spreadCounts[v.id] || [];
                const isExpanded = expandedVersionId === v.id;
                const isApproved = order.approvedVersionId === v.id;
                const isCurrent = order.currentVersionId === v.id;
                const versionFlagged = isCurrent ? flaggedSpreadIds : new Set();
                const filterOn = isCurrent && showOnlyFlagged[v.id];
                const previews = (versionPreviews[v.id] || []).filter((p) => !filterOn || versionFlagged.has(p.id));
                return (
                  <div key={v.id} className="border border-gray-800 rounded-lg overflow-hidden">
                    <div className="w-full flex items-center justify-between p-3 hover:bg-gray-800/50 transition-colors">
                      <button
                        onClick={() => toggleExpandVersion(v)}
                        className="flex items-center gap-2 flex-1"
                      >
                        <span className="text-white font-medium">גרסה {v.versionNumber}</span>
                        <span className="text-gray-500 text-sm">{spreads.length} כפולות</span>
                        {isCurrent && <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">מוצגת לזוג</Badge>}
                        {isApproved && <Badge className="bg-teal-500/20 text-teal-400 border-teal-500/30 text-xs">מאושרת</Badge>}
                      </button>
                      <div className="flex items-center gap-1">
                        {!isCurrent && !isApproved && (
                          <Button
                            size="icon"
                            variant="ghost"
                            title="מחק גרסה"
                            onClick={() => handleDeleteVersion(v)}
                            disabled={deleteVersionMutation.isPending}
                            className="h-7 w-7 text-gray-500 hover:text-red-400 hover:bg-red-950/30"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                        <button onClick={() => toggleExpandVersion(v)} className="p-1">
                          {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                        </button>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="p-3 border-t border-gray-800 space-y-3">
                        {backfillProgress[v.id] && (
                          <div className="flex items-center gap-2 bg-blue-950/30 border border-blue-800 rounded-lg px-3 py-2">
                            <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
                            <p className="text-blue-300 text-sm">
                              מכין תצוגות מקדימות לכפולות ישנות ({backfillProgress[v.id].current} מתוך {backfillProgress[v.id].total}) --
                              זה קורה פעם אחת בלבד, כל צפייה הבאה תהיה מיידית.
                            </p>
                          </div>
                        )}
                        {isCurrent && flaggedSpreadIds.size > 0 && (
                          <div className="flex items-center justify-between">
                            <p className="text-red-400 text-sm flex items-center gap-1.5">
                              <AlertTriangle className="w-4 h-4" />
                              {flaggedSpreadIds.size} כפולות דורשות תיקון בסבב הבדיקה האחרון
                            </p>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setShowOnlyFlagged((prev) => ({ ...prev, [v.id]: !prev[v.id] }))}
                              className="border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
                            >
                              {filterOn ? "הצג הכל" : "הצג רק דורשים תיקון"}
                            </Button>
                          </div>
                        )}
                        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                          {previews.map((p) => {
                            const isFlagged = versionFlagged.has(p.id);
                            const isReplacing = replacingSpreadId === p.id;
                            // The uploaded path itself encodes whether this file came from
                            // the single-spread "replace" flow (handleReplaceFileSelected
                            // names it "...-replaced-<timestamp>-..." vs. the plain
                            // "...-<filename>" of an original upload) -- reusing that instead
                            // of a separate DB flag means this survives refresh/navigation
                            // for free, straight from the fileKey that's already stored.
                            const wasReplaced = p.fileKey?.includes("-replaced-");
                            return (
                              <div
                                key={p.id || p.sequenceNumber}
                                className={`rounded-lg border overflow-hidden ${isFlagged ? "border-red-500 ring-1 ring-red-500/50" : "border-gray-800"}`}
                              >
                                <button
                                  type="button"
                                  onClick={() => handleOpenFullRes(p.fileKey)}
                                  title="פתח באיכות מקורית"
                                  className="block w-full relative"
                                >
                                  {wasReplaced && (
                                    <span className="absolute top-1 right-1 z-10 flex items-center gap-0.5 bg-green-500/90 text-white text-[10px] font-medium px-1.5 py-0.5 rounded">
                                      <RefreshCw className="w-2.5 h-2.5" /> הוחלף
                                    </span>
                                  )}
                                  {p.thumbUrl ? (
                                    <img
                                      src={p.thumbUrl}
                                      alt={`עמוד ${p.sequenceNumber}`}
                                      className="w-full aspect-square object-cover bg-gray-800"
                                      loading="lazy"
                                      decoding="async"
                                    />
                                  ) : (
                                    <div className="w-full aspect-square bg-gray-800 flex items-center justify-center">
                                      <ImageIcon className="w-6 h-6 text-gray-600" />
                                    </div>
                                  )}
                                </button>
                                <div className="flex items-center justify-between px-1.5 py-1">
                                  <span className="text-gray-500 text-xs">עמוד {p.sequenceNumber}</span>
                                  {isFlagged && (
                                    <span className="flex items-center gap-0.5 text-red-400 text-[10px]">
                                      <AlertTriangle className="w-3 h-3" /> תיקון
                                    </span>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleReplaceClick(v.id, p)}
                                  disabled={isReplacing}
                                  className="w-full text-[11px] font-medium py-1 bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-60 flex items-center justify-center gap-1"
                                >
                                  {isReplacing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                  {isReplacing ? "מעלה..." : "החלף קובץ"}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                        {!isApproved && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => approveVersionMutation.mutate(v.id)}
                            className="border-teal-700 bg-teal-950/40 text-teal-400 hover:bg-teal-500/20"
                          >
                            <CheckCircle2 className="w-4 h-4 mr-2" />
                            סמן כגרסה מאושרת ידנית
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Portal link */}
        <Card className="bg-gray-900/50 border-gray-800">
          <CardHeader>
            <CardTitle className="text-white text-lg flex items-center gap-2">
              <Link2 className="w-5 h-5 text-yellow-400" />
              קישור לזוג
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {portalLink && (
              <div className="bg-gray-800/50 p-3 rounded-lg space-y-2">
                <p className="text-amber-400 text-sm">הקישור נשמר בדפדפן הזה ויישאר זמין גם אחרי רענון -- אך לא יופיע במכשיר/דפדפן אחר. העתק ושלח לזוג.</p>
                <div className="flex gap-2">
                  <Input readOnly value={portalLink} className="bg-gray-900 border-gray-700 text-white text-sm" />
                  <Button size="icon" variant="outline" onClick={() => window.open(portalLink, "_blank")} title="פתח קישור" className="border-gray-700 bg-gray-800 hover:bg-gray-700 shrink-0">
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="outline" onClick={() => copyToClipboard(portalLink)} title="העתק קישור" className="border-gray-700 bg-gray-800 hover:bg-gray-700 shrink-0">
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
            <div className="flex items-center gap-3">
              {order.portalTokenHash && !order.portalTokenRevokedAt ? (
                <>
                  <Badge className="bg-green-500/20 text-green-400 border-green-500/30">קיים קישור פעיל</Badge>
                  <Button size="sm" variant="outline" onClick={() => revokePortalLinkMutation.mutate()} className="border-red-800 bg-red-950/40 text-red-400 hover:bg-red-500/20">
                    <Ban className="w-4 h-4 mr-2" />
                    בטל קישור
                  </Button>
                </>
              ) : (
                <Badge variant="outline" className="border-gray-700 bg-gray-800 text-gray-500">אין קישור פעיל</Badge>
              )}
              <Button size="sm" onClick={() => generatePortalLinkMutation.mutate()} className="bg-yellow-400 text-gray-900 hover:bg-yellow-500">
                <RefreshCw className="w-4 h-4 mr-2" />
                {order.portalTokenHash ? "צור קישור חדש" : "צור קישור"}
              </Button>
            </div>

            <div className="border-t border-gray-800 pt-3 space-y-2">
              <p className="text-gray-400 text-sm">שליחת הודעה לזוג בוואטסאפ</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={!displayPhone || !!sendingMessageType}
                  onClick={() => handleSendWhatsApp("send_to_couple")}
                  className="bg-yellow-400 text-gray-900 hover:bg-yellow-500"
                >
                  {sendingMessageType === "send_to_couple" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  💌 שלח לזוג
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!displayPhone || !!sendingMessageType}
                  onClick={() => handleSendWhatsApp("sketch")}
                  className="border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
                >
                  {sendingMessageType === "sketch" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  📩 שלח קישור לבדיקה
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!displayPhone || !!sendingMessageType}
                  onClick={() => handleSendWhatsApp("fix")}
                  className="border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
                >
                  {sendingMessageType === "fix" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  🔧 עדכון: התיקון בוצע
                </Button>
              </div>
              {!portalLink && order.portalTokenHash && !order.portalTokenRevokedAt && (
                <p className="text-gray-500 text-xs">
                  שימו לב: הקישור המדויק לא זמין בדפדפן זה (נוצר במכשיר/דפדפן אחר, בוטל, או שמטמון הדפדפן נוקה) -- ההודעה תישלח בלי קישור מוטבע.
                  כדי לשלוח הודעה עם קישור, לחצו למעלה על &quot;צור קישור חדש&quot; (פעולה זו מבטלת את הקישור הקיים שביד הזוג).
                </p>
              )}
              {!displayPhone && <p className="text-gray-500 text-xs">לא נמצא מספר טלפון להזמנה זו -- לא ניתן לשלוח הודעה.</p>}
            </div>
          </CardContent>
        </Card>

        {/* Review rounds */}
        {reviewRounds.length > 0 && (
          <Card className="bg-gray-900/50 border-gray-800">
            <CardHeader>
              <CardTitle className="text-white text-lg">היסטוריית סבבי בדיקה</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {reviewRounds.map((round) => {
                const decisions = decisionsByRound[round.id] || [];
                const needsRevision = decisions.filter((d) => d.decision === "needs_revision");
                return (
                  <div key={round.id} className="border border-gray-800 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white font-medium">סבב {round.roundNumber}</span>
                      <Badge variant="outline" className="border-gray-700 bg-gray-800 text-gray-400 text-xs">
                        {needsRevision.length === 0 ? "כל הכפולות אושרו" : `${needsRevision.length} כפולות דורשות תיקון`}
                      </Badge>
                    </div>
                    {needsRevision.length > 0 && (
                      <div className="space-y-1">
                        {needsRevision.map((d) => (
                          <p key={d.id} className="text-gray-400 text-sm">
                            עמוד {spreadSeqById[d.spreadId] ?? d.spreadId?.slice(0, 8)}{d.comment ? `: ${d.comment}` : ""}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* Purchase selections -- what the couple actually chose in the wizard */}
        {(selection || orderAddons.length > 0) && (
          <Card className="bg-gray-900/50 border-gray-800">
            <CardHeader>
              <CardTitle className="text-white text-lg flex items-center gap-2">
                <Package className="w-5 h-5 text-yellow-400" />
                פרטי ההזמנה שנבחרו
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {selection ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                    <div className="flex items-center justify-between border-b border-gray-800 pb-2">
                      <span className="text-gray-400">מוצר</span>
                      <span className="text-white font-medium">
                        {selection.productNameSnapshot || "—"}
                        {selection.productPriceSnapshot != null && (
                          <span className="text-gray-400"> · ₪{Number(selection.productPriceSnapshot).toLocaleString()}</span>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center justify-between border-b border-gray-800 pb-2">
                      <span className="text-gray-400">כריכה</span>
                      <span className="text-white font-medium">
                        {selection.coverNameSnapshot || "—"}
                        {!!selection.coverPriceDeltaSnapshot && (
                          <span className="text-gray-400"> · +₪{Number(selection.coverPriceDeltaSnapshot).toLocaleString()}</span>
                        )}
                      </span>
                    </div>
                  </div>

                  {selection.engravingType ? (
                    <div className="bg-gray-800/50 p-3 rounded-lg space-y-1.5">
                      <p className="text-gray-300 text-sm font-medium mb-1 flex items-center justify-between">
                        <span>חריטה</span>
                        {selection.engravingPriceSnapshot != null && (
                          <span className="text-yellow-400">+₪{Number(selection.engravingPriceSnapshot).toLocaleString()}</span>
                        )}
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                        <p className="text-gray-400">
                          סוג: <span className="text-white">{ENGRAVING_TYPE_LABELS[selection.engravingType] || selection.engravingType}</span>
                        </p>
                        <p className="text-gray-400">
                          היקף: <span className="text-white">{ENGRAVING_SCOPE_LABELS[selection.engravingScope] || selection.engravingScope || "—"}</span>
                        </p>
                        {selection.engravingColorNameSnapshot && (
                          <p className="text-gray-400">
                            צבע: <span className="text-white">{selection.engravingColorNameSnapshot}</span>
                          </p>
                        )}
                        {selection.engravingFontNameSnapshot && (
                          <p className="text-gray-400">
                            פונט: <span className="text-white">{selection.engravingFontNameSnapshot}</span>
                          </p>
                        )}
                      </div>
                      {selection.engravingText && (
                        <p className="text-gray-400 text-sm">
                          שורה 1: <span className="text-white">{selection.engravingText}</span>
                        </p>
                      )}
                      {selection.engravingTextLine2 && (
                        <p className="text-gray-400 text-sm">
                          שורה 2: <span className="text-white">{selection.engravingTextLine2}</span>
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-gray-500 text-sm">ללא חריטה</p>
                  )}
                </>
              ) : (
                <p className="text-gray-500 text-sm">טרם נבחר מוצר</p>
              )}

              {orderAddons.length > 0 && (
                <div className="border-t border-gray-800 pt-3 space-y-2">
                  <p className="text-gray-300 text-sm font-medium flex items-center gap-1.5">
                    <Gift className="w-4 h-4 text-yellow-400" />
                    תוספות
                  </p>
                  {orderAddons.map((a) => (
                    <div key={a.id} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-400">
                          {a.addonNameSnapshot} {a.quantity > 1 ? `× ${a.quantity}` : ""}
                        </span>
                        <span className="text-white">
                          ₪{Number((a.addonPriceSnapshot || 0) * (a.quantity || 1)).toLocaleString()}
                        </span>
                      </div>
                      {Array.isArray(a.uploadedFileKeys) && a.uploadedFileKeys.length > 0 && (
                        <div className="flex flex-wrap gap-2 pr-1">
                          {a.uploadedFileKeys.map((path) => (
                            <div
                              key={path}
                              className="flex items-center gap-1 bg-gray-800/70 border border-gray-700 rounded-lg px-2 py-1"
                            >
                              <ImageIcon className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
                              <span className="text-gray-400 text-xs max-w-[120px] truncate" title={path}>
                                {path.split("/").pop()}
                              </span>
                              <Button
                                size="icon"
                                variant="ghost"
                                title="צפייה"
                                onClick={() => viewAddonImage(path)}
                                className="w-6 h-6 text-gray-300 hover:bg-gray-700"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                title="הורדה"
                                onClick={() => downloadAddonImage(path)}
                                className="w-6 h-6 text-gray-300 hover:bg-gray-700"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                title="צור קישור לבית דפוס"
                                onClick={() => createAddonImagePrintLink(path)}
                                className="w-6 h-6 text-gray-300 hover:bg-gray-700"
                              >
                                <Link2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Payment */}
        <Card className="bg-gray-900/50 border-gray-800">
          <CardHeader>
            <CardTitle className="text-white text-lg flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-yellow-400" />
              תשלום
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-gray-400">סכום כולל</span>
              <span className="text-white font-bold">{order.totalAmount ? `₪${Number(order.totalAmount).toLocaleString()}` : "טרם נקבע"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-400">סטטוס תשלום</span>
              <Badge
                variant="outline"
                className={PAYMENT_STATUS_COLORS[order.paymentStatus] || "border-gray-700 bg-gray-800 text-gray-300"}
              >
                {PAYMENT_STATUS_LABELS[order.paymentStatus]}
              </Badge>
            </div>
            {order.transferProofFileKey && (
              <Button size="sm" variant="outline" onClick={viewTransferProof} className="border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700">
                צפייה באסמכתת העברה
              </Button>
            )}
            {order.paymentStatus !== "paid" && (
              <Button size="sm" onClick={() => markPaidMutation.mutate()} className="bg-green-600 hover:bg-green-700 text-white">
                <CheckCircle2 className="w-4 h-4 mr-2" />
                סמן כשולם
              </Button>
            )}
            {(order.shippingName || order.shippingAddress) && (
              <div className="bg-gray-800/50 p-3 rounded-lg text-sm text-gray-300 space-y-1 mt-2">
                {order.shippingName && <p>נמען: {order.shippingName}</p>}
                {order.shippingPhone && <p>טלפון: {order.shippingPhone}</p>}
                {order.shippingAddress && <p>כתובת: {order.shippingAddress}</p>}
                {order.shippingNotes && <p>הערות: {order.shippingNotes}</p>}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Print-shop access */}
        <Card className="bg-gray-900/50 border-gray-800">
          <CardHeader>
            <CardTitle className="text-white text-lg flex items-center gap-2">
              <Printer className="w-5 h-5 text-yellow-400" />
              קישור למעבדת הדפסה
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!order.approvedVersionId && (
              <p className="text-amber-400 text-sm">יש לאשר גרסה לפני יצירת קישור למעבדת הדפסה.</p>
            )}
            {newPrintToken && (
              <div className="bg-gray-800/50 p-3 rounded-lg space-y-2">
                <p className="text-amber-400 text-sm">הקישור מוצג פעם אחת בלבד -- העתק ושלח למעבדת ההדפסה עכשיו.</p>
                <div className="flex gap-2">
                  <Input readOnly value={`${window.location.origin}/print-access/${newPrintToken}`} className="bg-gray-900 border-gray-700 text-white text-sm" />
                  <Button size="icon" variant="outline" onClick={() => copyToClipboard(`${window.location.origin}/print-access/${newPrintToken}`)} className="border-gray-700 bg-gray-800 hover:bg-gray-700 shrink-0">
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
            <Button
              size="sm"
              disabled={!order.approvedVersionId}
              onClick={() => generatePrintLinkMutation.mutate()}
              className="bg-yellow-400 text-gray-900 hover:bg-yellow-500 disabled:opacity-40"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              צור קישור חדש
            </Button>

            {printLinks.length > 0 && (
              <div className="space-y-2 pt-2">
                {printLinks.map((link) => (
                  <div key={link.id} className="flex items-center justify-between border border-gray-800 rounded-lg p-2 text-sm">
                    <span className="text-gray-400">
                      נוצר {link.createdDate?.slice(0, 10)}
                      {link.revokedAt ? " · בוטל" : ""}
                    </span>
                    {!link.revokedAt && (
                      <Button size="sm" variant="ghost" onClick={() => revokePrintLinkMutation.mutate(link.id)} className="text-red-400 hover:bg-red-500/10">
                        בטל
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="pt-3 mt-1 border-t border-gray-800 space-y-2">
              <p className="text-gray-400 text-sm">
                לאחר שהקבצים נשלחו בפועל למעבדת ההדפסה (בין אם דרך הקישור למעלה או בכל דרך אחרת), עדכנו כאן את סטטוס
                ההזמנה:
              </p>
              <div className="flex flex-wrap gap-2">
                {PRODUCTION_STATUS_STEPS.map((step) => {
                  const isActive = order.workflowStatus === step.value;
                  const StepIcon = step.icon;
                  return (
                    <Button
                      key={step.value}
                      size="sm"
                      variant={isActive ? "default" : "outline"}
                      disabled={updateWorkflowStatusMutation.isPending}
                      onClick={() => updateWorkflowStatusMutation.mutate(step.value)}
                      className={
                        isActive
                          ? "bg-yellow-400 text-gray-900 hover:bg-yellow-500"
                          : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
                      }
                    >
                      <StepIcon className="w-4 h-4 mr-2" />
                      {isActive ? `${step.label} (נוכחי)` : step.label}
                    </Button>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
