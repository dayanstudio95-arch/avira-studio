import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
} from "lucide-react";

// Public, no-login couple-facing wedding album portal -- /album/:token.
// Mirrors EventQuestionnaire.jsx's public-page structural pattern exactly
// (dir="rtl", dark theme, loading/error/success branches, base44.functions.invoke
// against a dedicated Edge Function). No Supabase session ever exists here --
// see CLAUDE.md's "Wedding Albums module" section.

const REVIEW_STATUSES = ["sketch_uploaded", "in_review", "revision_requested"];
const PURCHASE_STATUSES = ["approved", "product_selected", "awaiting_payment"];
const POST_PAYMENT_STATUSES = ["paid", "in_print", "delivered", "completed"];

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

  const displayName = order.coupleNamesManual || "האלבום שלכם";

  return (
    <div className="min-h-screen bg-gray-950 py-8 px-4" dir="rtl">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-white">{displayName}</h1>
          {order.weddingDateManual && (
            <p className="text-gray-400 text-sm">{formatDate(order.weddingDateManual)}</p>
          )}
        </div>

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
          .map((spread) => {
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

function PurchaseWizard({ token, order, onReloaded }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [catalog, setCatalog] = useState({ products: [], covers: [], addons: [] });

  const [stepIndex, setStepIndex] = useState(0);
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [selectedCoverId, setSelectedCoverId] = useState(null);
  const [engravingText, setEngravingText] = useState("");
  const [selectedAddons, setSelectedAddons] = useState({}); // addonId -> quantity
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

  const estimatedTotal = useMemo(() => {
    let total = selectedProduct ? Number(selectedProduct.basePrice) : 0;
    if (selectedCover) total += Number(selectedCover.priceDelta || 0);
    Object.entries(selectedAddons).forEach(([addonId, qty]) => {
      const addon = catalog.addons.find((a) => a.id === addonId);
      if (addon && qty > 0) total += Number(addon.price) * qty;
    });
    return total;
  }, [selectedProduct, selectedCover, selectedAddons, catalog.addons]);

  const toggleAddon = (addonId) => {
    setSelectedAddons((prev) => {
      const next = { ...prev };
      if (next[addonId]) delete next[addonId];
      else next[addonId] = 1;
      return next;
    });
  };

  const setAddonQty = (addonId, qty) => {
    setSelectedAddons((prev) => ({ ...prev, [addonId]: Math.max(1, qty) }));
  };

  const goNext = () => setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  const goBack = () => setStepIndex((i) => Math.max(i - 1, 0));

  const handleSubmitPurchase = async () => {
    setSubmitting(true);
    setSubmitError("");
    try {
      const addonsPayload = Object.entries(selectedAddons).map(([addonId, quantity]) => ({ addonId, quantity }));
      const res = await base44.functions.invoke("albumPortal", {
        token,
        action: "submitPurchase",
        productId: selectedProductId,
        coverId: selectedCoverId,
        engravingText,
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
          <div className="grid gap-3">
            <button
              type="button"
              onClick={() => setSelectedCoverId(null)}
              className={`text-right p-4 rounded-xl border transition ${
                !selectedCoverId ? "border-yellow-400 bg-yellow-400/10" : "border-gray-700 bg-gray-800/50"
              }`}
            >
              <span className="text-white">ללא תוספת כריכה</span>
            </button>
            {catalog.covers.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedCoverId(c.id)}
                className={`text-right p-4 rounded-xl border transition ${
                  selectedCoverId === c.id
                    ? "border-yellow-400 bg-yellow-400/10"
                    : "border-gray-700 bg-gray-800/50 hover:border-gray-600"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-white">{c.name}</span>
                  {Number(c.priceDelta) > 0 && (
                    <span className="text-yellow-400 text-sm">{formatCurrency(c.priceDelta)}+</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "engraving" && (
        <div className="space-y-3">
          <h3 className="text-white font-bold flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-yellow-400" /> הקדשה לחריטה (אופציונלי)
          </h3>
          <Textarea
            value={engravingText}
            onChange={(e) => setEngravingText(e.target.value)}
            placeholder="טקסט לחריטה על כריכת האלבום..."
            className="bg-gray-800 border-gray-700 text-white"
            rows={3}
          />
        </div>
      )}

      {step === "addons" && (
        <div className="space-y-3">
          <h3 className="text-white font-bold">תוספות</h3>
          <div className="grid gap-3">
            {catalog.addons.map((a) => {
              const checked = !!selectedAddons[a.id];
              return (
                <div
                  key={a.id}
                  className={`p-4 rounded-xl border flex items-center justify-between ${
                    checked ? "border-yellow-400 bg-yellow-400/10" : "border-gray-700 bg-gray-800/50"
                  }`}
                >
                  <button type="button" onClick={() => toggleAddon(a.id)} className="text-right flex-1">
                    <span className="text-white">{a.name}</span>
                    <span className="text-yellow-400 text-sm block">{formatCurrency(a.price)}</span>
                  </button>
                  {checked && (
                    <Input
                      type="number"
                      min={1}
                      value={selectedAddons[a.id]}
                      onChange={(e) => setAddonQty(a.id, Number(e.target.value) || 1)}
                      className="w-16 bg-gray-800 border-gray-700 text-white text-center"
                    />
                  )}
                </div>
              );
            })}
            {!catalog.addons.length && <p className="text-gray-500 text-sm">אין תוספות זמינות כרגע.</p>}
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
            {Object.entries(selectedAddons).map(([addonId, qty]) => {
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
        <Button type="button" variant="outline" disabled={stepIndex === 0} onClick={goBack} className="border-gray-700 text-gray-300">
          הקודם
        </Button>
        {step !== "payment" && (
          <Button
            type="button"
            disabled={step === "product" && !selectedProductId}
            onClick={goNext}
            className="bg-yellow-400 text-gray-900 hover:bg-yellow-500"
          >
            הבא
          </Button>
        )}
      </div>
    </div>
  );
}

function WizardHeader({ stepIndex }) {
  const labels = ["מוצר", "כריכה", "חריטה", "תוספות", "משלוח", "תשלום"];
  return (
    <div className="flex items-center justify-between text-xs text-gray-500">
      {labels.map((label, i) => (
        <span key={label} className={i === stepIndex ? "text-yellow-400 font-bold" : ""}>
          {label}
        </span>
      ))}
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
