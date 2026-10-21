import React, { useState } from "react";
import { ClipboardList, ExternalLink, RefreshCw, Loader2 } from "lucide-react";
import { ENTITIES } from "@/lib/paymentEntity";
import { orderBalance, fmtDate } from "@/lib/workOrder";
import { useWorkOrders } from "./useWorkOrders";
import WorkOrderDialog from "./WorkOrderDialog";
import PendingOrderNotice from "./PendingOrderNotice";

// The couple's work order in the lead panel / the chat's client card (2026-10-21): number,
// total, what is left to invoice, the PDF, "הזמנה מעודכנת" — or "הפק הזמנת עבודה".
export default function WorkOrderCard({ lead, onChanged, compact = false }) {
  const { orders, invoices, loading, error, reload } = useWorkOrders(lead?.id);
  const [dialog, setDialog] = useState(null); // { replace: order|null }
  if (!lead) return null;
  const actives = orders.filter((o) => o.status === "active");
  const pending = orders.filter((o) => o.status === "issuing");
  // the order a pending replacement is replacing — shown with its notice, not as active
  const history = orders.filter((o) => o.status === "replaced" || o.status === "closed");
  const invoiceList = invoices || lead.invoicesList || [];
  const loaded = !loading || orders.length > 0;
  const btn = "flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold";

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/40 p-2.5 text-sm" dir="rtl">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs text-gray-400">
        <ClipboardList className="h-3.5 w-3.5" /> הזמנת עבודה (ספר הזמנות)
        {loading && <Loader2 className="h-3 w-3 animate-spin" />}
      </div>
      {error ? (
        <div className="flex items-center justify-between gap-2 text-xs text-red-300">
          <span>{error}</span>
          <button type="button" onClick={reload} className="underline">נסו שוב</button>
        </div>
      ) : !loaded ? null : (actives.length === 0 && pending.length === 0) ? (
        <button type="button" onClick={() => setDialog({ replace: null })} className={`${btn} w-full bg-sky-700 text-white hover:bg-sky-600`}>
          <ClipboardList className="h-4 w-4" /> הפק הזמנת עבודה
        </button>
      ) : (
        actives.map((o) => {
          const left = orderBalance(o, invoiceList);
          return (
            <div key={o.id} className="space-y-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-1">
                <span className="font-semibold text-white">
                  הזמנה מס' {o.morning_number} · {Number(o.total).toLocaleString("he-IL")} ₪
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${o.business_type === "company" ? "bg-purple-500/20 text-purple-200" : "bg-emerald-500/20 text-emerald-200"}`}>
                  {ENTITIES[o.business_type]?.short}
                </span>
              </div>
              <div className="text-xs text-gray-400">
                מיום {fmtDate(o.document_date)} · נשאר לחשבונית: <span className={left > 0 ? "text-amber-300" : "text-emerald-300"}>{Math.max(0, left).toLocaleString("he-IL")} ₪</span>
              </div>
              {!compact && (
                <div className="text-xs text-gray-500">{(o.lines || []).map((l) => `${l.description} ${Number(l.price).toLocaleString("he-IL")}`).join(" · ")}</div>
              )}
              <div className="flex gap-1.5">
                {o.morning_url && (
                  <a href={o.morning_url} target="_blank" rel="noopener noreferrer" className={`${btn} flex-1 border border-gray-600 text-gray-200 hover:bg-gray-700`}>
                    <ExternalLink className="h-3.5 w-3.5" /> PDF
                  </a>
                )}
                <button type="button" disabled={pending.some((p) => p.business_type === o.business_type)} onClick={() => setDialog({ replace: o })} className={`${btn} flex-1 border border-amber-700/60 text-amber-200 hover:bg-amber-900/30 disabled:opacity-40`}>
                  <RefreshCw className="h-3.5 w-3.5" /> הזמנה מעודכנת
                </button>
              </div>
            </div>
          );
        })
      )}
      {pending.length > 0 && (
        <div className="mt-1.5 space-y-1.5">
          {pending.map((o) => <PendingOrderNotice key={o.id} order={o} onResolved={onChanged} />)}
        </div>
      )}
      {history.length > 0 && (
        <div className="mt-1.5 border-t border-gray-700 pt-1.5 text-[11px] text-gray-500">
          {history.map((o) => (
            <div key={o.id}>
              הזמנה מס' {o.morning_number} מיום {fmtDate(o.document_date)} — {o.status === "replaced" ? "הוחלפה" : "נסגרה"}
              {o.morning_url && <> · <a href={o.morning_url} target="_blank" rel="noopener noreferrer" className="underline">PDF</a></>}
            </div>
          ))}
        </div>
      )}
      <WorkOrderDialog
        isOpen={!!dialog}
        onClose={() => setDialog(null)}
        lead={lead}
        replaceOrder={dialog?.replace || null}
        onCreated={() => { reload(); onChanged?.(); }}
      />
    </div>
  );
}
