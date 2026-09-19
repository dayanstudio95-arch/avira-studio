import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Receipt } from "lucide-react";
import { calculateNetProfit } from "../../lib/profitCalculations";
import { getEventVatAmount, getEventTeamCost } from "../../lib/financialCalculations";

// Two decimals, always. The default toLocaleString() allows three, which is how
// "₪77,076.271" ended up on screen — a float artefact presented as if it were money.
const money = (n) =>
  `₪${(Math.round((n || 0) * 100) / 100).toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export default function ReportsTable({ events, period, isLoading, staffMembers = [] }) {
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
      <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
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

  return (
    <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Receipt className="w-5 h-5 text-yellow-400" />
          סיכום פיננסי
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex justify-between items-center py-3 border-b border-gray-800">
            <span className="text-gray-400">מספר אירועים</span>
            <span className="text-white font-semibold">{events.length}</span>
          </div>

          <div className="flex justify-between items-center py-3 border-b border-gray-800">
            <span className="text-gray-400">הכנסה ברוטו (כולל מע״מ)</span>
            <span className="text-yellow-400 font-semibold">{money(totals.income)}</span>
          </div>

          <div className="flex justify-between items-center py-3 border-b border-gray-800">
            <span className="text-gray-400">− מע״מ</span>
            <span className="text-blue-400 font-semibold">{money(totals.vat)}</span>
          </div>

          <div className="flex justify-between items-center py-3 border-b border-gray-800">
            <span className="text-gray-400">= הכנסה לפני מע״מ</span>
            <span className="text-white font-semibold">{money(beforeVat)}</span>
          </div>

          <div className="flex justify-between items-center py-3 border-b border-gray-800">
            <span className="text-gray-400">− הוצאות צוות (כפי שנרשמו באירועים)</span>
            <span className="text-red-400 font-semibold">{money(totals.expenses)}</span>
          </div>

          <div className="flex justify-between items-center py-4 border-t-2 border-yellow-400/20">
            <span className="text-white font-bold text-lg">= רווח נקי</span>
            <span className={`font-bold text-xl ${
              totals.profit >= 0 ? 'text-green-400' : 'text-red-400'
            }`}>
              {money(totals.profit)}
            </span>
          </div>
        </div>

        {events.length > 0 && (
          <div className="mt-6 pt-6 border-t border-gray-800">
            <h4 className="text-white font-medium mb-4">ממוצע לאירוע</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">הכנסה ממוצעת</span>
                <span className="text-white">₪{Math.round(totals.income / events.length).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">רווח ממוצע</span>
                <span className="text-white">₪{Math.round(totals.profit / events.length).toLocaleString()}</span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}