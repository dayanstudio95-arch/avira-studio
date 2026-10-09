import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, CalendarX2, ChevronDown, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { fetchDateAvailability } from "@/lib/dateAvailability";
import { dateStatus } from "@/lib/chatModel";

const SOURCE = { lead: "מהליד", bot: "שהבוט אסף", message: "שנמצא בהודעה" };

// "Is that date free?" right inside the conversation (2026-10-05). Same rule as the chat
// list rows (lib/dateAvailability.js + chatModel.dateStatus), 2026-10-09:
//   • every event in the calendar that day is counted — the couple's own marked "(כולל שלהם)",
//     but only OTHER couples make the bar amber;
//   • "בתהליך סגירה" = a signed lead with no event yet (it used to repeat the events);
//   • "מתעניינים גם" = other leads deciding on the same date, each opens its chat.
// Read-only — it never changes anything.
export default function DateAvailability({ info, excludeLeadId, conversationId }) {
  const [open, setOpen] = useState(false);
  const date = info?.date;
  const q = useQuery({
    queryKey: ["chatDateCheck", date],
    queryFn: () => fetchDateAvailability([date]),
    enabled: !!date,
    staleTime: 60000,
  });
  if (!date) return null;

  const st = dateStatus(q.data, date, { ownLeadId: excludeLeadId, ownConvId: conversationId });
  const d = new Date(date + "T12:00:00");
  const label = d.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "numeric", year: "numeric" });
  const busy = st.others > 0;
  const hasList = st.total > 0 || st.closing.length > 0 || st.interested.length > 0;
  const tone = busy ? "border-amber-800/60 bg-amber-950/40 text-amber-100" : "border-emerald-900/60 bg-emerald-950/30 text-emerald-100";

  let calendarText;
  if (q.isLoading) calendarText = "בודק ביומן…";
  else if (!st.total) calendarText = "אין אירועים ביומן";
  else if (st.ownEvent && !st.others) calendarText = "ביומן: רק האירוע שלהם · אין אירועים אחרים";
  else calendarText = `${st.ownEvent ? "ביומן" : "כבר ביומן"}: ${st.total} ${st.total === 1 ? "אירוע" : "אירועים"}${st.ownEvent ? " (כולל שלהם)" : ""}`;

  return (
    <div className={`border-b px-3 py-2 text-sm md:px-4 ${tone}`}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 text-start">
        {busy ? <CalendarX2 className="h-4 w-4 shrink-0 text-amber-300" /> : <CalendarCheck className="h-4 w-4 shrink-0 text-emerald-300" />}
        <span className="min-w-0 flex-1 truncate">
          <span className="font-semibold">{label}</span>
          <span className="opacity-70"> ({SOURCE[info.source]}) · </span>
          {calendarText}
          {st.closing.length > 0 && ` · ${st.closing.length} סגרו ועוד לא ביומן`}
          {st.interested.length > 0 && (
            <span className="text-sky-200"> · 👥 עוד {st.interested.length === 1 ? "ליד אחד מתעניין" : `${st.interested.length} לידים מתעניינים`}</span>
          )}
        </span>
        {hasList && <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />}
      </button>
      {open && hasList && (
        <ul className="mt-1.5 space-y-0.5 pr-6 text-xs opacity-90">
          {st.ownEvent && (
            <li>• {st.ownEvent.name}{st.ownEvent.venue ? ` · ${st.ownEvent.venue}` : ""} <span className="opacity-70">(האירוע שלהם)</span></li>
          )}
          {st.otherEvents.map((e) => (
            <li key={e.id}>• {e.name}{e.venue ? ` · ${e.venue}` : ""}</li>
          ))}
          {st.closing.map((l) => (
            <li key={l.id} className="opacity-80">• סגרו ועוד לא ביומן: {l.name}{l.venue ? ` · ${l.venue}` : ""}</li>
          ))}
          {st.interested.length > 0 && (
            <li className="flex items-center gap-1 pt-1 text-sky-200"><Users className="h-3.5 w-3.5" /> מתעניינים גם בתאריך הזה:</li>
          )}
          {st.interested.map((i) => (
            <li key={i.key} className="text-sky-100">
              •{" "}
              <Link to={i.convId ? `/chat?c=${i.convId}` : `/Leads?openLeadId=${i.leadId}`} className="underline decoration-sky-500/50 hover:text-white">
                {i.name || "ליד ללא שם"}
              </Link>
              <span className="opacity-60">{i.convId ? " · שיחה" : " · בדף הלידים"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
