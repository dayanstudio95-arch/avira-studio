import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users } from "lucide-react";
import { EVENT_TEAM_ROLE_LABELS as ROLE_LABELS } from "@/lib/staffRoles";

// Intentionally a fixed subset, not "every role in EVENT_TEAM_ROLES" — this card only
// flags an event as understaffed if it's missing a primary photographer or a
// videographer; photographer2/videographer2 are optional extras, not baseline
// requirements (product decision, not a bug — see the deep security audit's finding 6).
const REQUIRED_ROLES = ["photographer1", "videographer"];

export default function MissingCrewCard({ events }) {
  const today = new Date().toISOString().split("T")[0];

  const upcoming = events.filter(e => e.date && e.date >= today);

  const missing = upcoming
    .map(e => {
      const assignedRoles = (e.team || []).map(m => m.role).filter(Boolean);
      const requiredCrew = e.requiredCrew || 3;
      const missingRoles = REQUIRED_ROLES.filter(r => !assignedRoles.includes(r));
      const underStaffed = assignedRoles.length < requiredCrew;
      if (missingRoles.length === 0 && !underStaffed) return null;
      return { ...e, missingRoles, assignedCount: assignedRoles.length, requiredCrew };
    })
    .filter(Boolean)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  const formatDate = (d) => {
    if (!d) return "";
    const [y, m, day] = d.split("-");
    return `${day}/${m}/${y.slice(2)}`;
  };

  return (
    <Card className="bg-gray-900 border-gray-800">
      <CardHeader className="pb-3">
        <CardTitle className="text-white text-base flex items-center gap-2">
          <Users className="w-4 h-4 text-orange-400" />
          אירועים חסרי צוות
          {missing.length > 0 && (
            <Badge className="bg-orange-500/20 text-orange-300 border-orange-700 text-xs ml-1">{missing.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {missing.length === 0 ? (
          <p className="text-gray-500 text-sm">כל האירועים הקרובים מאוישים ✓</p>
        ) : (
          <div className="space-y-2">
            {missing.map(e => (
              <div key={e.id} className="bg-gray-800/60 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <span className="text-white text-sm font-medium">{e.coupleNames}</span>
                  <span className="text-gray-400 text-xs">{formatDate(e.date)}</span>
                </div>
                <div className="flex gap-2 mt-1.5 flex-wrap">
                  {e.missingRoles.map(r => (
                    <Badge key={r} variant="outline" className="border-red-700 text-red-400 text-xs">
                      חסר: {ROLE_LABELS[r] || r}
                    </Badge>
                  ))}
                  {e.assignedCount < e.requiredCrew && (
                    <Badge variant="outline" className="border-yellow-700 text-yellow-400 text-xs">
                      {e.assignedCount}/{e.requiredCrew} משובצים
                    </Badge>
                  )}
                </div>
                {e.venue && <p className="text-gray-500 text-xs mt-1">📍 {e.venue}</p>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}