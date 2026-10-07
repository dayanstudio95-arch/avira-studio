import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import { Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { isMissingTeam, israelToday, assignedShooters, requiredShooters, eventDay, missingRoles } from "@/lib/missingTeam";

export default function DashboardMissingTeamCard({ events }) {
  const navigate = useNavigate();
  // The shared rule (src/lib/missingTeam.js) — same number as the sidebar and the staff page.
  const today = israelToday();
  // Packages say how many photographers / videographers each event needs (missingRoles).
  const pkgQ = useQuery({ queryKey: ["dashPackages"], queryFn: () => base44.entities.Package.list(), staleTime: 600000 });
  const pkgById = Object.fromEntries((pkgQ.data || []).map((p) => [p.id, p]));
  const missingTeamEvents = events
    .filter((e) => isMissingTeam(e, today))
    .sort((a, b) => eventDay(a).localeCompare(eventDay(b)));

  return (
    <Card className="dash-card flex flex-col h-full overflow-hidden">
      <CardHeader className="dash-head pb-3 flex-shrink-0">
        <CardTitle className="text-white flex items-center gap-2 text-base font-semibold">
          <Users className="w-5 h-5 text-orange-400" />
          חסר צוות
          {missingTeamEvents.length > 0 && (
            <span className="e-count e-count-orange">
              {missingTeamEvents.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="e-scroll px-3 py-1 overflow-y-auto flex-grow min-h-0" >
        {missingTeamEvents.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-sm">כל האירועים משובצים ✅</div>
        ) : (
          <div>
            {missingTeamEvents.map((event) => {
              const assigned = assignedShooters(event);
              const required = requiredShooters(event);
              return (
                <div
                  key={event.id}
                  className="e-row flex items-center justify-between gap-2 px-2 py-3 cursor-pointer rounded-lg hover:bg-white/[0.03] transition-colors"
                  onClick={() => navigate(`/StaffScheduling?eventId=${event.id}`)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{event.coupleNames}</p>
                    <p className="text-xs text-slate-400 truncate">
                      {format(new Date(event.date), "d/M/yyyy")}{event.venue ? ` · ${event.venue}` : ""}
                    </p>
                    <p className="text-[11px] text-rose-300/90 truncate">חסר {missingRoles(event, pkgById[event.packageId]).join(" + ")}</p>
                  </div>
                  <span className="e-chip e-chip-orange shrink-0">
                    {assigned}/{required} &#x202B;מאויש
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}