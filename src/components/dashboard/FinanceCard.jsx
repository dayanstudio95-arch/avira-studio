import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart } from "lucide-react";

// All the money in one tile (2026-10-07): today / this month / this year, gross and net,
// and what is still open to collect.
export default function FinanceCard({ stats, year, pendingCollection }) {
  const row = (label, s) => (
    <div className="flex items-baseline justify-between gap-2 py-1.5">
      <span className="text-sm text-gray-400">{label}</span>
      <span className="text-right">
        <span className="font-semibold text-white">₪{Math.round(s.income).toLocaleString()}</span>
        <span className="block text-[11px] text-emerald-300">נטו ₪{Math.round(s.netProfit).toLocaleString()}</span>
      </span>
    </div>
  );
  return (
    <Card className="dash-card h-full">
      <CardHeader className="dash-head pb-3">
        <CardTitle className="text-white flex items-center gap-2 text-base font-semibold">
          <LineChart className="w-5 h-5 text-emerald-400" /> פיננסי · {year}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 divide-y divide-gray-800/70">
        {row("היום", stats.today)}
        {row("החודש", stats.month)}
        {row("השנה", stats.year)}
        <div className="flex items-baseline justify-between gap-2 pt-2">
          <span className="text-sm text-gray-400">פתוח לגבייה</span>
          <span className="font-semibold text-red-300">₪{Math.round(pendingCollection).toLocaleString()}</span>
        </div>
      </CardContent>
    </Card>
  );
}
