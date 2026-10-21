import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, ExternalLink, Loader2, AlertTriangle, XCircle, Wifi, CalendarCheck, CheckCircle2, Link2, Eye } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { todayInIsrael } from "@/lib/localDate";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { activeOrder, pendingOrder, orderBalance, invoiceOrderCheck, friendlyError } from "@/lib/workOrder";
import { ENTITIES } from "@/lib/paymentEntity";
import { fetchWorkOrders, notifyWorkOrdersChanged } from "@/components/workOrders/useWorkOrders";
import PendingOrderNotice from "@/components/workOrders/PendingOrderNotice";
import WorkOrderDialog from "@/components/workOrders/WorkOrderDialog";
import PdfPreview from "@/components/workOrders/PdfPreview";

const INVOICE_ITEMS = ["מקדמה", "תשלום יתרה", "תוספת צילום", "אלבומים"];

// Morning API payment type codes: 1=מזומן, 2=צ'ק, 4=העברה בנקאית, 10=ביט
const PAYMENT_METHODS = [
  { value: "4", label: "העברה בנקאית" },
  { value: "1", label: "מזומן" },
  { value: "2", label: "צ'ק" },
  { value: "10", label: "ביט" },
];

export default function InvoiceDialog({
  isOpen,
  onClose,
  coupleNames,
  eventDate,
  venueName,
  clientEmail,
  clientPhone,
  leadId,
  remainingBalance,
  onInvoiceCreated,
  // Which Morning account issues the document — 'sole_prop' (עוסק מורשה, ירוק) or
  // 'company' (חברה בע״מ, סגול). Defaults to 'sole_prop' to preserve old behavior for
  // any caller that doesn't pass it. See generate-morning-invoice/index.ts.
  businessType = "sole_prop",
  // The event whose client_payment_status the success screen may update after a
  // "תשלום יתרה" invoice (2026-10-07). Without it the status question isn't offered.
  eventId,
  // Pre-selects the item (and its auto amount) on open — the post-sign wizard opens the
  // dialog with "מקדמה".
  initialItem,
}) {
  const todayStr = todayInIsrael();
  const DEPOSIT_AMOUNT = 500;
  const { tenantDefaults } = useAuth();
  const vatPercent = tenantDefaults?.defaultVatPercent ?? 18;
  const isCompany = businessType === "company";
  const businessLabel = isCompany ? "חברה בע״מ" : "עוסק מורשה";
  // Full literal Tailwind class strings (not template-interpolated) so the JIT scanner
  // picks them up regardless of which branch renders first.
  const theme = isCompany
    ? { icon: "text-purple-400", btn: "bg-purple-600 hover:bg-purple-700" }
    : { icon: "text-emerald-400", btn: "bg-emerald-600 hover:bg-emerald-700" };

  const getAutoAmount = (selectedItem) => {
    if (selectedItem === "מקדמה") return DEPOSIT_AMOUNT;
    if (selectedItem === "תשלום יתרה" && liveRemaining != null) return liveRemaining;
    return "";
  };

  const [clientName, setClientName] = useState(coupleNames || "");
  const [item, setItem] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("4");
  const [documentDate, setDocumentDate] = useState(todayStr);
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingConnection, setIsCheckingConnection] = useState(false);
  // The invoice that was just issued — { url, amount }. Drives the success screen.
  // FIXED 2026-10-07: the success screen sometimes never appeared. The parent's
  // onInvoiceCreated used to be called the moment the invoice was issued, and on some
  // screens (the dashboard table, "לידים אחרונים", the invoice button on a lead row) that
  // callback closes or unmounts the side panel — taking this dialog with it before the
  // owner ever saw it. The callback now runs only when he closes the success screen.
  const [created, setCreated] = useState(null);
  const [paymentStatusSaved, setPaymentStatusSaved] = useState(null); // 'Paid' | 'Partially Paid' | 'unchanged'
  const [isSavingPaymentStatus, setIsSavingPaymentStatus] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [apiStatus, setApiStatus] = useState(null); // { ok: bool, msg: string }
  const [latestMorningDate, setLatestMorningDate] = useState(null); // latest issued doc date globally
  const [isFetchingLatestDate, setIsFetchingLatestDate] = useState(false);
  // הזמנת עבודה (2026-10-21): the couple's active order of this business — the invoice is
  // linked to it in Morning and names its number.
  const [orderLead, setOrderLead] = useState(null);
  const [orders, setOrders] = useState([]);
  // 'loading' | 'ready' | 'error' — nothing is issued for a couple before we know whether they
  // have an order (an invoice issued unlinked can never be linked afterwards).
  const [ordersState, setOrdersState] = useState("ready");
  const [linkMode, setLinkMode] = useState("link"); // 'text' after Morning refused the link
  const [linkFailed, setLinkFailed] = useState(false);
  const [partialAsk, setPartialAsk] = useState(false);
  const [replaceFor, setReplaceFor] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  // Display-only VAT breakdown preview (the actual charged amount, amountNum, is
  // unaffected). Reads the tenant's own rate so a VAT-exempt studio (עוסק פטור,
  // rate 0) sees no VAT line rather than a fabricated 18%.
  const vatRate = vatPercent / 100;
  const amountNum = parseFloat(amount) || 0;
  const vatAmount = +(amountNum - amountNum / (1 + vatRate)).toFixed(2);
  const priceBeforeVat = +(amountNum / (1 + vatRate)).toFixed(2);

  // Reset the editable client-name field to the couple's real name whenever the
  // dialog is (re)opened for a given lead/event — keeps it editable per-invoice
  // (e.g. typing "עדי ואופק כהן" instead of the default) without stale values
  // leaking into the next invoice opened for a different couple.
  useEffect(() => {
    if (isOpen) setClientName(coupleNames || "");
  }, [isOpen, coupleNames]);

  useEffect(() => {
    if (isOpen && initialItem) {
      setItem(initialItem);
      setAmount(getAutoAmount(initialItem));
    }
  }, [isOpen, initialItem]);

  // Fetch latest Morning doc date when dialog opens
  useEffect(() => {
    if (!isOpen) return;
    setIsFetchingLatestDate(true);
    base44.functions.invoke("getLatestMorningDocumentDate", { businessType })
      .then((res) => {
        if (res.data?.found && res.data?.latestDocumentDate) {
          setLatestMorningDate(res.data.latestDocumentDate);
        }
      })
      .catch(() => {}) // silent fail — don't block the dialog
      .finally(() => setIsFetchingLatestDate(false));
  }, [isOpen, businessType]);

  const loadOrders = async () => {
    if (!leadId) { setOrders([]); setOrderLead(null); setOrdersState("ready"); return; }
    setOrdersState("loading");
    try {
      const [list, lead] = await Promise.all([fetchWorkOrders(leadId), base44.entities.Lead.get(leadId)]);
      setOrders(list);
      setOrderLead(lead);
      setOrdersState("ready");
    } catch {
      setOrdersState("error");
    }
  };
  useEffect(() => {
    if (!isOpen) return;
    setOrders([]); setOrderLead(null); setReplaceFor(null);
    setLinkMode("link"); setLinkFailed(false); setPartialAsk(false); setPreviewFile(null);
    loadOrders();
  }, [isOpen, leadId]);

  const order = activeOrder(orders, businessType);
  const pending = pendingOrder(orders, businessType);
  const otherOrder = !order ? activeOrder(orders, businessType === "company" ? "sole_prop" : "company") : null;
  const orderLeft = order ? orderBalance(order, orderLead?.invoicesList || []) : null;
  // With an order the couple's balance is read from the lead loaded here (a replacement order
  // issued from this window may have lowered the final price); otherwise the caller's value.
  const liveRemaining = order && orderLead
    ? Math.max(0, (Number(orderLead.finalPrice) || 0) - (Number(orderLead.totalPaid) || 0))
    : remainingBalance;
  const ordersBlocked = ordersState !== "ready" || !!pending;
  // Any edit makes a shown preview stale, and re-asks the partial-payment question.
  const edited = () => { setPreviewFile(null); setPartialAsk(false); };

  const isDateBeforeLatest = latestMorningDate && documentDate < latestMorningDate;

  const invoiceBody = () => ({
    clientName: clientName.trim(),
    clientEmail: clientEmail || "avira.media1@gmail.com",
    clientPhone: clientPhone || "",
    itemDescription: item,
    itemNotes: description,
    amount: amountNum,
    paymentMethodType: parseInt(paymentMethod),
    documentDate,
    eventDate: eventDate || "",
    leadId: leadId || "",
    businessType,
    ...(order ? { workOrderId: order.id, linkMode } : {}),
  });

  // The invoice as Morning would print it (with the link and the order line) — creates nothing.
  const handlePreview = async () => {
    if (!item || !amountNum || !clientName.trim()) {
      setErrorMsg("חסרים שדות: יש למלא פריט, סכום ושם לקוח");
      return;
    }
    setIsPreviewing(true);
    setErrorMsg(null);
    try {
      const res = await base44.functions.invoke("generateMorningInvoice", { ...invoiceBody(), preview: true });
      if (res.data?.file) setPreviewFile(res.data.file);
      else {
        setErrorMsg(res.data?.error || "התצוגה נכשלה");
        if (res.data?.linkFailed) setLinkFailed(true);
        if (res.data?.orderChanged) loadOrders();
      }
    } catch (e) {
      setErrorMsg(friendlyError(e, { fallback: "התצוגה נכשלה" }));
    }
    setIsPreviewing(false);
  };

  const handleSubmit = async (opts = {}) => {
    // שלב א׳ - בדיקת תקינות מקומית
    if (!item || !amountNum || !paymentMethod) {
      setErrorMsg("חסרים שדות: יש למלא פריט, סכום ואמצעי תשלום");
      return;
    }
    if (!clientName.trim()) {
      setErrorMsg("חסרים נתוני הגדרה: שם לקוח חסר");
      return;
    }
    if (isDateBeforeLatest) {
      setErrorMsg(`תאריך המסמך (${documentDate}) קודם לתאריך המסמך האחרון שהונפק במורנינג (${latestMorningDate}). לא ניתן להנפיק מסמך בתאריך מוקדם יותר.`);
      return;
    }
    if (ordersBlocked) {
      setErrorMsg(pending ? "יש לזוג הזמנת עבודה שההפקה שלה לא הסתיימה — בדקו אותה קודם (למעלה)." : "עוד לא ידוע אם לזוג יש הזמנת עבודה — חכו רגע או לחצו 'נסו שוב'.");
      return;
    }

    // Against the couple's work order: a "תשלום יתרה" smaller than what is left asks first
    // whether part was paid directly to a supplier (then a replacement order comes first);
    // more than what is left asks too.
    if (order) {
      const verdict = invoiceOrderCheck({ item, amount: amountNum, balance: orderLeft });
      if (verdict === "partial" && !opts.skipPartial) { setPartialAsk(true); return; }
      if (verdict === "over") {
        const ok = await confirmDialog({
          title: "הסכום עובר את היתרה בהזמנת העבודה",
          message: `בהזמנה מס' ${order.morning_number} נשארו ${Math.max(0, orderLeft).toLocaleString("he-IL")} ₪ לחשבונית. להפיק בכל זאת ${amountNum.toLocaleString("he-IL")} ₪?`,
          confirmText: "הפק בכל זאת",
        });
        if (!ok) return;
      }
    }
    setPartialAsk(false);

    setIsLoading(true);
    setErrorMsg(null);

    try {
      // שלב ב׳ + ג׳ - שליחה לשרת (שם מתבצע אימות הטוקן והפקת המסמך)
      const res = await base44.functions.invoke("generateMorningInvoice", invoiceBody());

      const data = res.data;

      // The first invoice decides the couple's business when nothing decided it yet
      // (2026-10-14) — the deposit invoice right after signing, typically. Never overrides a
      // business already chosen; best-effort.
      if (leadId && (data?.success || data?.warning || data?.invoiceUrl)) {
        supabase.from("leads").update({ payment_entity: businessType }).eq("id", leadId).is("payment_entity", null)
          .then(({ error }) => error && console.error("payment entity save failed:", error.message));
      }

      if (data?.success || data?.warning) {
        // החשבונית הופקה בהצלחה ב-Morning וכבר נשמרה ב-CRM.
        // onInvoiceCreated נקרא רק בסגירת מסך ההצלחה (handleClose) — ראו `created`.
        setCreated({ url: data.invoiceUrl || null, amount: amountNum });
        notifyWorkOrdersChanged(leadId);
        if (data.warning) {
          toast.error(data.warning);
        } else {
          toast.success(`החשבונית הופקה בהצלחה על סך ₪${amountNum.toLocaleString()}`);
        }
      } else if (data?.invoiceUrl) {
        // Fallback: אם יש URL זה כנראה הצליח
        setCreated({ url: data.invoiceUrl, amount: amountNum });
        toast.success(`החשבונית הופקה בהצלחה על סך ₪${amountNum.toLocaleString()}`);
      } else {
        // טיפול בשגיאה - Drawer נשאר פתוח
        const errMsg = data?.error || "שגיאה לא ידועה";
        const rawBody = data?.rawBody || "";
        setErrorMsg(errMsg);
        console.error("Morning invoice error:", data);
        if (data?.linkFailed) {
          // Morning refused the link itself — offer to issue with the order's number in the text.
          setLinkFailed(true);
          setIsLoading(false);
          return;
        }
        if (data?.orderChanged) {
          // The couple's order changed (or the window had not loaded it) — reload and let the
          // owner look again; nothing was issued.
          loadOrders();
          setIsLoading(false);
          return;
        }
        const debugInfo = data?.debugPayload ? `\n\n--- DEBUG PAYLOAD ---\n${JSON.stringify(data.debugPayload, null, 2)}` : "";
        alert(`Detailed Server Error: ${rawBody || errMsg}${debugInfo}`);
      }
    } catch (e) {
      // שגיאת רשת / שרת - Drawer נשאר פתוח
      setErrorMsg(`Detailed Server Error: ${e.message}`);
      console.error("Invoice network error:", e);
      alert(`Detailed Server Error: ${e.message}`);
    }

    setIsLoading(false);
  };

  const handleCheckConnection = async () => {
    setIsCheckingConnection(true);
    setApiStatus(null);
    try {
      const res = await base44.functions.invoke("checkMorningConnection", { businessType });
      const data = res.data;
      setApiStatus({ ok: data?.success, msg: data?.message || "תשובה לא ידועה" });
    } catch (e) {
      setApiStatus({ ok: false, msg: `שגיאת רשת: ${e.message}` });
    }
    setIsCheckingConnection(false);
  };

  const handleClose = () => {
    // Never close mid-request (Escape / click outside): the invoice may already exist in
    // Morning and the owner would never see the result.
    if (isLoading) return;
    const result = created;
    setCreated(null);
    setPaymentStatusSaved(null);
    setClientName(coupleNames || "");
    setItem("");
    setDescription("");
    setAmount("");
    setPaymentMethod("4");
    setDocumentDate(todayStr);
    setErrorMsg(null);
    setApiStatus(null);
    setLatestMorningDate(null);
    onClose();
    if (result && onInvoiceCreated) onInvoiceCreated(result.url, result.amount);
  };

  // After a "תשלום יתרה" invoice the owner decides the event's payment status himself
  // (2026-10-07) — nothing changes without his click. Same field PaymentStatusSelector writes.
  const isBalanceInvoice = item === "תשלום יתרה";
  const balanceAfter = created ? (Number(liveRemaining) || 0) - created.amount : null;
  const suggestedStatus = balanceAfter != null && balanceAfter <= 0 ? "Paid" : "Partially Paid";
  const handleSetPaymentStatus = async (status) => {
    if (status === "unchanged") { setPaymentStatusSaved("unchanged"); return; }
    setIsSavingPaymentStatus(true);
    try {
      await base44.entities.Event.update(eventId, { clientPaymentStatus: status });
      setPaymentStatusSaved(status);
      toast.success(status === "Paid" ? "הסטטוס עודכן: שולם" : "הסטטוס עודכן: שולם חלקית");
    } catch (e) {
      toast.error("עדכון סטטוס התשלום נכשל", { description: e?.message });
    }
    setIsSavingPaymentStatus(false);
  };

  return (
    <>
    <Dialog open={isOpen && !replaceFor} onOpenChange={handleClose}>
      <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-md max-h-[92vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <FileText className={`w-5 h-5 ${theme.icon}`} />
            הפקת חשבונית — {businessLabel}
          </DialogTitle>
        </DialogHeader>

        {created ? (
          <div className="text-center py-6 space-y-4">
            <div className="w-16 h-16 bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
              <FileText className="w-8 h-8 text-green-400" />
            </div>
            <p className="text-green-400 font-semibold text-lg">החשבונית הופקה בהצלחה על סך ₪{created.amount.toLocaleString()}</p>
            {created.url ? (
              <>
                <a href={created.url} target="_blank" rel="noopener noreferrer">
                  <Button className={`${theme.btn} text-white gap-2 w-full`}>
                    <ExternalLink className="w-4 h-4" />
                    פתח חשבונית
                  </Button>
                </a>
                <p className="text-gray-400 text-xs break-all">{created.url}</p>
              </>
            ) : (
              <p className="text-yellow-400 text-xs">Morning לא החזיר קישור למסמך — אפשר למצוא אותו במורנינג. אין צורך להפיק שוב.</p>
            )}
            {isBalanceInvoice && (
              <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-3 space-y-2 text-right">
                <p className="text-white text-sm font-semibold">לעדכן את סטטוס התשלום של הזוג?</p>
                {!eventId ? (
                  <p className="text-gray-400 text-xs">אין אירוע מקושר — אין סטטוס תשלום לעדכן.</p>
                ) : paymentStatusSaved ? (
                  <p className="text-emerald-400 text-xs flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4" />
                    {paymentStatusSaved === "Paid" ? "עודכן: שולם" : paymentStatusSaved === "Partially Paid" ? "עודכן: שולם חלקית" : "הסטטוס נשאר כמו שהיה"}
                  </p>
                ) : (
                  <>
                    <p className="text-gray-400 text-xs">
                      יתרה אחרי החשבונית: ₪{Math.max(0, balanceAfter || 0).toLocaleString()}
                    </p>
                    <div className="flex gap-2">
                      {[
                        { value: "Paid", label: "שולם" },
                        { value: "Partially Paid", label: "שולם חלקית" },
                        { value: "unchanged", label: "בלי שינוי" },
                      ].map((opt) => (
                        <Button
                          key={opt.value}
                          size="sm"
                          disabled={isSavingPaymentStatus}
                          onClick={() => handleSetPaymentStatus(opt.value)}
                          className={`flex-1 ${
                            opt.value === suggestedStatus
                              ? "bg-emerald-600 hover:bg-emerald-700 text-white ring-2 ring-emerald-300"
                              : "bg-gray-700 hover:bg-gray-600 text-gray-200"
                          }`}
                        >
                          {opt.label}
                        </Button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            <Button variant="outline" onClick={handleClose} className="w-full border-gray-600 bg-gray-800 text-gray-300">
              סגור
            </Button>
          </div>
        ) : (
           <div className="space-y-4">
             {/* שם הלקוח */}
             <div>
               <Label className="text-gray-300 mb-1 block">שם הלקוח *</Label>
               <Input
                 value={clientName}
                 onChange={(e) => { setClientName(e.target.value); edited(); }}
                 placeholder="שם הלקוח לחשבונית"
                 className="bg-gray-800 border-gray-700 text-white"
               />
             </div>

             {/* הזמנת עבודה (2026-10-21) */}
             {ordersState === "loading" ? (
               <div className="flex items-center gap-2 text-xs text-gray-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> בודק אם לזוג יש הזמנת עבודה…</div>
             ) : ordersState === "error" ? (
               <div className="flex items-center justify-between gap-2 rounded-lg border border-red-800/60 bg-red-950/30 p-3 text-xs text-red-200">
                 <span>לא הצלחנו לבדוק אם לזוג יש הזמנת עבודה — אי אפשר להפיק עד שזה ידוע.</span>
                 <Button size="sm" variant="outline" onClick={loadOrders} className="border-red-700 bg-transparent text-red-100">נסו שוב</Button>
               </div>
             ) : pending ? (
               <PendingOrderNotice order={pending} onResolved={loadOrders} />
             ) : order ? (
               <div className="flex items-start gap-2 rounded-lg border border-sky-800/60 bg-sky-950/30 p-3 text-xs text-sky-200">
                 <Link2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
                 <span>
                   {linkMode === "link" ? "מקושרת" : "מפנה (בטקסט)"} להזמנת עבודה מס' {order.morning_number} · נשאר לחשבונית{" "}
                   <span className="font-semibold">{Math.max(0, orderLeft).toLocaleString("he-IL")} ₪</span> מתוך {Number(order.total).toLocaleString("he-IL")} ₪.
                   {" "}בחשבונית ייכתב "בהתאם להזמנת עבודה מס' {order.morning_number}".
                 </span>
               </div>
             ) : otherOrder ? (
               <div className="flex items-start gap-2 rounded-lg border border-amber-800/60 bg-amber-950/30 p-3 text-xs text-amber-200">
                 <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                 <span>לזוג יש הזמנת עבודה פעילה ב{ENTITIES[otherOrder.business_type]?.label} (מס' {otherOrder.morning_number}) — חשבונית מה{businessLabel} לא תקושר אליה.</span>
               </div>
             ) : leadId ? (
               <div className="text-xs text-gray-500">לזוג אין הזמנת עבודה — החשבונית לא תקושר להזמנה.</div>
             ) : null}

             {/* התראת מייל חסר */}
             {!clientEmail && (
               <div className="flex items-center gap-2 bg-yellow-900/20 border border-yellow-700/40 rounded-lg p-3 text-yellow-400 text-xs">
                 <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                 <span>לא קיים מייל ללקוח — ישלח לכתובת הדיפולטיבית (avira.media1@gmail.com)</span>
               </div>
             )}

             {/* שגיאה ממורנינג */}
             {errorMsg && (
               <div className="flex items-start gap-2 bg-red-900/20 border border-red-700/40 rounded-lg p-3 text-red-400 text-xs">
                 <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                 <div>
                   <p className="font-semibold mb-1">שגיאה מ-Morning:</p>
                   <p className="break-all">{errorMsg}</p>
                 </div>
               </div>
             )}

             {/* תאריך המסמך */}
            <div>
              <Label className="text-gray-300 mb-1 block">תאריך המסמך / התשלום *</Label>
              <Input
                type="date"
                value={documentDate}
                onChange={(e) => { setDocumentDate(e.target.value); setErrorMsg(null); edited(); }}
                className={`bg-gray-800 text-white ${isDateBeforeLatest ? "border-red-500" : "border-gray-700"}`}
                dir="ltr"
              />
              {isFetchingLatestDate && (
                <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> טוען תאריך מסמך אחרון ממורנינג...
                </p>
              )}
              {latestMorningDate && !isFetchingLatestDate && (
                <div className={`flex items-center gap-1.5 mt-1.5 text-xs ${isDateBeforeLatest ? "text-red-400" : "text-emerald-400"}`}>
                  <CalendarCheck className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>
                    מסמך אחרון במורנינג: <span className="font-mono font-semibold">{latestMorningDate}</span>
                    {isDateBeforeLatest
                      ? " — התאריך שנבחר קודם לכן, שינוי נדרש"
                      : " — התאריך שנבחר תקין ✓"}
                  </span>
                </div>
              )}
            </div>

            {/* פריט */}
            <div>
              <Label className="text-gray-300 mb-1 block">פריט לחיוב *</Label>
              <Select value={item} onValueChange={(val) => { setItem(val); setAmount(getAutoAmount(val)); edited(); }}>
                <SelectTrigger className="bg-gray-800 border-gray-700 text-white">
                  <SelectValue placeholder="בחר פריט..." />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-700 text-white">
                  {INVOICE_ITEMS.map((i) => (
                    <SelectItem key={i} value={i}>{i}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* תיאור נוסף */}
            <div>
              <Label className="text-gray-300 mb-1 block">תיאור (יופיע במסמך)</Label>
              <Input
                type="text"
                value={description}
                onChange={(e) => { setDescription(e.target.value); edited(); }}
                placeholder="לדוגמה: מקדמה לצילום חתונה - יוסי ומיכל"
                className="bg-gray-800 border-gray-700 text-white"
              />
            </div>

            {/* סכום */}
            <div>
              <Label className="text-gray-300 mb-1 block">סכום לתשלום (כולל מע"מ) *</Label>
              <Input
                type="number"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); edited(); }}
                placeholder="0"
                className="bg-gray-800 border-gray-700 text-white"
                dir="ltr"
              />
              {amountNum > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  לפני מע"מ: ₪{priceBeforeVat.toLocaleString()} | מע"מ {Math.round(vatRate * 100)}%: ₪{vatAmount.toLocaleString()}
                </p>
              )}
            </div>

            {/* אמצעי תשלום */}
            <div>
              <Label className="text-gray-300 mb-1 block">אמצעי תשלום *</Label>
              <Select value={paymentMethod} onValueChange={(v) => { setPaymentMethod(v); edited(); }}>
                <SelectTrigger className="bg-gray-800 border-gray-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-700 text-white">
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* סטטוס API */}
            {apiStatus && (
              <div className={`flex items-start gap-2 rounded-lg p-3 text-xs ${apiStatus.ok ? "bg-green-900/20 border border-green-700/40 text-green-400" : "bg-red-900/20 border border-red-700/40 text-red-400"}`}>
                <span className="font-semibold">סטטוס API:</span>
                <span className="break-all">{apiStatus.msg}</span>
              </div>
            )}

            {/* "תשלום יתרה" smaller than what is left on the order */}
            {partialAsk && order && (
              <div className="space-y-2 rounded-lg border border-amber-700/60 bg-amber-950/30 p-3 text-xs text-amber-100">
                <p className="font-semibold">
                  החשבונית ({amountNum.toLocaleString("he-IL")} ₪) קטנה ממה שנשאר בהזמנה מס' {order.morning_number} ({Math.max(0, orderLeft).toLocaleString("he-IL")} ₪).
                  הזוג שילם על חלק מהשירותים ישירות לספק?
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={!orderLead} onClick={() => { setPartialAsk(false); setReplaceFor(order); }} className="bg-amber-500 text-black hover:bg-amber-400">
                    כן — הוצא קודם הזמנה מעודכנת
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleSubmit({ skipPartial: true })} className="border-gray-600 bg-gray-800 text-gray-200">
                    לא, תשלום חלקי — המשך
                  </Button>
                </div>
              </div>
            )}

            {/* Morning refused the link itself */}
            {linkFailed && order && linkMode === "link" && (
              <div className="space-y-2 rounded-lg border border-red-800/60 bg-red-950/30 p-3 text-xs text-red-200">
                <p>Morning לא קיבל את הקישור להזמנה מס' {order.morning_number}. אפשר להפיק את החשבונית עם מספר ההזמנה בטקסט בלבד (בלי קישור במערכת של Morning).</p>
                <Button size="sm" onClick={() => { setLinkMode("text"); setLinkFailed(false); setErrorMsg(null); edited(); }} className="bg-red-600 text-white hover:bg-red-500">
                  הפק בלי קישור (מספר ההזמנה בטקסט)
                </Button>
              </div>
            )}

            {previewFile && <PdfPreview base64={previewFile} title="תצוגה מקדימה של החשבונית" />}

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                onClick={handlePreview}
                disabled={isPreviewing || isLoading || ordersBlocked}
                className="border-gray-600 bg-gray-800 text-gray-300 text-xs px-3"
                title="תצוגה מקדימה — לא יוצר מסמך"
              >
                {isPreviewing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
              </Button>
              <Button
                onClick={() => handleSubmit()}
                disabled={isLoading || isDateBeforeLatest || ordersBlocked}
                className={`flex-1 ${theme.btn} text-white disabled:opacity-50`}
              >
                {isLoading ? (
                  <><Loader2 className="w-4 h-4 animate-spin ml-2" /> מפיק חשבונית...</>
                ) : (
                  <><FileText className="w-4 h-4 ml-2" /> אשר והפק חשבונית</>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={handleCheckConnection}
                disabled={isCheckingConnection}
                className="border-gray-600 bg-gray-800 text-gray-300 text-xs px-3"
                title="בדוק חיבור למורנינג"
              >
                {isCheckingConnection ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wifi className="w-3 h-3" />}
              </Button>
              <Button variant="outline" onClick={handleClose} className="border-gray-600 bg-gray-800 text-gray-300">
                ביטול
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
    {replaceFor && orderLead && (
      <WorkOrderDialog
        isOpen
        onClose={() => { setReplaceFor(null); loadOrders(); }}
        lead={orderLead}
        replaceOrder={replaceFor}
        onCreated={() => { setReplaceFor(null); loadOrders(); }}
      />
    )}
    </>
  );
}
