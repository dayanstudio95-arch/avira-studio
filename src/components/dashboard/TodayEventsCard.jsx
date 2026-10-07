import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { CalendarDays, MapPin, Home, Phone, StickyNote } from "lucide-react";
import { eventTeamRoleLabel } from "@/lib/staffRoles";
import { israelToday, eventDay, combinedNotes, missingRoles } from "@/lib/missingTeam";
import { formatDateWithWeekday } from "@/lib/chatModel";

// "אירועים היום" (design E, 2026-10-07 — the owner's reference image): the photo fills the
// card under a dark overlay. On it, today's events — or "אין אירועים היום · הבא: <day>" and
// every event of that next day — each in a glass panel with all its details: venue,
// getting-ready place, bride's / groom's phones, crew by role and who is missing, notes
// (event + lead), amount. A click on the names opens the event.
const BG = "/images/next-event-bg.webp";

// Today's events — or, with none today, every event of the next day that has one — with
// their leads (getting-ready place, phones, lead notes live there). Shared by the photo card
// and the details card under it, so both always show the same day.
function useShownEvents(events) {
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
  return { today, day, list, leads };
}

export default function TodayEventsCard({ events }) {
  const navigate = useNavigate();
  const { today, day, list, leads } = useShownEvents(events);
  const [packages, setPackages] = useState({});
  useEffect(() => {
    base44.entities.Package.list().then((rows) => setPackages(Object.fromEntries((rows || []).map((p) => [p.id, p])))).catch(() => {});
  }, []);
  const isToday = day === today;
  const tel = (n) => n && <a href={`tel:${n}`} dir="ltr" className="text-white hover:text-sky-300">{n}</a>;

  return (
    <div className="dash-card hero-card hero-photo relative h-full min-h-[240px] overflow-hidden flex flex-col" style={{ backgroundImage: `url(${BG}), linear-gradient(135deg, #1b1340, #0b1a33)`, backgroundSize: "cover", backgroundPosition: "center 80%" }}>
      <div className="absolute inset-0 bg-[#0A1430]/25" />
      <div className="absolute inset-0 bg-gradient-to-b from-[#071026]/75 via-transparent to-[#071026]/40" />
      <div className="relative mx-5 flex items-center gap-2 border-b border-white/10 py-4">
        <CalendarDays className="h-5 w-5 text-amber-400" />
        <span className="text-base font-semibold text-white">אירועים היום</span>
        <span className="text-xs text-slate-300">{formatDateWithWeekday(today)}</span>
      </div>
      <div className="relative flex flex-1 flex-col justify-center gap-3 px-4 py-4">
        {!isToday && (
          <div className="text-center text-base text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]">
            אין אירועים היום{day ? <span className="text-slate-200"> · הבא: {formatDateWithWeekday(day)}</span> : null}
          </div>
        )}
        {!list.length && <div className="text-center text-sm text-slate-300">אין אירועים קרובים</div>}
        {/* The details of each event (the owner, 2026-10-07: inside this card, on the photo). */}
        {list.length > 0 && (
          <div className={`grid gap-2.5 ${list.length > 1 ? "md:grid-cols-2" : "mx-auto w-full max-w-xl"}`}>
            {list.map((e) => {
              const lead = leads[e.sourceLeadId] || null;
              const notes = combinedNotes(e.notes, lead?.notes);
              const crew = (e.team || []).filter((m) => String(m.staffMemberName || "").trim());
              const missing = missingRoles(e, packages[e.packageId]);
              return (
                <div key={e.id} className="rounded-xl border border-white/15 bg-[#071026]/60 p-3 text-xs text-slate-200 backdrop-blur-md">
                  <div className="flex items-center justify-between gap-2">
                    <button type="button" onClick={() => navigate(`/Events?openEventId=${e.id}`)} className="truncate text-right text-base font-semibold text-white hover:text-amber-200">
                      {e.coupleNames}
                    </button>
                    {e.totalAmountGross ? <span className="shrink-0 text-sm font-semibold text-emerald-400 tabular-nums">₪{Number(e.totalAmountGross).toLocaleString()}</span> : null}
                  </div>
                  <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
                    <span className="flex min-w-0 items-center gap-1"><MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate">אולם: {e.venue || lead?.venueName || "—"}</span></span>
                    <span className="flex min-w-0 items-center gap-1"><Home className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate">התארגנות: {lead?.productionBridePrepLocation || "—"}</span></span>
                    <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" />כלה: {tel(lead?.productionBridePhone) || "—"}</span>
                    <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" />חתן: {tel(lead?.productionGroomPhone) || "—"}</span>
                  </div>
                  {(crew.length > 0 || missing.length > 0) && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {crew.map((m, i) => (
                        <span key={i} className="e-chip e-chip-blue px-2 py-0.5 text-[11px]">{eventTeamRoleLabel(m.role)}: {m.staffMemberName}</span>
                      ))}
                      {missing.length > 0 && <span className="e-chip e-chip-red px-2 py-0.5 text-[11px]">חסר {missing.join(" + ")}</span>}
                    </div>
                  )}
                  {notes && (
                    <div className="mt-2 flex gap-1 text-amber-100" title={notes}>
                      <StickyNote className="h-3.5 w-3.5 shrink-0 text-amber-300" /><span className="line-clamp-2 whitespace-pre-wrap">{notes}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
