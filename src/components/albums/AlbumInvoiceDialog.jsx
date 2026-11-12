import React, { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, ExternalLink, Loader2, AlertTriangle, XCircle, CalendarCheck, CheckCircle2, Eye } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { todayInIsrael } from "@/lib/localDate";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { ENTITIES, ENTITY_KEYS, defaultEntity } from "@/lib/paymentEntity";
import PdfPreview from "@/components/workOrders/PdfPreview";
import { albumInvoiceDescription, albumInvoiceState, lastAlbumInvoice, leftToInvoice, invoicedTotal, MAX_ALBUM_INVOICE_TEXT } from "@/lib/albumInvoice";

// חשבונית מס קבלה on an album order (2026-11-12, approved from a mockup): everything filled from the order — the
// couple's name, the amount still without an invoice, the line text from the chosen products, and the couple's
// business. Issued by generate-morning-invoice with `albumOrderId` (saved on the album order, never on the lead,
// never linked to the photography work order). See src/lib/albumInvoice.js.

// Morning payment type codes: 1=מזומן, 2=צ'ק, 4=העברה בנקאית, 10=ביט
const PAYMENT_METHODS = [
  { value: "4", label: "העברה בנקאית" },
  { value: "10", label: "ביט" },
  { value: "1", label: "מזומן" },
  { value: "2", label: "צ'ק" },
];

const ils = (n) => `₪${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString("he-IL")}`;

