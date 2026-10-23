import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardList, FileClock, CheckCircle2, AlertTriangle, ExternalLink, Loader2, EyeOff, Undo2, Search, X, FileText, Receipt } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/api/supabaseClient";
import { rowToRecord } from "@/api/entities";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { todayInIsrael } from "@/lib/localDate";
import { ENTITIES } from "@/lib/paymentEntity";
import { fmtDate } from "@/lib/workOrder";
import { SIGNED_STATUSES, ORDER_STATUS_LABELS, missingOrders, skippedRows, filterMissing, issuedOrders, orderChains, filterChains, bookSearchMatch, chainSearchValues } from "@/lib/workOrderBook";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import WorkOrderDialog from "@/components/workOrders/WorkOrderDialog";
import PendingOrderNotice from "@/components/workOrders/PendingOrderNotice";

// 📒 ספר הזמנות (2026-10-21, the owner's request): the couples who closed and have no work
// order yet — by the day the order was received, so issuing down the list keeps Morning's order
// numbers in that order — and the orders already issued. "הפק" opens the same order window as
// the lead panel. 2026-10-22: couples closed outside the system (imported from the old one, no
// digital signature) are listed too; the owner can take couples that need no order off the
// list ("הסר מהרשימה" — nothing is deleted, "הוסרו" brings them back).
const LEAD_COLUMNS = "id, couple_names, event_date, signed_at, status, final_price, package_choice, package_id, payment_entity, payment_request_entity, invoices_list, work_order_skipped_at, signed_contract_pdf_url";

const TONES = {
  amber: "border-[#F59E0B]/50 bg-[#F59E0B]/12 text-amber-300",
  blue: "border-[#3B82F6]/50 bg-[#3B82F6]/12 text-sky-300",
  green: "border-[#22C987]/50 bg-[#22C987]/12 text-emerald-300",
  red: "border-red-500/50 bg-red-500/12 text-red-300",
};

const FILTERS = [["month", "מהחודש והלאה"], ["upcoming", "אירוע עתידי"], ["past", "אירוע שעבר"], ["all", "הכל"]];

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

// One couple: names, tags, signing / event / price, the deposit invoice.
function CoupleInfo({ r, next }) {
  const l = r.lead;
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-semibold text-white">{l.coupleNames}</span>
        {next && <span className="rounded-full bg-sky-600 px-2 py-0.5 text-[11px] text-white">הבא בתור</span>}
        {r.eventPast && <span className="rounded-full bg-gray-700 px-2 py-0.5 text-[11px] text-gray-200">האירוע עבר</span>}
        {r.fullyInvoiced && <span className="rounded-full bg-emerald-800/60 px-2 py-0.5 text-[11px] text-emerald-100">שולם במלואו</span>}
        {r.outsideSystem && <span className="rounded-full bg-amber-900/50 px-2 py-0.5 text-[11px] text-amber-100">חתמו מחוץ למערכת</span>}
        {r.signingCutOff && <span className="rounded-full bg-amber-900/50 px-2 py-0.5 text-[11px] text-amber-100">יש PDF חתום, החתימה נקטעה</span>}
      </div>
      <div className="mt-0.5 text-xs text-gray-400">
        {r.signedOn ? `חתמו ${fmtDate(r.signedOn)}` : "תאריך חתימה לא ידוע"} · אירוע {l.eventDate ? fmtDate(l.eventDate) : "—"} · {Number(l.finalPrice || 0).toLocaleString("he-IL")} ₪
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-gray-400">
        {r.deposit
          ? <>מקדמה {fmtDate(r.deposit.date)} · מס' {r.deposit.number || "—"} {bizTag(r.deposit.businessType)}</>
          : <span className="text-amber-300">אין חשבונית מקדמה במערכת</span>}
        {r.invoicesCount > 1 && <span>· {r.invoicesCount} חשבוניות</span>}
      </div>
    </div>
  );
}

