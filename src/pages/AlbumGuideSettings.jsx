import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { isAdmin, isAlbumManagerRole } from "@/lib/permissions";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  BookOpen, ImageIcon, Save, Upload, Loader2, Copy, Plus, Pencil, Trash2,
  ArrowUp, ArrowDown, HelpCircle, ExternalLink, ChevronDown, X, Images, Layers,
} from "lucide-react";
import { toast } from "sonner";

// Album Guide Page — studio-owner-editable, generic (one row per tenant)
// couple-facing informational page explaining the album-ordering process,
// sent as a companion link alongside the gallery link (see
// send-to-couple/index.ts). Isolated from the Wedding Albums purchase-wizard
// tables (album_orders/...) and from the legacy events.album_status marker —
// see CLAUDE.md's Wedding Albums module section. Only reads (never writes)
// album_products/album_covers for the read-only pricing preview below.
//
// Bucket `album-guide-assets` is PUBLIC (unlike the private `album-files`
// bucket used by AlbumOrderDetail.jsx) — uses .getPublicUrl(), same pattern
// as StudioDetailsCard.jsx's `studio-logos` bucket, not signed URLs.
//
// migration 0040 added per-cover preview images (album_guide_cover_previews)
// and multi-example sketch galleries (album_guide_sketch_examples +
// album_guide_sketch_example_images) — both purely additive to
// album_guide_content/album_guide_faq_items from 0039, and both only
// reference album_covers by id (read-only), never modifying it.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB
const BUCKET = "album-guide-assets";

const sanitizeFileName = (name) => name.replace(/[^a-zA-Z0-9._-]/g, "_");

const EMPTY_CONTENT_FORM = {
  photo_selection_intro: "",
  submission_instructions: "",
  cancellation_policy: "",
  is_published: true,
};

const EMPTY_FAQ_FORM = { question: "", answer: "" };

