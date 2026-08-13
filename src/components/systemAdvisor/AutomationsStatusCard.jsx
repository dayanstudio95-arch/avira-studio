import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, Clock, AlertTriangle } from "lucide-react";

export default function AutomationsStatusCard({ automations, runs }) {
  const [showInactive, setShowInactive] = useState(false);

  const active   = automations.filter(a => a.isActive);
  const inactive = automations.filter(a => !a.isActive);

  // Last run across all automations (active only — inactive haven't run recently)
  const lastRun = [...active]
    .filter(a => a.lastRunAt)
    .sort((a, b) => new Date(b.lastRunAt) - new Date(a.lastRunAt))[0];

  // Last error from AutomationRun records
  const lastError = [...(runs || [])]
    .filter(r => r.status === "error" && r.errorMessage)
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0];

  const formatDate = (d) => {
    if (!d) return "—";
    return new Date(d).toLocaleString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  // Displayed list: always show active; show inactive only if toggle is on
  const displayed = showInactive ? automations : active;

  return (
    <Card className="bg-gray-900 border-gray-800">
      <CardHeader className="pb-3">
        <CardTitle className="text-white text-base flex items-center gap-2">
          <Clock className="w-4 h-4 text-yellow-400" />
          מצב אוטומציות
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">

        {/* Counts */}
        <div className="flex items-center justify-between">
          <div className="flex gap-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-400" />
              <span className="text-gray-300 text-sm">{active.length} פעילות</span>
            </div>
            <div className="flex items-center gap-2">
              <XCircle className="w-4 h-4 text-gray-500" />
              <span className="text-gray-500 text-sm">{inactive.length} כבויות</span>
            </div>
          </div>

          {/* Toggle: show inactive */}
          {inactive.length > 0 && (
            <button
              onClick={() => setShowInactive(v => !v)}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                showInactive
                  ? "border-gray-500 bg-gray-700 text-gray-300"
                  : "border-gray-700 bg-gray-800/60 text-gray-500 hover:text-gray-400"
              }`}
            >
              {showInactive ? "הסתר כבויות" : "הצג כבויות"}
            </button>
          )}
        </div>

        {/* Last run */}
        <div className="text-xs text-gray-500">
          ריצה אחרונה:{" "}
          <span className="text-gray-300">
            {lastRun ? `${lastRun.name} — ${formatDate(lastRun.lastRunAt)}` : "—"}
          </span>
        </div>

        {/* Last error */}
        {lastError && (
          <div className="bg-red-950/40 border border-red-800/40 rounded-lg p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-red-300 text-xs font-medium">{lastError.automationName}</p>
              <p className="text-red-400/80 text-xs mt-0.5">{lastError.errorMessage}</p>
              <p className="text-gray-500 text-xs mt-1">{formatDate(lastError.startedAt)}</p>
            </div>
          </div>
        )}

        {/* Automation list */}
        <div className="space-y-1.5 mt-1">
          {displayed.map(a => (
            <div key={a.id} className="flex items-center justify-between text-xs">
              <span className={a.isActive ? "text-gray-400" : "text-gray-600"}>
                {a.emoji || "⚙️"} {a.name}
              </span>
              <Badge
                variant="outline"
                className={a.isActive ? "border-green-700 text-green-400" : "border-gray-700 text-gray-600"}
              >
                {a.isActive ? "פעיל" : "כבוי"}
              </Badge>
            </div>
          ))}
          {displayed.length === 0 && (
            <p className="text-gray-600 text-xs">אין אוטומציות פעילות</p>
          )}
        </div>

      </CardContent>
    </Card>
  );
}