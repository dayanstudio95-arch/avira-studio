import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardList, FileClock, CheckCircle2, AlertTriangle, ExternalLink, Loader2 } from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import { rowToRecord } from "@/api/entities";
import { todayInIsrael } from "@/lib/localDate";
import { ENTITIES } from "@/lib/paymentEntity";
import { fmtDate } from "@/lib/workOrder";
import { SIGNED_STATUSES, ORDER_STATUS_LABELS, missingOrders, filterMissing, issuedOrders } from "@/lib/workOrderBook";
import WorkOrderDialog from "@/components/workOrders/WorkOrderDialog";
import PendingOrderNotice from "@/components/workOrders/PendingOrderNotice";

// 📒 ספר הזמנות (2026-10-21, the owner's request): the couples who signed and have no work
// order yet, oldest signature first — issuing down the list keeps Morning's order numbers in
// signing order — and the orders already issued. "הפק" opens the same order window as the
// lead panel.
const LEAD_COLUMNS = "id, couple_names, event_date, signed_at, status, final_price, package_choice, package_id, payment_entity, payment_request_entity, invoices_list";

const TONES = {
  amber: "border-[#F59E0B]/50 bg-[#F59E0B]/12 text-amber-300",
  blue: "border-[#3B82F6]/50 bg-[#3B82F6]/12 text-sky-300",
  green: "border-[#22C987]/50 bg-[#22C987]/12 text-emerald-300",
  red: "border-red-500/50 bg-red-500/12 text-red-300",
};

