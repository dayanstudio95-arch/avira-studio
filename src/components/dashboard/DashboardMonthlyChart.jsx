import React from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";

const MONTHS_HE = ["ינו", "פבר", "מרץ", "אפר", "מאי", "יונ", "יול", "אוג", "ספט", "אוק", "נוב", "דצמ"];

export default function DashboardMonthlyChart({ events, year }) {
  const data = MONTHS_HE.map((month, idx) => {
    const monthEvents = events.filter(e => {
      const d = new Date(e.date);
      return d.getFullYear() === year && d.getMonth() === idx;
    });
    const income = monthEvents.reduce((s, e) => s + (e.totalAmountGross || 0), 0);
    const profit = monthEvents.reduce((s, e) => s + (e.profitNet || 0), 0);
    return { month, income, profit };
  });

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-xs">
        <p className="text-gray-300 font-semibold mb-1">{label}</p>
        {payload.map((p, i) => (
          <p key={i} style={{ color: p.color }}>
            {p.name}: ₪{p.value.toLocaleString()}
          </p>
        ))}
      </div>
    );
  };

  return (
    <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm mb-8">
      <CardHeader className="border-b border-gray-800 pb-4">
        <CardTitle className="text-white flex items-center gap-2 text-lg">
          <TrendingUp className="w-5 h-5 text-yellow-400" />
          הכנסות לפי חודש — {year}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <ResponsiveContainer width="100%" height={130}>
          <BarChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="month" tick={{ fill: "#9ca3af", fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `₪${(v/1000).toFixed(0)}k`} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ color: "#9ca3af", fontSize: 12 }} formatter={(val) => val === "income" ? "הכנסות" : "רווח נקי"} />
            <Bar dataKey="income" name="income" fill="#eab308" radius={[3, 3, 0, 0]} />
            <Bar dataKey="profit" name="profit" fill="#22c55e" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}