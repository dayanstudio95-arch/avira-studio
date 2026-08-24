import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ImageOff,
  Sparkles,
  Package,
  Truck,
  Landmark,
  Upload,
  CheckCircle,
  Clock,
  Plus,
  Minus,
  X,
} from "lucide-react";

// Public, no-login couple-facing wedding album portal -- /album/:token.
// Mirrors EventQuestionnaire.jsx's public-page structural pattern exactly
// (dir="rtl", dark theme, loading/error/success branches, base44.functions.invoke
// against a dedicated Edge Function). No Supabase session ever exists here --
// see CLAUDE.md's "Wedding Albums module" section.
//
// Redesigned to match the studio's old system's portal (reference screenshots,
// reconciled with the user) -- branded header + status badge, richer pill
// stepper, per-card product notes, filterable cover grid, and a fuller
// engraving step (type/scope/1-2 lines) backed by migration 0035.

const REVIEW_STATUSES = ["sketch_uploaded", "in_review", "revision_requested"];
const PURCHASE_STATUSES = ["approved", "product_selected", "awaiting_payment"];
const POST_PAYMENT_STATUSES = ["paid", "in_print", "delivered", "completed"];

const COVER_TYPE_LABELS = {
  denim: "ג'ינס",
  linen: "פשתן",
  faux_leather: "עור סינטטי",
  other: "אחר",
};
const COVER_TYPE_ORDER = ["denim", "linen", "faux_leather", "other"];

const ADDON_CATEGORY_LABELS = {
  glass: "זכוכית",
  canvas: "קנבס",
  mini_album: "מיני אלבום",
  parent_album: "אלבום הורים",
  extra_pages: "עמודים נוספים",
  other: "אחר",
};

// The couple never manually picks the "extra pages" addon (see the "addons" step
// below, which filters the 'extra_pages' catalog category out of the pickable
// list) -- every product's base price already includes this many pages per the
// order's current (approved) spread version; anything beyond it is billed
// automatically per page. Kept in sync manually with the identical constant in
// supabase/functions/album-portal/index.ts's submitPurchase, which is the
// authoritative, server-side computation -- this copy only drives the
// display-only estimatedTotal preview here.
const PAGE_BASELINE = 30;

const ENGRAVING_TYPE_OPTIONS = [
  { id: "colored", label: "חריטה צבעונית", description: "צבע בולט על גבי הכריכה" },
  { id: "blind", label: "הטבעה שקופה (ללא צבע)", description: "מומלץ בעיקר לכריכת עור סינטטי" },
];

const ENGRAVING_SCOPE_OPTIONS = [
  { id: "main_only", label: "אלבום ראשי בלבד" },
  { id: "full_set", label: "כל סט האלבומים" },
];

// Flat pricing matrix for engraving (there is no catalog table for this -- engraving
// type/scope are fixed studio options, not editable catalog rows, same as the
// hardcoded option lists above). Kept in sync manually with the identical matrix in
// supabase/functions/album-portal/index.ts, which is the authoritative, server-side
// computation -- this copy is display-only (estimatedTotal preview).
const ENGRAVING_PRICES = {
  colored: { main_only: 110, full_set: 220 },
  blind: { main_only: 100, full_set: 130 },
};
function getEngravingPrice(type, scope) {
  return ENGRAVING_PRICES[type]?.[scope] ?? 0;
}
// Blind (colorless) engraving only looks right on a faux-leather ("עור סינטטי") base
// cover -- enforced as a hard restriction (disabled option), not just a warning.
const BLIND_ENGRAVING_ALLOWED_COVER_TYPE = "faux_leather";

