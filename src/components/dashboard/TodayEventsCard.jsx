import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { CalendarDays } from "lucide-react";
import { israelToday, eventDay } from "@/lib/missingTeam";
import { formatDateWithWeekday } from "@/lib/chatModel";

// "אירועים היום" (design E, 2026-10-07 — the owner's reference image, matched exactly): the
// photo fills the card under a dark overlay. Today's events, or "אין אירועים היום" and a
// "הבא: …" line for each event of the next day that has one. A click opens the event.
const BG = "/images/next-event-bg.webp";

export default function TodayEventsCard({ events }) {
  const navigate = useNavigate();
  const today = israelToday();
  const todayEvents = (events || []).filter((e) => eventDay(e) === today);
  const nextDay = todayEvents.length ? null : (events || []).map(eventDay).filter((d) => d > today).sort()[0] || null;
  const day = todayEvents.length ? today : nextDay;
  const list = todayEvents.length ? todayEvents : (events || []).filter((e) => eventDay(e) === nextDay);
  const [leads, setLeads] = useState({});

  const leadIds = list.map((e) => e.sourceLeadId).filter(Boolean).sort().join(",");
  useEffect(() => {
    if (!leadIds) { setLeads({}); return; }
    let alive = true;
    base44.entities.Lead.filter({ id: { $in: leadIds.split(",") } })
      .then((rows) => { if (alive) setLeads(Object.fromEntries((rows || []).map((l) => [l.id, l]))); })
      .catch(() => {});
    return () => { alive = false; };
  }, [leadIds]);

  const isToday = day === today;

  return (
    <div className="dash-card hero-card hero-photo relative h-full min-h-[240px] overflow-hidden flex flex-col" style={{ backgroundImage: `url(${BG}), linear-gradient(135deg, #1b1340, #0b1a33)`, backgroundSize: "cover", backgroundPosition: "center 80%" }}>
      <div className="absolute inset-0 bg-[#0A1430]/25" />
      <div className="absolute inset-0 bg-gradient-to-b from-[#071026]/75 via-transparent to-[#071026]/40" />
      <div className="relative mx-5 flex items-center gap-2 border-b border-white/10 py-4">
        <CalendarDays className="h-5 w-5 text-amber-400" />
        <span className="text-base font-semibold text-white">אירועים היום</span>
        <span className="text-xs text-slate-300">{formatDateWithWeekday(today)}</span>
      </div>
      <div className="relative flex flex-1 flex-col items-center justify-center gap-2 px-5 py-6 text-center drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]">
        {isToday ? (
          <>
            {list.map((e) => (
              <button key={e.id} type="button" onClick={() => navigate(`/Events?openEventId=${e.id}`)} className="text-xl font-semibold text-white hover:text-amber-200">
                {e.coupleNames}{(e.venue || leads[e.sourceLeadId]?.venueName) ? ` · ${e.venue || leads[e.sourceLeadId]?.venueName}` : ""}
              </button>
            ))}
          </>
        ) : (
          <>
            <div className="text-lg font-medium text-white">אין אירועים היום</div>
            {list.length ? list.map((e) => (
              <button key={e.id} type="button" onClick={() => navigate(`/Events?openEventId=${e.id}`)} className="text-base text-slate-100 hover:text-amber-200">
                הבא: {e.coupleNames} · {formatDateWithWeekday(day)}{(e.venue || leads[e.sourceLeadId]?.venueName) ? ` · ${e.venue || leads[e.sourceLeadId]?.venueName}` : ""}
              </button>
            )) : <div className="text-sm text-slate-300">אין אירועים קרובים</div>}
          </>
        )}
      </div>
    </div>
  );
}
