import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

const colorStyles = {
  red: "border-red-500/40 bg-red-500/10 text-red-300",
  orange: "border-orange-500/40 bg-orange-500/10 text-orange-300",
  yellow: "border-yellow-500/40 bg-yellow-500/10 text-yellow-300",
  green: "border-green-500/40 bg-green-500/10 text-green-300",
};

const dotColor = {
  red: "bg-red-500",
  orange: "bg-orange-500",
  yellow: "bg-yellow-500",
  green: "bg-green-500",
};

export default function PriorityQueueCard({ items }) {
  return (
    <Card className="bg-gray-900 border-gray-800">
      <CardHeader className="pb-3">
        <CardTitle className="text-white text-base flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-400" />
          דורש טיפול עכשיו
          {items.length > 0 && (
            <span className="mr-auto text-xs font-normal bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full border border-red-500/30">
              {items.length} פריטים
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="flex items-center gap-2 text-green-400 text-sm py-2">
            <span>✅</span>
            <span>אין פריטים דחופים — המערכת תקינה!</span>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item, i) => (
              <div
                key={i}
                className={`flex items-start gap-3 p-3 rounded-xl border text-sm ${colorStyles[item.color] || colorStyles.yellow}`}
              >
                <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${dotColor[item.color] || dotColor.yellow}`} />
                <span className="leading-snug">
                  <span className="ml-1.5">{item.icon}</span>
                  {item.text}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}