const STATUS_INFO = {
  sketch_uploaded: { label: "סקיצה מוכנה לצפייה", className: "bg-blue-500/15 text-blue-300 border-blue-500/30" },
  in_review: { label: "בבדיקה על ידכם", className: "bg-blue-500/15 text-blue-300 border-blue-500/30" },
  revision_requested: { label: "ממתין לתיקונים מהצוות", className: "bg-orange-500/15 text-orange-300 border-orange-500/30" },
  approved: { label: "מאושר · בחרו מוצר", className: "bg-green-500/15 text-green-300 border-green-500/30" },
  product_selected: { label: "השלימו את ההזמנה", className: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30" },
  awaiting_payment: { label: "ממתין לתשלום", className: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30" },
  paid: { label: "התשלום התקבל", className: "bg-green-500/15 text-green-300 border-green-500/30" },
  in_print: { label: "בהדפסה", className: "bg-purple-500/15 text-purple-300 border-purple-500/30" },
  delivered: { label: "נשלח אליכם", className: "bg-purple-500/15 text-purple-300 border-purple-500/30" },
  completed: { label: "הושלם", className: "bg-green-500/15 text-green-300 border-green-500/30" },
};

function formatCurrency(amount) {
  if (amount === null || amount === undefined) return "";
  return `₪${Number(amount).toLocaleString("he-IL")}`;
}

function formatDate(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString("he-IL", { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return value;
  }
}

export default function AlbumPortal() {
  const { token } = useParams();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [order, setOrder] = useState(null);

  const loadOrder = async () => {
    if (!token) {
      setError("קישור לא תקין");
      setIsLoading(false);
      return;
    }
    try {
      const res = await base44.functions.invoke("albumPortal", { token, action: "getOrder" });
      setOrder(res.data);
      setError("");
    } catch (e) {
      setError(e?.message || "אירעה שגיאה בטעינת ההזמנה");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadOrder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center" dir="rtl">
        <Loader2 className="w-10 h-10 text-yellow-400 animate-spin" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6" dir="rtl">
        <div className="max-w-md w-full bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center space-y-3">
          <AlertTriangle className="w-10 h-10 text-red-400 mx-auto" />
          <h1 className="text-lg font-bold text-white">לא ניתן להציג את ההזמנה</h1>
          <p className="text-gray-400 text-sm">{error || "קישור לא תקין"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 py-8 px-4" dir="rtl">
      <div className="max-w-3xl mx-auto space-y-6">
        <PortalHeader order={order} />

        {REVIEW_STATUSES.includes(order.workflowStatus) && (
          <ReviewGallery token={token} order={order} onReloaded={setOrder} />
        )}

        {PURCHASE_STATUSES.includes(order.workflowStatus) && (
          <PurchaseWizard token={token} order={order} onReloaded={setOrder} />
        )}

        {POST_PAYMENT_STATUSES.includes(order.workflowStatus) && <PostPaymentStatus order={order} />}
      </div>
    </div>
  );
}

// -------------------- Branded header --------------------

function PortalHeader({ order }) {
  const displayName = order.coupleNamesManual || "האלבום שלכם";
  const status = STATUS_INFO[order.workflowStatus];
  const versionNumber = order.currentVersion?.versionNumber;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      <div className="bg-gradient-to-l from-yellow-500/10 via-gray-900 to-gray-900 px-5 py-3 border-b border-gray-800 flex items-center justify-between gap-3">
        <div>
          <p className="text-yellow-400 font-bold text-sm tracking-wide">Avira Album</p>
          <p className="text-gray-500 text-xs">פורטל הזוג</p>
        </div>
        {status && (
          <Badge variant="outline" className={`border shrink-0 ${status.className}`}>
            {status.label}
          </Badge>
        )}
      </div>
      <div className="px-5 py-4 text-center space-y-1">
        <p className="text-gray-400 text-sm">ברוכים הבאים,</p>
        <h1 className="text-2xl font-bold text-white">{displayName}</h1>
        {(order.weddingDateManual || versionNumber) && (
          <div className="flex items-center justify-center gap-2 text-gray-500 text-xs">
            {order.weddingDateManual && <span>{formatDate(order.weddingDateManual)}</span>}
            {order.weddingDateManual && versionNumber && <span>·</span>}
            {versionNumber && <span>גרסה {versionNumber}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// -------------------- Review gallery phase --------------------

function ReviewGallery({ token, order, onReloaded }) {
  const spreads = order.currentVersion?.spreads || [];
  const [decisions, setDecisions] = useState({});
  const [activePin, setActivePin] = useState(null); // spreadId currently being commented on
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [resultStatus, setResultStatus] = useState(null);

  useEffect(() => {
    // Default every spread to "approved" -- couple only needs to flag problems.
    const initial = {};
    spreads.forEach((s) => {
      initial[s.id] = { decision: "approved", comment: "", pointX: null, pointY: null };
    });
    setDecisions(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.currentVersion?.id]);

  const toggleNeedsRevision = (spreadId) => {
    setDecisions((prev) => ({
      ...prev,
      [spreadId]: {
        ...prev[spreadId],
        decision: prev[spreadId]?.decision === "needs_revision" ? "approved" : "needs_revision",
      },
    }));
  };

  const setComment = (spreadId, comment) => {
    setDecisions((prev) => ({ ...prev, [spreadId]: { ...prev[spreadId], comment } }));
  };

  const handleImageClick = (spreadId, e) => {
    if (decisions[spreadId]?.decision !== "needs_revision") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pointX = Math.round(((e.clientX - rect.left) / rect.width) * 100);
    const pointY = Math.round(((e.clientY - rect.top) / rect.height) * 100);
    setDecisions((prev) => ({ ...prev, [spreadId]: { ...prev[spreadId], pointX, pointY } }));
    setActivePin(spreadId);
  };

  const handleSubmitRound = async () => {
    setSubmitting(true);
    setSubmitError("");
    try {
      const payload = Object.entries(decisions).map(([spreadId, d]) => ({
        spreadId,
        decision: d.decision,
        comment: d.comment || null,
        pointX: d.pointX,
        pointY: d.pointY,
      }));
      const res = await base44.functions.invoke("albumPortal", {
        token,
        action: "submitReviewRound",
        decisions: payload,
      });
      setResultStatus(res.data?.workflowStatus);
      setJustSubmitted(true);
      onReloaded((prev) => ({ ...prev, workflowStatus: res.data?.workflowStatus }));
    } catch (e) {
      setSubmitError(e?.message || "שגיאה בשליחת הביקורת");
    } finally {
      setSubmitting(false);
    }
  };

  if (!spreads.length) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center space-y-2">
        <ImageOff className="w-8 h-8 text-gray-600 mx-auto" />
        <p className="text-gray-400 text-sm">הסקיצה עדיין לא הועלתה. נעדכן אתכם כשהיא תהיה מוכנה לצפייה.</p>
      </div>
    );
  }

  if (justSubmitted) {
    const approved = resultStatus === "approved";
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center space-y-3">
        <CheckCircle2 className={`w-10 h-10 mx-auto ${approved ? "text-green-400" : "text-yellow-400"}`} />
        <h2 className="text-lg font-bold text-white">
          {approved ? "תודה! אישרתם את כל העמודים" : "תודה, קיבלנו את הערותיכם"}
        </h2>
        <p className="text-gray-400 text-sm">
          {approved
            ? "האלבום מאושר וניתן כעת להמשיך לבחירת המוצר והרכישה."
            : "הצוות שלנו יעדכן סקיצה מתוקנת ותקבלו הודעה כשהיא תהיה מוכנה לביקורת נוספת."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 text-sm text-gray-300">
        כל עמוד (כפולה) מסומן כברירת מחדל כ״מאושר״ — אם הכול נראה טוב אין צורך לגעת בכלום.
        עבור עמוד שדורש שינוי: לחצו על הכפתור ליד העמוד כדי להפוך אותו ל״נדרש תיקון״, ואז לחצו
        במקום המדויק בתמונה וכתבו הערה. סבב התיקונים הראשון חינם.
      </div>

      <div className="space-y-6">
        {spreads
          .slice()
          .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
          .map((spread, spreadIndex) => {
            const d = decisions[spread.id] || {};
            const needsRevision = d.decision === "needs_revision";
            return (
              <div key={spread.id} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <div className="p-3 flex items-center justify-between border-b border-gray-800">
                  <span className="text-gray-300 text-sm font-medium">עמוד {spread.sequenceNumber}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant={needsRevision ? "destructive" : "default"}
                    onClick={() => toggleNeedsRevision(spread.id)}
                    title="לחצו כדי לשנות את הסטטוס של העמוד הזה"
                    className={`gap-1.5 font-bold ${!needsRevision ? "bg-yellow-400 text-gray-900 hover:bg-yellow-500" : ""}`}
                  >
                    {needsRevision ? (
                      <AlertTriangle className="w-3.5 h-3.5" />
                    ) : (
                      <CheckCircle className="w-3.5 h-3.5" />
                    )}
                    {needsRevision ? "נדרש תיקון" : "מאושר · לחצו לשינוי"}
                  </Button>
                </div>
                <div className="relative bg-black">
                  {spread.previewUrl ? (
                    <img
                      src={spread.previewUrl}
                      alt={`עמוד ${spread.sequenceNumber}`}
                      className={`w-full h-auto ${needsRevision ? "cursor-crosshair" : ""}`}
                      onClick={(e) => handleImageClick(spread.id, e)}
                      loading={spreadIndex < 2 ? "eager" : "lazy"}
                      decoding="async"
                    />
                  ) : (
                    <div className="h-48 flex items-center justify-center text-gray-600">
                      <ImageOff className="w-8 h-8" />
                    </div>
                  )}
                  {needsRevision && d.pointX !== null && d.pointY !== null && (
                    <div
                      className="absolute w-4 h-4 -mt-2 -mr-2 rounded-full bg-red-500 border-2 border-white shadow"
                      style={{ left: `${d.pointX}%`, top: `${d.pointY}%` }}
                    />
                  )}
                </div>
                {needsRevision && (
                  <div className="p-3 space-y-2">
                    <Label className="text-gray-400 text-xs">
                      לחצו בתמונה על המקום המדויק, ותארו מה לתקן
                    </Label>
                    <Textarea
                      value={d.comment || ""}
                      onChange={(e) => setComment(spread.id, e.target.value)}
                      placeholder="לדוגמה: להחליף את התמונה השמאלית..."
                      className="bg-gray-800 border-gray-700 text-white"
                      rows={2}
                    />
                  </div>
                )}
              </div>
            );
          })}
      </div>

      {submitError && <p className="text-red-400 text-sm text-center">{submitError}</p>}

      <Button
        type="button"
        disabled={submitting}
        onClick={handleSubmitRound}
        className="w-full bg-yellow-400 text-gray-900 hover:bg-yellow-500 h-12 text-base font-bold"
      >
        {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : "שליחת הביקורת"}
      </Button>
    </div>
  );
}

// -------------------- Purchase wizard phase --------------------

const STEPS = ["product", "cover", "engraving", "addons", "shipping", "payment"];
const STEP_LABELS = ["מוצר", "כריכה", "חריטה", "תוספות", "משלוח", "תשלום"];
const NEXT_LABELS = {
  product: "המשך לכריכה",
  cover: "המשך לחריטה",
  addons: "המשך למשלוח",
  shipping: "המשך לתשלום",
};

function PurchaseWizard({ token, order, onReloaded }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [catalog, setCatalog] = useState({ products: [], covers: [], addons: [], engravingColors: [], engravingFonts: [] });

  const [stepIndex, setStepIndex] = useState(0);
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [selectedCoverId, setSelectedCoverId] = useState(null);
  const [coverFilter, setCoverFilter] = useState("all");

  const [engravingEnabled, setEngravingEnabled] = useState(false);
  const [engravingLines, setEngravingLines] = useState(1);
  const [engravingText, setEngravingText] = useState("");
  const [engravingTextLine2, setEngravingTextLine2] = useState("");
  const [engravingType, setEngravingType] = useState("colored");
  const [engravingScope, setEngravingScope] = useState("main_only");
  const [selectedEngravingColorId, setSelectedEngravingColorId] = useState(null);
  const [selectedEngravingFontId, setSelectedEngravingFontId] = useState(null);

  const [selectedAddons, setSelectedAddons] = useState({}); // addonId -> quantity
  const [addonImages, setAddonImages] = useState({}); // addonId -> [{path, previewUrl, uploading}]
  const [addonUploadError, setAddonUploadError] = useState({}); // addonId -> message
  const [shipping, setShipping] = useState({ name: "", phone: "", address: "", notes: "" });

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const isAwaitingPayment = order.workflowStatus === "awaiting_payment";

  useEffect(() => {
    if (isAwaitingPayment) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const res = await base44.functions.invoke("albumPortal", { token, action: "getCatalog" });
        setCatalog(res.data);
      } catch (e) {
        setError(e?.message || "שגיאה בטעינת הקטלוג");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedProduct = catalog.products.find((p) => p.id === selectedProductId);
  const selectedCover = catalog.covers.find((c) => c.id === selectedCoverId);
  const selectedEngravingColor = (catalog.engravingColors || []).find((c) => c.id === selectedEngravingColorId);
  const selectedEngravingFont = (catalog.engravingFonts || []).find((f) => f.id === selectedEngravingFontId);
  const extraPagesAddon = catalog.addons.find((a) => a.category === "extra_pages");
  const pickableAddons = catalog.addons.filter((a) => a.category !== "extra_pages");

  // Real page count comes from the order's current (approved-by-purchase-time)
  // version's actual uploaded spreads -- never from anything the couple enters.
  const spreadCount = order.currentVersion?.spreads?.length || 0;
  const extraPagesCount = Math.max(0, spreadCount - PAGE_BASELINE);

  const coverTypesPresent = COVER_TYPE_ORDER.filter((t) => catalog.covers.some((c) => c.coverType === t));
  const filteredCovers = coverFilter === "all" ? catalog.covers : catalog.covers.filter((c) => c.coverType === coverFilter);

  const blindEngravingAllowed = selectedCover?.coverType === BLIND_ENGRAVING_ALLOWED_COVER_TYPE;
  const engravingPrice = engravingEnabled ? getEngravingPrice(engravingType, engravingScope) : 0;

  // If the couple picks "blind" engraving and then goes back and changes the cover
  // to something other than faux-leather, silently fall back to "colored" rather than
  // leaving an invalid combination selected (hard restriction, not just a warning).
  useEffect(() => {
    if (engravingType === "blind" && !blindEngravingAllowed) {
      setEngravingType("colored");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blindEngravingAllowed]);

  const estimatedTotal = useMemo(() => {
    let total = selectedProduct ? Number(selectedProduct.basePrice) : 0;
    if (selectedCover) total += Number(selectedCover.priceDelta || 0);
    if (engravingEnabled) total += getEngravingPrice(engravingType, engravingScope);
    Object.entries(selectedAddons).forEach(([addonId, qty]) => {
      if (extraPagesAddon && addonId === extraPagesAddon.id) return; // never manual, added below
      const addon = catalog.addons.find((a) => a.id === addonId);
      if (addon && qty > 0) total += Number(addon.price) * qty;
    });
    if (extraPagesAddon && extraPagesCount > 0) total += Number(extraPagesAddon.price) * extraPagesCount;
    return total;
  }, [
    selectedProduct,
    selectedCover,
    engravingEnabled,
    engravingType,
    engravingScope,
    selectedAddons,
    catalog.addons,
    extraPagesAddon,
    extraPagesCount,
  ]);

  // Addons flagged requiresUpload must have at least one uploaded image before the
  // couple can move past the addons step (mirrors the product/cover step's own
  // required-selection gating).
  const addonUploadsMissing = Object.entries(selectedAddons).some(([addonId, qty]) => {
    if (!qty) return false;
    const addon = catalog.addons.find((a) => a.id === addonId);
    if (!addon?.requiresUpload) return false;
    const images = (addonImages[addonId] || []).filter((img) => img.path && !img.uploading);
    return images.length === 0;
  });

  const handleAddonFileSelected = async (addon, fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const toUpload = addon.allowsMultipleImages ? files : [files[0]];
    setAddonUploadError((prev) => ({ ...prev, [addon.id]: "" }));
    for (const file of toUpload) {
      const localId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const previewUrl = URL.createObjectURL(file);
      setAddonImages((prev) => {
        const existing = addon.allowsMultipleImages ? prev[addon.id] || [] : [];
        return { ...prev, [addon.id]: [...existing, { localId, previewUrl, path: null, uploading: true }] };
      });
      try {
        const createRes = await base44.functions.invoke("albumPortal", {
          token,
          action: "createAddonUploadUrl",
          addonId: addon.id,
          fileName: file.name,
        });
        const { path, token: uploadToken } = createRes.data;
        const { error: uploadError } = await supabase.storage.from("album-files").uploadToSignedUrl(path, uploadToken, file);
        if (uploadError) throw new Error(uploadError.message || "העלאת התמונה נכשלה");
        setAddonImages((prev) => ({
          ...prev,
          [addon.id]: (prev[addon.id] || []).map((img) => (img.localId === localId ? { ...img, path, uploading: false } : img)),
        }));
      } catch (e) {
        setAddonUploadError((prev) => ({ ...prev, [addon.id]: e?.message || "שגיאה בהעלאת התמונה" }));
        setAddonImages((prev) => ({
          ...prev,
          [addon.id]: (prev[addon.id] || []).filter((img) => img.localId !== localId),
        }));
      }
    }
  };

  const removeAddonImage = (addonId, localId) => {
    setAddonImages((prev) => ({ ...prev, [addonId]: (prev[addonId] || []).filter((img) => img.localId !== localId) }));
  };

  const incrementAddon = (addonId) => {
    setSelectedAddons((prev) => ({ ...prev, [addonId]: (prev[addonId] || 0) + 1 }));
  };

  const decrementAddon = (addonId) => {
    setSelectedAddons((prev) => {
      const current = prev[addonId] || 1;
      if (current <= 1) {
        const next = { ...prev };
        delete next[addonId];
        setAddonImages((imgPrev) => {
          const nextImgs = { ...imgPrev };
          delete nextImgs[addonId];
          return nextImgs;
        });
        return next;
      }
      return { ...prev, [addonId]: current - 1 };
    });
  };

  const goNext = () => setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  const goBack = () => setStepIndex((i) => Math.max(i - 1, 0));

  const handleSubmitPurchase = async () => {
    setSubmitting(true);
    setSubmitError("");
    try {
      // Defensive: the "extra pages" addon is never shown as a manually-pickable
      // item (see the "addons" step below), but strip it here too in case it's
      // ever present in selectedAddons -- the server recomputes/charges it
      // authoritatively from the real spread count regardless of what's sent.
      const addonsPayload = Object.entries(selectedAddons)
        .filter(([addonId]) => !extraPagesAddon || addonId !== extraPagesAddon.id)
        .map(([addonId, quantity]) => ({
          addonId,
          quantity,
          imageKeys: (addonImages[addonId] || []).filter((img) => img.path).map((img) => img.path),
        }));
      const res = await base44.functions.invoke("albumPortal", {
        token,
        action: "submitPurchase",
        productId: selectedProductId,
        coverId: selectedCoverId,
        engravingText: engravingEnabled ? engravingText : "",
        engravingTextLine2: engravingEnabled && engravingLines === 2 ? engravingTextLine2 : "",
        engravingType: engravingEnabled ? engravingType : null,
        engravingScope: engravingEnabled ? engravingScope : null,
        engravingColorId: engravingEnabled ? selectedEngravingColorId : null,
        engravingFontId: engravingEnabled ? selectedEngravingFontId : null,
        addons: addonsPayload,
        shipping,
      });
      onReloaded((prev) => ({
        ...prev,
        workflowStatus: res.data?.workflowStatus,
        totalAmount: res.data?.totalAmount,
      }));
    } catch (e) {
      setSubmitError(e?.message || "שגיאה בשליחת ההזמנה");
    } finally {
      setSubmitting(false);
    }
  };

  if (isAwaitingPayment) {
    return <PaymentStep token={token} order={order} onReloaded={onReloaded} />;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-yellow-400 animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="text-red-400 text-sm text-center">{error}</p>;
  }

  const step = STEPS[stepIndex];
  const nextLabel =
    step === "engraving" ? (engravingEnabled ? "המשך לתוספות" : "דלג והמשך") : NEXT_LABELS[step] || "המשך";

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-5">
      <WizardHeader stepIndex={stepIndex} />

      {step === "product" && (
        <div className="space-y-3">
          <h3 className="text-white font-bold flex items-center gap-2">
            <Package className="w-4 h-4 text-yellow-400" /> בחירת מוצר
          </h3>
          <div className="grid gap-3">
            {catalog.products.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedProductId(p.id)}
                className={`text-right p-4 rounded-xl border transition ${
                  selectedProductId === p.id
                    ? "border-yellow-400 bg-yellow-400/10"
                    : "border-gray-700 bg-gray-800/50 hover:border-gray-600"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-white font-medium">{p.name}</span>
                  <span className="text-yellow-400 font-bold">{formatCurrency(p.basePrice)}</span>
                </div>
                {p.description && <p className="text-gray-400 text-sm mt-1">{p.description}</p>}
                <p className="text-gray-500 text-xs mt-1.5">
                  כולל {PAGE_BASELINE} עמודים
                  {extraPagesAddon ? ` · עמוד נוסף ${formatCurrency(extraPagesAddon.price)}` : ""}
                  {extraPagesCount > 0
                    ? ` · האלבום שהועלה כולל ${spreadCount} עמודים -- תתווסף עלות של ${extraPagesCount} עמודים נוספים (${formatCurrency(
                        Number(extraPagesAddon?.price || 0) * extraPagesCount
                      )}) אוטומטית`
                    : ""}
                </p>
              </button>
            ))}
            {!catalog.products.length && (
              <p className="text-gray-500 text-sm">הקטלוג עדיין לא הוגדר. נא ליצור קשר עם הסטודיו.</p>
            )}
          </div>
        </div>
      )}

      {step === "cover" && (
        <div className="space-y-3">
          <h3 className="text-white font-bold">בחירת כריכה</h3>

          {!!coverTypesPresent.length && (
            <Tabs value={coverFilter} onValueChange={setCoverFilter}>
              <TabsList className="flex-wrap h-auto gap-1 bg-gray-800/70">
                <TabsTrigger value="all">הכל</TabsTrigger>
                {coverTypesPresent.map((t) => (
                  <TabsTrigger key={t} value={t}>
                    {COVER_TYPE_LABELS[t] || t}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {filteredCovers.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedCoverId(c.id)}
                className={`rounded-xl border overflow-hidden text-center transition ${
                  selectedCoverId === c.id
                    ? "border-yellow-400 ring-2 ring-yellow-400/40"
                    : "border-gray-700 bg-gray-800/50 hover:border-gray-600"
                }`}
              >
                <div className="aspect-square bg-gray-800 flex items-center justify-center overflow-hidden">
                  {c.previewImageUrl ? (
                    <img src={c.previewImageUrl} alt={c.name} className="w-full h-full object-cover" />
                  ) : (
                    <ImageOff className="w-6 h-6 text-gray-600" />
                  )}
                </div>
                <div className="p-2 space-y-0.5">
                  <p className="text-white text-xs font-medium truncate">{c.name}</p>
                  {c.coverType && (
                    <p className="text-gray-500 text-[10px]">{COVER_TYPE_LABELS[c.coverType] || c.coverType}</p>
                  )}
                  {Number(c.priceDelta) > 0 && (
                    <p className="text-yellow-400 text-[11px] font-medium">{formatCurrency(c.priceDelta)}+</p>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "engraving" && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-white font-bold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-yellow-400" /> חריטה על הכריכה
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-gray-400 text-xs">{engravingEnabled ? "עם חריטה" : "ללא חריטה"}</span>
              <Switch checked={engravingEnabled} onCheckedChange={setEngravingEnabled} />
            </div>
          </div>

          {!engravingEnabled ? (
            <p className="text-gray-500 text-sm">
              לא תתווסף חריטה לאלבום. ניתן להפעיל את המתג למעלה כדי להוסיף הקדשה.
            </p>
          ) : (
            <div className="space-y-5">
              <div>
                <p className="text-gray-400 text-sm mb-2">סוג החריטה</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {ENGRAVING_TYPE_OPTIONS.map((opt) => {
                    const isBlindDisabled = opt.id === "blind" && !blindEngravingAllowed;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={isBlindDisabled}
                        onClick={() => !isBlindDisabled && setEngravingType(opt.id)}
                        className={`text-right p-3 rounded-xl border transition ${
                          isBlindDisabled
                            ? "border-gray-800 bg-gray-800/20 opacity-50 cursor-not-allowed"
                            : engravingType === opt.id
                            ? "border-yellow-400 bg-yellow-400/10"
                            : "border-gray-700 bg-gray-800/50 hover:border-gray-600"
                        }`}
                      >
                        <span className="text-white text-sm font-medium block">{opt.label}</span>
                        <span className="text-gray-500 text-xs">{opt.description}</span>
                      </button>
                    );
                  })}
                </div>
                {!blindEngravingAllowed && (
                  <p className="text-orange-400 text-xs mt-2 flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    הטבעה שקופה (ללא צבע) אפשרית רק על כריכות בסיס מסוג עור סינטטי — לא זמינה עבור הכריכה שנבחרה.
                  </p>
                )}
              </div>

              <div>
                <p className="text-gray-400 text-sm mb-2">היקף החריטה</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {ENGRAVING_SCOPE_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setEngravingScope(opt.id)}
                      className={`text-right p-3 rounded-xl border transition ${
                        engravingScope === opt.id
                          ? "border-yellow-400 bg-yellow-400/10"
                          : "border-gray-700 bg-gray-800/50 hover:border-gray-600"
                      }`}
                    >
                      <span className="text-white text-sm font-medium block">{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-yellow-400/30 bg-yellow-400/5 px-4 py-3">
                <span className="text-gray-300 text-sm">תוספת עבור החריטה</span>
                <span className="text-yellow-400 font-bold">{formatCurrency(engravingPrice)}</span>
              </div>

              <div>
                <p className="text-gray-400 text-sm mb-2">מספר שורות</p>
                <Tabs value={String(engravingLines)} onValueChange={(v) => setEngravingLines(Number(v))}>
                  <TabsList className="bg-gray-800/70">
                    <TabsTrigger value="1">שורה אחת</TabsTrigger>
                    <TabsTrigger value="2">שתי שורות</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-gray-400 text-xs flex items-center justify-between">
                    <span>שורה 1</span>
                    <span>{engravingText.length}/30</span>
                  </Label>
                  <Input
                    value={engravingText}
                    maxLength={30}
                    onChange={(e) => setEngravingText(e.target.value)}
                    placeholder="לדוגמה: דנה ומיקי"
                    className="bg-gray-800 border-gray-700 text-white"
                  />
                </div>
                {engravingLines === 2 && (
                  <div className="space-y-1.5">
                    <Label className="text-gray-400 text-xs flex items-center justify-between">
                      <span>שורה 2</span>
                      <span>{engravingTextLine2.length}/30</span>
                    </Label>
                    <Input
                      value={engravingTextLine2}
                      maxLength={30}
                      onChange={(e) => setEngravingTextLine2(e.target.value)}
                      placeholder="לדוגמה: 12.06.2026"
                      className="bg-gray-800 border-gray-700 text-white"
                    />
                  </div>
                )}
              </div>

              {!!(catalog.engravingColors || []).length && (
                <div>
                  <p className="text-gray-400 text-sm mb-2">צבע החריטה</p>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {catalog.engravingColors.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelectedEngravingColorId((prev) => (prev === c.id ? null : c.id))}
                        className={`flex flex-col items-center gap-1 p-1.5 rounded-lg border transition ${
                          selectedEngravingColorId === c.id
                            ? "border-yellow-400 bg-yellow-400/10"
                            : "border-gray-700 bg-gray-800/50"
                        }`}
                        title={c.name}
                      >
                        {c.previewImageUrl ? (
                          <img src={c.previewImageUrl} alt={c.name} className="w-full h-9 rounded object-cover" />
                        ) : (
                          <span className="w-full h-9 rounded bg-gray-950 border border-gray-700 flex items-center justify-center">
                            <span className="text-base font-serif" style={{ color: c.hexColor || "#ffffff" }}>
                              Aa
                            </span>
                          </span>
                        )}
                        <span className="text-gray-400 text-[10px] truncate w-full text-center">{c.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {!!(catalog.engravingFonts || []).length && (
                <div>
                  <p className="text-gray-400 text-sm mb-2">פונט החריטה</p>
                  <div className="grid grid-cols-3 gap-2">
                    {catalog.engravingFonts.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setSelectedEngravingFontId((prev) => (prev === f.id ? null : f.id))}
                        className={`flex flex-col items-center gap-1.5 text-center p-2 rounded-xl border transition ${
                          selectedEngravingFontId === f.id
                            ? "border-yellow-400 bg-yellow-400/10"
                            : "border-gray-700 bg-gray-800/50 hover:border-gray-600"
                        }`}
                      >
                        {f.previewImageUrl ? (
                          <img src={f.previewImageUrl} alt={f.name} className="w-full h-10 rounded object-cover" />
                        ) : (
                          <span
                            className="w-full h-10 rounded bg-gray-950 border border-gray-700 flex items-center justify-center text-white text-sm"
                            style={f.cssFontFamily ? { fontFamily: f.cssFontFamily } : undefined}
                          >
                            Aa
                          </span>
                        )}
                        <span className="text-gray-400 text-[10px] truncate w-full">{f.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {step === "addons" && (
        <div className="space-y-3">
          <h3 className="text-white font-bold">תוספות</h3>
          {extraPagesAddon && extraPagesCount > 0 && (
            <div className="p-3 rounded-xl border border-yellow-400/40 bg-yellow-400/10 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="text-white text-sm font-medium block">עמודים נוספים -- מחושב אוטומטית</span>
                <span className="text-gray-400 text-xs block mt-0.5">
                  האלבום שהועלה כולל {spreadCount} עמודים, {PAGE_BASELINE} מתוכם כלולים במחיר הבסיס. {extraPagesCount}{" "}
                  עמודים נוספים x {formatCurrency(extraPagesAddon.price)}.
                </span>
              </div>
              <span className="text-yellow-400 font-bold shrink-0">
                {formatCurrency(Number(extraPagesAddon.price) * extraPagesCount)}
              </span>
            </div>
          )}
          <div className="grid gap-3">
            {pickableAddons.map((a) => {
              const qty = selectedAddons[a.id];
              const checked = !!qty;
              const images = addonImages[a.id] || [];
              const hasUploadedImage = images.some((img) => img.path && !img.uploading);
              return (
                <div
                  key={a.id}
                  className={`p-3 rounded-xl border ${
                    checked ? "border-yellow-400 bg-yellow-400/10" : "border-gray-700 bg-gray-800/50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {a.previewImageUrl && (
                      <img src={a.previewImageUrl} alt={a.name} className="w-16 h-16 rounded-lg object-cover shrink-0 border border-gray-700" />
                    )}
                    <div className="flex-1 min-w-0">
                      <span className="text-white block">{a.name}</span>
                      {a.description && <span className="text-gray-500 text-xs block mt-0.5">{a.description}</span>}
                      <span className="text-yellow-400 text-sm block mt-0.5">
                        {formatCurrency(a.price)}
                        {a.priceType === "per_unit" ? " / יחידה" : ""}
                      </span>
                      {(a.category || a.requiresUpload) && (
                        <span className="text-gray-500 text-xs block mt-0.5">
                          {a.category ? ADDON_CATEGORY_LABELS[a.category] || a.category : ""}
                          {a.category && a.requiresUpload ? " · " : ""}
                          {a.requiresUpload ? `דורש העלאת תמונה${a.allowsMultipleImages ? " (כמה תמונות)" : ""}` : ""}
                        </span>
                      )}
                    </div>
                    <div className="shrink-0">
                      {!checked ? (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => incrementAddon(a.id)}
                          className="bg-yellow-400 text-gray-900 hover:bg-yellow-500 font-bold gap-1"
                        >
                          <Plus className="w-3.5 h-3.5" /> הוסף
                        </Button>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            onClick={() => decrementAddon(a.id)}
                            className="w-7 h-7 border-gray-700 text-gray-300 hover:bg-gray-700"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </Button>
                          <span className="text-white text-sm w-5 text-center">{qty}</span>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            onClick={() => incrementAddon(a.id)}
                            className="w-7 h-7 border-gray-700 text-gray-300 hover:bg-gray-700"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>

                  {checked && a.requiresUpload && (
                    <div className="mt-3 pt-3 border-t border-gray-700/50 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-300 text-xs font-medium">
                          תמונה להגדלה {a.allowsMultipleImages ? "" : "(תמונה אחת)"}
                        </span>
                        <label className="cursor-pointer text-yellow-400 text-xs font-medium flex items-center gap-1">
                          <Upload className="w-3.5 h-3.5" />
                          העלה תמונה
                          <input
                            type="file"
                            accept="image/*"
                            multiple={!!a.allowsMultipleImages}
                            className="hidden"
                            onChange={(e) => {
                              handleAddonFileSelected(a, e.target.files);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      </div>
                      {images.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {images.map((img) => (
                            <div
                              key={img.localId}
                              className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-700 shrink-0"
                            >
                              <img src={img.previewUrl} alt="" className="w-full h-full object-cover" />
                              {img.uploading ? (
                                <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                                  <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => removeAddonImage(a.id, img.localId)}
                                  className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 flex items-center justify-center"
                                >
                                  <X className="w-2.5 h-2.5 text-white" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {addonUploadError[a.id] && <p className="text-red-400 text-xs">{addonUploadError[a.id]}</p>}
                      {!hasUploadedImage && (
                        <p className="text-orange-400 text-xs flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 shrink-0" /> יש להעלות תמונה כדי להמשיך
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {!pickableAddons.length && !(extraPagesAddon && extraPagesCount > 0) && (
              <p className="text-gray-500 text-sm">אין תוספות זמינות כרגע.</p>
            )}
          </div>
        </div>
      )}

      {step === "shipping" && (
        <div className="space-y-3">
          <h3 className="text-white font-bold flex items-center gap-2">
            <Truck className="w-4 h-4 text-yellow-400" /> פרטי משלוח
          </h3>
          <Input
            placeholder="שם מלא"
            value={shipping.name}
            onChange={(e) => setShipping((s) => ({ ...s, name: e.target.value }))}
            className="bg-gray-800 border-gray-700 text-white"
          />
          <Input
            placeholder="טלפון"
            value={shipping.phone}
            onChange={(e) => setShipping((s) => ({ ...s, phone: e.target.value }))}
            className="bg-gray-800 border-gray-700 text-white"
          />
          <Input
            placeholder="כתובת מלאה"
            value={shipping.address}
            onChange={(e) => setShipping((s) => ({ ...s, address: e.target.value }))}
            className="bg-gray-800 border-gray-700 text-white"
          />
          <Textarea
            placeholder="הערות למשלוח (אופציונלי)"
            value={shipping.notes}
            onChange={(e) => setShipping((s) => ({ ...s, notes: e.target.value }))}
            className="bg-gray-800 border-gray-700 text-white"
            rows={2}
          />
        </div>
      )}

      {step === "payment" && (
        <div className="space-y-4">
          <h3 className="text-white font-bold">סיכום הזמנה</h3>
          <div className="bg-gray-800/50 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex justify-between text-gray-300">
              <span>{selectedProduct?.name || "-"}</span>
              <span>{formatCurrency(selectedProduct?.basePrice)}</span>
            </div>
            {selectedCover && (
              <div className="flex justify-between text-gray-300">
                <span>{selectedCover.name}</span>
                <span>{formatCurrency(selectedCover.priceDelta)}</span>
              </div>
            )}
            {engravingEnabled && (
              <div className="flex justify-between text-gray-300">
                <span>
                  חריטה
                  {` · ${engravingType === "colored" ? "צבעונית" : "הטבעה שקופה"}`}
                  {` · ${engravingScope === "main_only" ? "אלבום ראשי" : "כל הסט"}`}
                  {engravingLines === 2 ? " · שתי שורות" : " · שורה אחת"}
                  {selectedEngravingFont ? ` · ${selectedEngravingFont.name}` : ""}
                  {selectedEngravingColor ? ` · ${selectedEngravingColor.name}` : ""}
                </span>
                <span>{formatCurrency(engravingPrice)}</span>
              </div>
            )}
            {Object.entries(selectedAddons).map(([addonId, qty]) => {
              if (extraPagesAddon && addonId === extraPagesAddon.id) return null; // shown separately below, auto-computed
              const addon = catalog.addons.find((a) => a.id === addonId);
              if (!addon) return null;
              return (
                <div key={addonId} className="flex justify-between text-gray-300">
                  <span>
                    {addon.name} {qty > 1 ? `x${qty}` : ""}
                  </span>
                  <span>{formatCurrency(Number(addon.price) * qty)}</span>
                </div>
              );
            })}
            {extraPagesAddon && extraPagesCount > 0 && (
              <div className="flex justify-between text-gray-300">
                <span>
                  {extraPagesAddon.name} x{extraPagesCount}
                </span>
                <span>{formatCurrency(Number(extraPagesAddon.price) * extraPagesCount)}</span>
              </div>
            )}
            <div className="border-t border-gray-700 pt-2 flex justify-between text-white font-bold">
              <span>סה"כ</span>
              <span className="text-yellow-400">{formatCurrency(estimatedTotal)}</span>
            </div>
          </div>
          {submitError && <p className="text-red-400 text-sm text-center">{submitError}</p>}
          <Button
            type="button"
            disabled={submitting || !selectedProductId}
            onClick={handleSubmitPurchase}
            className="w-full bg-yellow-400 text-gray-900 hover:bg-yellow-500 h-12 text-base font-bold"
          >
            {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : "אישור הזמנה ומעבר לתשלום"}
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <Button
          type="button"
          variant="outline"
          disabled={stepIndex === 0}
          onClick={goBack}
          className="border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
        >
          חזרה
        </Button>
        {step !== "payment" && (
          <Button
            type="button"
            disabled={
              (step === "product" && !selectedProductId) ||
              (step === "cover" && !selectedCoverId) ||
              (step === "addons" && addonUploadsMissing)
            }
            onClick={goNext}
            className="bg-yellow-400 text-gray-900 hover:bg-yellow-500"
          >
            {nextLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

function WizardHeader({ stepIndex }) {
  return (
    <div className="flex items-start">
      {STEP_LABELS.map((label, i) => {
        const isDone = i < stepIndex;
        const isCurrent = i === stepIndex;
        return (
          <div key={label} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                  isCurrent
                    ? "bg-yellow-400 text-gray-900"
                    : isDone
                    ? "bg-green-500 text-white"
                    : "bg-gray-800 text-gray-500 border border-gray-700"
                }`}
              >
                {isDone ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
              </div>
              <span className={`text-[10px] whitespace-nowrap ${isCurrent ? "text-yellow-400 font-bold" : "text-gray-500"}`}>
                {label}
              </span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div className={`h-0.5 flex-1 mx-1 mt-3.5 ${isDone ? "bg-green-500" : "bg-gray-800"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// -------------------- Payment (bank transfer) step --------------------

function PaymentStep({ token, order, onReloaded }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(order.paymentStatus === "transfer_pending_review");

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const createRes = await base44.functions.invoke("albumPortal", {
        token,
        action: "createTransferProofUploadUrl",
        fileName: file.name,
      });
      const { path, token: uploadToken } = createRes.data;
      const { error: uploadError } = await supabase.storage
        .from("album-files")
        .uploadToSignedUrl(path, uploadToken, file);
      if (uploadError) throw new Error(uploadError.message || "העלאת הקובץ נכשלה");

      await base44.functions.invoke("albumPortal", { token, action: "confirmTransferProofUploaded", path });
      setDone(true);
      onReloaded((prev) => ({ ...prev, paymentStatus: "transfer_pending_review" }));
    } catch (e) {
      setError(e?.message || "שגיאה בהעלאת האסמכתא");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-4">
      <h3 className="text-white font-bold flex items-center gap-2">
        <Landmark className="w-4 h-4 text-yellow-400" /> תשלום בהעברה בנקאית
      </h3>
      <div className="bg-gray-800/50 rounded-xl p-4 text-sm text-gray-300 space-y-1">
        <p>סכום לתשלום: <span className="text-yellow-400 font-bold">{formatCurrency(order.totalAmount)}</span></p>
        <p>לפרטי חשבון להעברה, אנא פנו לסטודיו בוואטסאפ או בטלפון.</p>
      </div>

      {done ? (
        <div className="flex items-center gap-2 text-green-400 text-sm">
          <CheckCircle className="w-5 h-5" /> אסמכתת ההעברה התקבלה, ממתינה לאישור הסטודיו.
        </div>
      ) : (
        <div className="space-y-3">
          <Label className="text-gray-400 text-sm flex items-center gap-2">
            <Upload className="w-4 h-4" /> העלאת אסמכתת העברה (צילום מסך / קובץ)
          </Label>
          <Input
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="bg-gray-800 border-gray-700 text-white"
          />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <Button
            type="button"
            disabled={!file || uploading}
            onClick={handleUpload}
            className="w-full bg-yellow-400 text-gray-900 hover:bg-yellow-500"
          >
            {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : "שליחת אסמכתא"}
          </Button>
        </div>
      )}
    </div>
  );
}

// -------------------- Post-payment status --------------------

function PostPaymentStatus({ order }) {
  const labels = {
    paid: { text: "התשלום התקבל, האלבום בהכנה", icon: CheckCircle },
    in_print: { text: "האלבום בהדפסה", icon: Clock },
    delivered: { text: "האלבום נשלח אליכם", icon: Truck },
    completed: { text: "ההזמנה הושלמה, מקווים שנהניתם!", icon: CheckCircle2 },
  };
  const info = labels[order.workflowStatus] || labels.paid;
  const Icon = info.icon;
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center space-y-3">
      <Icon className="w-10 h-10 text-yellow-400 mx-auto" />
      <h2 className="text-lg font-bold text-white">{info.text}</h2>
      {order.totalAmount !== null && order.totalAmount !== undefined && (
        <p className="text-gray-400 text-sm">סכום ההזמנה: {formatCurrency(order.totalAmount)}</p>
      )}
    </div>
  );
}
