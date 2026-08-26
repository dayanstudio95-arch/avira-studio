import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import { Heart, Calendar, Banknote, Receipt, TrendingUp } from "lucide-react";
import { getVatPercent } from "@/lib/financialCalculations";

export default function SummaryStep({ eventData }) {
  // Get pre-calculated totalExpenses (includes Dror if videographer exists)
  const totalExpenses = eventData.totalExpenses || 0;
  const vatPercent = getVatPercent(eventData);
  const amountBeforeVat = eventData.totalAmountGross / (1 + vatPercent / 100);

  const chartData = [
    { label: 'רווח נקי', value: eventData.profitNet || 0, color: 'bg-green-500', percentage: amountBeforeVat > 0 ? ((eventData.profitNet || 0) / amountBeforeVat * 100) : 0 },
    { label: `מע״מ (${vatPercent}%)`, value: eventData.vatAmount || 0, color: 'bg-blue-500', percentage: ((eventData.vatAmount || 0) / eventData.totalAmountGross * 100) },
    { label: 'סך הוצאות', value: totalExpenses, color: 'bg-red-500', percentage: amountBeforeVat > 0 ? (totalExpenses / amountBeforeVat * 100) : 0 }
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Event Details */}
        <Card className="bg-gray-800/30 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Heart className="w-5 h-5 text-yellow-400" />
              פרטי האירוע
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Calendar className="w-4 h-4 text-gray-400" />
              <span className="text-gray-300">
                {format(new Date(eventData.date), "MMMM d, yyyy")}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Heart className="w-4 h-4 text-gray-400" />
              <span className="text-gray-300">{eventData.coupleNames}</span>
            </div>
            <div className="flex items-center gap-3">
              <Banknote className="w-4 h-4 text-gray-400" />
              <span className="text-gray-300">
                ₪{eventData.totalAmountGross?.toLocaleString()} gross
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Financial Summary */}
        <Card className="bg-gray-800/30 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-yellow-400" />
              סיכום פיננסי
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-gray-400">הכנסה ברוטו</span>
              <span className="text-yellow-400 font-semibold">
                ₪{eventData.totalAmountGross?.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">מע״מ ({vatPercent}%)</span>
              <span className="text-blue-400 font-semibold">
                -₪{eventData.vatAmount?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
             {eventData.vatableAmount > 0 && eventData.vatableAmount < eventData.totalAmountGross && (
              <p className="text-xs text-center text-gray-500 -my-2">
                (חושב על בסיס ₪{eventData.vatableAmount.toLocaleString()})
              </p>
            )}
            <div className="flex justify-between items-center">
              <span className="text-gray-400">סך הוצאות</span>
              <span className="text-red-400 font-semibold">
                -₪{totalExpenses.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            {(() => {
              const hasVideographer = (eventData.team || []).some(m => ['videographer', 'videographer2'].includes(m.role));
              return hasVideographer ? (
                <p className="text-xs text-center text-gray-500 -my-2">
                  (כולל דרור - עורך וידאו: ₪1,200)
                </p>
              ) : null;
            })()}
            <div className="border-t border-gray-700 pt-4">
              <div className="flex justify-between items-center">
                <span className="text-white font-semibold">רווח נקי</span>
                <span className={`font-bold text-lg ${
                  (eventData.profitNet || 0) >= 0 ? 'text-green-400' : 'text-red-400'
                }`}>
                  ₪{eventData.profitNet?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Visual Breakdown */}
      <Card className="bg-gray-800/30 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Receipt className="w-5 h-5 text-yellow-400" />
            התפלגות ההכנסה
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {chartData.map((item, index) => (
              <div key={index} className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-gray-300 font-medium">{item.label}</span>
                  <span className="text-white font-semibold">
                    ₪{item.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({item.percentage.toFixed(1)}%)
                  </span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
                  <div 
                    className={`h-full ${item.color} transition-all duration-500 ease-out`}
                    style={{ width: `${Math.max(item.percentage, 0)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}