import React, { useMemo } from "react";
import { Banknote, CalendarRange, BarChart3, Wallet } from "lucide-react";
import { eventDay, israelToday } from "@/lib/missingTeam";

// Design D (2026-10-07): the money in four gradient cards. The little bars are real — gross
// income per month of the selected year (the current month lit) — nothing decorative.
function Bars({ series, highlight, color }) {
  const max = Math.max(1, ...series);
  return (
    <div className="pointer-events-none absolute bottom-3 left-4 flex h-9 items-end gap-[3px]" aria-hidden="true">
      {series.map((v, i) => (
        <span
          key={i}
          className="w-[5px] rounded-sm"
          style={{ height: `${Math.max(8, (v / max) * 100)}%`, background: color, opacity: i === highlight ? 1 : 0.35 }}
        />
      ))}
    </div>
  );
}

function Kpi({ tone, icon: Icon, iconColor, label, value, sub, subClass, children }) {
  return (
    <div className={`kpi kpi-${tone} p-4 min-h-[118px]`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] text-slate-300">{label}</div>
          <div className="mt-1 text-[26px] font-bold leading-tight tracking-tight text-white tabular-nums">{value}</div>
          {sub && <div className={`mt-1 text-xs ${subClass || "text-slate-400"}`}>{sub}</div>}
        </div>
        <div className="kpi-icon shrink-0"><Icon className="h-5 w-5" style={{ color: iconColor }} /></div>
      </div>
      {children}
    </div>
  );
}

export default function KpiRow({ stats, events, year, pendingCollection }) {
  const monthly = useMemo(() => {
    const out = Array(12).fill(0);
    for (const e of events || []) {
      const d = eventDay(e);
      if (d.slice(0, 4) === String(year)) out[Number(d.slice(5, 7)) - 1] += e.totalAmountGross || 0;
    }
    return out;
  }, [events, year]);
  const today = israelToday();
  const thisMonth = String(year) === today.slice(0, 4) ? Number(today.slice(5, 7)) - 1 : 11;
  const todayCount = (events || []).filter((e) => eventDay(e) === today).length;
  const nis = (n) => `₪${Math.round(n || 0).toLocaleString()}`;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
      <Kpi tone="green" icon={Banknote} iconColor="#22C987" label="הכנסות היום" value={nis(stats.today.income)}
        sub={todayCount ? `${todayCount} ${todayCount === 1 ? "אירוע" : "אירועים"} היום · נטו ${nis(stats.today.netProfit)}` : "אין אירוע היום"} />
      <Kpi tone="blue" icon={CalendarRange} iconColor="#60A5FA" label="הכנסות החודש" value={nis(stats.month.income)}
        sub={`נטו ${nis(stats.month.netProfit)}`} subClass="text-sky-300">
        <Bars series={monthly} highlight={thisMonth} color="#60A5FA" />
      </Kpi>
      <Kpi tone="cyan" icon={BarChart3} iconColor="#22D3EE" label={`הכנסות ${year}`} value={nis(stats.year.income)}
        sub={`נטו ${nis(stats.year.netProfit)}`} subClass="text-cyan-300">
        <Bars series={monthly} highlight={thisMonth} color="#22D3EE" />
      </Kpi>
      <Kpi tone="purple" icon={Wallet} iconColor="#C084FC" label="פתוח לגבייה" value={nis(pendingCollection)}
        sub="אירועים שעברו ולא סומנו שולם" subClass="text-fuchsia-300/80" />
    </div>
  );
}
