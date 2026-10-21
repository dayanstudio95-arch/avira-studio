import React, { useState } from "react";
import { AlertTriangle, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { fmtDate, friendlyError } from "@/lib/workOrder";
import { notifyWorkOrdersChanged } from "./useWorkOrders";

// An order whose issue did not finish (the connection broke while Morning answered). Until it
// is checked against Morning nothing new is issued for that business. "בדוק מול Morning"
// searches Morning's order documents: this order there → completed; no unrecorded order at
// all → released; unrecorded ones that are not surely this one → the owner picks, or (owner
// only, after checking Morning himself) releases.
export default function PendingOrderNotice({ order, onResolved }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState(null);
  const [failed, setFailed] = useState(false);
  if (!order) return null;

  const run = async (extra = {}) => {
    setBusy(true);
    try {
      const res = await base44.functions.invoke("generateMorningOrder", { action: "resolve", orderId: order.id, ...extra });
      const d = res?.data || {};
      if (d.resolved === "issued" && d.order) {
        toast.success(`ההזמנה נמצאה ב-Morning (מס' ${d.order.morning_number}) והושלמה`);
        if (d.warning) toast.warning(d.warning, { duration: 15000 });
        if (d.order.replaces_order_id) toast.warning("המחיר הסופי של הזוג לא עודכן אוטומטית — אם צריך, עדכנו אותו ב'ערוך ליד'.", { duration: 15000 });
      } else if (d.resolved === "not_issued") {
        toast.success("ההזמנה לא הופקה ב-Morning — אפשר להפיק אותה מחדש");
      } else if (d.needsPick) {
        setCandidates(d.candidates || []);
        setFailed(true);
        toast.warning(d.error);
        return;
      } else if (d.pending) {
        toast.error(d.warning || "עדיין לא הושלם — נסו שוב בעוד כמה דקות", { duration: 15000 });
        return;
      } else {
        throw new Error(d.error || "הבדיקה נכשלה");
      }
      setCandidates(null);
      notifyWorkOrdersChanged(order.lead_id);
      onResolved?.();
    } catch (e) {
      setFailed(true);
      toast.error(friendlyError(e, { fallback: "הבדיקה נכשלה" }), { duration: 15000 });
    } finally {
      setBusy(false);
    }
  };

  const forceRelease = async () => {
    const ok = await confirmDialog({
      title: "לשחרר את ההזמנה שבבדיקה?",
      message: "עשו את זה רק אחרי שבדקתם ב-Morning (מסמכים ← הזמנות) שההזמנה של הזוג לא נוצרה שם. אחרי השחרור אפשר להפיק אותה מחדש — ואם היא כן קיימת ב-Morning, תהיה כפולה.",
      confirmText: "בדקתי — לשחרר",
      danger: true,
    });
    if (ok) run({ forceRelease: true });
  };

  return (
    <div className="space-y-2 rounded-lg border border-amber-700/60 bg-amber-950/30 p-2.5 text-xs text-amber-100" dir="rtl">
      <div className="flex items-start gap-1.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-300" />
        <span>
          הפקת הזמנה{order.replaces_order_id ? " מעודכנת" : ""} מיום {fmtDate(order.document_date)} ({Number(order.total).toLocaleString("he-IL")} ₪) לא הסתיימה — לא ידוע אם היא נוצרה ב-Morning.
          עד הבדיקה לא מפיקים הזמנה או חשבונית מהעסק הזה.
        </span>
      </div>
      {candidates?.length > 0 && (
        <div className="space-y-1">
          <div className="text-amber-200">הזמנות ב-Morning שלא רשומות במערכת — איזו מהן של הזוג?</div>
          {candidates.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-1.5 rounded bg-gray-900/60 px-2 py-1.5">
              <span>מס' {c.number} · {c.client} · {Number(c.amount).toLocaleString("he-IL")} ₪{c.documentDate ? ` · ${fmtDate(c.documentDate)}` : ""}</span>
              <button type="button" disabled={busy} onClick={() => run({ pickMorningId: c.id })} className="rounded bg-sky-700 px-2 py-1 font-semibold text-white hover:bg-sky-600 disabled:opacity-60">
                זו ההזמנה
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => run()}
          disabled={busy}
          className="flex min-h-[36px] items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 font-semibold text-black hover:bg-amber-400 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} בדוק מול Morning
        </button>
        {failed && user?.role === "owner" && (
          <button type="button" onClick={forceRelease} disabled={busy} className="min-h-[36px] rounded-lg border border-red-700 px-3 py-1.5 text-red-200 hover:bg-red-950/50 disabled:opacity-60">
            בדקתי ב-Morning, היא לא שם — לשחרר
          </button>
        )}
      </div>
    </div>
  );
}
