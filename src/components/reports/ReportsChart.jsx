import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp } from "lucide-react";
import { format } from "date-fns";
import { chartGradients, gridProps, axisProps, tooltipProps, Legend, CHART_COLORS } from "./chartTheme";

import { calculateNetProfit } from "../../lib/profitCalculations";
import { getEventTeamCost } from "../../lib/financialCalculations";

export default function ReportsChart({ events, period, isLoading, staffMembers = [] }) {
  const processChartData = () => {
    if (!events.length) return [];

    // Every event in the period, oldest first. This used to be `.slice(0, 10)` with a
    // "top 10" comment — it was simply the first ten of a date-descending list, so a
    // month with 26 weddings drew 10 bars under a summary that counted 26.
    const data = [...events]
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map(event => ({
        // Design E (2026-10-07): the axis shows the date (d/M, as in the owner's reference);
        // the couple's names are in the tooltip.
        name: event.date ? format(new Date(event.date), "d/M") : "—",
        couple: event.coupleNames || 'אירוע',
        income: event.totalAmountGross || 0,
        expenses: getEventTeamCost(event),
        profit: calculateNetProfit(event, staffMembers)
      }));

    return data;
  };

  const chartData = processChartData();

  if (isLoading) {
    return (
      <Card className="dash-card">
        <CardHeader>
          <CardTitle className="text-white">הכנסות מול הוצאות</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-80 flex items-center justify-center">
            <div className="animate-pulse text-gray-500">Loading chart...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (chartData.length === 0) {
    return (
      <Card className="dash-card">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2 text-base">
            <TrendingUp className="w-6 h-6 text-amber-400" />
            הכנסות מול הוצאות — לפי אירוע
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-80 flex items-center justify-center">
            <div className="text-center text-gray-500">
              <TrendingUp className="w-12 h-12 mx-auto mb-4 text-gray-600" />
              <p>אין נתונים לתקופה הזו</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="dash-card">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-white flex items-center gap-2 text-base">
            <TrendingUp className="w-6 h-6 text-amber-400" />
            Income vs Expenses
          </CardTitle>
          <Legend items={[["הכנסה", CHART_COLORS.income], ["הוצאה", CHART_COLORS.expenses]]} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 5 }} barGap={2}>
              {chartGradients()}
              <CartesianGrid {...gridProps} />
              <XAxis
                dataKey="name"
                {...axisProps}
                fontSize={11}
                interval={chartData.length > 16 ? 1 : 0}
                angle={chartData.length > 8 ? -45 : 0}
                textAnchor={chartData.length > 8 ? "end" : "middle"}
                height={chartData.length > 8 ? 46 : 30}
              />
              <YAxis
                {...axisProps}
                fontSize={12}
                tickFormatter={(value) => `₪${value.toLocaleString()}`}
              />
              <Tooltip
                {...tooltipProps}
                labelFormatter={(label, payload) => `${label}${payload?.[0]?.payload?.couple ? ` · ${payload[0].payload.couple}` : ""}`}
                formatter={(value, name) => [`₪${value.toLocaleString()}`, name]}
              />
              <Bar dataKey="income" fill="url(#rg-income)" name="הכנסה ברוטו" radius={[3, 3, 0, 0]} maxBarSize={14} />
              <Bar dataKey="expenses" fill="url(#rg-expenses)" name="הוצאות צוות" radius={[3, 3, 0, 0]} maxBarSize={14} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
