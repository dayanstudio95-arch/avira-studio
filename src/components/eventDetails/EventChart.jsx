import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart } from "lucide-react";
import { getVatPercent } from "@/lib/financialCalculations";

export default function EventChart({ event }) {
  const teamExpenses = (event.team || []).reduce((sum, member) => sum + (member.cost || 0), 0);
  const hasVideographer = (event.team || []).some(m => ['videographer', 'videographer2'].includes(m.role));
  const totalExpenses = teamExpenses + (hasVideographer ? 1200 : 0);
  const vatPercent = getVatPercent(event);
  const amountBeforeVat = event.totalAmountGross / (1 + vatPercent / 100);
  
  const chartData = [
    { 
      label: 'רווח נקי', 
      value: event.profitNet || 0, 
      color: 'bg-green-500',
      percentage: amountBeforeVat > 0 ? ((event.profitNet || 0) / amountBeforeVat * 100) : 0
    },
    { 
      label: `מע״מ (${vatPercent}%)`,
      value: event.vatAmount || 0, 
      color: 'bg-blue-500',
      percentage: ((event.vatAmount || 0) / event.totalAmountGross * 100)
    },
    { 
      label: 'סך הוצאות', 
      value: totalExpenses, 
      color: 'bg-red-500',
      percentage: amountBeforeVat > 0 ? (totalExpenses / amountBeforeVat * 100) : 0
    }
  ];

  return (
    <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
      <CardHeader className="border-b border-gray-800">
        <CardTitle className="text-white flex items-center gap-2">
          <PieChart className="w-5 h-5 text-yellow-400" />
          התפלגות כספית
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        {/* Donut Chart Visual */}
        <div className="relative w-48 h-48 mx-auto mb-6">
          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
            {/* Background circle */}
            <circle
              cx="50"
              cy="50"
              r="40"
              fill="none"
              stroke="rgb(55, 65, 81)"
              strokeWidth="8"
            />
            
            {/* Profit segment */}
            <circle
              cx="50"
              cy="50"
              r="40"
              fill="none"
              stroke="rgb(34, 197, 94)"
              strokeWidth="8"
              strokeDasharray={`${Math.max(chartData[0].percentage * 2.51, 0)} 251.2`}
              strokeDashoffset="0"
              className="transition-all duration-1000 ease-out"
            />
            
            {/* VAT segment */}
            <circle
              cx="50"
              cy="50"
              r="40"
              fill="none"
              stroke="rgb(59, 130, 246)"
              strokeWidth="8"
              strokeDasharray={`${Math.max(chartData[1].percentage * 2.51, 0)} 251.2`}
              strokeDashoffset={`-${Math.max(chartData[0].percentage * 2.51, 0)}`}
              className="transition-all duration-1000 ease-out"
            />
            
            {/* Expenses segment */}
            <circle
              cx="50"
              cy="50"
              r="40"
              fill="none"
              stroke="rgb(239, 68, 68)"
              strokeWidth="8"
              strokeDasharray={`${Math.max(chartData[2].percentage * 2.51, 0)} 251.2`}
              strokeDashoffset={`-${Math.max((chartData[0].percentage + chartData[1].percentage) * 2.51, 0)}`}
              className="transition-all duration-1000 ease-out"
            />
          </svg>
          
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p className="text-xs text-gray-400">רווח נקי</p>
            <p className={`text-lg font-bold ${
              (event.profitNet || 0) >= 0 ? 'text-green-400' : 'text-red-400'
            }`}>
              ₪{(event.profitNet || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
        </div>

        {/* Legend */}
        <div className="space-y-3">
          {chartData.map((item, index) => (
            <div key={index} className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-4 h-4 rounded-full ${item.color}`}></div>
                <span className="text-gray-300 text-sm">{item.label}</span>
              </div>
              <div className="text-right">
                <p className="text-white font-medium">₪{item.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                <p className="text-xs text-gray-500">{item.percentage.toFixed(1)}%</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}