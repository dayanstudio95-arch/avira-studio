import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { calculateNetProfit } from "../../lib/profitCalculations";
import { getEventTeamCost } from "../../lib/financialCalculations";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Calendar, Users, Coins, CreditCard, BarChart3 } from "lucide-react";
import { chartGradients, gridProps, axisProps, tooltipProps, Legend, CHART_COLORS } from "./chartTheme";

const MONTHS = ["ינו", "פבר", "מרץ", "אפר", "מאי", "יונ", "יול", "אוג", "ספט", "אוק", "נוב", "דצמ"];

// `year` comes from the page's year selector. It used to be hardcoded to the current
// year here, so choosing 2027 changed the summary above and left this chart on 2026.
export default function MonthlyChart({ events, isLoading, staffMembers = [], year }) {
  const shownYear = year || new Date().getFullYear();
  const processMonthlyData = () => {
    if (!events.length) return [];

    const currentYear = shownYear;
    const monthlyData = Array(12).fill(null).map((_, index) => ({
      month: MONTHS[index],
      monthIndex: index,
      income: 0,
      expenses: 0,
      profit: 0,
      events: 0
    }));

    events.forEach(event => {
      const eventDate = new Date(event.date);
      if (eventDate.getFullYear() === currentYear) {
        const monthIndex = eventDate.getMonth();
        const expenses = getEventTeamCost(event);

        monthlyData[monthIndex].income += event.totalAmountGross || 0;
        monthlyData[monthIndex].expenses += expenses;
        monthlyData[monthIndex].profit += calculateNetProfit(event, staffMembers);
        monthlyData[monthIndex].events += 1;
      }
    });

    return monthlyData;
  };

  const chartData = processMonthlyData();

  if (isLoading) {
    return (
      <Card className="dash-card">
        <CardHeader>
          <CardTitle className="text-white">סקירה חודשית</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-80 flex items-center justify-center">
            <div className="animate-pulse text-gray-500">טוען גרף...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Design E (2026-10-07, the owner's reference image): the same four totals as tiles with icons.
  const sum = (k) => chartData.reduce((t, m) => t + m[k], 0);
  const tiles = [
    { label: 'סה"כ אירועים', value: sum("events").toLocaleString(), icon: Users, cls: "text-white", icon_cls: "text-sky-400" },
    { label: 'סה"כ הכנסה', value: `₪${sum("income").toLocaleString()}`, icon: Coins, cls: "text-amber-300", icon_cls: "text-amber-400" },
    { label: 'סה"כ הוצאות', value: `₪${sum("expenses").toLocaleString()}`, icon: CreditCard, cls: "text-rose-400", icon_cls: "text-rose-400" },
    { label: 'סה"כ רווח', value: `₪${(Math.round(sum("profit") * 100) / 100).toLocaleString()}`, icon: BarChart3, cls: "text-emerald-400", icon_cls: "text-emerald-400" },
  ];

  return (
    <Card className="dash-card">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-white flex items-center gap-2 text-base">
            <Calendar className="w-6 h-6 text-amber-400" />
            סקירה חודשית - {shownYear}
          </CardTitle>
          <Legend items={[["הכנסה", CHART_COLORS.income], ["הוצאה", CHART_COLORS.expenses], ["רווח נקי", CHART_COLORS.profit]]} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 5 }} barGap={3}>
              {chartGradients()}
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="month" {...axisProps} fontSize={12} />
              <YAxis {...axisProps} fontSize={12} tickFormatter={(value) => `₪${(value / 1000).toFixed(0)}K`} />
              <Tooltip
                {...tooltipProps}
                formatter={(value, name) => [
                  `₪${value.toLocaleString()}`,
                  name === 'income' ? 'הכנסה' : name === 'expenses' ? 'הוצאות' : 'רווח'
                ]}
                labelFormatter={(label) => `חודש ${label}`}
              />
              <Bar dataKey="income" fill="url(#rg-income)" name="income" radius={[3, 3, 0, 0]} maxBarSize={18} />
              <Bar dataKey="expenses" fill="url(#rg-expenses)" name="expenses" radius={[3, 3, 0, 0]} maxBarSize={18} />
              <Bar dataKey="profit" fill="url(#rg-profit)" name="profit" radius={[3, 3, 0, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Summary Stats */}
        <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3">
          {tiles.map((t) => (
            <div key={t.label} className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3">
              <t.icon className={`h-8 w-8 shrink-0 ${t.icon_cls} drop-shadow-[0_0_8px_currentColor]`} strokeWidth={1.75} />
              <div className="min-w-0">
                <p className="text-xs text-slate-400">{t.label}</p>
                <p className={`truncate text-lg font-bold tabular-nums ${t.cls}`}>{t.value}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
