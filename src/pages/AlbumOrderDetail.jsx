import React, { useState, useRef, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { createPageUrl } from "@/utils";
import { generateRawToken, hashToken } from "@/lib/albumTokens";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  ArrowRight, Upload, Copy, Link2, Ban, RefreshCw, ImageIcon, CheckCircle2,
  CreditCard, Printer, Loader2, ChevronDown, ChevronUp, AlertTriangle, ExternalLink,
} from "lucide-react";
import { WORKFLOW_STATUS_LABELS, WORKFLOW_STATUS_COLORS, PAYMENT_STATUS_LABELS } from "./AlbumOrders";

// Wedding Albums module -- single order's full lifecycle control: upload sketch
// versions, generate/revoke the couple's portal link, view review-round history,
// confirm manual bank-transfer payment, and generate print-shop access links. See
// CLAUDE.md's "Wedding Albums module" section. All Storage access here goes directly
// through the RLS-scoped Supabase client (album-files bucket policies already gate
// select/insert/update/delete to owner/admin/studio_manager/album_manager) -- no
// dedicated Edge Function needed for any of these admin actions.

const BUCKET = "album-files";

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export default function AlbumOrderDetail() {
  const { orderId } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [expandedVersionId, setExpandedVersionId] = useState(null);
  const [versionPreviews, setVersionPreviews] = useState({}); // versionId -> [{id, sequenceNumber, fileKey, url}]
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

  const displayName = order?.eventId ? event?.coupleNames : order?.coupleNamesManual;
  const displayDate = order?.eventId ? event?.date : order?.weddingDateManual;
  const displayPhone = order?.eventId ? event?.phoneNumber : order?.phoneManual;

  // --- Sketch version upload ---------------------------------------------------
  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFilesSelected = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;
    setIsUploading(true);
    const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
    setUploadProgress({ current: 0, total: sorted.length });
    try {
      const nextVersionNumber = (versions[0]?.versionNumber || 0) + 1;
      const newVersion = await base44.entities.AlbumVersion.create({
        albumOrderId: orderId,
        versionNumber: nextVersionNumber,
      });

      for (let i = 0; i < sorted.length; i++) {
        const file = sorted[i];
        const sequenceNumber = i + 1;
        const path = `${user.tenant_id}/${orderId}/${newVersion.id}/spread-${String(sequenceNumber).padStart(2, "0")}-${sanitizeFileName(file.name)}`;
        const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
        if (uploadError) throw uploadError;
        await base44.entities.AlbumSpread.create({
          versionId: newVersion.id,
          sequenceNumber,
          fileKey: path,
          processingStatus: "ready",
        });
        setUploadProgress({ current: i + 1, total: sorted.length });
      }

      await base44.entities.AlbumOrder.update(orderId, {
        currentVersionId: newVersion.id,
        workflowStatus: "in_review",
      });

      queryClient.invalidateQueries({ queryKey: ["albumVersions", orderId] });
      queryClient.invalidateQueries({ queryKey: ["albumSpreadCounts", orderId] });
      invalidateOrder();
      toast.success(`גרסה ${nextVersionNumber} הועלתה בהצלחה (${sorted.length} כפולות)`);
    } catch (err) {
      toast.error(err.message || "שגיאה בהעלאת הסקיצה");
    } finally {
      setIsUploading(false);
      setUploadProgress({ current: 0, total: 0 });
    }
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
    const paths = spreads.map((s) => s.fileKey);
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 60 * 10);
    if (error) {
      toast.error("שגיאה בטעינת תצוגה מקדימה");
      return;
    }
    setVersionPreviews((prev) => ({
      ...prev,
      [version.id]: spreads.map((s, i) => ({ id: s.id, sequenceNumber: s.sequenceNumber, fileKey: s.fileKey, url: data[i]?.signedUrl })),
    }));
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
    setReplaceTarget({ spreadId: spread.id, versionId, sequenceNumber: spread.sequenceNumber, oldFileKey: spread.fileKey });
    replaceFileInputRef.current?.click();
  };

  const handleReplaceFileSelected = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !replaceTarget) return;
    const { spreadId, versionId, sequenceNumber, oldFileKey } = replaceTarget;
    setReplacingSpreadId(spreadId);
    try {
      const path = `${user.tenant_id}/${orderId}/${versionId}/spread-${String(sequenceNumber).padStart(2, "0")}-replaced-${Date.now()}-${sanitizeFileName(file.name)}`;
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
      if (uploadError) throw uploadError;
      await base44.entities.AlbumSpread.update(spreadId, { fileKey: path, processingStatus: "ready" });
      if (order?.workflowStatus !== "in_review") {
        await base44.entities.AlbumOrder.update(orderId, { workflowStatus: "in_review" });
      }
      if (oldFileKey) {
        supabase.storage.from(BUCKET).remove([oldFileKey]).catch(() => {});
      }
      const { data: signedData } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 10);
      setVersionPreviews((prev) => ({
        ...prev,
        [versionId]: (prev[versionId] || []).map((p) =>
          p.id === spreadId ? { ...p, fileKey: path, url: signedData?.signedUrl || p.url } : p
        ),
      }));
      queryClient.invalidateQueries({ queryKey: ["albumSpreadCounts", orderId] });
      invalidateOrder();
      toast.success("הכפולה הוחלפה בהצלחה");
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
      invalidateOrder();
      toast.success("קישור לזוג נוצר");
    },
    onError: (err) => toast.error(err.message || "שגיאה ביצירת קישור"),
  });

  const revokePortalLinkMutation = useMutation({
    mutationFn: () => base44.entities.AlbumOrder.update(orderId, { portalTokenRevokedAt: new Date().toISOString() }),
    onSuccess: () => {
      invalidateOrder();
      toast.success("הקישור בוטל");
    },
    onError: (err) => toast.error(err.message || "שגיאה בביטול הקישור"),
  });

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

  const handleSendWhatsApp = async (type) => {
    if (!displayPhone) return;
    setSendingMessageType(type);
    try {
      const message = buildAlbumMessage(type);
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
            <h1 className="text-2xl md:text-3xl font-bold text-white">{displayName || "ללא שם"}</h1>
            <p className="text-gray-400 mt-1">
              {displayDate || "ללא תאריך"}{displayPhone ? ` · ${displayPhone}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={WORKFLOW_STATUS_COLORS[order.workflowStatus] || "bg-gray-500/20 text-gray-400 border-gray-500/30"}>
              {WORKFLOW_STATUS_LABELS[order.workflowStatus] || order.workflowStatus}
            </Badge>
            <Badge variant="outline" className="border-gray-700 text-gray-400">
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
                    <button
                      onClick={() => toggleExpandVersion(v)}
                      className="w-full flex items-center justify-between p-3 hover:bg-gray-800/50 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-white font-medium">גרסה {v.versionNumber}</span>
                        <span className="text-gray-500 text-sm">{spreads.length} כפולות</span>
                        {isCurrent && <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">מוצגת לזוג</Badge>}
                        {isApproved && <Badge className="bg-teal-500/20 text-teal-400 border-teal-500/30 text-xs">מאושרת</Badge>}
                      </div>
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                    </button>
                    {isExpanded && (
                      <div className="p-3 border-t border-gray-800 space-y-3">
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
                              className="border-gray-700 text-gray-300 hover:bg-gray-800"
                            >
                              {filterOn ? "הצג הכל" : "הצג רק דורשים תיקון"}
                            </Button>
                          </div>
                        )}
                        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                          {previews.map((p) => {
                            const isFlagged = versionFlagged.has(p.id);
                            const isReplacing = replacingSpreadId === p.id;
                            return (
                              <div
                                key={p.id || p.sequenceNumber}
                                className={`rounded-lg border overflow-hidden ${isFlagged ? "border-red-500 ring-1 ring-red-500/50" : "border-gray-800"}`}
                              >
                                <a href={p.url} target="_blank" rel="noreferrer" className="block">
                                  <img src={p.url} alt={`עמוד ${p.sequenceNumber}`} className="w-full aspect-square object-cover" />
                                </a>
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
                            className="border-teal-700 text-teal-400 hover:bg-teal-500/10"
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
                <p className="text-amber-400 text-sm">הקישור מוצג פעם אחת בלבד -- העתק ושלח לזוג עכשיו.</p>
                <div className="flex gap-2">
                  <Input readOnly value={portalLink} className="bg-gray-900 border-gray-700 text-white text-sm" />
                  <Button size="icon" variant="outline" onClick={() => window.open(portalLink, "_blank")} title="פתח קישור" className="border-gray-700 shrink-0">
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="outline" onClick={() => copyToClipboard(portalLink)} title="העתק קישור" className="border-gray-700 shrink-0">
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
            <div className="flex items-center gap-3">
              {order.portalTokenHash && !order.portalTokenRevokedAt ? (
                <>
                  <Badge className="bg-green-500/20 text-green-400 border-green-500/30">קיים קישור פעיל</Badge>
                  <Button size="sm" variant="outline" onClick={() => revokePortalLinkMutation.mutate()} className="border-red-800 text-red-400 hover:bg-red-500/10">
                    <Ban className="w-4 h-4 mr-2" />
                    בטל קישור
                  </Button>
                </>
              ) : (
                <Badge variant="outline" className="border-gray-700 text-gray-500">אין קישור פעיל</Badge>
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
                  variant="outline"
                  disabled={!displayPhone || !!sendingMessageType}
                  onClick={() => handleSendWhatsApp("sketch")}
                  className="border-gray-700 text-gray-300 hover:bg-gray-800"
                >
                  {sendingMessageType === "sketch" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  📩 שלח קישור לבדיקה
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!displayPhone || !!sendingMessageType}
                  onClick={() => handleSendWhatsApp("fix")}
                  className="border-gray-700 text-gray-300 hover:bg-gray-800"
                >
                  {sendingMessageType === "fix" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  🔧 עדכון: התיקון בוצע
                </Button>
              </div>
              {!portalLink && order.portalTokenHash && !order.portalTokenRevokedAt && (
                <p className="text-gray-500 text-xs">
                  שימו לב: הקישור המדויק לא זמין כרגע (הוא מוצג פעם אחת בלבד בעת היצירה) -- ההודעה תישלח בלי קישור מוטבע.
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
                      <Badge variant="outline" className="border-gray-700 text-gray-400 text-xs">
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
              <Badge variant="outline" className="border-gray-700 text-gray-300">{PAYMENT_STATUS_LABELS[order.paymentStatus]}</Badge>
            </div>
            {order.transferProofFileKey && (
              <Button size="sm" variant="outline" onClick={viewTransferProof} className="border-gray-700 text-gray-300 hover:bg-gray-800">
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
                  <Button size="icon" variant="outline" onClick={() => copyToClipboard(`${window.location.origin}/print-access/${newPrintToken}`)} className="border-gray-700 shrink-0">
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
