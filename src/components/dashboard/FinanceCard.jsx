import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart } from "lucide-react";
import { eventDay, israelToday } from "@/lib/missingTeam";

// All the money in one tile (2026-10-07): today / this month / this year, gross and net,
// and what is still open to collect.
// Design E: each row carries a small bar chart, and every bar is real gross income by event
// date — today's row: the last 14 days; the month row: each day of this month so far; the
// year row: each month of the selected year. The last (current) bar is lit.
function Bars({ series, color }) {
  const max = Math.max(1, ...series);
  return (
    <div className="flex h-7 items-end gap-[3px]" aria-hidden="true">
      {series.map((v, i) => (
        <span
          key={i}
          className="w-[3px] rounded-[1px]"
          style={{
            height: `${Math.max(6, (v / max) * 100)}%`,
            background: color,
            opacity: i === series.length - 1 ? 1 : v ? 0.55 : 0.18,
          }}
        />
      ))}
    </div>
  );
}

const nis = (n) => `₪${Math.round(n || 0).toLocaleString()}`;

export default function FinanceCard({ stats, year, pendingCollection, events = [] }) {
  const series = useMemo(() => {
    const byDay = {};
    for (const e of events) {
      const d = eventDay(e);
      if (d) byDay[d] = (byDay[d] || 0) + (e.totalAmountGross || 0);
    }
    const today = israelToday();
    const dayStr = (ms) => new Date(ms).toISOString().slice(0, 10);
    const t0 = Date.parse(today + "T12:00:00Z");
    const last14 = Array.from({ length: 14 }, (_, i) => byDay[dayStr(t0 - (13 - i) * 86400000)] || 0);
    const monthPrefix = today.slice(0, 7);
    const dom = Number(today.slice(8, 10));
    const month = Array.from({ length: dom }, (_, i) => byDay[`${monthPrefix}-${String(i + 1).padStart(2, "0")}`] || 0);
    const months = Array(12).fill(0);
    for (const [d, v] of Object.entries(byDay)) if (d.slice(0, 4) === String(year)) months[Number(d.slice(5, 7)) - 1] += v;
    const lastMonth = String(year) === today.slice(0, 4) ? Number(today.slice(5, 7)) : 12;
    return { last14, month, year: months.slice(0, lastMonth) };
  }, [events, year]);

  const row = (label, s, bars, color) => (
    <div className="e-row flex items-center gap-3 py-2.5">
      <span className="w-14 shrink-0 text-sm text-slate-300">{label}</span>
      <div className="flex flex-1 justify-center"><Bars series={bars} color={color} /></div>
      <span className="shrink-0 text-left">
        <span className="block text-lg font-bold leading-tight text-white tabular-nums">{nis(s.income)}</span>
        <span className="block text-[11px] text-emerald-400 tabular-nums">נטו {nis(s.netProfit)}</span>
      </span>
    </div>
  );
  return (
    <Card className="dash-card fin-card h-full flex flex-col">
      <CardHeader className="dash-head pb-3">
        <CardTitle className="text-white flex items-center gap-2 text-base font-semibold">
          <LineChart className="w-5 h-5 text-emerald-400" /> פיננסי · {year}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-3 pt-0.5">
        {row("היום", stats.today, series.last14, "#10B981")}
        {row("החודש", stats.month, series.month, "#14B8A6")}
        {row("השנה", stats.year, series.year, "#3B82F6")}
        <div className="flex items-center justify-between gap-2 pt-2.5">
          <span className="text-sm text-slate-300">פתוח לגבייה</span>
          <span className="text-lg font-bold text-rose-400 tabular-nums">{nis(pendingCollection)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
