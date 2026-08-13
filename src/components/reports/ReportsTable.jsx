import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Receipt } from "lucide-react";
import { calculateNetProfit } from "../../lib/profitCalculations";
import { calculateEventFinancials } from "../../lib/financialCalculations";

export default function ReportsTable({ events, period, isLoading, staffMembers = [] }) {
  const calculateTotals = () => {
    return events.reduce((totals, event) => ({
      income: totals.income + (event.totalAmountGross || 0),
      expenses: totals.expenses + (event.team || []).reduce((sum, member) => sum + (member.cost || 0), 0),
      // Self-heal like calculateNetProfit below: some legacy/CSV-imported events never had
      // vatAmount persisted, so fall back to live-computing it from totalAmountGross/vatPercent
      // instead of silently showing 0 for those events.
      vat: totals.vat + (event.vatAmount != null ? event.vatAmount : calculateEventFinancials(event).vatAmount),
      profit: totals.profit + calculateNetProfit(event, staffMembers)
    }), { income: 0, expenses: 0, vat: 0, profit: 0 });
  };

  const totals = calculateTotals();

  if (isLoading) {
    return (
      <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-white">Financial Summary</CardTitle>
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
          Financial Summary
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex justify-between items-center py-3 border-b border-gray-800">
            <span className="text-gray-400">Total Events</span>
            <span className="text-white font-semibold">{events.length}</span>
          </div>
          
          <div className="flex justify-between items-center py-3 border-b border-gray-800">
            <span className="text-gray-400">Gross Income</span>
            <span className="text-yellow-400 font-semibold">₪{totals.income.toLocaleString()}</span>
          </div>
          
          <div className="flex justify-between items-center py-3 border-b border-gray-800">
            <span className="text-gray-400">Total VAT</span>
            <span className="text-blue-400 font-semibold">₪{totals.vat.toLocaleString()}</span>
          </div>
          
          <div className="flex justify-between items-center py-3 border-b border-gray-800">
            <span className="text-gray-400">Total Expenses</span>
            <span className="text-red-400 font-semibold">₪{totals.expenses.toLocaleString()}</span>
          </div>
          
          <div className="flex justify-between items-center py-4 border-t-2 border-yellow-400/20">
            <span className="text-white font-bold text-lg">Net Profit</span>
            <span className={`font-bold text-xl ${
              totals.profit >= 0 ? 'text-green-400' : 'text-red-400'
            }`}>
              ₪{totals.profit.toLocaleString()}
            </span>
          </div>
        </div>

        {events.length > 0 && (
          <div className="mt-6 pt-6 border-t border-gray-800">
            <h4 className="text-white font-medium mb-4">Average per Event</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Avg Income</span>
                <span className="text-white">₪{Math.round(totals.income / events.length).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Avg Profit</span>
                <span className="text-white">₪{Math.round(totals.profit / events.length).toLocaleString()}</span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}