const CHAIN_FILTERS = [["all", "הכל"], ["due", "נשאר לגבות"], ["paid", "שולם במלואו"]];
const shekel = (n) => `${Number(n || 0).toLocaleString("he-IL")} ₪`;

// "הזמנות וחשבוניות" (2026-10-24): one couple and business — its orders, then its invoices.
function OrderChainCard({ c, orderNumber, onResolved }) {
  return (
    <div className="dash-card p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="font-semibold text-white">{c.coupleNames}</span>
          <span className="text-xs text-gray-400"> · אירוע {c.eventDate ? fmtDate(c.eventDate) : "—"}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {bizTag(c.business)}
          {c.balance == null ? null : c.paid ? (
            <span className="rounded-full bg-emerald-800/60 px-2 py-0.5 text-[11px] text-emerald-100">שולם במלואו ✓</span>
          ) : (
            <span className="rounded-full bg-orange-900/60 px-2 py-0.5 text-[11px] text-orange-100">נשאר {shekel(c.balance)}</span>
          )}
        </div>
      </div>

      <div className="mt-2 divide-y divide-gray-800 border-t border-gray-800">
        {c.orders.map((o) => {
          const old = o.status === "replaced" || o.status === "closed";
          return (
            <div key={o.id} className={`py-2 ${old ? "opacity-55" : ""}`}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <FileText className="h-4 w-4 shrink-0 text-sky-300" />
                <span className={`font-semibold text-white ${old ? "line-through" : ""}`}>הזמנה {o.morning_number || "—"}</span>
                <span className="text-xs text-gray-400">{fmtDate(o.document_date)}</span>
                {o.replaces_order_id && (
                  <span className="text-xs text-gray-400">· מחליפה את {orderNumber(o.replaces_order_id) || "ההזמנה הקודמת"}{o.replace_reason ? ` (${o.replace_reason})` : ""}</span>
                )}
                <span className="ms-auto tabular-nums text-gray-200">{shekel(o.total)}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${o.status === "active" ? "bg-emerald-800/60 text-emerald-100" : o.status === "issuing" ? "bg-red-800/60 text-red-100" : "bg-gray-700 text-gray-200"}`}>
                  {ORDER_STATUS_LABELS[o.status] || o.status}
                </span>
                {o.morning_url && (
                  <a href={o.morning_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-sky-300 underline">
                    <ExternalLink className="h-3.5 w-3.5" /> PDF
                  </a>
                )}
              </div>
              {o.status === "issuing" && <PendingOrderNotice order={o} onResolved={onResolved} />}
            </div>
          );
        })}
        {c.invoices.map((i, idx) => (
          <div key={i.id || i.number || idx} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2">
            <Receipt className="h-4 w-4 shrink-0 text-amber-300" />
            <span className="text-gray-100">חשבונית מס קבלה {i.number || "—"}</span>
            <span className="text-xs text-gray-400">· {i.description || "—"} · {fmtDate(i.date)}</span>
            <span className="ms-auto tabular-nums text-gray-200">{shekel(i.amount)}</span>
            {i.linked ? (
              <span className="rounded-full bg-sky-900/60 px-2 py-0.5 text-[11px] text-sky-100">מקושרת להזמנה ✓</span>
            ) : i.beforeOrder ? (
              <span className="rounded-full border border-gray-600 px-2 py-0.5 text-[11px] text-gray-300">לפני ההזמנה</span>
            ) : null}
            {i.url && (
              <a href={i.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-sky-300 underline">
                <ExternalLink className="h-3.5 w-3.5" /> PDF
              </a>
            )}
          </div>
        ))}
        {c.invoices.length === 0 && <div className="py-2 text-xs text-gray-400">אין עדיין חשבוניות{c.lead ? "" : " (הזוג לא נמצא)"}</div>}
      </div>
      {c.covered != null && (
        <div className="border-t border-gray-800 pt-2 text-xs text-gray-400">חשבוניות: {shekel(c.covered)} מתוך {shekel(c.total)}</div>
      )}
    </div>
  );
}

export default function WorkOrders() {
  const today = todayInIsrael();
  const { user } = useAuth();
  const [leads, setLeads] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("missing");
  const [filter, setFilter] = useState("month");
  const [dialogLead, setDialogLead] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [chainFilter, setChainFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // in pages of 1000 (the API's cap per request) so no couple is cut off
      const all = async (q) => {
        const rows = [];
        for (let from = 0; ; from += 1000) {
          const { data, error: e } = await q().range(from, from + 999);
          if (e) throw e;
          rows.push(...(data || []));
          if (!data || data.length < 1000) return rows;
        }
      };
      const [l, o] = await Promise.all([
        all(() => supabase.from("leads").select(LEAD_COLUMNS).in("status", SIGNED_STATUSES).order("id", { ascending: true })),
        all(() => supabase.from("work_orders").select("*").order("id", { ascending: true })),
      ]);
      // An order's couple may have moved on to another status — load those leads too, for
      // their invoices in "הזמנות וחשבוניות" (closedNeedsOrder keeps them out of the lists).
      const known = new Set(l.map((x) => x.id));
      const extraIds = [...new Set(o.map((x) => x.lead_id).filter((id) => id && !known.has(id)))];
      const extra = [];
      for (let i = 0; i < extraIds.length; i += 100) {
        const { data, error: e } = await supabase.from("leads").select(LEAD_COLUMNS).in("id", extraIds.slice(i, i + 100));
        if (e) throw e;
        extra.push(...(data || []));
      }
      setLeads([...l, ...extra].map(rowToRecord));
      setOrders(o);
      setError(null);
    } catch (e) {
      setError(e?.message || "הטעינה נכשלה");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const missing = useMemo(() => missingOrders(leads, orders, today), [leads, orders, today]);
  const skipped = useMemo(() => skippedRows(leads, orders, today), [leads, orders, today]);
  // One search box for every tab (2026-10-24): couple names, order and invoice numbers.
  const rowMatches = (r) => bookSearchMatch(search, [r.lead.coupleNames, ...(r.lead.invoicesList || []).map((i) => i?.number)]);
  const shown = (tab === "skipped" ? skipped : filterMissing(missing, filter, today)).filter(rowMatches);
  const issued = useMemo(() => issuedOrders(orders), [orders]);
  const issuedShown = issued.filter((o) => bookSearchMatch(search, [o.couple_names, o.morning_number]));
  const leadsById = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);
  const chains = useMemo(() => orderChains(orders, leadsById), [orders, leadsById]);
  const chainsShown = filterChains(chains, chainFilter).filter((c) => bookSearchMatch(search, chainSearchValues(c)));
  const orderNumber = (id) => orders.find((o) => o.id === id)?.morning_number;
  const counts = {
    missing: missing.length,
    active: orders.filter((o) => o.status === "active").length,
    pending: orders.filter((o) => o.status === "issuing").length,
    skipped: skipped.length,
  };

  // the selection only ever holds rows on screen
  useEffect(() => { setSelected(new Set()); }, [tab, filter, search]);
  const shownIds = shown.map((r) => r.lead.id);
  const selectedShown = shownIds.filter((id) => selected.has(id));
  const allSelected = shownIds.length > 0 && selectedShown.length === shownIds.length;
  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(shownIds));

  // Take couples off the list / bring them back — a mark on the lead, nothing is deleted.
  const setSkipped = async (ids, skip) => {
    if (!ids.length) return;
    if (skip) {
      const ok = await confirmDialog({
        title: ids.length === 1 ? "להסיר את הזוג מרשימת ספר ההזמנות?" : `להסיר ${ids.length} זוגות מרשימת ספר ההזמנות?`,
        message: ids.length === 1
          ? "הזוג עצמו לא נמחק ושום דבר לא משתנה אצלו — הוא רק לא יופיע ב\"בלי הזמנה\". אפשר להחזיר אותו בלשונית \"הוסרו\"."
          : "הזוגות עצמם לא נמחקים ושום דבר לא משתנה אצלם — הם רק לא יופיעו ב\"בלי הזמנה\". אפשר להחזיר אותם בלשונית \"הוסרו\".",
        confirmText: "הסר מהרשימה",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const values = skip ? { work_order_skipped_at: new Date().toISOString(), work_order_skipped_by: user?.id || null } : { work_order_skipped_at: null, work_order_skipped_by: null };
      // in batches of 100 (every id goes into the request's address)
      for (let i = 0; i < ids.length; i += 100) {
        const { error: e } = await supabase.from("leads").update(values).in("id", ids.slice(i, i + 100));
        if (e) throw e;
      }
      const n = ids.length === 1 ? "הזוג" : `${ids.length} זוגות`;
      toast.success(skip ? `${n} ${ids.length === 1 ? "הוסר" : "הוסרו"} מהרשימה` : `${n} ${ids.length === 1 ? "חזר" : "חזרו"} לרשימה`);
      setSelected(new Set());
      await load();
    } catch (e) {
      toast.error(skip ? "ההסרה נכשלה" : "ההחזרה נכשלה", { description: e?.message });
    } finally {
      setBusy(false);
    }
  };

  const tabs = [
    ["missing", `בלי הזמנה (${counts.missing})`],
    ["issued", `הזמנות שהופקו (${orders.length})`],
    ["chains", `הזמנות וחשבוניות (${chains.length})`],
    ["skipped", `הוסרו (${counts.skipped})`],
  ];

  return (
    <div dir="rtl" className="e-page min-h-screen p-4 md:p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[#3B82F6]/45 bg-[#3B82F6]/10 text-sky-300">
            <ClipboardList className="h-7 w-7" strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white md:text-4xl">ספר הזמנות</h1>
            <p className="text-sm text-slate-400">הזמנות עבודה ב-Morning · זוגות שנסגרו ועוד אין להם הזמנה</p>
          </div>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile icon={FileClock} tone="amber" value={counts.missing} label="נסגרו, בלי הזמנה" />
          <Tile icon={CheckCircle2} tone="green" value={counts.active} label="הזמנות פעילות" />
          <Tile icon={AlertTriangle} tone="red" value={counts.pending} label="בבדיקה" />
          <Tile icon={EyeOff} tone="blue" value={counts.skipped} label="הוסרו מהרשימה" />
        </div>

        <div className="relative mb-3">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש לפי שם הזוג, מספר הזמנה או מספר חשבונית…"
            className="w-full rounded-xl border border-[#2A3B57] bg-[#0B1529] py-2.5 pe-9 ps-9 text-base text-white placeholder:text-slate-500 focus:border-sky-500 md:text-sm"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} aria-label="נקה חיפוש" className="absolute left-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="mb-3 flex flex-wrap gap-2">
          {tabs.map(([k, label]) => (
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
        ) : tab === "issued" ? (
          <div className="dash-card overflow-hidden">
            {issuedShown.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-400">{search ? "לא נמצאו הזמנות לחיפוש הזה." : "עוד לא הופקו הזמנות עבודה."}</div>
            ) : (
              <div className="divide-y divide-gray-800">
                {issuedShown.map((o) => (
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
        ) : tab === "chains" ? (
          <div>
            <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
              {CHAIN_FILTERS.map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setChainFilter(k)}
                  className={`rounded-full border px-3 py-1 ${chainFilter === k ? "border-amber-400 bg-amber-400/15 text-amber-200" : "border-gray-700 text-gray-300 hover:bg-gray-800"}`}
                >
                  {label} ({filterChains(chains, k).length})
                </button>
              ))}
            </div>
            {chainsShown.length === 0 ? (
              <div className="dash-card p-6 text-center text-sm text-gray-400">{search ? "לא נמצאו הזמנות לחיפוש הזה." : chains.length ? "אין הזמנות בסינון הזה." : "עוד לא הופקו הזמנות עבודה."}</div>
            ) : (
              <div className="space-y-3">
                {chainsShown.map((c) => <OrderChainCard key={c.key} c={c} orderNumber={orderNumber} onResolved={load} />)}
              </div>
            )}
          </div>
        ) : (
          <div className="dash-card overflow-hidden">
            <div className="space-y-2 border-b border-gray-800 p-3 text-xs text-gray-400">
              {tab === "missing" ? (
                <>
                  <p>
                    מומלץ להוציא לפי הסדר — מהישן לחדש — כך מספרי ההזמנות ב-Morning ילכו לפי סדר קבלת ההזמנה.
                    Morning לא מאפשר תאריך מוקדם מההזמנה האחרונה של העסק. זוגות שלא צריכים הזמנה — סמנו והסירו מהרשימה.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {FILTERS.map(([k, label]) => (
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
                </>
              ) : (
                <p>זוגות שהוסרו מהרשימה. שום דבר לא נמחק — "החזר לרשימה" מחזיר אותם ל"בלי הזמנה".</p>
              )}
              {shown.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <label className="flex cursor-pointer items-center gap-1.5 text-gray-300">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 accent-sky-500" />
                    בחר את כל המוצגים ({shown.length})
                  </label>
                  {selectedShown.length > 0 && (
                    tab === "missing" ? (
                      <button type="button" disabled={busy} onClick={() => setSkipped(selectedShown, true)} className="flex min-h-[36px] items-center gap-1.5 rounded-lg border border-red-700/70 px-3 text-red-200 hover:bg-red-950/40 disabled:opacity-50">
                        <EyeOff className="h-3.5 w-3.5" /> הסר מהרשימה ({selectedShown.length})
                      </button>
                    ) : (
                      <button type="button" disabled={busy} onClick={() => setSkipped(selectedShown, false)} className="flex min-h-[36px] items-center gap-1.5 rounded-lg border border-sky-700/70 px-3 text-sky-200 hover:bg-sky-950/40 disabled:opacity-50">
                        <Undo2 className="h-3.5 w-3.5" /> החזר לרשימה ({selectedShown.length})
                      </button>
                    )
                  )}
                  {busy && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
                </div>
              )}
            </div>
            {shown.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-400">
                {search ? "לא נמצאו זוגות לחיפוש הזה." : tab === "skipped" ? "אין זוגות שהוסרו מהרשימה." : `אין זוגות שנסגרו בלי הזמנת עבודה${filter !== "all" ? " בסינון הזה" : ""} 🎉`}
              </div>
            ) : (
              <div className="divide-y divide-gray-800">
                {shown.map((r) => {
                  const l = r.lead;
                  // the earliest received couple overall — not just the first one this filter shows
                  const next = tab === "missing" && l.id === missing[0]?.lead.id;
                  return (
                    <div key={l.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 text-sm ${next ? "bg-sky-950/30" : ""} ${selected.has(l.id) ? "bg-gray-800/60" : ""}`}>
                      <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} aria-label={`בחר ${l.coupleNames}`} className="h-4 w-4 shrink-0 accent-sky-500" />
                      <CoupleInfo r={r} next={next} />
                      {tab === "missing" ? (
                        <button
                          type="button"
                          onClick={() => setDialogLead(l)}
                          className={`min-h-[40px] shrink-0 rounded-xl px-4 text-sm font-semibold text-white ${next ? "bg-sky-600 hover:bg-sky-500" : "bg-sky-800 hover:bg-sky-700"}`}
                        >
                          הפק הזמנה
                        </button>
                      ) : (
                        <button type="button" disabled={busy} onClick={() => setSkipped([l.id], false)} className="min-h-[40px] shrink-0 rounded-xl border border-sky-700/70 px-4 text-sm text-sky-200 hover:bg-sky-950/40 disabled:opacity-50">
                          החזר לרשימה
                        </button>
                      )}
                    </div>
                  );
                })}
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
