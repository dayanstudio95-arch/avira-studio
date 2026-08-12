import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";

export default function StatsCards({ title, value, icon: Icon, bgColor, textColor, trend, subValue, subLabel }) {
  return (
    <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm hover:bg-gray-900/70 transition-all duration-300 hover:shadow-xl hover:shadow-yellow-500/10">
      <CardContent className="p-4 sm:p-6">
        <div className="flex justify-between items-start mb-3">
          <div>
            <p className="text-xs sm:text-sm font-medium text-gray-400 mb-1">{title}</p>
            <p className="text-xl sm:text-2xl md:text-3xl font-bold text-white">
              {value}
            </p>
            {subValue !== undefined && (
              <div className="mt-1.5">
                <p className="text-xs text-gray-500">{subLabel || 'רווח נקי'}</p>
                <p className="text-lg sm:text-xl md:text-2xl font-bold text-green-400">{subValue}</p>
              </div>
            )}
          </div>
          <div className={`p-3 rounded-xl ${bgColor} bg-opacity-20 ring-1 ring-white/10`}>
            <Icon className={`w-6 h-6 ${textColor}`} />
          </div>
        </div>
        {trend && (
          <div className="flex items-center text-sm">
            <TrendingUp className="w-4 h-4 mr-1 text-green-400" />
            <span className="text-gray-300">{trend}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}