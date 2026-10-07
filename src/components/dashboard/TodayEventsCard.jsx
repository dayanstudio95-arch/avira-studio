import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { MapPin, Home, Phone, StickyNote, CalendarDays } from "lucide-react";
import { eventTeamRoleLabel } from "@/lib/staffRoles";
import { israelToday, eventDay, combinedNotes, missingRoles } from "@/lib/missingTeam";
import { formatDateWithWeekday } from "@/lib/chatModel";

// "אירועים היום" (design E, 2026-10-07 — the owner's reference image): a photo card with a
// dark overlay. Today's events, or "אין אירועים היום · הבא: …" when there are none. Under the
// photo, every detail of the events shown (today's, or else every event of the next day that
// has one — the owner's earlier request): venue, getting-ready place, bride's / groom's phones,
// crew by role and who is missing, notes (event + lead), amount. Details come from the lead.
const BG = "/images/next-event-bg.webp";

export default function TodayEventsCard({ events }) {
  const navigate = useNavigate();
  const today = israelToday();
  const todayEvents = (events || []).filter((e) => eventDay(e) === today);
  const nextDay = todayEvents.length ? null : (events || []).map(eventDay).filter((d) => d > today).sort()[0] || null;
  const day = todayEvents.length ? today : nextDay;
  const list = todayEvents.length ? todayEvents : (events || []).filter((e) => eventDay(e) === nextDay);
  const [leads, setLeads] = useState({});
  const [packages, setPackages] = useState({});

  const leadIds = list.map((e) => e.sourceLeadId).filter(Boolean).sort().join(",");
  useEffect(() => {
    if (!leadIds) { setLeads({}); return; }
    let alive = true;
    base44.entities.Lead.filter({ id: { $in: leadIds.split(",") } })
      .then((rows) => { if (alive) setLeads(Object.fromEntries((rows || []).map((l) => [l.id, l]))); })
      .catch(() => {});
    return () => { alive = false; };
  }, [leadIds]);
  useEffect(() => {
    base44.entities.Package.list().then((rows) => setPackages(Object.fromEntries((rows || []).map((p) => [p.id, p])))).catch(() => {});
  }, []);

  const first = list[0];
  const firstLead = first ? leads[first.sourceLeadId] : null;
  const tel = (n) => n && <a href={`tel:${n}`} dir="ltr" className="text-slate-100 hover:text-sky-300">{n}</a>;
  const isToday = day === today;

  return (
    <div className="dash-card hero-card h-full overflow-hidden flex flex-col">
      <div className="hero-photo relative min-h-[260px] sm:min-h-[285px] flex flex-col" style={{ backgroundImage: `url(${BG}), linear-gradient(135deg, #1b1340, #0b1a33)` }}>
        <div className="absolute inset-0 bg-[#0A1430]/30" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#071026]/80 via-transparent to-[#071026]/45" />
        <div className="relative mx-4 flex items-center gap-2 border-b border-white/10 py-4">
          <CalendarDays className="h-5 w-5 text-amber-400" />
          <span className="text-base font-semibold text-white">אירועים היום</span>
          <span className="text-xs text-slate-300">{formatDateWithWeekday(today)}</span>
        </div>
        <div className="relative flex flex-1 flex-col items-center justify-center gap-2 px-5 py-6 text-center drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
          {isToday ? (
            <>
              {list.map((e) => (
                <button key={e.id} type="button" onClick={() => navigate(`/Events?openEventId=${e.id}`)} className="text-2xl font-bold text-white hover:text-amber-200">
                  {e.coupleNames}
                </button>
              ))}
              <div className="text-sm text-slate-200">{list.map((e) => e.venue || leads[e.sourceLeadId]?.venueName).filter(Boolean).join(" · ")}</div>
            </>
          ) : (
            <>
              <div className="text-xl font-medium text-white">אין אירועים היום</div>
              {first ? (
                <button type="button" onClick={() => navigate(`/Events?openEventId=${first.id}`)} className="text-base text-slate-100 hover:text-amber-200">
                  הבא: {list.map((e) => e.coupleNames).join(" + ")} · {formatDateWithWeekday(day)}{(first.venue || firstLead?.venueName) ? ` · ${first.venue || firstLead?.venueName}` : ""}
                </button>
              ) : (
                <div className="text-sm text-slate-300">אין אירועים קרובים</div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Every event of that day, with the details */}
      {list.length > 0 && (
        <div className="flex-1 space-y-2.5 p-4">
          <div className="text-xs font-medium text-slate-400">{isToday ? "פרטי האירועים היום" : `פרטי ${list.length > 1 ? "האירועים" : "האירוע"} · ${formatDateWithWeekday(day)}`}</div>
          {list.map((e) => {
            const lead = leads[e.sourceLeadId] || null;
            const notes = combinedNotes(e.notes, lead?.notes);
            const crew = (e.team || []).filter((m) => String(m.staffMemberName || "").trim());
            const missing = missingRoles(e, packages[e.packageId]);
            return (
              <div key={e.id} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3.5 text-sm transition-colors hover:border-[#4F7BFF]/40">
                <div className="flex items-center justify-between gap-2">
                  <button type="button" onClick={() => navigate(`/Events?openEventId=${e.id}`)} className="text-base font-semibold text-white hover:text-amber-200 text-right">
                    {e.coupleNames}
                  </button>
                  {e.totalAmountGross ? <span className="font-semibold text-emerald-400 tabular-nums">₪{Number(e.totalAmountGross).toLocaleString()}</span> : null}
                </div>
                <div className="mt-2 grid gap-1.5 text-slate-300 sm:grid-cols-2">
                  <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-slate-500" />אולם: {e.venue || lead?.venueName || "—"}</span>
                  <span className="flex items-center gap-1.5"><Home className="h-3.5 w-3.5 text-slate-500" />התארגנות: {lead?.productionBridePrepLocation || "—"}</span>
                  <span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-slate-500" />כלה: {tel(lead?.productionBridePhone) || "—"}</span>
                  <span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-slate-500" />חתן: {tel(lead?.productionGroomPhone) || "—"}</span>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {crew.map((m, i) => (
                    <span key={i} className="e-chip e-chip-blue">{eventTeamRoleLabel(m.role)}: {m.staffMemberName}</span>
                  ))}
                  {missing.length > 0 && <span className="e-chip e-chip-red">חסר {missing.join(" + ")}</span>}
                </div>
                {notes && (
                  <div className="mt-2.5 flex gap-1.5 rounded-lg border border-amber-400/25 bg-amber-400/[0.07] px-2.5 py-1.5 text-xs text-amber-100 whitespace-pre-wrap">
                    <StickyNote className="h-3.5 w-3.5 shrink-0 text-amber-300" /> {notes}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