function Tile({ icon: Icon, tone, value, label }) {
  return (
    <div className="dash-card flex items-center justify-end gap-3 px-4 py-3">
      <div>
        <div className="text-xl font-bold leading-tight text-white tabular-nums md:text-2xl">{value}</div>
        <div className="text-xs text-slate-400 md:text-sm">{label}</div>
      </div>
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${TONES[tone]}`}>
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </div>
    </div>
  );
}

const bizTag = (b) => (
  <span className={`rounded-full px-1.5 py-0.5 text-[11px] ${b === "company" ? "bg-purple-500/20 text-purple-200" : "bg-emerald-500/20 text-emerald-200"}`}>
    {ENTITIES[b]?.short || "—"}
  </span>
);

export default function WorkOrders() {
  const today = todayInIsrael();
  const [leads, setLeads] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("missing");
  const [filter, setFilter] = useState("all");
  const [dialogLead, setDialogLead] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [l, o] = await Promise.all([
        supabase.from("leads").select(LEAD_COLUMNS).not("signed_at", "is", null).in("status", SIGNED_STATUSES).order("signed_at", { ascending: true }),
        supabase.from("work_orders").select("*").order("created_at", { ascending: true }),
      ]);
      if (l.error) throw l.error;
      if (o.error) throw o.error;
      setLeads((l.data || []).map(rowToRecord));
      setOrders(o.data || []);
      setError(null);
    } catch (e) {
      setError(e?.message || "הטעינה נכשלה");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const missing = useMemo(() => missingOrders(leads, orders, today), [leads, orders, today]);
  const shown = filterMissing(missing, filter);
  const issued = useMemo(() => issuedOrders(orders), [orders]);
  const counts = {
    missing: missing.length,
    active: orders.filter((o) => o.status === "active").length,
    pending: orders.filter((o) => o.status === "issuing").length,
    replaced: orders.filter((o) => o.status === "replaced" || o.status === "closed").length,
  };

  return (
    <div dir="rtl" className="e-page min-h-screen p-4 md:p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[#3B82F6]/45 bg-[#3B82F6]/10 text-sky-300">
            <ClipboardList className="h-7 w-7" strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white md:text-4xl">ספר הזמנות</h1>
            <p className="text-sm text-slate-400">הזמנות עבודה ב-Morning · זוגות שחתמו ועוד אין להם הזמנה</p>
          </div>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile icon={FileClock} tone="amber" value={counts.missing} label="חתמו, בלי הזמנה" />
          <Tile icon={CheckCircle2} tone="green" value={counts.active} label="הזמנות פעילות" />
          <Tile icon={AlertTriangle} tone="red" value={counts.pending} label="בבדיקה" />
          <Tile icon={ClipboardList} tone="blue" value={counts.replaced} label="הוחלפו / נסגרו" />
        </div>

        <div className="mb-3 flex gap-2">
          {[["missing", `בלי הזמנה (${counts.missing})`], ["issued", `הזמנות שהופקו (${orders.length})`]].map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`min-h-[40px] rounded-xl border px-4 text-sm font-semibold ${tab === k ? "border-sky-400 bg-sky-900/40 text-white" : "border-gray-700 text-gray-300 hover:bg-gray-800"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {error ? (
          <div className="dash-card flex items-center justify-between gap-2 p-4 text-sm text-red-300">
            <span>{error}</span>
            <button type="button" onClick={load} className="underline">נסו שוב</button>
          </div>
        ) : loading && !leads.length ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
        ) : tab === "missing" ? (
          <div className="dash-card overflow-hidden">
            <div className="space-y-2 border-b border-gray-800 p-3 text-xs text-gray-400">
              <p>
                מומלץ להוציא לפי הסדר — מהישן לחדש — כך מספרי ההזמנות ב-Morning ילכו לפי סדר החתימה.
                Morning לא מאפשר תאריך מוקדם מההזמנה האחרונה של העסק, ותאריך החתימה מודפס בהערות של כל הזמנה.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {[["all", "הכל"], ["upcoming", "אירוע עתידי"], ["past", "אירוע שעבר"]].map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setFilter(k)}
                    className={`rounded-full border px-3 py-1 ${filter === k ? "border-sky-400 bg-sky-900/40 text-white" : "border-gray-700 text-gray-300 hover:bg-gray-800"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {shown.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-400">אין זוגות שחתמו בלי הזמנת עבודה{filter !== "all" ? " בסינון הזה" : ""} 🎉</div>
            ) : (
              <div className="divide-y divide-gray-800">
                {shown.map((r, idx) => {
                  const l = r.lead;
                  const next = idx === 0 && filter === "all";
                  return (
                    <div key={l.id} className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2.5 text-sm ${next ? "bg-sky-950/30" : ""}`}>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold text-white">{l.coupleNames}</span>
                          {next && <span className="rounded-full bg-sky-600 px-2 py-0.5 text-[11px] text-white">הבא בתור</span>}
                          {r.eventPast && <span className="rounded-full bg-gray-700 px-2 py-0.5 text-[11px] text-gray-200">האירוע עבר</span>}
                          {r.fullyInvoiced && <span className="rounded-full bg-emerald-800/60 px-2 py-0.5 text-[11px] text-emerald-100">שולם במלואו</span>}
                        </div>
                        <div className="mt-0.5 text-xs text-gray-400">
                          חתמו {fmtDate(r.signedOn)} · אירוע {l.eventDate ? fmtDate(l.eventDate) : "—"} · {Number(l.finalPrice || 0).toLocaleString("he-IL")} ₪
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-gray-400">
                          {r.deposit
                            ? <>מקדמה {fmtDate(r.deposit.date)} · מס' {r.deposit.number || "—"} {bizTag(r.deposit.businessType)}</>
                            : <span className="text-amber-300">אין חשבונית מקדמה</span>}
                          {r.invoicesCount > 1 && <span>· {r.invoicesCount} חשבוניות</span>}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDialogLead(l)}
                        className={`min-h-[40px] shrink-0 rounded-xl px-4 text-sm font-semibold text-white ${next ? "bg-sky-600 hover:bg-sky-500" : "bg-sky-800 hover:bg-sky-700"}`}
                      >
                        הפק הזמנה
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="dash-card overflow-hidden">
            {issued.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-400">עוד לא הופקו הזמנות עבודה.</div>
            ) : (
              <div className="divide-y divide-gray-800">
                {issued.map((o) => (
                  <div key={o.id} className="space-y-1.5 px-3 py-2.5 text-sm">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-semibold text-white">{o.morning_number ? `מס' ${o.morning_number}` : "—"}</span>
                      <span className="text-gray-300">{fmtDate(o.document_date)}</span>
                      <span className="min-w-0 flex-1 text-gray-100">{o.couple_names}</span>
                      <span className="tabular-nums text-gray-200">{Number(o.total).toLocaleString("he-IL")} ₪</span>
                      {bizTag(o.business_type)}
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${o.status === "active" ? "bg-emerald-800/60 text-emerald-100" : o.status === "issuing" ? "bg-red-800/60 text-red-100" : "bg-gray-700 text-gray-200"}`}>
                        {ORDER_STATUS_LABELS[o.status] || o.status}
                      </span>
                      {o.morning_url && (
                        <a href={o.morning_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-sky-300 underline">
                          <ExternalLink className="h-3.5 w-3.5" /> PDF
                        </a>
                      )}
                    </div>
                    {o.status === "issuing" && <PendingOrderNotice order={o} onResolved={load} />}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <WorkOrderDialog
        isOpen={!!dialogLead}
        onClose={() => { setDialogLead(null); load(); }}
        lead={dialogLead}
        onCreated={() => { setDialogLead(null); load(); }}
      />
    </div>
  );
}
