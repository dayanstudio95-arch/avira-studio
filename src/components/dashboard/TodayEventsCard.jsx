import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { MapPin, Home, Phone, StickyNote, Clock, CalendarDays } from "lucide-react";
import { eventTeamRoleLabel } from "@/lib/staffRoles";
import { israelToday, eventDay, combinedNotes, missingRoles } from "@/lib/missingTeam";
import { formatDateWithWeekday } from "@/lib/chatModel";
import { israelLocalToUtc } from "@/lib/meetings";

// "האירוע הבא" (design D, 2026-10-07): today's events — or, with none today, every event of the
// next day that has one — under a cinematic photo header with a countdown. Every detail the
// owner asked for: couple, venue, getting-ready place, bride's / groom's phones, crew by role
// and who is missing, notes (event + lead), amount. Details come from the lead (sourceLeadId).
// The countdown runs to the arrival time the couple gave (production_checkin_time, "18:30");
// without one it counts whole days only — no invented hour.
const BG = "/images/next-event-bg.webp";

function useNow(ms = 30000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function countdownParts(targetMs, now) {
  const diff = Math.max(0, targetMs - now);
  const mins = Math.floor(diff / 60000);
  return { days: Math.floor(mins / 1440), hours: Math.floor((mins % 1440) / 60), minutes: mins % 60 };
}

export default function TodayEventsCard({ events }) {
  const navigate = useNavigate();
  const now = useNow();
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
  const checkin = /^\d{1,2}:\d{2}$/.test(String(firstLead?.productionCheckinTime || "").trim()) ? firstLead.productionCheckinTime.trim().padStart(5, "0") : null;
  const target = day ? (checkin ? israelLocalToUtc(day, checkin) : israelLocalToUtc(day, "00:00")) : null;
  const cd = target ? countdownParts(target.getTime(), now) : null;
  // Calendar days between today and that day (Israel dates, so "מחר" is right at 23:00 too).
  const dayDiff = day ? Math.round((Date.parse(day + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000) : null;
  const tel = (n) => n && <a href={`tel:${n}`} dir="ltr" className="text-slate-100 hover:text-sky-300">{n}</a>;

  return (
    <div className="dash-card h-full overflow-hidden flex flex-col">
      {/* Photo header */}
      <div className="hero-photo relative min-h-[190px] sm:min-h-[210px]" style={{ backgroundImage: `url(${BG}), linear-gradient(135deg, #1b1340, #0b1a33)` }}>
        <div className="absolute inset-0 bg-gradient-to-l from-[#060D1B]/95 via-[#060D1B]/55 to-[#060D1B]/20" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0C1728] via-transparent to-transparent" />
        <div className="relative flex h-full flex-col justify-between gap-4 p-5 sm:flex-row sm:items-end">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <Clock className="h-4 w-4 text-amber-400" />
              <span className="font-semibold text-white">{day === today ? "האירועים היום" : "האירוע הבא"}</span>
              {day && <span>· {formatDateWithWeekday(day)}</span>}
            </div>
            {first ? (
              <>
                <button type="button" onClick={() => navigate(`/Events?openEventId=${first.id}`)} className="mt-2 block text-right text-3xl font-bold tracking-tight text-white drop-shadow hover:text-amber-200">
                  {first.coupleNames}
                </button>
                <div className="mt-1 flex items-center gap-1.5 text-slate-200">
                  <MapPin className="h-4 w-4 text-slate-400" /> {first.venue || firstLead?.venueName || "—"}
                </div>
                {list.length > 1 && <div className="mt-1 text-xs text-sky-300">+ עוד {list.length - 1} {list.length === 2 ? "אירוע" : "אירועים"} באותו יום</div>}
              </>
            ) : (
              <div className="mt-2 text-xl text-slate-300">אין אירועים קרובים</div>
            )}
          </div>
          {cd && (
            !checkin ? (
              <span className="self-start rounded-full bg-amber-400/15 px-3.5 py-1.5 text-sm font-semibold text-amber-300 ring-1 ring-amber-400/30 sm:self-end">
                {dayDiff === 0 ? "היום!" : dayDiff === 1 ? "מחר" : `בעוד ${dayDiff} ימים`}
              </span>
            ) : (
              <div className="flex gap-2 self-start sm:self-end" aria-label="ספירה לאחור">
                {[["ימים", cd.days], ["שעות", cd.hours], ["דקות", cd.minutes]].map(([label, v]) => (
                  <div key={label} className="min-w-[58px] rounded-xl border border-white/15 bg-white/[0.08] px-2 py-1.5 text-center backdrop-blur-md">
                    <div className="text-xl font-bold leading-tight text-white tabular-nums">{v}</div>
                    <div className="text-[10px] text-slate-300">{label}</div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>

      {/* Every event of that day, with the details */}
      <div className="flex-1 space-y-2.5 p-4">
        {checkin && <div className="text-xs text-slate-400"><CalendarDays className="inline h-3.5 w-3.5" /> הספירה עד שעת ההגעה שהזוג מסר: {checkin}</div>}
        {list.map((e) => {
          const lead = leads[e.sourceLeadId] || null;
          const notes = combinedNotes(e.notes, lead?.notes);
          const crew = (e.team || []).filter((m) => String(m.staffMemberName || "").trim());
          const missing = missingRoles(e, packages[e.packageId]);
          return (
            <div key={e.id} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5 text-sm transition-colors hover:border-white/10">
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={() => navigate(`/Events?openEventId=${e.id}`)} className="text-base font-semibold text-white hover:text-amber-200 text-right">
                  {e.coupleNames}
                </button>
                {e.totalAmountGross ? <span className="font-semibold text-[#22C987] tabular-nums">₪{Number(e.totalAmountGross).toLocaleString()}</span> : null}
              </div>
              <div className="mt-2 grid gap-1.5 text-slate-300 sm:grid-cols-2">
                <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-slate-500" />אולם: {e.venue || lead?.venueName || "—"}</span>
                <span className="flex items-center gap-1.5"><Home className="h-3.5 w-3.5 text-slate-500" />התארגנות: {lead?.productionBridePrepLocation || "—"}</span>
                <span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-slate-500" />כלה: {tel(lead?.productionBridePhone) || "—"}</span>
                <span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-slate-500" />חתן: {tel(lead?.productionGroomPhone) || "—"}</span>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {crew.map((m, i) => (
                  <span key={i} className="d-chip bg-[#3B82F6]/12 text-sky-200 border-[#3B82F6]/25">{eventTeamRoleLabel(m.role)}: {m.staffMemberName}</span>
                ))}
                {missing.length > 0 && <span className="d-chip bg-[#F05B70]/12 text-rose-200 border-[#F05B70]/30">חסר {missing.join(" + ")}</span>}
              </div>
              {notes && (
                <div className="mt-2.5 flex gap-1.5 rounded-xl border border-amber-400/20 bg-amber-400/[0.07] px-2.5 py-1.5 text-xs text-amber-100 whitespace-pre-wrap">
                  <StickyNote className="h-3.5 w-3.5 shrink-0 text-amber-300" /> {notes}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