export default function AlbumGuideSettings() {
  const { user } = useAuth();
  const canManage = isAdmin(user) || isAlbumManagerRole(user);
  const queryClient = useQueryClient();

  // ---- Guide content (singleton per tenant) ----
  const [guideId, setGuideId] = useState(null);
  const [form, setForm] = useState(EMPTY_CONTENT_FORM);
  const [isLoadingGuide, setIsLoadingGuide] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (user?.tenant_id) loadGuide();
  }, [user?.tenant_id]);

  const loadGuide = async () => {
    setIsLoadingGuide(true);
    try {
      const rows = await base44.entities.AlbumGuideContent.filter({ tenantId: user.tenant_id });
      const row = rows?.[0];
      if (row) {
        setGuideId(row.id);
        setForm({
          photo_selection_intro: row.photoSelectionIntro || "",
          submission_instructions: row.submissionInstructions || "",
          cancellation_policy: row.cancellationPolicy || "",
          is_published: row.isPublished ?? true,
        });
      } else {
        setGuideId(null);
        setForm(EMPTY_CONTENT_FORM);
      }
    } catch (error) {
      toast.error("שגיאה בטעינת מדריך האלבום", { description: error.message });
    }
    setIsLoadingGuide(false);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const payload = {
        photoSelectionIntro: form.photo_selection_intro,
        submissionInstructions: form.submission_instructions,
        cancellationPolicy: form.cancellation_policy,
        isPublished: form.is_published,
        updatedBy: user.id,
      };
      if (guideId) {
        await base44.entities.AlbumGuideContent.update(guideId, payload);
      } else {
        const created = await base44.entities.AlbumGuideContent.create({
          ...payload,
          tenantId: user.tenant_id,
        });
        setGuideId(created.id);
      }
      toast.success("מדריך האלבום נשמר בהצלחה");
    } catch (error) {
      toast.error("שמירה נכשלה", { description: error.message });
    }
    setIsSaving(false);
  };

  const extractStoragePath = (publicUrl) => {
    const marker = `/object/public/${BUCKET}/`;
    const idx = publicUrl?.indexOf(marker);
    if (idx === -1 || idx === undefined) return null;
    return publicUrl.slice(idx + marker.length);
  };

  // ---- FAQ items ----
  const { data: faqItems = [], isLoading: isLoadingFaq } = useQuery({
    queryKey: ["albumGuideFaqItems", user?.tenant_id],
    queryFn: () => base44.entities.AlbumGuideFaqItem.filter({ tenantId: user.tenant_id }, "sortOrder"),
    enabled: !!user?.tenant_id,
  });

  const [isFaqDialogOpen, setIsFaqDialogOpen] = useState(false);
  const [editingFaq, setEditingFaq] = useState(null);
  const [faqForm, setFaqForm] = useState(EMPTY_FAQ_FORM);

  const invalidateFaq = () => queryClient.invalidateQueries({ queryKey: ["albumGuideFaqItems", user?.tenant_id] });

  const createFaqMutation = useMutation({
    mutationFn: (data) => base44.entities.AlbumGuideFaqItem.create({
      tenantId: user.tenant_id,
      question: data.question,
      answer: data.answer,
      sortOrder: faqItems.length,
    }),
    onSuccess: () => { invalidateFaq(); toast.success("השאלה נוספה"); handleCloseFaqDialog(); },
    onError: (error) => toast.error("הוספה נכשלה", { description: error.message }),
  });

  const updateFaqMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.AlbumGuideFaqItem.update(id, data),
    onSuccess: () => { invalidateFaq(); toast.success("השאלה עודכנה"); handleCloseFaqDialog(); },
    onError: (error) => toast.error("עדכון נכשל", { description: error.message }),
  });

  const deleteFaqMutation = useMutation({
    mutationFn: (id) => base44.entities.AlbumGuideFaqItem.delete(id),
    onSuccess: () => { invalidateFaq(); toast.success("השאלה נמחקה"); },
    onError: (error) => toast.error("מחיקה נכשלה", { description: error.message }),
  });

  const handleOpenFaqDialog = (item = null) => {
    setEditingFaq(item);
    setFaqForm(item ? { question: item.question || "", answer: item.answer || "" } : EMPTY_FAQ_FORM);
    setIsFaqDialogOpen(true);
  };

  const handleCloseFaqDialog = () => {
    setIsFaqDialogOpen(false);
    setEditingFaq(null);
    setFaqForm(EMPTY_FAQ_FORM);
  };

  const handleSubmitFaq = () => {
    if (!faqForm.question?.trim() || !faqForm.answer?.trim()) {
      toast.error("יש למלא שאלה ותשובה");
      return;
    }
    if (editingFaq) {
      updateFaqMutation.mutate({ id: editingFaq.id, data: { question: faqForm.question, answer: faqForm.answer } });
    } else {
      createFaqMutation.mutate(faqForm);
    }
  };

  const handleDeleteFaq = (id) => {
    if (window.confirm("למחוק את השאלה?")) deleteFaqMutation.mutate(id);
  };

  const moveFaq = async (index, direction) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= faqItems.length) return;
    const a = faqItems[index];
    const b = faqItems[targetIndex];
    try {
      await Promise.all([
        base44.entities.AlbumGuideFaqItem.update(a.id, { sortOrder: b.sortOrder ?? targetIndex }),
        base44.entities.AlbumGuideFaqItem.update(b.id, { sortOrder: a.sortOrder ?? index }),
      ]);
      invalidateFaq();
    } catch (error) {
      toast.error("שינוי הסדר נכשל", { description: error.message });
    }
  };

  // ---- Read-only catalog preview (products + covers) ----
  const { data: products = [] } = useQuery({
    queryKey: ["albumGuideProductsPreview", user?.tenant_id],
    queryFn: () => base44.entities.AlbumProduct.filter({ active: true }, "sortOrder"),
    enabled: !!user?.tenant_id,
  });
  const { data: covers = [] } = useQuery({
    queryKey: ["albumGuideCoversPreview", user?.tenant_id],
    queryFn: () => base44.entities.AlbumCover.filter({ active: true }, "sortOrder"),
    enabled: !!user?.tenant_id,
  });

  // ---- Per-cover preview images (migration 0040) ----
  const { data: coverPreviews = [] } = useQuery({
    queryKey: ["albumGuideCoverPreviews", user?.tenant_id],
    queryFn: () => base44.entities.AlbumGuideCoverPreview.filter({ tenantId: user.tenant_id }),
    enabled: !!user?.tenant_id,
  });
  const coverPreviewByCoverId = new Map(coverPreviews.map((p) => [p.coverId, p]));

  const [expandedCoverIds, setExpandedCoverIds] = useState(new Set());
  const toggleCoverExpanded = (coverId) => {
    setExpandedCoverIds((prev) => {
      const next = new Set(prev);
      if (next.has(coverId)) next.delete(coverId); else next.add(coverId);
      return next;
    });
  };

  const invalidateCoverPreviews = () => queryClient.invalidateQueries({ queryKey: ["albumGuideCoverPreviews", user?.tenant_id] });

  const [uploadingCoverId, setUploadingCoverId] = useState(null);
  const coverFileInputRef = useRef(null);
  const [pendingCoverUploadId, setPendingCoverUploadId] = useState(null);

  // "Load existing images from catalog" -- album_covers already has a
  // previewImageUrl column (populated by an earlier, unrelated migration,
  // 0033_album_catalog_richness.sql) that's already live in production on
  // AlbumPortal.jsx's couple-facing cover picker. Rather than requiring the
  // studio owner to manually re-upload each cover image into this separate
  // per-guide table, this copies the already-working URL straight across for
  // any cover that doesn't already have a guide preview set -- read-only
  // against album_covers (per CLAUDE.md's isolation rule), only ever writes
  // into album_guide_cover_previews.
  const [isLoadingFromCatalog, setIsLoadingFromCatalog] = useState(false);
  const coversMissingPreview = covers.filter((c) => c.previewImageUrl && !coverPreviewByCoverId.get(c.id)?.imageUrl);

  const handleLoadFromCatalog = async () => {
    if (!coversMissingPreview.length) return;
    setIsLoadingFromCatalog(true);
    let successCount = 0;
    try {
      for (const cover of coversMissingPreview) {
        try {
          const existing = coverPreviewByCoverId.get(cover.id);
          if (existing) {
            await base44.entities.AlbumGuideCoverPreview.update(existing.id, { imageUrl: cover.previewImageUrl });
          } else {
            await base44.entities.AlbumGuideCoverPreview.create({
              tenantId: user.tenant_id,
              coverId: cover.id,
              imageUrl: cover.previewImageUrl,
            });
          }
          successCount += 1;
        } catch (innerError) {
          // Keep going -- one cover's failure (e.g. a race on the unique
          // constraint) shouldn't block the rest from loading.
          console.error(`[AlbumGuideSettings] Failed to load catalog image for cover ${cover.id}:`, innerError);
        }
      }
      invalidateCoverPreviews();
      if (successCount > 0) {
        toast.success(`${successCount} תמונות כריכה נטענו מהקטלוג`);
      } else {
        toast.error("לא הצלחנו לטעון תמונות מהקטלוג");
      }
    } finally {
      setIsLoadingFromCatalog(false);
    }
  };

  const triggerCoverUpload = (coverId) => {
    setPendingCoverUploadId(coverId);
    coverFileInputRef.current?.click();
  };

  const handleCoverImageFileChange = async (e) => {
    const file = e.target.files?.[0];
    const coverId = pendingCoverUploadId;
    if (!file || !coverId) return;
    if (!file.type.startsWith("image/")) {
      toast.error("יש להעלות קובץ תמונה בלבד");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error("גודל הקובץ חייב להיות עד 4MB");
      return;
    }

    setUploadingCoverId(coverId);
    try {
      const sanitized = sanitizeFileName(file.name);
      const path = `${user.tenant_id}/covers/${coverId}-${Date.now()}-${sanitized}`;

      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const newUrl = publicUrlData?.publicUrl;
      if (!newUrl) throw new Error("לא התקבל URL ציבורי עבור התמונה");

      const existing = coverPreviewByCoverId.get(coverId);
      if (existing) {
        await base44.entities.AlbumGuideCoverPreview.update(existing.id, { imageUrl: newUrl });
        const oldPath = extractStoragePath(existing.imageUrl);
        if (oldPath) supabase.storage.from(BUCKET).remove([oldPath]).catch(() => {});
      } else {
        await base44.entities.AlbumGuideCoverPreview.create({
          tenantId: user.tenant_id,
          coverId,
          imageUrl: newUrl,
        });
      }
      invalidateCoverPreviews();
      toast.success("תמונת הכריכה הועלתה בהצלחה");
    } catch (error) {
      toast.error("העלאת התמונה נכשלה", { description: error.message });
    }
    setUploadingCoverId(null);
    setPendingCoverUploadId(null);
    if (coverFileInputRef.current) coverFileInputRef.current.value = "";
  };

  // ---- Sketch examples: multiple full spread galleries (migration 0040) ----
  const { data: sketchExamples = [], isLoading: isLoadingSketchExamples } = useQuery({
    queryKey: ["albumGuideSketchExamples", user?.tenant_id],
    queryFn: () => base44.entities.AlbumGuideSketchExample.filter({ tenantId: user.tenant_id }, "sortOrder"),
    enabled: !!user?.tenant_id,
  });
  const { data: sketchExampleImages = [] } = useQuery({
    queryKey: ["albumGuideSketchExampleImages", user?.tenant_id],
    queryFn: () => base44.entities.AlbumGuideSketchExampleImage.filter({ tenantId: user.tenant_id }, "sequenceNumber"),
    enabled: !!user?.tenant_id,
  });
  const imagesByExampleId = new Map();
  for (const img of sketchExampleImages) {
    const list = imagesByExampleId.get(img.exampleId) || [];
    list.push(img);
    imagesByExampleId.set(img.exampleId, list);
  }

  const invalidateSketchExamples = () => queryClient.invalidateQueries({ queryKey: ["albumGuideSketchExamples", user?.tenant_id] });
  const invalidateSketchExampleImages = () => queryClient.invalidateQueries({ queryKey: ["albumGuideSketchExampleImages", user?.tenant_id] });

  const [expandedExampleIds, setExpandedExampleIds] = useState(new Set());
  const toggleExampleExpanded = (id) => {
    setExpandedExampleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const [isExampleDialogOpen, setIsExampleDialogOpen] = useState(false);
  const [exampleTitleForm, setExampleTitleForm] = useState("");

  const createExampleMutation = useMutation({
    mutationFn: (title) => base44.entities.AlbumGuideSketchExample.create({
      tenantId: user.tenant_id,
      title: title || null,
      sortOrder: sketchExamples.length,
    }),
    onSuccess: () => {
      invalidateSketchExamples();
      toast.success("הדוגמה נוספה");
      setIsExampleDialogOpen(false);
      setExampleTitleForm("");
    },
    onError: (error) => toast.error("הוספה נכשלה", { description: error.message }),
  });

  const deleteExampleMutation = useMutation({
    mutationFn: async (example) => {
      const images = imagesByExampleId.get(example.id) || [];
      const paths = images.map((img) => extractStoragePath(img.imageUrl)).filter(Boolean);
      if (paths.length) await supabase.storage.from(BUCKET).remove(paths).catch(() => {});
      await base44.entities.AlbumGuideSketchExample.delete(example.id);
    },
    onSuccess: () => {
      invalidateSketchExamples();
      invalidateSketchExampleImages();
      toast.success("הדוגמה נמחקה");
    },
    onError: (error) => toast.error("מחיקה נכשלה", { description: error.message }),
  });

  const moveExample = async (index, direction) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= sketchExamples.length) return;
    const a = sketchExamples[index];
    const b = sketchExamples[targetIndex];
    try {
      await Promise.all([
        base44.entities.AlbumGuideSketchExample.update(a.id, { sortOrder: b.sortOrder ?? targetIndex }),
        base44.entities.AlbumGuideSketchExample.update(b.id, { sortOrder: a.sortOrder ?? index }),
      ]);
      invalidateSketchExamples();
    } catch (error) {
      toast.error("שינוי הסדר נכשל", { description: error.message });
    }
  };

  const handleDeleteExample = (example) => {
    if (window.confirm(`למחוק את הדוגמה "${example.title || "ללא כותרת"}" וכל תמונותיה?`)) {
      deleteExampleMutation.mutate(example);
    }
  };

  const [uploadingExampleId, setUploadingExampleId] = useState(null);
  const exampleFilesInputRef = useRef(null);
  const [pendingExampleUploadId, setPendingExampleUploadId] = useState(null);

  const triggerExampleImagesUpload = (exampleId) => {
    setPendingExampleUploadId(exampleId);
    exampleFilesInputRef.current?.click();
  };

  const handleExampleImagesFileChange = async (e) => {
    // Sort by filename (natural/numeric compare) before assigning sequence
    // numbers -- the browser's FileList order does not reliably match
    // filename order (e.g. "אווירה 10" can come before "אווירה 2"), so
    // without this the stored sequence_number wouldn't match the couple's
    // intended viewing order.
    const files = Array.from(e.target.files || []).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
    );
    const exampleId = pendingExampleUploadId;
    if (!files.length || !exampleId) return;

    const invalidFile = files.find((f) => !f.type.startsWith("image/"));
    if (invalidFile) {
      toast.error("ניתן להעלות קבצי תמונה בלבד");
      return;
    }
    const tooLarge = files.find((f) => f.size > MAX_IMAGE_BYTES);
    if (tooLarge) {
      toast.error("כל קובץ חייב להיות עד 4MB");
      return;
    }

    setUploadingExampleId(exampleId);
    try {
      const existingImages = imagesByExampleId.get(exampleId) || [];
      let nextSeq = existingImages.length
        ? Math.max(...existingImages.map((img) => img.sequenceNumber || 0)) + 1
        : 1;

      for (const file of files) {
        const sanitized = sanitizeFileName(file.name);
        const path = `${user.tenant_id}/sketch-examples/${exampleId}/${nextSeq}-${sanitized}`;
        const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
        if (uploadError) throw uploadError;
        const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
        const newUrl = publicUrlData?.publicUrl;
        if (!newUrl) throw new Error("לא התקבל URL ציבורי עבור התמונה");
        await base44.entities.AlbumGuideSketchExampleImage.create({
          tenantId: user.tenant_id,
          exampleId,
          sequenceNumber: nextSeq,
          imageUrl: newUrl,
        });
        nextSeq += 1;
      }
      invalidateSketchExampleImages();
      toast.success(`${files.length} תמונות הועלו בהצלחה`);
    } catch (error) {
      toast.error("העלאת התמונות נכשלה", { description: error.message });
    }
    setUploadingExampleId(null);
    setPendingExampleUploadId(null);
    if (exampleFilesInputRef.current) exampleFilesInputRef.current.value = "";
  };

  const handleDeleteExampleImage = async (image) => {
    if (!window.confirm("למחוק את התמונה?")) return;
    try {
      const path = extractStoragePath(image.imageUrl);
      if (path) await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
      await base44.entities.AlbumGuideSketchExampleImage.delete(image.id);
      invalidateSketchExampleImages();
      toast.success("התמונה נמחקה");
    } catch (error) {
      toast.error("מחיקת התמונה נכשלה", { description: error.message });
    }
  };

  // Remediation for images uploaded before the filename-order fix above --
  // re-derives each image's original filename from its stored path
  // (`<seq>-<sanitizedFileName>`) and reassigns sequence_number in that
  // filename order. Two-phase (push everything to a high temp range first,
  // then assign final 1..N) to avoid transient collisions with the
  // unique(tenant_id, example_id, sequence_number) constraint.
  const [resortingExampleId, setResortingExampleId] = useState(null);

  const extractOriginalFileNameFromUrl = (imageUrl) => {
    try {
      const lastSegment = decodeURIComponent(imageUrl.split("/").pop().split("?")[0]);
      const dashIndex = lastSegment.indexOf("-");
      return dashIndex >= 0 ? lastSegment.slice(dashIndex + 1) : lastSegment;
    } catch {
      return imageUrl;
    }
  };

  const handleResortExampleImages = async (example) => {
    const images = imagesByExampleId.get(example.id) || [];
    if (images.length < 2) return;
    if (!window.confirm("למיין מחדש את כל התמונות בדוגמה זו לפי שם הקובץ המקורי? פעולה זו תשנה את מספרי הסדר של התמונות.")) return;
    setResortingExampleId(example.id);
    try {
      const sorted = [...images].sort((a, b) =>
        extractOriginalFileNameFromUrl(a.imageUrl).localeCompare(
          extractOriginalFileNameFromUrl(b.imageUrl),
          undefined,
          { numeric: true, sensitivity: "base" }
        )
      );
      const TEMP_OFFSET = 100000;
      for (let i = 0; i < sorted.length; i++) {
        await base44.entities.AlbumGuideSketchExampleImage.update(sorted[i].id, { sequenceNumber: TEMP_OFFSET + i });
      }
      for (let i = 0; i < sorted.length; i++) {
        await base44.entities.AlbumGuideSketchExampleImage.update(sorted[i].id, { sequenceNumber: i + 1 });
      }
      invalidateSketchExampleImages();
      toast.success("סדר התמונות עודכן לפי שם הקובץ");
    } catch (error) {
      toast.error("מיון מחדש נכשל", { description: error.message });
    }
    setResortingExampleId(null);
  };

  const guideLink = user?.tenant_id ? `${window.location.origin}/album-guide/${user.tenant_id}` : "";

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success("הועתק ללוח");
  };

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8" dir="rtl">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-yellow-400" />
            <div>
              <h1 className="text-2xl font-bold text-white">מדריך אלבום לזוגות</h1>
              <p className="text-gray-400 text-sm mt-1">
                עמוד מידע כללי (זהה לכל זוג) המוסבר איך בוחרים תמונות, מזמינים אלבום, ומה המדיניות — נשלח אוטומטית יחד עם קישור הגלריה
              </p>
            </div>
          </div>
          {guideLink && (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => copyToClipboard(guideLink)}
                className="border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-yellow-400"
              >
                <Copy className="w-4 h-4 ml-2" />
                העתק קישור למדריך
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => window.open(guideLink, "_blank")}
                className="border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-yellow-400"
              >
                <ExternalLink className="w-4 h-4 ml-2" />
                תצוגה מקדימה
              </Button>
            </div>
          )}
        </div>

        {/* Guide content card */}
        <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
          <CardHeader className="border-b border-gray-800">
            <div className="flex items-center justify-between">
              <CardTitle className="text-white">תוכן המדריך</CardTitle>
              {canManage && (
                <div className="flex items-center gap-2">
                  <Label className="text-gray-300 text-sm">מפורסם</Label>
                  <Switch
                    checked={form.is_published}
                    onCheckedChange={(checked) => setForm({ ...form, is_published: checked })}
                  />
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            {isLoadingGuide ? (
              <div className="h-40 bg-gray-800 rounded-lg animate-pulse" />
            ) : (
              <>
                <div className="space-y-2">
                  <Label className="text-gray-300 font-medium">
                    איך בוחרים תמונות + כמה תמונות כלולות בחבילה
                  </Label>
                  <Textarea
                    value={form.photo_selection_intro}
                    disabled={!canManage}
                    onChange={(e) => setForm({ ...form, photo_selection_intro: e.target.value })}
                    className="bg-gray-800/50 border-gray-700 text-white min-h-[100px]"
                    placeholder="לדוגמה: החבילה כוללת בחירה של עד 60 תמונות מתוך הגלריה המלאה..."
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-gray-300 font-medium">מה עושים אחרי שסיימתם לבחור</Label>
                  <Textarea
                    value={form.submission_instructions}
                    disabled={!canManage}
                    onChange={(e) => setForm({ ...form, submission_instructions: e.target.value })}
                    className="bg-gray-800/50 border-gray-700 text-white min-h-[100px]"
                    placeholder="לדוגמה: שלחו לנו את רשימת מספרי התמונות שבחרתם בוואטסאפ..."
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-gray-300 font-medium">מדיניות ביטול</Label>
                  <Textarea
                    value={form.cancellation_policy}
                    disabled={!canManage}
                    onChange={(e) => setForm({ ...form, cancellation_policy: e.target.value })}
                    className="bg-gray-800/50 border-gray-700 text-white min-h-[80px]"
                    placeholder="לדוגמה: במידה והוזמן אלבום והמעצבת הגרפית כבר ביצעה עבודה, ובוטלה ההזמנה — יגבה תשלום של 300 ש״ח עבור העבודה הגרפית שבוצעה."
                  />
                </div>

                {canManage && (
                  <Button onClick={handleSave} disabled={isSaving} className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-semibold">
                    <Save className="w-4 h-4 ml-2" />
                    {isSaving ? "שומר..." : "שמירה"}
                  </Button>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* FAQ editor */}
        <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
          <CardHeader className="border-b border-gray-800">
            <div className="flex items-center justify-between">
              <CardTitle className="text-white flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-yellow-400" />
                שאלות נפוצות
              </CardTitle>
              {canManage && (
                <Button size="sm" onClick={() => handleOpenFaqDialog()} className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-semibold">
                  <Plus className="w-4 h-4 ml-2" />
                  שאלה חדשה
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-6">
            {isLoadingFaq ? (
              <div className="h-24 bg-gray-800 rounded-lg animate-pulse" />
            ) : faqItems.length === 0 ? (
              <p className="text-gray-500 text-sm">עדיין לא נוספו שאלות נפוצות.</p>
            ) : (
              <div className="space-y-3">
                {faqItems.map((item, index) => (
                  <div key={item.id} className="p-4 rounded-lg bg-gray-800/40 border border-gray-700 flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-medium">{item.question}</p>
                      <p className="text-gray-400 text-sm mt-1 whitespace-pre-wrap">{item.answer}</p>
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-1 shrink-0">
                        <Button size="icon" variant="ghost" onClick={() => moveFaq(index, -1)} disabled={index === 0} className="text-gray-400 hover:text-white h-8 w-8">
                          <ArrowUp className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => moveFaq(index, 1)} disabled={index === faqItems.length - 1} className="text-gray-400 hover:text-white h-8 w-8">
                          <ArrowDown className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => handleOpenFaqDialog(item)} className="text-gray-400 hover:text-yellow-400 h-8 w-8">
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => handleDeleteFaq(item.id)} className="text-gray-400 hover:text-red-400 h-8 w-8">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Sketch examples gallery manager */}
        <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
          <CardHeader className="border-b border-gray-800">
            <div className="flex items-center justify-between">
              <CardTitle className="text-white flex items-center gap-2">
                <Layers className="w-5 h-5 text-yellow-400" />
                דוגמאות סקיצת אלבום מלאות
              </CardTitle>
              {canManage && (
                <Button size="sm" onClick={() => setIsExampleDialogOpen(true)} className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-semibold">
                  <Plus className="w-4 h-4 ml-2" />
                  דוגמה חדשה
                </Button>
              )}
            </div>
            <p className="text-gray-400 text-sm mt-1">
              כל דוגמה היא רצף תמונות (עד כ-30 עמודים) שהזוג יכול לדפדף בו — מומלץ להעלות לפחות 2 דוגמאות שונות
            </p>
          </CardHeader>
          <CardContent className="p-6">
            {isLoadingSketchExamples ? (
              <div className="h-24 bg-gray-800 rounded-lg animate-pulse" />
            ) : sketchExamples.length === 0 ? (
              <p className="text-gray-500 text-sm">עדיין לא נוספו דוגמאות סקיצה.</p>
            ) : (
              <div className="space-y-3">
                {sketchExamples.map((example, index) => {
                  const images = imagesByExampleId.get(example.id) || [];
                  const isExpanded = expandedExampleIds.has(example.id);
                  const isUploading = uploadingExampleId === example.id;
                  return (
                    <div key={example.id} className="rounded-lg bg-gray-800/40 border border-gray-700 overflow-hidden">
                      <div className="flex items-center justify-between gap-3 p-3">
                        <button
                          type="button"
                          onClick={() => toggleExampleExpanded(example.id)}
                          className="flex items-center gap-2 flex-1 min-w-0 text-right"
                        >
                          <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                          <Images className="w-4 h-4 text-gray-500 shrink-0" />
                          <span className="text-white text-sm truncate">{example.title || `דוגמה ${index + 1}`}</span>
                          <Badge className="bg-gray-700 text-gray-300 border-gray-600 shrink-0">{images.length} תמונות</Badge>
                        </button>
                        {canManage && (
                          <div className="flex items-center gap-1 shrink-0">
                            <Button size="icon" variant="ghost" onClick={() => moveExample(index, -1)} disabled={index === 0} className="text-gray-400 hover:text-white h-8 w-8">
                              <ArrowUp className="w-4 h-4" />
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => moveExample(index, 1)} disabled={index === sketchExamples.length - 1} className="text-gray-400 hover:text-white h-8 w-8">
                              <ArrowDown className="w-4 h-4" />
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => handleDeleteExample(example)} className="text-gray-400 hover:text-red-400 h-8 w-8">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                      {isExpanded && (
                        <div className="p-3 pt-0 border-t border-gray-700/60 space-y-3">
                          {images.length > 0 && (
                            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                              {images.map((img) => (
                                <div key={img.id} className="relative group aspect-[3/2] rounded-md overflow-hidden bg-gray-900/50 border border-gray-700">
                                  <img src={img.imageUrl} alt={`עמוד ${img.sequenceNumber}`} className="w-full h-full object-cover" />
                                  <span className="absolute bottom-1 right-1 text-[10px] bg-black/60 text-white px-1 rounded">{img.sequenceNumber}</span>
                                  {canManage && (
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteExampleImage(img)}
                                      className="absolute top-1 left-1 bg-black/60 hover:bg-red-600 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                          {canManage && (
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={isUploading}
                                  onClick={() => triggerExampleImagesUpload(example.id)}
                                  className="border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-yellow-400"
                                >
                                  {isUploading ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Upload className="w-4 h-4 ml-2" />}
                                  {isUploading ? "מעלה..." : "הוספת תמונות (עמודים)"}
                                </Button>
                                {images.length > 1 && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={resortingExampleId === example.id}
                                    onClick={() => handleResortExampleImages(example)}
                                    className="border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-yellow-400"
                                  >
                                    {resortingExampleId === example.id ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Layers className="w-4 h-4 ml-2" />}
                                    {resortingExampleId === example.id ? "ממיין..." : "מיין מחדש לפי שם קובץ"}
                                  </Button>
                                )}
                              </div>
                              <p className="text-xs text-gray-500 mt-1">ניתן לבחור כמה קבצים בבת אחת, PNG/JPG עד 4MB לכל תמונה. תמונות שהועלו לפני התיקון יכולות להיות בסדר שגוי — השתמשו ב"מיין מחדש לפי שם קובץ" כדי לתקן אותן.</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <input
              ref={exampleFilesInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleExampleImagesFileChange}
            />
          </CardContent>
        </Card>

        {/* Read-only catalog preview */}
        <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
          <CardHeader className="border-b border-gray-800">
            <CardTitle className="text-white">תצוגה מקדימה של מחירון (מתוך הגדרות קטלוג האלבומים)</CardTitle>
            <p className="text-gray-400 text-sm mt-1">
              המחירים מוצגים לזוגות ישירות מהקטלוג הפעיל — לעריכת מחירים היכנסו ל"הגדרות קטלוג אלבומים"
            </p>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            <div>
              <h3 className="text-gray-300 font-medium mb-2">אלבומים</h3>
              {products.length === 0 ? (
                <p className="text-gray-500 text-sm">אין עדיין מוצרים פעילים בקטלוג.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {products.map((p) => (
                    <div key={p.id} className="p-3 rounded-lg bg-gray-800/40 border border-gray-700 flex items-center justify-between">
                      <span className="text-white text-sm">{p.name}</span>
                      <Badge className="bg-yellow-400/20 text-yellow-400 border-yellow-400/30">₪{p.basePrice}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                <h3 className="text-gray-300 font-medium">כריכות</h3>
                {canManage && coversMissingPreview.length > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isLoadingFromCatalog}
                    onClick={handleLoadFromCatalog}
                    className="border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-yellow-400"
                  >
                    {isLoadingFromCatalog ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <ImageIcon className="w-4 h-4 ml-2" />}
                    {isLoadingFromCatalog ? "טוען..." : `טען תמונות קיימות מהקטלוג (${coversMissingPreview.length})`}
                  </Button>
                )}
              </div>
              <p className="text-gray-500 text-xs mb-2">
                לחצו על כריכה כדי להוסיף/להחליף תמונת דוגמה שתוצג לזוגות ברשימה הנפתחת — או השתמשו בכפתור למעלה כדי לטעון אוטומטית את תמונות הכריכות שכבר קיימות בקטלוג האלבומים
              </p>
              {covers.length === 0 ? (
                <p className="text-gray-500 text-sm">אין עדיין כריכות פעילות בקטלוג.</p>
              ) : (
                <div className="space-y-2">
                  {covers.map((c) => {
                    const preview = coverPreviewByCoverId.get(c.id);
                    const isExpanded = expandedCoverIds.has(c.id);
                    const isUploading = uploadingCoverId === c.id;
                    return (
                      <div key={c.id} className="rounded-lg bg-gray-800/40 border border-gray-700 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => toggleCoverExpanded(c.id)}
                          className="w-full flex items-center justify-between gap-3 p-3 text-right"
                        >
                          <div className="flex items-center gap-2">
                            <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                            {preview?.imageUrl ? (
                              <img src={preview.imageUrl} alt={c.name} className="w-8 h-8 rounded object-cover border border-gray-700" />
                            ) : (
                              <ImageIcon className="w-4 h-4 text-gray-600" />
                            )}
                            <span className="text-white text-sm">{c.name}</span>
                          </div>
                          <Badge className="bg-yellow-400/20 text-yellow-400 border-yellow-400/30">
                            {c.priceDelta > 0 ? `+₪${c.priceDelta}` : "כלול"}
                          </Badge>
                        </button>
                        {isExpanded && (
                          <div className="p-3 pt-0 border-t border-gray-700/60 flex items-center gap-4">
                            <div className="w-28 h-20 rounded-lg bg-gray-900/50 border border-gray-700 flex items-center justify-center overflow-hidden shrink-0">
                              {preview?.imageUrl ? (
                                <img src={preview.imageUrl} alt={c.name} className="w-full h-full object-cover" />
                              ) : (
                                <ImageIcon className="w-6 h-6 text-gray-600" />
                              )}
                            </div>
                            {canManage && (
                              <div>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={isUploading}
                                  onClick={() => triggerCoverUpload(c.id)}
                                  className="border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-yellow-400"
                                >
                                  {isUploading ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Upload className="w-4 h-4 ml-2" />}
                                  {isUploading ? "מעלה..." : preview?.imageUrl ? "החלף תמונה" : "העלה תמונה"}
                                </Button>
                                <p className="text-xs text-gray-500 mt-1">PNG/JPG, עד 4MB</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <input
                ref={coverFileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleCoverImageFileChange}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* FAQ dialog */}
      <Dialog open={isFaqDialogOpen} onOpenChange={(open) => !open && handleCloseFaqDialog()}>
        <DialogContent className="bg-gray-900 border-gray-800 text-white" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editingFaq ? "עריכת שאלה" : "שאלה חדשה"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-gray-300">שאלה</Label>
              <Input
                value={faqForm.question}
                onChange={(e) => setFaqForm({ ...faqForm, question: e.target.value })}
                className="bg-gray-800/50 border-gray-700 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-gray-300">תשובה</Label>
              <Textarea
                value={faqForm.answer}
                onChange={(e) => setFaqForm({ ...faqForm, answer: e.target.value })}
                className="bg-gray-800/50 border-gray-700 text-white min-h-[100px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCloseFaqDialog} className="border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700">
              ביטול
            </Button>
            <Button
              onClick={handleSubmitFaq}
              disabled={createFaqMutation.isPending || updateFaqMutation.isPending}
              className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-semibold"
            >
              {editingFaq ? "עדכון" : "הוספה"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New sketch example dialog */}
      <Dialog
        open={isExampleDialogOpen}
        onOpenChange={(open) => { if (!open) { setIsExampleDialogOpen(false); setExampleTitleForm(""); } }}
      >
        <DialogContent className="bg-gray-900 border-gray-800 text-white" dir="rtl">
          <DialogHeader>
            <DialogTitle>דוגמה חדשה</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-gray-300">כותרת (לדוגמה: "אלבום קלאסי — 30 עמודים")</Label>
            <Input
              value={exampleTitleForm}
              onChange={(e) => setExampleTitleForm(e.target.value)}
              className="bg-gray-800/50 border-gray-700 text-white"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setIsExampleDialogOpen(false); setExampleTitleForm(""); }}
              className="border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
            >
              ביטול
            </Button>
            <Button
              onClick={() => createExampleMutation.mutate(exampleTitleForm)}
              disabled={createExampleMutation.isPending}
              className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-semibold"
            >
              הוספה
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
