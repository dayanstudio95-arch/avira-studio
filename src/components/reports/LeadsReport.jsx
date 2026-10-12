import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import { monthStats, prevMonthKey, delta, lastMonths, monthKey } from "@/lib/leadReport";

// "לידים ומכירות" — the monthly report (2026-10-13). Read-only; everything is computed
// in the browser from leads + WhatsApp conversations (src/lib/leadReport.js).
const MONTH_NAMES = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const monthLabel = (key) => {
  const [y, m] = key.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
};
const ils = (n) => `₪${Math.round(n || 0).toLocaleString("he-IL")}`;

async function fetchAll(table, columns) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    // A fixed order, or pages can repeat / skip rows once a table passes 1,000.
    const { data, error } = await supabase.from(table).select(columns).order("id").range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

function Card({ title, value, sub, change }) {
  return (
    <div className="rounded-2xl border border-[#2A3B57] bg-[#0B1529] p-4">
      <div className="text-xs text-slate-400">{title}</div>
      <div className="mt-1 text-2xl font-bold text-white tabular-nums">{value}</div>
      {(sub || change) && (
        <div className="mt-0.5 text-xs text-slate-400">
          {sub}
          {change !== null && change !== undefined && (
            <span className={`ms-1 ${String(change).startsWith("+") ? "text-emerald-400" : String(change).startsWith("−") ? "text-red-400" : "text-slate-400"}`}>
              ({change} מהחודש הקודם)
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default function LeadsReport({ year, month }) {
  const q = useQuery({
    queryKey: ["leadsReport"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [leads, convs] = await Promise.all([
        fetchAll("leads", "created_at, signed_at, status, final_price, source"),
        fetchAll("whatsapp_conversations", "created_at, contact_type"),
      ]);
      return {
        leads: leads.map((l) => ({ createdAt: l.created_at, signedAt: l.signed_at, status: l.status, finalPrice: l.final_price, source: l.source })),
        conversations: convs.map((c) => ({ createdAt: c.created_at, contactType: c.contact_type })),
      };
    },
  });

  const key = monthKey(year, month);
  const cur = useMemo(() => (q.data ? monthStats(q.data.leads, q.data.conversations, key) : null), [q.data, key]);
  const prev = useMemo(() => (q.data ? monthStats(q.data.leads, q.data.conversations, prevMonthKey(key)) : null), [q.data, key]);
  const history = useMemo(
    () => (q.data ? lastMonths(key, 6).map((k) => monthStats(q.data.leads, q.data.conversations, k)) : []),
    [q.data, key]
  );

  if (q.isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
  if (q.error) return <div className="rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-200">טעינת הדוח נכשלה: {q.error.message}</div>;

  return (
    <div className="space-y-6" dir="rtl">
      <h2 className="text-xl font-semibold text-white">לידים ומכירות · {monthLabel(key)}</h2>

      {!cur.newLeadsReliable && (
        <div className="rounded-xl border border-amber-800/60 bg-amber-950/30 p-3 text-xs text-amber-200">
          הלידים הישנים הועברו מהמערכת הקודמת ב-13.8.2026 בלי תאריך הכניסה המקורי, ולכן "לידים חדשים" ו"מקור" אמינים רק מספטמבר 2026. מספר החתימות והמחירים נכונים לכל חודש.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card title="פניות חדשות בוואטסאפ" value={cur.inquiries} change={delta(cur.inquiries, prev.inquiries)} />
        <Card title="לידים חדשים" value={cur.newLeads} change={cur.newLeadsReliable && prev.newLeadsReliable ? delta(cur.newLeads, prev.newLeads) : null} sub={cur.lost ? `${cur.lost} לא רלוונטי` : ""} />
        <Card title="חתמו החודש" value={cur.signed} sub={cur.signedTotal > 0 ? `סה"כ ${ils(cur.signedTotal)}` : ""} change={delta(cur.signed, prev.signed)} />
        <Card title="מחיר ממוצע לחתימה" value={cur.avgPrice ? ils(cur.avgPrice) : "—"} change={cur.avgPrice && prev.avgPrice ? delta(cur.avgPrice, prev.avgPrice) : null} />
      </div>

      {cur.newLeadsReliable && cur.newLeads > 0 && (
        <div className="rounded-2xl border border-[#2A3B57] bg-[#0B1529] p-4 text-sm text-slate-200">
          מתוך {cur.newLeads} הלידים שנכנסו החודש — <span className="font-bold text-white">{cur.cohortSigned} כבר חתמו</span> ({cur.conversion}%)
        </div>
      )}

      <div className="rounded-2xl border border-[#2A3B57] bg-[#0B1529] p-4">
        <h3 className="mb-3 font-semibold text-white">מאיפה הגיעו</h3>
        {cur.bySource.length === 0 ? (
          <div className="text-sm text-slate-400">אין לידים חדשים בחודש הזה.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-400">
                <th className="py-1 text-start font-normal">מקור</th>
                <th className="py-1 text-center font-normal">לידים</th>
                <th className="py-1 text-center font-normal">חתמו</th>
              </tr>
            </thead>
            <tbody>
              {cur.bySource.map((r) => (
                <tr key={r.source} className="border-t border-[#1B2A44]">
                  <td className="py-1.5 text-slate-200">{r.source}</td>
                  <td className="py-1.5 text-center tabular-nums text-white">{r.leads}</td>
                  <td className="py-1.5 text-center tabular-nums text-emerald-300">{r.signed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-slate-500">את המקור בוחרים בטופס הליד ("מאיפה הגיעו?"). ליד שנוצר משיחה שהגיעה ממודעה מקבל "מודעה בפייסבוק" לבד.</p>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[#2A3B57] bg-[#0B1529] p-4">
        <h3 className="mb-3 font-semibold text-white">6 החודשים האחרונים</h3>
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="text-xs text-slate-400">
              <th className="py-1 text-start font-normal">חודש</th>
              <th className="py-1 text-center font-normal">פניות</th>
              <th className="py-1 text-center font-normal">לידים</th>
              <th className="py-1 text-center font-normal">חתמו</th>
              <th className="py-1 text-center font-normal">ממוצע</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.key} className={`border-t border-[#1B2A44] ${h.key === key ? "text-white" : "text-slate-300"}`}>
                <td className="py-1.5">{monthLabel(h.key)}</td>
                <td className="py-1.5 text-center tabular-nums">{h.inquiries}</td>
                <td className="py-1.5 text-center tabular-nums">{h.newLeadsReliable ? h.newLeads : "—"}</td>
                <td className="py-1.5 text-center tabular-nums text-emerald-300">{h.signed}</td>
                <td className="py-1.5 text-center tabular-nums">{h.avgPrice ? ils(h.avgPrice) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
