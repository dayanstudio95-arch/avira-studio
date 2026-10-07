import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Receipt, Users, Coins, FileText, Calculator, CreditCard, BarChart3, Gem, CalendarDays } from "lucide-react";
import { calculateNetProfit } from "../../lib/profitCalculations";
import { getEventVatAmount, getEventTeamCost } from "../../lib/financialCalculations";

// Two decimals, always. The default toLocaleString() allows three, which is how
// "₪77,076.271" ended up on screen — a float artefact presented as if it were money.
const money = (n) =>
  `₪${(Math.round((n || 0) * 100) / 100).toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

// Design E (2026-10-07, the owner's reference image): each line its own row with an icon;
// net profit a lit green box; the per-event averages two small cards. Same numbers as before.
function Row({ icon: Icon, label, value, cls }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3.5 py-2.5">
      <span className="flex items-center gap-3 text-sm text-slate-300">
        <Icon className="h-5 w-5 shrink-0 text-sky-300/80" strokeWidth={1.75} />
        {label}
      </span>
      <span className={`font-bold tabular-nums ${cls}`}>{value}</span>
    </div>
  );
}

export default function ReportsTable({ events, period, isLoading, staffMembers = [], periodLabel }) {
  // Every line comes from the same three per-event numbers (gross, VAT, crew cost), and
  // profit is derived from them — so the card adds up: gross − VAT − expenses = profit.
  // See calculateNetProfit for what used to break that.
  const calculateTotals = () => {
    return events.reduce((totals, event) => ({
      income: totals.income + (event.totalAmountGross || 0),
      expenses: totals.expenses + getEventTeamCost(event),
      vat: totals.vat + getEventVatAmount(event),
      profit: totals.profit + calculateNetProfit(event, staffMembers)
    }), { income: 0, expenses: 0, vat: 0, profit: 0 });
  };

  const totals = calculateTotals();
  const beforeVat = totals.income - totals.vat;

  if (isLoading) {
    return (
      <Card className="dash-card">
        <CardHeader>
          <CardTitle className="text-white">סיכום פיננסי</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Array(4).fill(0).map((_, i) => (
              <div key={i} className="animate-pulse flex justify-between">
                <div className="h-4 bg-gray-700 rounded w-24"></div>
                <div className="h-4 bg-gray-700 rounded w-16"></div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const positive = totals.profit >= 0;

  return (
    <Card className="dash-card">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-white flex items-center gap-2 text-base">
            <Receipt className="w-6 h-6 text-amber-400" />
            סיכום פיננסי
          </CardTitle>
          {periodLabel && (
            <span className="flex items-center gap-1.5 text-sm text-sky-300">
              <CalendarDays className="h-4 w-4" /> {periodLabel}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <Row icon={Users} label="מספר אירועים" value={events.length} cls="text-white" />
        <Row icon={Coins} label="הכנסה ברוטו (כולל מע״מ)" value={money(totals.income)} cls="text-amber-300" />
        <Row icon={FileText} label="− מע״מ" value={money(totals.vat)} cls="text-sky-400" />
        <Row icon={Calculator} label="= הכנסה לפני מע״מ" value={money(beforeVat)} cls="text-white" />
        <Row icon={CreditCard} label="− הוצאות צוות (כפי שנרשמו באירועים)" value={money(totals.expenses)} cls="text-rose-400" />

        <div className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3.5 ${positive ? "border-[#22C987]/70 bg-gradient-to-l from-[#22C987]/[0.04] to-[#22C987]/[0.16] shadow-[0_0_26px_-8px_rgba(34,201,135,0.8)]" : "border-[#F05B70]/70 bg-[#F05B70]/10"}`}>
          <span className="flex items-center gap-3 text-lg font-bold text-white">
            <BarChart3 className={`h-6 w-6 ${positive ? "text-emerald-400" : "text-rose-400"}`} />
            = רווח נקי
          </span>
          <span className={`text-xl font-bold tabular-nums ${positive ? "text-emerald-400" : "text-rose-400"}`}>
            {money(totals.profit)}
          </span>
        </div>

        {events.length > 0 && (
          <div className="pt-3">
            <h4 className="text-white font-semibold mb-2">ממוצע לאירוע</h4>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3.5 py-2.5">
                <div>
                  <div className="text-xs text-slate-400">הכנסה ממוצעת</div>
                  <div className="font-bold text-white tabular-nums">₪{Math.round(totals.income / events.length).toLocaleString()}</div>
                </div>
                <BarChart3 className="h-7 w-7 text-sky-400" />
              </div>
              <div className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3.5 py-2.5">
                <div>
                  <div className="text-xs text-slate-400">רווח ממוצע</div>
                  <div className="font-bold text-white tabular-nums">₪{Math.round(totals.profit / events.length).toLocaleString()}</div>
                </div>
                <Gem className="h-7 w-7 text-emerald-400" />
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
