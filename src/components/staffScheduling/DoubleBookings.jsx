import { AlertTriangle } from "lucide-react";
import { sameDayClashes } from "@/lib/sameDayCrew";
import { eventTeamRoleLabel } from "@/lib/staffRoles";

const dayText = (d) => {
  const [y, m, dd] = String(d || "").split("-");
  return `${Number(dd)}.${Number(m)}.${y}`;
};

/**
 * Double bookings already saved (2026-11-09, the owner's choice: a banner that stays until each is fixed, and he fixes
 * it himself): the same photographer / videographer on two events the same day, from today on. Each wedding's name
 * opens it on the list, where he takes the person off one of them. Nothing when there are none.
 */
export default function DoubleBookings({ events, today, onOpen }) {
  const clashes = sameDayClashes(events, { from: today });
  if (!clashes.length) return null;
  return (
    <div className="mb-5 rounded-xl border border-rose-500/50 bg-rose-500/10 px-4 py-3" dir="rtl" data-testid="double-bookings">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-rose-200">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {clashes.length === 1 ? "איש צוות אחד משובץ פעמיים באותו יום" : `${clashes.length} אנשי צוות משובצים פעמיים באותו יום`}
      </div>
      {clashes.map((c) => (
        <div key={`${c.date}|${c.name}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/5 py-2 text-sm" data-testid="double-booking-row">
          <span className="text-slate-200">
            {dayText(c.date)} · <span className="font-semibold text-white">{c.name}</span>
          </span>
          <span className="flex flex-wrap gap-1.5">
            {c.items.map((it) => (
              <button
                key={it.eventId}
                type="button"
                onClick={() => onOpen(it.eventId)}
                title="פתיחת האירוע ברשימה, כדי להוציא אותו מאחד מהם"
                className="rounded-md border border-rose-400/40 px-2 py-0.5 text-xs text-rose-100 hover:bg-rose-500/20"
              >
                {it.couple} · {eventTeamRoleLabel(it.role)}
              </button>
            ))}
          </span>
        </div>
      ))}
      <p className="mt-1 text-[11px] text-slate-400">מוציאים אותו מאחד האירועים. מאז 9.11.2026 המערכת כבר לא מאפשרת שיבוץ כפול.</p>
    </div>
  );
}
