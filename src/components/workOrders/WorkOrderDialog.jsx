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
  DEFAULT_WORK_ORDER_NOTE, defaultOrderLines, packageForLead, linesTotal, orderRemarks, depositInvoiceOf, fmtDate, VIDEO_LINE, friendlyError, israelDateOf,
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

  const receivedOn = israelDateOf(lead?.signedAt);
  const finalPrice = Number(lead?.finalPrice) || 0;

  // A replacement order with no video row left drops the subcontractor clause — the video is
  // no longer part of the order, and the reason line already says why (still editable).
  const buildRemarks = (b, n, rsn, sup, ls = lines) => {
    const dep = depositInvoiceOf(lead?.invoicesList, b);
    const clause = replaceOrder && !ls.some((l) => l.description === VIDEO_LINE) ? "" : n;
    return orderRemarks({
      note: clause,
      deposit: { amount: dep?.amount || depositAmount, invoice: dep ? { number: dep.number, date: dep.date } : null, orderNumber: replaceOrder && dep?.workOrderNumber ? dep.workOrderNumber : null },
      receivedOn,
      documentDate: today,
      replaces: replaceOrder ? { number: replaceOrder.morning_number, date: replaceOrder.document_date, reason: rsn, supplier: sup } : null,
    });
  };

  // Fresh defaults each time the window opens.
  useEffect(() => {
    if (!isOpen || !lead) return;
    let alive = true;
    setPreview(null); setError(null); setLoaded(false); setSupplier(""); setReason(DEFAULT_REPLACE_REASON); setPendingMsg(null); setUpdatePrice(true);
    const b = replaceOrder?.business_type || defaultEntity(lead) || null;
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
      setRemarks(buildRemarks(b, n, DEFAULT_REPLACE_REASON, "", initial));
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, [isOpen, lead?.id, replaceOrder?.id]);

  const total = useMemo(() => linesTotal(lines), [lines]);
  const mismatch = !replaceOrder && finalPrice > 0 && Math.abs(total - finalPrice) > 0.5;
  // What leaves the order in a replacement (e.g. the video paid directly to the supplier).
  const priceDrop = replaceOrder ? Math.round((Number(replaceOrder.total) - total) * 100) / 100 : 0;
  const priceAfter = Math.max(0, finalPrice - priceDrop);

  const setLine = (i, patch) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const payload = () => ({
    businessType: business,
    leadId: lead.id,
    coupleNames: lead.coupleNames,
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
      message: `${ENTITIES[business].label} · ${total.toLocaleString("he-IL")} ₪${replaceOrder ? ` · הזמנה מס' ${replaceOrder.morning_number} תיסגר` : ""}\nזה מסמך אמיתי בספרים של Morning — אי אפשר לערוך או למחוק אותו אחר כך.`,
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
              <div><span className="text-gray-400">תאריך ההזמנה: </span>{fmtDate(today)}</div>
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
                    onClick={() => { setBusiness(k); setRemarks(buildRemarks(k, note, reason, supplier)); setPreview(null); }}
                    className={`min-h-[44px] rounded-xl border px-3 font-semibold disabled:cursor-not-allowed ${tone(k, business === k)} ${replaceOrder && business !== k ? "opacity-40" : ""}`}
                  >
                    {ENTITIES[k].label}
                  </button>
                ))}
              </div>
              {replaceOrder && <div className="mt-1 text-xs text-gray-500">הזמנה מעודכנת יוצאת מאותו עסק של ההזמנה המקורית.</div>}
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
                  <Input value={reason} onChange={(e) => { setReason(e.target.value); setRemarks(buildRemarks(business, note, e.target.value, supplier)); setPreview(null); }} className="border-gray-700 bg-gray-800 text-white" />
                </div>
                <div>
                  <div className="mb-1 text-gray-300">שם הספק (לא חובה)</div>
                  <Input value={supplier} onChange={(e) => { setSupplier(e.target.value); setRemarks(buildRemarks(business, note, reason, e.target.value)); setPreview(null); }} placeholder="למשל: דודו וידאו" className="border-gray-700 bg-gray-800 text-white" />
                </div>
              </div>
            )}

            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-gray-300">הערות שיודפסו על ההזמנה</span>
                <button type="button" onClick={() => { setRemarks(buildRemarks(business, note, reason, supplier)); setPreview(null); }} className="flex items-center gap-1 text-xs text-gray-400 hover:text-white">
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
