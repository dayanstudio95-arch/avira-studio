import React from "react";
import { missingCount } from "@/lib/missingTeam";
import { eventTeamRoleLabel } from "@/lib/staffRoles";
import { crewByRole } from "@/lib/sameDayCrew";
import { ArrowLeftRight } from "lucide-react";

// "באותו יום — עוד N אירועים" (2026-10-25, the owner's request): the other weddings that day,
// each with its crew by role and whether it is still missing someone — wherever crew is asked
// or assigned (post-sign wizard, availability check, team window, staff page, phone sheet).
// Moved here from EventTeamDialog, which showed it first (2026-10-09). Nothing when alone.
// With `onPickMember(otherEvent, member)` the names (not the editor — he works from home) are
// buttons: "move him to the event being edited" (2026-10-25).
export default function SameDayEventsCard({ others, className = "", onPickMember }) {
  if (!others?.length) return null;
  return (
    <div className={`rounded-xl border border-white/10 bg-white/[0.02] p-3 ${className}`} dir="rtl">
      <div className="mb-2 text-sm font-semibold text-white">
        באותו יום — {others.length === 1 ? "עוד אירוע אחד" : `עוד ${others.length} אירועים`}
      </div>
      {onPickMember && <div className="-mt-1 mb-2 text-xs text-slate-400">לחיצה על שם — להעביר אותו לאירוע הזה</div>}
      <div className="space-y-2">
        {others.map((o) => {
          const crew = crewByRole(o);
          const gap = missingCount(o);
          return (
            <div key={o.id} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-white">{o.coupleNames}{o.venue ? ` · ${o.venue}` : ""}</span>
                <span className={`text-xs ${gap > 0 ? "text-red-300" : "text-green-300"}`}>{gap > 0 ? `חסר ${gap}` : "צוות מלא"}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {crew.length ? crew.map((m, i) => (
                  onPickMember && m.role !== "editor" ? (
                    <button
                      key={i}
                      type="button"
                      onClick={() => onPickMember(o, m)}
                      title={`להעביר את ${m.staffMemberName} לאירוע הזה`}
                      className="inline-flex items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-xs text-sky-100 hover:bg-sky-500/25"
                    >
                      <ArrowLeftRight className="h-3 w-3" />
                      {eventTeamRoleLabel(m.role)}: {m.staffMemberName}
                    </button>
                  ) : (
                    <span key={i} className="rounded-md bg-white/[0.06] px-2 py-0.5 text-xs text-slate-200">{eventTeamRoleLabel(m.role)}: {m.staffMemberName}</span>
                  )
                )) : <span className="text-xs text-slate-500">אף אחד עוד לא משובץ</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
