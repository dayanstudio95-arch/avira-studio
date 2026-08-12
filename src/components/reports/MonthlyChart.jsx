import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { calculateNetProfit } from "../../lib/profitCalculations";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Calendar } from "lucide-react";

const MONTHS = ["ינו", "פבר", "מרץ", "אפר", "מאי", "יונ", "יול", "אוג", "ספט", "אוק", "נוב", "דצמ"];

export default function MonthlyChart({ events, isLoading, staffMembers = [] }) {
  const processMonthlyData = () => {
    if (!events.length) return [];

    const currentYear = new Date().getFullYear();
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
        const expenses = (event.team || []).reduce((sum, member) => sum + (member.cost || 0), 0);
        
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
      <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
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

  return (
    <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Calendar className="w-5 h-5 text-yellow-400" />
          סקירה חודשית - {new Date().getFullYear()}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis 
                dataKey="month" 
                stroke="#9CA3AF"
                fontSize={12}
              />
              <YAxis 
                stroke="#9CA3AF"
                fontSize={12}
                tickFormatter={(value) => `₪${(value / 1000).toFixed(0)}K`}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#1F2937', 
                  border: '1px solid #374151',
                  borderRadius: '8px',
                  color: '#F3F4F6'
                }}
                formatter={(value, name) => [
                  `₪${value.toLocaleString()}`, 
                  name === 'income' ? 'הכנסה' : name === 'expenses' ? 'הוצאות' : 'רווח'
                ]}
                labelFormatter={(label) => `חודש ${label}`}
              />
              <Legend 
                formatter={(value) => 
                  value === 'income' ? 'הכנסה' : 
                  value === 'expenses' ? 'הוצאות' : 'רווח נקי'
                }
              />
              <Bar dataKey="income" fill="#F59E0B" name="income" radius={[2, 2, 0, 0]} />
              <Bar dataKey="expenses" fill="#EF4444" name="expenses" radius={[2, 2, 0, 0]} />
              <Bar dataKey="profit" fill="#10B981" name="profit" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        
        {/* Summary Stats */}
        <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <p className="text-sm text-gray-400">סה"כ אירועים</p>
            <p className="text-lg font-bold text-white">
              {chartData.reduce((sum, month) => sum + month.events, 0)}
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm text-gray-400">סה"כ הכנסה</p>
            <p className="text-lg font-bold text-yellow-400">
              ₪{chartData.reduce((sum, month) => sum + month.income, 0).toLocaleString()}
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm text-gray-400">סה"כ הוצאות</p>
            <p className="text-lg font-bold text-red-400">
              ₪{chartData.reduce((sum, month) => sum + month.expenses, 0).toLocaleString()}
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm text-gray-400">סה"כ רווח</p>
            <p className="text-lg font-bold text-green-400">
              ₪{chartData.reduce((sum, month) => sum + month.profit, 0).toLocaleString()}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}