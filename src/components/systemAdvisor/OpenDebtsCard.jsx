import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DollarSign } from "lucide-react";

// כלל עסקי: אירועי עבר בלבד (date < today) שה-clientPaymentStatus שלהם אינו 'Paid'
export default function OpenDebtsCard({ events }) {
  const today = new Date().toISOString().split("T")[0];

  const unpaid = events
    .filter(e => e.date && e.date < today && e.clientPaymentStatus !== "Paid")
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const formatDate = (d) => {
    if (!d) return "";
    const [y, m, day] = d.split("-");
    return `${day}/${m}/${y.slice(2)}`;
  };

  const statusColor = (s) => {
    if (s === "Partially Paid") return "border-yellow-700 bg-yellow-950/20 text-yellow-400";
    return "border-red-700 bg-red-950/20 text-red-400";
  };

  const statusLabel = (s) => {
    if (s === "Partially Paid") return "שולם חלקית";
    return "לא שולם";
  };

  return (
    <Card className="bg-gray-900 border-gray-800">
      <CardHeader className="pb-3">
        <CardTitle className="text-white text-base flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-red-400" />
          חובות פתוחים
          {unpaid.length > 0 && (
            <Badge className="bg-red-500/20 text-red-300 border-red-700 text-xs ml-1">{unpaid.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {unpaid.length === 0 ? (
          <p className="text-gray-500 text-sm">אין חובות פתוחים ✓</p>
        ) : (
          <div className="space-y-2">
            {unpaid.map(e => (
              <div key={e.id} className="bg-gray-800/60 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <span className="text-white text-sm font-medium">{e.coupleNames}</span>
                  <span className="text-gray-400 text-xs">{formatDate(e.date)}</span>
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <Badge variant="outline" className={`text-xs ${statusColor(e.clientPaymentStatus)}`}>
                    {statusLabel(e.clientPaymentStatus)}
                  </Badge>
                  {e.totalAmountGross && (
                    <span className="text-gray-400 text-xs">סכום: {e.totalAmountGross.toLocaleString()}₪</span>
                  )}
                </div>
                {e.phoneNumber && <p className="text-gray-500 text-xs mt-1">📞 {e.phoneNumber}</p>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}