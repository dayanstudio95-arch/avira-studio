import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import { Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import { isMissingTeam, israelToday, assignedShooters, requiredShooters, eventDay } from "@/lib/missingTeam";

export default function DashboardMissingTeamCard({ events }) {
  const navigate = useNavigate();
  // The shared rule (src/lib/missingTeam.js) — same number as the sidebar and the staff page.
  const today = israelToday();
  const missingTeamEvents = events
    .filter((e) => isMissingTeam(e, today))
    .sort((a, b) => eventDay(a).localeCompare(eventDay(b)));

  return (
    <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm flex flex-col h-full">
      <CardHeader className="border-b border-gray-800 pb-3 flex-shrink-0">
        <CardTitle className="text-white flex items-center gap-2 text-sm font-semibold">
          <Users className="w-4 h-4 text-orange-400" />
          חסר צוות
          {missingTeamEvents.length > 0 && (
            <span className="bg-orange-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
              {missingTeamEvents.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 overflow-y-auto flex-grow" style={{ maxHeight: "260px" }}>
        {missingTeamEvents.length === 0 ? (
          <div className="py-8 text-center text-gray-500 text-sm">כל האירועים משובצים ✅</div>
        ) : (
          <div className="divide-y divide-gray-800/60">
            {missingTeamEvents.map((event) => {
              const assigned = assignedShooters(event);
              const required = requiredShooters(event);
              return (
                <div
                  key={event.id}
                  className="flex items-center justify-between gap-2 px-3 py-2.5 cursor-pointer hover:bg-gray-800/30 transition-colors"
                  onClick={() => navigate(`/StaffScheduling?eventId=${event.id}`)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{event.coupleNames}</p>
                    <p className="text-xs text-gray-400">{format(new Date(event.date), "d/M/yyyy")}</p>
                  </div>
                  <Badge variant="outline" className="bg-orange-500/20 text-orange-400 border-orange-500/30 border text-xs whitespace-nowrap">
                    {assigned}/{required} &#x202B;מאויש
                  </Badge>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}