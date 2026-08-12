import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Heart } from "lucide-react";

function scoreColor(score) {
  if (score >= 80) return { bar: "bg-green-500", text: "text-green-400", ring: "text-green-400" };
  if (score >= 60) return { bar: "bg-yellow-500", text: "text-yellow-400", ring: "text-yellow-400" };
  if (score >= 40) return { bar: "bg-orange-500", text: "text-orange-400", ring: "text-orange-400" };
  return { bar: "bg-red-500", text: "text-red-400", ring: "text-red-400" };
}

const penaltyColor = {
  red: "text-red-400",
  orange: "text-orange-400",
  yellow: "text-yellow-400",
  green: "text-green-400",
};

export default function HealthScoreCard({ score, penalties }) {
  const colors = scoreColor(score);

  return (
    <Card className="bg-gray-900 border-gray-800 h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-white text-base flex items-center gap-2">
          <Heart className="w-4 h-4 text-pink-400" />
          בריאות מערכת
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Score display */}
        <div className="flex items-end gap-1 mb-3">
          <span className={`text-5xl font-black ${colors.text}`}>{score}</span>
          <span className="text-gray-500 text-lg mb-1">/100</span>
        </div>

        {/* Bar */}
        <div className="h-2 bg-gray-800 rounded-full mb-4 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${colors.bar}`}
            style={{ width: `${score}%` }}
          />
        </div>

        {/* Penalties breakdown */}
        <div className="space-y-1.5">
          {penalties.length === 0 ? (
            <p className="text-green-400 text-xs">✅ לא נמצאו ניכויים</p>
          ) : (
            penalties.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-gray-400">{p.label}</span>
                <span className={`font-semibold ${penaltyColor[p.color] || "text-gray-400"}`}>
                  -{p.deduct}
                </span>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}