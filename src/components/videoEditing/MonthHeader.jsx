import React from "react";
import { eventsCount } from "@/lib/videoEditing";

// The month line between weddings (2026-11-06, the owner's request: "הפרדה בין החודשים, כמו בסטטוס עבודה") — on
// the editor's page and on "עריכת וידאו".
export default function MonthHeader({ label, count }) {
  return (
    <div className="flex items-center gap-3 pb-1 pt-4 first:pt-0" data-testid="month-header">
      <span className="text-base font-semibold text-white">{label}</span>
      <span className="text-xs text-slate-400">{eventsCount(count)}</span>
      <span className="h-px flex-1 bg-white/10" />
    </div>
  );
}