export default function AlbumInvoiceDialog({ isOpen, onClose, order, coupleNames, eventDate, leadId, onDone }) {
  const todayStr = todayInIsrael();
  const { tenantDefaults } = useAuth();
  const vatPercent = tenantDefaults?.defaultVatPercent ?? 18;

  const [businessType, setBusinessType] = useState("sole_prop");
  const [businessTouched, setBusinessTouched] = useState(false);
  const touchedRef = useRef(false); // the owner picked a business — the couple's one no longer replaces it
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [text, setText] = useState("אלבומים");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("4");
  const [documentDate, setDocumentDate] = useState(todayStr);
  const [markPaid, setMarkPaid] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [latestMorningDate, setLatestMorningDate] = useState(null);
  const [isFetchingLatestDate, setIsFetchingLatestDate] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [created, setCreated] = useState(null); // { number, url, amount, markedPaid, warning }

  const alreadyPaid = order?.paymentStatus === "paid";
  const left = leftToInvoice(order);
  const invoiced = invoicedTotal(order);
  const amountNum = parseFloat(amount) || 0;
  const vatRate = vatPercent / 100;
  const beforeVat = +(amountNum / (1 + vatRate)).toFixed(2);
  const vatAmount = +(amountNum - beforeVat).toFixed(2);
  const isDateBeforeLatest = latestMorningDate && documentDate < latestMorningDate;
  const isCompany = businessType === "company";
  const theme = isCompany
    ? { icon: "text-purple-400", btn: "bg-purple-600 hover:bg-purple-700" }
    : { icon: "text-emerald-400", btn: "bg-emerald-600 hover:bg-emerald-700" };

  // Fill everything from the order each time the window opens.
  useEffect(() => {
    if (!isOpen || !order) return;
    let alive = true;
    setCreated(null);
    setErrorMsg(null);
    setPreviewFile(null);
    setBusinessTouched(false);
    touchedRef.current = false;
    setBusinessType("sole_prop");
    setClientName(coupleNames || "");
    setClientEmail("");
    setAmount(left > 0 ? String(left) : order.totalAmount ? String(order.totalAmount) : "");
    setPaymentMethod("4");
    setDocumentDate(todayStr);
    setMarkPaid(true);
    setText("אלבומים");
    setLoadingDetails(true);
    (async () => {
      const [sel, add, lead] = await Promise.all([
        supabase.from("album_order_selections").select("product_name_snapshot, cover_name_snapshot").eq("album_order_id", order.id).order("created_at"),
        supabase.from("album_order_addons").select("addon_name_snapshot, quantity").eq("album_order_id", order.id).order("created_at"),
        leadId
          ? supabase.from("leads").select("email, payment_entity, payment_request_entity").eq("id", leadId).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      if (!alive) return;
      setText(albumInvoiceDescription(sel.data || [], add.data || []));
      const l = lead?.data;
      if (l) {
        setClientEmail(l.email || "");
        const ent = defaultEntity({ paymentEntity: l.payment_entity, paymentRequestEntity: l.payment_request_entity });
        if (ent && !touchedRef.current) setBusinessType(ent);
      }
      setLoadingDetails(false);
    })().catch(() => alive && setLoadingDetails(false));
    return () => { alive = false; };
  }, [isOpen, order?.id]);

  // The last document date in Morning for the chosen business — an invoice can't be dated before it.
  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    setLatestMorningDate(null);
    setIsFetchingLatestDate(true);
    base44.functions.invoke("getLatestMorningDocumentDate", { businessType })
      .then((res) => { if (alive && res.data?.found && res.data?.latestDocumentDate) setLatestMorningDate(res.data.latestDocumentDate); })
      .catch(() => {})
      .finally(() => alive && setIsFetchingLatestDate(false));
    return () => { alive = false; };
  }, [isOpen, businessType]);

  const edited = () => { setPreviewFile(null); setErrorMsg(null); };

  const body = () => ({
    clientName: clientName.trim(),
    clientEmail: clientEmail || "avira.media1@gmail.com",
    itemDescription: text.trim() || "אלבומים",
    itemNotes: "אלבום",
    amount: amountNum,
    paymentMethodType: parseInt(paymentMethod, 10),
    documentDate,
    eventDate: eventDate || "",
    businessType,
    albumOrderId: order.id,
    markPaid: !alreadyPaid && markPaid,
  });

  const missing = () => {
    if (!clientName.trim()) return "חסר שם לקוח";
    if (!amountNum || amountNum <= 0) return "חסר סכום";
    if (!text.trim()) return "חסר מה ייכתב בחשבונית";
    return null;
  };

  const handlePreview = async () => {
    const m = missing();
    if (m) { setErrorMsg(m); return; }
    setIsPreviewing(true);
    setErrorMsg(null);
    try {
      const res = await base44.functions.invoke("generateMorningInvoice", { ...body(), preview: true });
      if (res.data?.file) setPreviewFile(res.data.file);
      else setErrorMsg(res.data?.error || "התצוגה נכשלה");
    } catch (e) {
      setErrorMsg(e?.message || "התצוגה נכשלה");
    }
    setIsPreviewing(false);
  };

  const handleSubmit = async () => {
    const m = missing();
    if (m) { setErrorMsg(m); return; }
    if (isDateBeforeLatest) {
      setErrorMsg(`תאריך המסמך (${documentDate}) קודם למסמך האחרון במורנינג (${latestMorningDate}). צריך תאריך מאוחר יותר.`);
      return;
    }
    if (left > 0 && amountNum > left + 0.001) {
      const ok = await confirmDialog({
        title: "הסכום גבוה מההזמנה",
        message: `על ההזמנה נשארו ${ils(left)} בלי חשבונית. להפיק בכל זאת על ${ils(amountNum)}?`,
        confirmText: "להפיק בכל זאת",
      });
      if (!ok) return;
    }
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await base44.functions.invoke("generateMorningInvoice", body());
      const data = res.data || {};
      if (data.success || data.warning || data.invoiceUrl) {
        setCreated({
          number: data.invoiceNumber,
          url: data.invoiceUrl || null,
          amount: amountNum,
          markedPaid: !!data.markedPaid,
          warning: data.warning || null,
        });
        if (data.warning) toast.error(data.warning);
        else toast.success(`חשבונית מס קבלה ${data.invoiceNumber ?? ""} הופקה על ${ils(amountNum)}`);
      } else {
        setErrorMsg(data.error || "ההפקה נכשלה");
        console.error("Album invoice error:", data);
      }
    } catch (e) {
      setErrorMsg(e?.message || "ההפקה נכשלה");
    }
    setIsLoading(false);
  };

  const handleClose = () => {
    if (isLoading) return; // the invoice may already exist in Morning — never close mid-request
    const done = !!created;
    setCreated(null);
    onClose();
    if (done) onDone?.();
  };

  if (!order) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-md max-h-[92vh] overflow-y-auto" dir="rtl" data-testid="album-invoice-dialog">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <FileText className={`w-5 h-5 ${theme.icon}`} />
            חשבונית מס קבלה, אלבום
          </DialogTitle>
        </DialogHeader>

        {created ? (
          <div className="text-center py-4 space-y-4" data-testid="album-invoice-done">
            <div className="w-16 h-16 bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
              <FileText className="w-8 h-8 text-green-400" />
            </div>
            <p className="text-green-400 font-semibold text-lg">
              חשבונית מס קבלה {created.number} הופקה על {ils(created.amount)}
            </p>
            {created.warning && (
              <p className="rounded-lg border border-amber-700/50 bg-amber-950/30 p-3 text-right text-xs text-amber-200">{created.warning}</p>
            )}
            {created.markedPaid && (
              <p className="flex items-center justify-center gap-1 text-sm text-emerald-300">
                <CheckCircle2 className="w-4 h-4" /> ההזמנה סומנה "שולם"
              </p>
            )}
            {created.url ? (
              <a href={created.url} target="_blank" rel="noopener noreferrer" className="block">
                <Button className={`${theme.btn} text-white gap-2 w-full`}>
                  <ExternalLink className="w-4 h-4" /> פתיחת החשבונית
                </Button>
              </a>
            ) : (
              <p className="text-yellow-400 text-xs">Morning לא החזיר קישור למסמך. אפשר למצוא אותו במורנינג, אין צורך להפיק שוב.</p>
            )}
            <Button variant="outline" onClick={handleClose} className="w-full border-gray-600 bg-gray-800 text-gray-300">
              סגירה
            </Button>
          </div>
        ) : (
          <div className="space-y-3.5">
            {/* העסק */}
            <div className="flex gap-2" data-testid="album-invoice-business">
              {ENTITY_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => { setBusinessType(k); setBusinessTouched(true); touchedRef.current = true; edited(); }}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${businessType === k ? (k === "company" ? "border-purple-500 bg-purple-500/15 text-purple-200" : "border-emerald-500 bg-emerald-500/15 text-emerald-200") : "border-gray-700 bg-gray-800/60 text-gray-400 hover:bg-gray-800"}`}
                >
                  {ENTITIES[k].label}
                </button>
              ))}
            </div>
            {businessTouched ? null : leadId && !loadingDetails ? (
              <p className="-mt-1.5 text-[11px] text-gray-500">לפי העסק של הזוג. אפשר להחליף.</p>
            ) : null}

            {invoiced > 0 && (
              <div className="rounded-lg border border-sky-800/60 bg-sky-950/30 p-2.5 text-xs text-sky-200">
                על ההזמנה כבר הופקו חשבוניות על {ils(invoiced)}. נשארו {ils(left)} בלי חשבונית.
              </div>
            )}

            <div>
              <Label className="text-gray-300 mb-1 block">שם הלקוח</Label>
              <Input value={clientName} onChange={(e) => { setClientName(e.target.value); edited(); }} className="bg-gray-800 border-gray-700 text-white" data-testid="album-invoice-name" />
            </div>

            <div>
              <Label className="text-gray-300 mb-1 block">מה ייכתב בחשבונית (מההזמנה, אפשר לשנות)</Label>
              <Textarea
                value={text}
                maxLength={MAX_ALBUM_INVOICE_TEXT}
                rows={2}
                onChange={(e) => { setText(e.target.value); edited(); }}
                className="bg-gray-800 border-gray-700 text-white text-sm"
                data-testid="album-invoice-text"
              />
              {loadingDetails && (
                <p className="text-xs text-gray-500 mt-1 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> טוען את פרטי ההזמנה…</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-gray-300 mb-1 block">סכום (כולל מע״מ)</Label>
                <Input type="number" dir="ltr" value={amount} onChange={(e) => { setAmount(e.target.value); edited(); }} className="bg-gray-800 border-gray-700 text-amber-300 font-semibold" data-testid="album-invoice-amount" />
              </div>
              <div>
                <Label className="text-gray-300 mb-1 block">איך שילמו</Label>
                <Select value={paymentMethod} onValueChange={(v) => { setPaymentMethod(v); edited(); }}>
                  <SelectTrigger className="bg-gray-800 border-gray-700 text-white"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700 text-white">
                    {PAYMENT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {amountNum > 0 && vatPercent > 0 && (
              <p className="-mt-2 text-xs text-gray-500">לפני מע״מ {ils(beforeVat)} · מע״מ {ils(vatAmount)}</p>
            )}

            <div className="grid grid-cols-2 gap-2 items-end">
              <div>
                <Label className="text-gray-300 mb-1 block">תאריך המסמך</Label>
                <Input type="date" dir="ltr" value={documentDate} onChange={(e) => { setDocumentDate(e.target.value); edited(); }} className={`bg-gray-800 text-white ${isDateBeforeLatest ? "border-red-500" : "border-gray-700"}`} />
              </div>
              {!alreadyPaid && (
                <label className="flex items-center gap-2 pb-2 text-sm text-gray-200 cursor-pointer select-none">
                  <input type="checkbox" checked={markPaid} onChange={(e) => setMarkPaid(e.target.checked)} className="h-4 w-4 accent-emerald-500" data-testid="album-invoice-mark-paid" />
                  לסמן את ההזמנה "שולם"
                </label>
              )}
            </div>
            {isFetchingLatestDate ? (
              <p className="-mt-1.5 text-xs text-gray-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> בודק את המסמך האחרון במורנינג…</p>
            ) : latestMorningDate ? (
              <p className={`-mt-1.5 flex items-center gap-1.5 text-xs ${isDateBeforeLatest ? "text-red-400" : "text-emerald-400"}`}>
                <CalendarCheck className="w-3.5 h-3.5" /> מסמך אחרון במורנינג: <span className="font-mono">{latestMorningDate}</span>
                {isDateBeforeLatest ? " — צריך תאריך מאוחר יותר" : " ✓"}
              </p>
            ) : null}

            {!clientEmail && leadId && !loadingDetails && (
              <div className="flex items-center gap-2 rounded-lg border border-yellow-700/40 bg-yellow-900/20 p-2.5 text-xs text-yellow-300">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" /> אין מייל לזוג, אז המסמך יגיע לכתובת של הסטודיו.
              </div>
            )}

            <p className="rounded-lg border border-sky-800/40 bg-sky-950/20 p-2.5 text-xs leading-relaxed text-sky-200/90">
              החשבונית נשמרת על הזמנת האלבום ומופיעה ב"ניהול חשבוניות". היא לא מורידה מהיתרה של חבילת הצילום של הזוג.
            </p>

            {errorMsg && (
              <div className="flex items-start gap-2 rounded-lg border border-red-700/40 bg-red-900/20 p-3 text-xs text-red-300" data-testid="album-invoice-error">
                <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span className="break-all">{errorMsg}</span>
              </div>
            )}

            {previewFile && <PdfPreview base64={previewFile} title="תצוגה מקדימה של החשבונית" />}

            <div className="flex gap-2 pt-1">
              <Button variant="outline" onClick={handlePreview} disabled={isPreviewing || isLoading} className="border-gray-600 bg-gray-800 text-gray-200 gap-1.5" data-testid="album-invoice-preview">
                {isPreviewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />} תצוגה מקדימה
              </Button>
              <Button onClick={handleSubmit} disabled={isLoading || isDateBeforeLatest || loadingDetails} className={`flex-1 ${theme.btn} text-white disabled:opacity-50`} data-testid="album-invoice-submit">
                {isLoading ? <><Loader2 className="w-4 h-4 animate-spin ml-2" /> מפיק…</> : <>הפקת חשבונית {amountNum > 0 ? ils(amountNum) : ""}</>}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// The album orders list: "הוצאת חשבונית" (amber) while the order has a total and no invoice; the invoice's number
// (green — opens the PDF) once issued; "חשבונית על ההפרש" too when something was added to the order since.
// Inside the row's <Link>, so every click stops there.
export function AlbumInvoiceChip({ order, onIssue }) {
  const state = albumInvoiceState(order);
  if (state === "none") return null;
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  const last = lastAlbumInvoice(order);
  return (
    <>
      {last && (
        <button
          type="button"
          title={last.url ? "פתיחת החשבונית" : "חשבונית מס קבלה"}
          onClick={(e) => { stop(e); if (last.url) window.open(last.url, "_blank", "noopener,noreferrer"); }}
          className="inline-flex h-6 items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25"
          data-testid="album-invoice-chip"
        >
          <CheckCircle2 className="h-3.5 w-3.5" /> חשבונית {last.number}
        </button>
      )}
      {state !== "done" && (
        <button
          type="button"
          onClick={(e) => { stop(e); onIssue(order); }}
          className="inline-flex h-6 items-center gap-1 rounded-md border border-amber-500/60 bg-amber-500/10 px-2 text-xs font-medium text-amber-300 hover:bg-amber-500/20"
          data-testid="album-invoice-issue"
        >
          <FileText className="h-3.5 w-3.5" /> {state === "partial" ? `חשבונית על ההפרש ${ils(leftToInvoice(order))}` : "הוצאת חשבונית"}
        </button>
      )}
    </>
  );
}
