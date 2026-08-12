import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Lightbulb } from "lucide-react";

export default function DailyTipCard({ tip }) {
  return (
    <Card className="bg-gradient-to-br from-blue-900/40 to-blue-800/20 border-blue-700/30 h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-white text-base flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-yellow-400" />
          המלצה יומית
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-gray-200 text-sm leading-relaxed">{tip}</p>
      </CardContent>
    </Card>
  );
}