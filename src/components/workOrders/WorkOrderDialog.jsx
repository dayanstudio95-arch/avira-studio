import React, { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, Trash2, Eye, FileText, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { todayInIsrael } from "@/lib/localDate";
import { ENTITIES, ENTITY_KEYS, defaultEntity } from "@/lib/paymentEntity";
import {
  DEFAULT_WORK_ORDER_NOTE, defaultOrderLines, packageForLead, linesTotal, orderRemarks, fmtDate, VIDEO_LINE, friendlyError, israelDateOf,
  coupleInvoices, depositInvoiceAny, businessFromInvoices, orderDateProblem, orderDateChoices,
} from "@/lib/workOrder";
import PdfPreview from "./PdfPreview";
import { notifyWorkOrdersChanged } from "./useWorkOrders";

export const WORK_ORDER_NOTE_KEY = "template_work_order_note";
const DEFAULT_REPLACE_REASON = "הלקוח בחר לשלם עבור צילום וידאו ישירות לספק";

// "הזמנת עבודה" (2026-10-21): rows (services only, from the package's split, editable), the
// remark (subcontractor clause + deposit + signing date), a preview of the real Morning PDF,
// then "הפק". With `replaceOrder` it is "הזמנה מעודכנת": same business, the rows of the old
// order to trim (e.g. remove the video), a reason — the old order is closed and kept.
export default function WorkOrderDialog({ isOpen, onClose, lead, replaceOrder = null, onCreated }) {
  const { tenantDefaults } = useAuth();
  const depositAmount = tenantDefaults?.defaultDepositAmount ?? 500;
  const today = todayInIsrael();
  const [business, setBusiness] = useState(null);
  const [lines, setLines] = useState([]);
  const [needsSplit, setNeedsSplit] = useState(false);
  const [note, setNote] = useState(DEFAULT_WORK_ORDER_NOTE);
  const [remarks, setRemarks] = useState("");
  const [reason, setReason] = useState(DEFAULT_REPLACE_REASON);
  const [supplier, setSupplier] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(null); // 'preview' | 'create'
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  // The issue did not finish (outcome unknown in Morning) — stays on screen, nothing more is issued.
  const [pendingMsg, setPendingMsg] = useState(null);
  // Replacement: also lower the couple's final price by what left the order (owner's choice).
  const [updatePrice, setUpdatePrice] = useState(true);
  // The name on the document (editable — e.g. full names) and the document's date.
  const [clientName, setClientName] = useState("");
  const [docDate, setDocDate] = useState(today);
  // Morning's window for the order's date: { today, lastDocumentDate, nextNumber } of the business.
  const [morningInfo, setMorningInfo] = useState(null);
  const [infoError, setInfoError] = useState(null);

  // The day the order was received: the digital signature; for a couple who closed outside
  // the system (imported from the old one) the owner types it — the order book requires it.
  const signedOn = israelDateOf(lead?.signedAt);
  const [manualReceived, setManualReceived] = useState("");
  const receivedOn = signedOn || manualReceived || null;
  const finalPrice = Number(lead?.finalPrice) || 0;
  const invoices = coupleInvoices(lead?.invoicesList);

  // A replacement order with no video row left drops the subcontractor clause — the video is
  // no longer part of the order, and the reason line already says why (still editable).
  // The deposit invoice is named even when the other business issued it; the couple's other
  // invoices already issued are listed too (orders recorded after the payments).
  const buildRemarks = (o = {}) => {
    const b = o.business ?? business;
    const ls = o.lines ?? lines;
    const dep = depositInvoiceAny(lead?.invoicesList, b);
    const clause = replaceOrder && !ls.some((l) => l.description === VIDEO_LINE) ? "" : (o.note ?? note);
    const label = (t) => (b && t && t !== b ? ENTITIES[t]?.label : null);
    return orderRemarks({
      note: clause,
      deposit: {
        amount: dep?.amount || depositAmount,
        invoice: dep ? { number: dep.number, date: dep.date, businessLabel: label(dep.businessType) } : null,
        orderNumber: replaceOrder && dep?.workOrderNumber ? dep.workOrderNumber : null,
      },
      prior: invoices.filter((i) => !(dep && i.number === dep.number && i.businessType === dep.businessType))
        .map((i) => ({ description: i.description, amount: i.amount, number: i.number, date: i.date, businessLabel: label(i.businessType) })),
      receivedOn: o.receivedOn !== undefined ? o.receivedOn : receivedOn,
      documentDate: o.docDate ?? docDate,
      recordedOn: today,
      replaces: replaceOrder ? { number: replaceOrder.morning_number, date: replaceOrder.document_date, reason: o.reason ?? reason, supplier: o.supplier ?? supplier } : null,
    });
  };

  // The latest builder / date, for answers that arrive after a re-render (Morning's info).
  const buildRemarksRef = useRef(buildRemarks);
  buildRemarksRef.current = buildRemarks;
  const docDateRef = useRef(docDate);
  docDateRef.current = docDate;

  // Fresh defaults each time the window opens.
  useEffect(() => {
    if (!isOpen || !lead) return;
    let alive = true;
    setPreview(null); setError(null); setLoaded(false); setSupplier(""); setReason(DEFAULT_REPLACE_REASON); setPendingMsg(null); setUpdatePrice(true);
    // a replacement keeps the name of the order it replaces (it may have been edited there)
    setClientName(String(replaceOrder?.couple_names || lead.coupleNames || "").trim()); setDocDate(today); setMorningInfo(null); setInfoError(null);
    // this couple's receipt date — never the one typed for the previous couple (the window
    // stays mounted between couples); a replacement keeps the replaced order's
    const initialManual = replaceOrder?.received_on ? String(replaceOrder.received_on).slice(0, 10) : "";
    const initialReceived = israelDateOf(lead.signedAt) || initialManual || null;
    setManualReceived(initialManual);
    // The couple's business; never set → the business of their latest invoice.
    const b = replaceOrder?.business_type || defaultEntity(lead) || businessFromInvoices(lead.invoicesList) || null;
    setBusiness(b);
    (async () => {
      const [packages, settings] = await Promise.all([
        base44.entities.Package.list().catch(() => []),
        base44.entities.AppSetting.filter({ key: WORK_ORDER_NOTE_KEY }).catch(() => []),
      ]);
      if (!alive) return;
      const n = settings?.[0]?.value?.trim() || DEFAULT_WORK_ORDER_NOTE;
      setNote(n);
      let initial;
      if (replaceOrder) {
        // The old order's rows without the video row (the usual reason) — editable.
        const old = Array.isArray(replaceOrder.lines) ? replaceOrder.lines : [];
        const kept = old.filter((l) => l.description !== VIDEO_LINE);
        initial = (kept.length ? kept : old).map((l) => ({ description: l.description, price: l.price }));
        setNeedsSplit(false);
      } else {
        const d = defaultOrderLines(finalPrice, packageForLead(lead, packages));
        initial = d.lines;
        setNeedsSplit(d.needsSplit);
      }
      setLines(initial);
      setRemarks(buildRemarks({ business: b, note: n, reason: DEFAULT_REPLACE_REASON, supplier: "", lines: initial, docDate: today, receivedOn: initialReceived }));
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, [isOpen, lead?.id, replaceOrder?.id]);

  // Morning's date window for the chosen business (read-only call). A date outside it moves
  // back to today.
  useEffect(() => {
    if (!isOpen || !business) return;
    let alive = true;
    setMorningInfo(null); setInfoError(null);
    base44.functions.invoke("generateMorningOrder", { action: "info", businessType: business })
      .then((res) => {
        if (!alive) return;
        const d = res?.data || {};
        if (!d.success) throw new Error(d.error || "לא התקבלו פרטים מ-Morning");
        setMorningInfo({ today: d.today, lastDocumentDate: d.lastDocumentDate, nextNumber: d.nextNumber, first: d.first });
        const cur = docDateRef.current;
        if (orderDateProblem(cur, { today: d.today, lastDocumentDate: d.lastDocumentDate, receivedOn })) {
          setDocDate(d.today);
          setRemarks(buildRemarksRef.current({ docDate: d.today }));
          setPreview(null);
        }
      })
      .catch((e) => {
        if (!alive) return;
        setInfoError(friendlyError(e, { fallback: "לא הצלחנו לקרוא מ-Morning את תאריך ההזמנה האחרונה" }));
        // without Morning's window only today can be issued
        if (docDateRef.current !== today) {
          setDocDate(today);
          setRemarks(buildRemarksRef.current({ docDate: today }));
          setPreview(null);
        }
      });
    return () => { alive = false; };
  }, [isOpen, business]);

  // Until Morning answered (or if it could not be read), only today — the server needs that
  // answer anyway and would refuse anything else.
  const dateWindow = morningInfo
    ? { today: morningInfo.today || today, lastDocumentDate: morningInfo.lastDocumentDate || null, receivedOn }
    : { today, lastDocumentDate: today, receivedOn };
  const depositInv = depositInvoiceAny(lead?.invoicesList, business);
  const dateChoices = orderDateChoices({ ...dateWindow, signedOn: receivedOn, depositDate: depositInv?.date || null });
  // the earliest date allowed: Morning's last order, and never before the signing day
  const minDate = [dateWindow.lastDocumentDate, receivedOn].filter(Boolean).sort().pop() || undefined;
  const receiptProblem = receivedOn && receivedOn > today ? "תאריך קבלת ההזמנה לא יכול להיות בעתיד" : null;
  const dateProblemNow = receiptProblem || (!morningInfo
    ? (docDate !== today
      ? (infoError ? "לא הצלחנו לבדוק ב-Morning איזה תאריך מותר — אפשר להוציא רק בתאריך של היום" : "בודק ב-Morning איזה תאריך מותר — רגע")
      : orderDateProblem(docDate, { today, receivedOn }))
    : orderDateProblem(docDate, dateWindow));
  const pickDate = (d) => { setDocDate(d); setRemarks(buildRemarks({ docDate: d })); setPreview(null); };

  const total = useMemo(() => linesTotal(lines), [lines]);
  const mismatch = !replaceOrder && finalPrice > 0 && Math.abs(total - finalPrice) > 0.5;
  // What leaves the order in a replacement (e.g. the video paid directly to the supplier).
  const priceDrop = replaceOrder ? Math.round((Number(replaceOrder.total) - total) * 100) / 100 : 0;
  const priceAfter = Math.max(0, finalPrice - priceDrop);

  const setLine = (i, patch) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const payload = () => ({
    businessType: business,
    leadId: lead.id,
    coupleNames: clientName.trim(),
    documentDate: docDate,
    eventDate: lead.eventDate || null,
    lines: lines.map((l) => ({ description: String(l.description || "").trim(), price: Number(l.price) })),
    remarks,
    receivedOn,
    ...(replaceOrder ? {
      replacesOrderId: replaceOrder.id,
      replaceReason: supplier ? `${reason} (${supplier})` : reason,
      updateFinalPrice: priceDrop > 0 && updatePrice,
    } : {}),
  });

  const check = () => {
    if (!business) return "בחרו מאיזה עסק להוציא";
    if (!clientName.trim()) return "חסר שם הלקוח במסמך";
    const dp = dateProblemNow;
    if (dp) return dp;
    if (!lines.length) return "צריך לפחות שורה אחת";
    if (lines.some((l) => !String(l.description || "").trim() || !(Number(l.price) > 0))) return "לכל שורה צריך תיאור וסכום";
    return null;
  };

  // A preview answer is shown only if nothing was edited while it was on its way.
  const payloadKey = useRef("");
  payloadKey.current = lead ? JSON.stringify(payload()) : "";

  const doPreview = async () => {
    const problem = check();
    if (problem) { setError(problem); return; }
    setBusy("preview"); setError(null);
    const sent = payload();
    const key = JSON.stringify(sent);
    try {
      const res = await base44.functions.invoke("generateMorningOrder", { action: "preview", ...sent });
      if (!res?.data?.file) throw new Error(res?.data?.error || "לא התקבלה תצוגה");
      if (payloadKey.current === key) setPreview(res.data.file);
    } catch (e) {
      setError(friendlyError(e, { fallback: "התצוגה נכשלה" }));
    } finally {
      setBusy(null);
    }
  };

  const doCreate = async () => {
    const problem = check();
    if (problem) { setError(problem); return; }
    const ok = await confirmDialog({
      title: replaceOrder ? `להפיק הזמנה מעודכנת ל${lead.coupleNames}?` : `להפיק הזמנת עבודה ל${lead.coupleNames}?`,
      message: `${clientName.trim()} · ${ENTITIES[business].label} · ${total.toLocaleString("he-IL")} ₪ · תאריך ${fmtDate(docDate)}${replaceOrder ? ` · הזמנה מס' ${replaceOrder.morning_number} תיסגר` : ""}\nזה מסמך אמיתי בספרים של Morning — אי אפשר לערוך או למחוק אותו אחר כך.`,
      confirmText: "הפק",
    });
    if (!ok) return;
    setBusy("create"); setError(null);
    try {
      const res = await base44.functions.invoke("generateMorningOrder", { action: "create", ...payload() });
      const d = res?.data || {};
      notifyWorkOrdersChanged(lead.id);
      if (d.success && d.order) {
        toast.success(`הזמנת עבודה מס' ${d.order.morning_number} הופקה`);
        if (d.warning) toast.warning(d.warning, { duration: 15000 });
        if (d.priceUpdate?.to != null) toast.success(`המחיר הסופי של הזוג עודכן: ${Number(d.priceUpdate.from).toLocaleString("he-IL")} ← ${Number(d.priceUpdate.to).toLocaleString("he-IL")} ₪`);
        else if (d.priceUpdate?.error) toast.error(`ההזמנה הופקה, אבל עדכון המחיר הסופי נכשל: ${d.priceUpdate.error}`, { duration: 15000 });
        onCreated?.(d.order);
        onClose();
      } else if (d.pending) {
        // Kept on screen (not a passing toast): the order may exist in Morning — issuing again
        // could create a second one. The card shows "בדוק מול Morning".
        setPendingMsg(d.warning || "לא ברור אם ההזמנה הופקה — בדקו בכרטיס הזמנת העבודה");
      } else {
        throw new Error(d.error || "ההפקה נכשלה");
      }
    } catch (e) {
      notifyWorkOrdersChanged(lead.id);
      setError(friendlyError(e, { fallback: "ההפקה נכשלה", issuing: true }));
    } finally {
      setBusy(null);
    }
  };

  if (!lead) return null;
  const tone = (k, on) => (k === "company"
    ? on ? "border-purple-400 bg-purple-600 text-white" : "border-purple-700/60 text-purple-300 hover:bg-purple-900/30"
    : on ? "border-emerald-400 bg-emerald-600 text-white" : "border-emerald-700/60 text-emerald-300 hover:bg-emerald-900/30");

  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent dir="rtl" className="max-h-[92vh] max-w-2xl overflow-y-auto border-gray-700 bg-gray-900 text-white">
        <DialogHeader>
          <DialogTitle className="text-right text-white">
            {replaceOrder ? `הזמנה מעודכנת — מחליפה את מס' ${replaceOrder.morning_number}` : "הזמנת עבודה"} · {lead.coupleNames}
          </DialogTitle>
        </DialogHeader>

        {!loaded ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl border border-gray-700 bg-gray-800/60 p-3">
              <div><span className="text-gray-400">תאריך החתימה: </span>{signedOn ? fmtDate(signedOn) : lead.signedContractPdfUrl ? "לא נשמר (יש PDF חתום)" : "לא ידוע (נסגר מחוץ למערכת)"}</div>
              <div><span className="text-gray-400">תאריך האירוע: </span>{lead.eventDate ? fmtDate(lead.eventDate) : "—"}</div>
              <div><span className="text-gray-400">חבילה: </span>{lead.packageChoice || "—"}</div>
              <div><span className="text-gray-400">מחיר סופי: </span>{finalPrice ? `${finalPrice.toLocaleString("he-IL")} ₪` : "—"}</div>
            </div>

            <div>
              <div className="mb-1.5 text-gray-300">מאיזה עסק?</div>
              <div className="grid grid-cols-2 gap-2">
                {ENTITY_KEYS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    disabled={!!replaceOrder}
                    onClick={() => { setBusiness(k); setRemarks(buildRemarks({ business: k })); setPreview(null); }}
                    className={`min-h-[44px] rounded-xl border px-3 font-semibold disabled:cursor-not-allowed ${tone(k, business === k)} ${replaceOrder && business !== k ? "opacity-40" : ""}`}
                  >
                    {ENTITIES[k].label}
                  </button>
                ))}
              </div>
              {replaceOrder && <div className="mt-1 text-xs text-gray-500">הזמנה מעודכנת יוצאת מאותו עסק של ההזמנה המקורית.</div>}
            </div>

            {!signedOn && (
              <div className="rounded-xl border border-amber-800/60 bg-amber-950/20 p-3">
                <div className="mb-1 text-gray-200">תאריך קבלת ההזמנה (חתימת החוזה)</div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="date"
                    value={manualReceived}
                    max={today}
                    onChange={(e) => { const v = e.target.value; setManualReceived(v); setRemarks(buildRemarks({ receivedOn: v || null })); setPreview(null); }}
                    className="w-44 border-gray-700 bg-gray-800 text-white"
                    dir="ltr"
                  />
                  {depositInv?.date && (
                    <button type="button" onClick={() => { const v = String(depositInv.date).slice(0, 10); setManualReceived(v); setRemarks(buildRemarks({ receivedOn: v })); setPreview(null); }}
                      className="rounded-full border border-gray-600 px-2.5 py-1 text-xs text-gray-300 hover:bg-gray-800">
                      כמו חשבונית המקדמה {fmtDate(depositInv.date)}
                    </button>
                  )}
                </div>
                <div className="mt-1 text-xs text-amber-200">
                  {manualReceived
                    ? "יודפס בהזמנה: \"ההזמנה התקבלה בתאריך …\"."
                    : lead.signedContractPdfUrl
                      ? "החתימה נקטעה באמצע: ה-PDF החתום נשמר, אבל תאריך החתימה לא נשמר. התאריך כתוב ב-PDF (\"נחתם: …\") — מלאו אותו כאן."
                      : "הזוג נסגר מחוץ למערכת, אז אין תאריך חתימה. ספר ההזמנות דורש את תאריך קבלת ההזמנה — מלאו אותו אם ידוע (מהחוזה או מהמערכת הישנה)."}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-gray-300">שם הלקוח במסמך</div>
                <Input value={clientName} onChange={(e) => { setClientName(e.target.value); setPreview(null); }} maxLength={200} placeholder="שמות הזוג" className="border-gray-700 bg-gray-800 text-white" />
                <div className="mt-1 text-xs text-gray-500">כך יופיע ב-Morning, וגם בחשבוניות שיקושרו להזמנה. אחרי ההפקה אי אפשר לשנות.</div>
              </div>
              <div>
                <div className="mb-1 text-gray-300">תאריך ההזמנה</div>
                <Input
                  type="date"
                  value={docDate}
                  min={minDate}
                  max={dateWindow.today}
                  onChange={(e) => pickDate(e.target.value)}
                  className="border-gray-700 bg-gray-800 text-white"
                  dir="ltr"
                />
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {dateChoices.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      disabled={!c.allowed}
                      onClick={() => pickDate(c.date)}
                      title={c.allowed ? "" : !morningInfo
                        ? (infoError ? "אין חיבור ל-Morning — אפשר רק בתאריך של היום" : "בודק ב-Morning איזה תאריך מותר")
                        : (orderDateProblem(c.date, dateWindow) || "")}
                      className={`rounded-full border px-2.5 py-1 text-xs ${docDate === c.date ? "border-sky-400 bg-sky-900/50 text-sky-100" : "border-gray-600 text-gray-300 hover:bg-gray-800"} disabled:cursor-not-allowed disabled:opacity-40`}
                    >
                      {c.label} {fmtDate(c.date)}
                    </button>
                  ))}
                </div>
                {dateProblemNow && <div className="mt-1 text-xs text-amber-300">{dateProblemNow}</div>}
                <div className="mt-1 text-xs text-gray-500">
                  {infoError
                    ? <span className="text-amber-300">{infoError}</span>
                    : morningInfo
                      ? (morningInfo.lastDocumentDate
                        ? <>אפשר מ-{fmtDate(minDate)} ({minDate === morningInfo.lastDocumentDate ? "ההזמנה האחרונה של העסק ב-Morning" : "חתימת החוזה"}) ועד היום{morningInfo.nextNumber ? ` · המספר הבא: ${morningInfo.nextNumber}` : ""}.</>
                        : <>זו ההזמנה הראשונה של העסק ב-Morning{morningInfo.nextNumber ? ` (מס' ${morningInfo.nextNumber})` : ""} — אפשר לבחור תאריך מהחתימה ועד היום; התצוגה המקדימה תראה אם Morning מקבל אותו. אחריה, כל הזמנה תהיה מהתאריך הזה והלאה.</>)
                      : business ? "בודק ב-Morning איזה תאריך מותר…" : "בחרו עסק כדי לראות איזה תאריך מותר."}
                </div>
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-gray-300">שורות (כולל מע״מ)</span>
                <button type="button" onClick={() => setLines((ls) => [...ls, { description: "", price: "" }])} className="flex items-center gap-1 text-xs text-sky-300 hover:text-sky-200">
                  <Plus className="h-3.5 w-3.5" /> שורה
                </button>
              </div>
              <div className="space-y-1.5">
                {lines.map((l, i) => (
                  <div key={i} className="flex gap-1.5">
                    <Input value={l.description} onChange={(e) => { setLine(i, { description: e.target.value }); setPreview(null); }} placeholder="תיאור" className="flex-1 border-gray-700 bg-gray-800 text-white" />
                    <Input type="number" inputMode="decimal" value={l.price} onChange={(e) => { setLine(i, { price: e.target.value }); setPreview(null); }} placeholder="₪" className="w-28 border-gray-700 bg-gray-800 text-white" dir="ltr" />
                    <button type="button" aria-label="מחק שורה" onClick={() => { setLines((ls) => ls.filter((_, j) => j !== i)); setPreview(null); }} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-700 text-gray-400 hover:text-red-400">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-1.5 flex items-center justify-between">
                <span className="font-semibold">סה״כ: {total.toLocaleString("he-IL")} ₪ כולל מע״מ</span>
                {mismatch && <span className="text-xs text-amber-300">לא שווה למחיר הסופי של הזוג ({finalPrice.toLocaleString("he-IL")} ₪)</span>}
              </div>
              {needsSplit && (
                <div className="mt-1.5 rounded-lg bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
                  {needsSplit === "no_package"
                    ? "לא נמצאה חבילה תואמת לזוג — חלקו כאן את השורות (סטילס / וידאו) לפני ההפקה."
                    : needsSplit === "video_over"
                      ? `מחיר הווידאו בחבילה "${lead.packageChoice || ""}" לא נמוך מהמחיר הסופי של הזוג — חלקו כאן את השורות ידנית.`
                      : `לחבילה "${lead.packageChoice || ""}" עוד לא הוגדר כמה מהמחיר הוא סטילס וכמה וידאו (הגדרות ← חבילות ומחירים). אפשר לפצל כאן ידנית.`}
                </div>
              )}
            </div>

            <div>
              <div className="mb-1 text-gray-300">החשבוניות של הזוג</div>
              {invoices.length === 0 ? (
                <div className="text-xs text-gray-500">עוד לא הופקו חשבוניות לזוג.</div>
              ) : (
                <div className="divide-y divide-gray-800 rounded-lg border border-gray-700 bg-gray-800/40 text-xs">
                  {invoices.map((i, idx) => (
                    <div key={`${i.number}-${idx}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-2.5 py-1.5">
                      <span className="font-semibold text-gray-100">{fmtDate(i.date)} · {i.description || "חשבונית"}</span>
                      <span className="text-gray-300">
                        {Number(i.amount).toLocaleString("he-IL")} ₪ · מס' {i.number || "—"}
                        <span className={`mr-1.5 rounded-full px-1.5 py-0.5 ${i.businessType === "company" ? "bg-purple-500/20 text-purple-200" : "bg-emerald-500/20 text-emerald-200"}`}>{ENTITIES[i.businessType]?.short}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {business && invoices.some((i) => i.businessType !== business) && (
                <div className="mt-1 text-xs text-amber-300">חלק מהחשבוניות הופקו מה{ENTITIES[business === "company" ? "sole_prop" : "company"]?.label} — הן מופיעות בהערות עם שם העסק.</div>
              )}
            </div>

            {replaceOrder && priceDrop > 0 && finalPrice > 0 && (
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-700 bg-gray-800/60 p-2.5 text-xs text-gray-200">
                <input type="checkbox" checked={updatePrice} onChange={(e) => setUpdatePrice(e.target.checked)} className="mt-0.5 h-4 w-4 accent-amber-500" />
                <span>
                  לעדכן את המחיר הסופי של הזוג: {finalPrice.toLocaleString("he-IL")} ← <span className="font-semibold">{priceAfter.toLocaleString("he-IL")} ₪</span> (גם באירוע)
                  <span className="block text-gray-500">כך היתרה, דרישת התשלום והדוחות לא יכללו את מה ששולם ישירות לספק.</span>
                </span>
              </label>
            )}

            {replaceOrder && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-gray-300">סיבת העדכון</div>
                  <Input value={reason} onChange={(e) => { setReason(e.target.value); setRemarks(buildRemarks({ reason: e.target.value })); setPreview(null); }} className="border-gray-700 bg-gray-800 text-white" />
                </div>
                <div>
                  <div className="mb-1 text-gray-300">שם הספק (לא חובה)</div>
                  <Input value={supplier} onChange={(e) => { setSupplier(e.target.value); setRemarks(buildRemarks({ supplier: e.target.value })); setPreview(null); }} placeholder="למשל: דודו וידאו" className="border-gray-700 bg-gray-800 text-white" />
                </div>
              </div>
            )}

            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-gray-300">הערות שיודפסו על ההזמנה</span>
                <button type="button" onClick={() => { setRemarks(buildRemarks()); setPreview(null); }} className="flex items-center gap-1 text-xs text-gray-400 hover:text-white">
                  <RotateCcw className="h-3.5 w-3.5" /> לנוסח המקורי
                </button>
              </div>
              <Textarea value={remarks} onChange={(e) => { setRemarks(e.target.value); setPreview(null); }} rows={6} className="border-gray-700 bg-gray-800 text-sm text-white" />
              <div className="mt-1 text-xs text-gray-500">את סעיף הספק אפשר לשנות פעם אחת בהגדרות ← תבניות ← "הזמנת עבודה — סעיף ספק".</div>
            </div>

            {error && <div className="rounded-lg border border-red-800/60 bg-red-950/40 p-3 text-xs text-red-300">{error}</div>}
            {pendingMsg && <div className="rounded-lg border border-amber-700/60 bg-amber-950/40 p-3 text-sm font-semibold text-amber-100">{pendingMsg}</div>}

            {preview && <PdfPreview base64={preview} title="תצוגה מקדימה של ההזמנה" />}

            <div className="flex flex-wrap gap-2">
              <Button onClick={doPreview} disabled={!!busy || !!pendingMsg} variant="outline" className="border-gray-600 bg-gray-800 text-gray-200">
                {busy === "preview" ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Eye className="ml-2 h-4 w-4" />} תצוגה מקדימה
              </Button>
              <Button onClick={doCreate} disabled={!!busy || !business || !!pendingMsg} className={`flex-1 text-white ${business === "company" ? "bg-purple-600 hover:bg-purple-700" : "bg-emerald-600 hover:bg-emerald-700"}`}>
                {busy === "create" ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <FileText className="ml-2 h-4 w-4" />}
                {replaceOrder ? "הפק הזמנה מעודכנת" : "הפק הזמנת עבודה"}
              </Button>
              <Button variant="outline" onClick={onClose} disabled={!!busy} className="border-gray-600 bg-gray-800 text-gray-300">ביטול</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
