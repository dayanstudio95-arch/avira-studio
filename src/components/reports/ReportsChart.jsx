import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp } from "lucide-react";

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
        name: (event.coupleNames || '').split(' ')[0] || 'אירוע',
        income: event.totalAmountGross || 0,
        expenses: getEventTeamCost(event),
        profit: calculateNetProfit(event, staffMembers)
      }));

    return data;
  };

  const chartData = processChartData();

  if (isLoading) {
    return (
      <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
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
      <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-yellow-400" />
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
    <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-yellow-400" />
          Income vs Expenses
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="name"
                stroke="#9CA3AF"
                fontSize={chartData.length > 14 ? 10 : 12}
                interval={0}
                angle={chartData.length > 14 ? -45 : 0}
                textAnchor={chartData.length > 14 ? "end" : "middle"}
                height={chartData.length > 14 ? 50 : 30}
              />
              <YAxis 
                stroke="#9CA3AF"
                fontSize={12}
                tickFormatter={(value) => `₪${value.toLocaleString()}`}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#1F2937', 
                  border: '1px solid #374151',
                  borderRadius: '8px',
                  color: '#F3F4F6'
                }}
                formatter={(value, name) => [`₪${value.toLocaleString()}`, name]}
              />
              <Bar dataKey="income" fill="#F59E0B" name="הכנסה ברוטו" radius={[2, 2, 0, 0]} />
              <Bar dataKey="expenses" fill="#EF4444" name="הוצאות צוות" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}