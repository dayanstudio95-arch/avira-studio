import React from "react";
import { CheckCircle2, AlertCircle, Copy, FileText, Calendar, GitCompare } from "lucide-react";

const cards = [
  { key: "totalEvents",        label: "אירועים עתידיים",   icon: Calendar,      color: "blue"   },
  { key: "synced",             label: "מסונכרנים",         icon: CheckCircle2,  color: "green"  },
  { key: "missingCalendarId",  label: "חסר ID ביומן",      icon: AlertCircle,   color: "red"    },
  { key: "dateMismatches",     label: "אי התאמת תאריך",    icon: GitCompare,    color: "orange" },
  { key: "duplicateCandidates",label: "חשד לכפילויות",     icon: Copy,          color: "yellow" },
  { key: "signedLeads",        label: "לידים חתומים",      icon: FileText,      color: "purple" },
];

const colorMap = {
  blue:   { bg: "bg-blue-500/10",   border: "border-blue-500/30",   icon: "text-blue-400",   value: "text-blue-400"   },
  green:  { bg: "bg-green-500/10",  border: "border-green-500/30",  icon: "text-green-400",  value: "text-green-400"  },
  red:    { bg: "bg-red-500/10",    border: "border-red-500/30",    icon: "text-red-400",    value: "text-red-400"    },
  orange: { bg: "bg-orange-500/10", border: "border-orange-500/30", icon: "text-orange-400", value: "text-orange-400" },
  yellow: { bg: "bg-yellow-500/10", border: "border-yellow-500/30", icon: "text-yellow-400", value: "text-yellow-400" },
  purple: { bg: "bg-purple-500/10", border: "border-purple-500/30", icon: "text-purple-400", value: "text-purple-400" },
};

export default function CalendarStatsCards({
  totalEvents, synced, missingCalendarId, dateMismatches, duplicateCandidates, signedLeads,
}) {
  const values = { totalEvents, synced, missingCalendarId, dateMismatches, duplicateCandidates, signedLeads };

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {cards.map(({ key, label, icon: Icon, color }) => {
        const c = colorMap[color];
        return (
          <div key={key} className={`rounded-xl border p-4 ${c.bg} ${c.border}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-400">{label}</span>
              <Icon className={`w-4 h-4 ${c.icon}`} />
            </div>
            <div className={`text-2xl font-bold ${c.value}`}>{values[key] ?? 0}</div>
          </div>
        );
      })}
    </div>
  );
}