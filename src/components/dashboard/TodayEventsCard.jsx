import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarHeart, MapPin, Home, Phone, StickyNote } from "lucide-react";
import { eventTeamRoleLabel } from "@/lib/staffRoles";
import { israelToday, eventDay, combinedNotes } from "@/lib/missingTeam";
import { formatDateWithWeekday } from "@/lib/chatModel";

// "אירועים היום" (2026-10-07, the owner's list): couple, date, venue, getting-ready place,
// bride's and groom's phones, crew with roles, notes, amount. Those details live on the
// lead (production questionnaire), loaded by sourceLeadId. With no event today: the next one.
export default function TodayEventsCard({ events }) {
  const navigate = useNavigate();
  const today = israelToday();
  const todays = (events || []).filter((e) => eventDay(e) === today);
  const next = todays.length
    ? null
    : (events || []).filter((e) => eventDay(e) > today).sort((a, b) => eventDay(a).localeCompare(eventDay(b)))[0];
  const [leads, setLeads] = useState({});

  const leadIds = todays.map((e) => e.sourceLeadId).filter(Boolean).sort().join(",");
  useEffect(() => {
    if (!leadIds) { setLeads({}); return; }
    let alive = true;
    base44.entities.Lead.filter({ id: { $in: leadIds.split(",") } })
      .then((rows) => { if (alive) setLeads(Object.fromEntries((rows || []).map((l) => [l.id, l]))); })
      .catch(() => {});
    return () => { alive = false; };
  }, [leadIds]);

  const tel = (n) => n && <a href={`tel:${n}`} dir="ltr" className="text-gray-200 hover:text-yellow-300">{n}</a>;

  return (
    <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm h-full">
      <CardHeader className="border-b border-gray-800 pb-3">
        <CardTitle className="text-white flex items-center gap-2 text-base font-semibold">
          <CalendarHeart className="w-5 h-5 text-yellow-400" />
          אירועים היום
          <span className="text-xs font-normal text-gray-400">· {formatDateWithWeekday(today)}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 space-y-3">
        {todays.length === 0 && (
          <div className="py-4 text-center text-sm text-gray-400">
            אין אירועים היום
            {next && (
              <button type="button" onClick={() => navigate(`/Events?openEventId=${next.id}`)} className="mt-1 block w-full text-gray-300 hover:text-yellow-300">
                הבא: {next.coupleNames} · {formatDateWithWeekday(eventDay(next))}{next.venue ? ` · ${next.venue}` : ""}
              </button>
            )}
          </div>
        )}
        {todays.map((e) => {
          const lead = leads[e.sourceLeadId] || null;
          const notes = combinedNotes(e.notes, lead?.notes);
          const crew = (e.team || []).filter((m) => String(m.staffMemberName || "").trim());
          return (
            <div key={e.id} className="rounded-xl border border-gray-800 bg-gray-950/60 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={() => navigate(`/Events?openEventId=${e.id}`)} className="text-base font-bold text-white hover:text-yellow-300 text-start">
                  {e.coupleNames}
                </button>
                {e.totalAmountGross ? <span className="font-semibold text-emerald-300">₪{Number(e.totalAmountGross).toLocaleString()}</span> : null}
              </div>
              <div className="mt-1.5 grid gap-1 text-gray-300 sm:grid-cols-2">
                <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-gray-500" />אולם: {e.venue || lead?.venueName || "—"}</span>
                <span className="flex items-center gap-1.5"><Home className="h-3.5 w-3.5 text-gray-500" />התארגנות: {lead?.productionBridePrepLocation || "—"}</span>
                <span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-gray-500" />כלה: {tel(lead?.productionBridePhone) || "—"}</span>
                <span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-gray-500" />חתן: {tel(lead?.productionGroomPhone) || "—"}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {crew.length === 0 && <span className="text-xs text-orange-300">אין צוות משובץ</span>}
                {crew.map((m, i) => (
                  <span key={i} className="rounded-full bg-blue-500/15 px-2 py-0.5 text-xs text-blue-200">
                    {eventTeamRoleLabel(m.role)}: {m.staffMemberName}
                  </span>
                ))}
              </div>
              {notes && (
                <div className="mt-2 flex gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-200 whitespace-pre-wrap">
                  <StickyNote className="h-3.5 w-3.5 shrink-0" /> {notes}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
