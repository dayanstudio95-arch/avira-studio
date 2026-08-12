import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, CheckSquare } from "lucide-react";

function formatDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

function daysFromToday(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr);
  return Math.round((d - today) / 86400000);
}

// Compute all status tags for an event
function getEventStatuses(event) {
  const days = daysFromToday(event.date);
  const assigned = (event.team || []).filter(m => m.staffMemberName).length;
  const required = event.requiredCrew || 3;
  const statuses = [];

  if (assigned < required) {
    statuses.push({ label: `חסר צוות ${assigned}/${required}`, style: "bg-red-500/20 text-red-400 border-red-500/40" });
  }

  if (days < 0 && event.clientPaymentStatus !== "Paid") {
    const label = event.clientPaymentStatus === "Partially Paid" ? "חוב חלקי" : "חוב";
    statuses.push({ label, style: "bg-orange-500/20 text-orange-400 border-orange-500/40" });
  }

  if (days >= 0 && days <= 30 && !event.questionnaireSentAt) {
    statuses.push({ label: "שאלון חסר", style: "bg-yellow-500/20 text-yellow-400 border-yellow-500/40" });
  }

  if (statuses.length === 0) {
    statuses.push({ label: "✓ תקין", style: "bg-emerald-500/20 text-emerald-400 border-emerald-500/40" });
  }

  return statuses;
}

function EventRow({ event }) {
  const days = daysFromToday(event.date);
  const statuses = getEventStatuses(event);
  const hasIssue = statuses.some(s => !s.label.startsWith("✓"));

  let daysLabel, daysColor;
  if (days < 0) {
    daysLabel = `לפני ${Math.abs(days)}י`;
    daysColor = "text-gray-500";
  } else if (days === 0) {
    daysLabel = "היום!";
    daysColor = "text-red-400 font-black";
  } else if (days === 1) {
    daysLabel = "מחר";
    daysColor = "text-orange-400 font-bold";
  } else {
    daysLabel = `+${days}י`;
    daysColor = days <= 3 ? "text-yellow-400 font-semibold" : "text-gray-400";
  }

  const rowBg = days === 0
    ? "bg-red-900/25 border-red-700/50"
    : days > 0 && hasIssue
    ? "bg-orange-900/15 border-orange-700/30"
    : days < 0 && hasIssue
    ? "bg-gray-800/50 border-orange-700/20"
    : "bg-gray-800/40 border-gray-700/40";

  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl border ${rowBg}`}>
      {/* Date */}
      <div className="text-center shrink-0 w-14">
        <div className="text-white font-bold text-sm">{formatDate(event.date)}</div>
        <div className={`text-xs ${daysColor}`}>{daysLabel}</div>
      </div>

      {/* Names + venue */}
      <div className="min-w-0 flex-1">
        <p className="text-white text-sm font-medium truncate">{event.coupleNames}</p>
        {event.venue && <p className="text-gray-500 text-xs truncate">{event.venue}</p>}
      </div>

      {/* Status tags */}
      <div className="flex flex-wrap gap-1 justify-end shrink-0 max-w-[160px]">
        {statuses.map((s, i) => (
          <span
            key={i}
            className={`text-xs px-2 py-0.5 rounded-lg border font-medium ${s.style}`}
          >
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function NowTab({ events }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sevenDaysAhead = new Date(today.getTime() + 7 * 86400000);
  const threeDaysAgo = new Date(today.getTime() - 3 * 86400000);

  const windowEvents = events
    .filter(e => {
      const d = new Date(e.date);
      return d >= threeDaysAgo && d <= sevenDaysAhead;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  // "What to do today" checklist
  const todayEvents = windowEvents.filter(e => daysFromToday(e.date) === 0);
  const urgentCrew = windowEvents.filter(e => {
    const days = daysFromToday(e.date);
    if (days < 0 || days > 3) return false;
    const assigned = (e.team || []).filter(m => m.staffMemberName).length;
    const required = e.requiredCrew || 3;
    return assigned < required;
  });
  const recentDebts = events.filter(e => {
    const d = new Date(e.date);
    const days = (today - d) / 86400000;
    return d < today && e.clientPaymentStatus !== "Paid" && days > 0 && days <= 7;
  });
  const missingQuestionnaires = events.filter(e => {
    const days = daysFromToday(e.date);
    return days >= 0 && days <= 14 && !e.questionnaireSentAt;
  });

  const todoItems = [];
  if (todayEvents.length > 0)
    todoItems.push({ icon: "📸", text: `${todayEvents.length} אירוע${todayEvents.length > 1 ? "ים" : ""} היום — בהצלחה!`, urgency: "red" });
  if (urgentCrew.length > 0)
    todoItems.push({ icon: "👥", text: `שבץ צוות ל-${urgentCrew.length} אירוע${urgentCrew.length > 1 ? "ים" : ""} ב-3 הימים הקרובים`, urgency: "orange" });
  if (recentDebts.length > 0)
    todoItems.push({ icon: "💳", text: `עדכן סטטוס תשלום ל-${recentDebts.length} אירוע${recentDebts.length > 1 ? "ים" : ""} אחרונים`, urgency: "orange" });
  if (missingQuestionnaires.length > 0)
    todoItems.push({ icon: "📋", text: `שלח שאלון ל-${missingQuestionnaires.length} אירוע${missingQuestionnaires.length > 1 ? "ים" : ""} קרובים`, urgency: "yellow" });

  const urgencyStyle = {
    red: "bg-red-500/10 border-red-500/30 text-red-300",
    orange: "bg-orange-500/10 border-orange-500/30 text-orange-300",
    yellow: "bg-yellow-500/10 border-yellow-500/30 text-yellow-300",
  };

  return (
    <div className="space-y-4">
      {/* What to do today */}
      {todoItems.length > 0 && (
        <Card className="bg-blue-900/20 border-blue-700/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-sm flex items-center gap-2">
              <CheckSquare className="w-4 h-4 text-blue-400" />
              מה צריך לעשות היום
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {todoItems.map((item, i) => (
                <li key={i} className={`flex items-center gap-2.5 text-sm px-3 py-2 rounded-xl border ${urgencyStyle[item.urgency]}`}>
                  <span>{item.icon}</span>
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Events window */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader className="pb-3">
          <CardTitle className="text-white text-base flex items-center gap-2">
            <Calendar className="w-4 h-4 text-blue-400" />
            חלון אירועים — 3 ימים אחורה / 7 קדימה
            <span className="mr-auto text-xs font-normal text-gray-500">{windowEvents.length} אירועים</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {windowEvents.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-6">אין אירועים בטווח זה</p>
          ) : (
            <div className="space-y-2">
              {windowEvents.map(e => (
                <EventRow key={e.id} event={e} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}