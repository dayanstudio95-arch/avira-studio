import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Flame, Clock, MessageSquare, Target } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { buildAttentionList } from "@/lib/needsAttention";

// The dashboard's צריך טיפול card. The merge itself lives in src/lib/needsAttention.js
// so it can be tested without React — everything that can be wrong is in there, not in
// the rendering below. This file owns only how each reason looks.

const REASONS = {
  hot: { label: "רוצה להתקדם", icon: Flame, className: "bg-red-500/20 text-red-300 border-red-500/30" },
  silent_pricelist: { label: "קיבל מחירון ושותק", icon: MessageSquare, className: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30" },
  stale_lead: { label: "בלי מגע", icon: Clock, className: "bg-gray-600/30 text-gray-300 border-gray-600" },
};

export default function NeedsAttentionCard() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [conversations, leads] = await Promise.all([
          base44.entities.WhatsAppConversation.list("-lastMessageAt", 300),
          base44.entities.Lead.list("-updated_date", 300),
        ]);
        setItems(buildAttentionList(conversations, leads));
      } catch (e) {
        console.error("Error loading needs-attention list:", e);
        setItems([]);
      }
      setIsLoading(false);
    })();
  }, []);

  return (
    <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm flex flex-col h-full">
      <CardHeader className="border-b border-gray-800 pb-3 flex-shrink-0">
        <CardTitle className="text-white flex items-center gap-2 text-sm font-semibold">
          <Target className="w-4 h-4 text-emerald-400" />
          צריך טיפול
          {items.length > 0 && (
            <span className="bg-emerald-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
              {items.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 overflow-y-auto flex-grow" style={{ maxHeight: "260px" }}>
        {isLoading && <div className="py-8 text-center text-gray-500 text-sm">טוען…</div>}

        {!isLoading && items.length === 0 && (
          <div className="py-8 text-center text-gray-500 text-sm">אין לידים שממתינים ✅</div>
        )}

        <div className="divide-y divide-gray-800/60">
          {items.map((item) => {
            const meta = REASONS[item.reason];
            const Icon = meta.icon;
            return (
              <div
                key={item.key}
                onClick={() => navigate(item.target)}
                className="flex items-center justify-between gap-2 px-3 py-2.5 cursor-pointer hover:bg-gray-800/30 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{item.name}</p>
                  <p className="text-xs text-gray-400 truncate">
                    {item.detail}
                    {item.days !== null && item.detail ? " · " : ""}
                    {item.days !== null && (item.days === 0 ? "היום" : `לפני ${item.days} ימים`)}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={`border text-xs whitespace-nowrap flex items-center gap-1 ${meta.className}`}
                >
                  <Icon className="w-3 h-3" />
                  {meta.label}
                </Badge>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
