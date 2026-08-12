import React from "react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { MapPin, Users, Eye, DollarSign } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

const paymentLabels = {
  "Paid":         { label: "שולם",   cls: "bg-green-500/20 text-green-400 border-green-500/30" },
  "Partially Paid":{ label: "חלקי",  cls: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  "Unpaid":       { label: "לא שולם",cls: "bg-red-500/20 text-red-400 border-red-500/30" },
};

function getProgressStatus(event) {
  const teamCount = event.team?.filter(m => m.staffMemberName)?.length || 0;
  if (teamCount === 0) return { label: "חסר צוות", cls: "bg-red-500/20 text-red-400 border-red-500/30" };
  if (event.photographer1_done && event.video1_done && event.editor_done)
    return { label: "הושלם", cls: "bg-green-500/20 text-green-400 border-green-500/30" };
  return { label: "בתהליך", cls: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" };
}

function getTeamSummary(event) {
  const members = (event.team || []).filter(m => m.staffMemberName);
  if (members.length === 0) return "אין צוות";
  return members.map(m => m.staffMemberName).join(", ");
}

export default function EventMobileCards({ events, isLoading, onOpenDetail, onOpenExpenses }) {
  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 animate-pulse h-28" />
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-500">
        <span className="text-4xl mb-3">💍</span>
        <p className="font-medium">אין אירועים עדיין</p>
      </div>
    );
  }

  let lastMonth = null;

  return (
    <div className="space-y-2 p-3" dir="rtl">
      {events.map(event => {
        const eventDate = new Date(event.date);
        const monthKey = format(eventDate, "MMMM yyyy");
        const showMonthHeader = monthKey !== lastMonth;
        lastMonth = monthKey;

        const pay = paymentLabels[event.clientPaymentStatus] || paymentLabels["Unpaid"];
        const ps  = getProgressStatus(event);
        const teamSummary = getTeamSummary(event);
        const teamCount = (event.team || []).filter(m => m.staffMemberName).length;
        const required  = event.requiredCrew || 3;
        const teamFull  = teamCount >= required;

        const waPhone = event.phoneNumber
          ? event.phoneNumber.replace(/\D/g, "").replace(/^0/, "972")
          : null;

        return (
          <React.Fragment key={event.id}>
            {showMonthHeader && (
              <div className="text-xs text-gray-500 font-semibold pt-2 pb-1 px-1 border-b border-gray-800">
                {monthKey}
              </div>
            )}
            <div id={`event-row-${event.id}`} className="bg-gray-900 border border-gray-800 rounded-xl p-3 space-y-2">
              {/* Top row: name + payment badge */}
              <div className="flex items-start justify-between gap-2">
                <button
                  onClick={() => onOpenDetail?.(event)}
                  className="text-base font-bold text-white hover:text-yellow-400 text-right leading-tight flex-1 min-w-0"
                >
                  {event.coupleNames}
                </button>
                <Badge variant="outline" className={`${pay.cls} border text-[10px] font-medium px-2 py-0.5 whitespace-nowrap flex-shrink-0`}>
                  {pay.label}
                </Badge>
              </div>

              {/* Date + Venue */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
                <span>📅 {format(eventDate, "d/M/yyyy")}</span>
                {event.venue && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    <span className="truncate max-w-[140px]">{event.venue}</span>
                  </span>
                )}
              </div>

              {/* Team */}
              <div className="flex items-center gap-2 text-xs">
                <Users className="w-3 h-3 text-gray-500 flex-shrink-0" />
                <span className={`truncate ${teamFull ? "text-green-400" : "text-red-400"}`}>
                  {teamSummary}
                  {!teamFull && <span className="ml-1 text-red-400">(חסר {required - teamCount})</span>}
                </span>
              </div>

              {/* Status badges */}
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline" className={`${ps.cls} border text-[10px] px-2 py-0.5`}>{ps.label}</Badge>
                {event.albumStatus === "sent" && (
                  <Badge variant="outline" className="bg-pink-500/20 text-pink-400 border-pink-500/30 border text-[10px] px-2 py-0.5">🖼️ אלבום נשלח</Badge>
                )}
                {event.signedAt && (
                  <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500/30 border text-[10px] px-2 py-0.5">✅ חתם</Badge>
                )}
              </div>

              {/* Quick actions */}
              <div className="flex items-center gap-2 pt-1 border-t border-gray-800">
                <button
                  onClick={() => onOpenDetail?.(event)}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-yellow-400 px-2 py-1 rounded-lg hover:bg-yellow-500/10 transition-colors"
                >
                  <Eye className="w-3.5 h-3.5" /> פרטים
                </button>
                <button
                  onClick={() => onOpenExpenses?.(event)}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-green-400 px-2 py-1 rounded-lg hover:bg-green-500/10 transition-colors"
                >
                  <DollarSign className="w-3.5 h-3.5" /> הוצאות
                </button>
                <Link to={createPageUrl(`TeamPayments?id=${event.id}`)}>
                  <button className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-400 px-2 py-1 rounded-lg hover:bg-blue-500/10 transition-colors">
                    <Users className="w-3.5 h-3.5" /> צוות
                  </button>
                </Link>
                {waPhone && (
                  <a
                    href={`https://wa.me/${waPhone}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-green-400 px-2 py-1 rounded-lg hover:bg-green-500/10 transition-colors mr-auto"
                  >
                    💬 וואטסאפ
                  </a>
                )}
              </div>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}