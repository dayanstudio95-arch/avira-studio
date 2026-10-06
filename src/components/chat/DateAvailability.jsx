import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, CalendarX2, ChevronDown } from "lucide-react";
import { supabase } from "@/api/supabaseClient";

const SOURCE = { lead: "מהליד", bot: "שהבוט אסף", message: "שנמצא בהודעה" };

// "Is that date free?" right inside the conversation (2026-10-05): how many events are
// already in the calendar that day, and which leads are in the middle of closing on it.
// Read-only — it never changes anything.
export default function DateAvailability({ info, excludeLeadId }) {
  const [open, setOpen] = useState(false);
  const date = info?.date;
  const q = useQuery({
    queryKey: ["chatDateCheck", date, excludeLeadId || ""],
    queryFn: async () => {
      const [{ data: events, error: e1 }, { data: closing, error: e2 }] = await Promise.all([
        supabase.from("events").select("id, couple_names, venue, source_lead_id").eq("date", date).limit(20),
        supabase.from("leads").select("id, couple_names, venue_name, status").eq("event_date", date).eq("status", "נסגר/חתימה").limit(20),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      // The couple's own event is not "taken" (2026-10-07).
      return {
        events: (events || []).filter((e) => !excludeLeadId || e.source_lead_id !== excludeLeadId),
        closing: (closing || []).filter((l) => l.id !== excludeLeadId),
      };
    },
    enabled: !!date,
    staleTime: 60000,
  });
  if (!date) return null;

  const d = new Date(date + "T12:00:00");
  const label = d.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "numeric", year: "numeric" });
  const events = q.data?.events || [];
  const closing = q.data?.closing || [];
  const busy = events.length > 0;
  const tone = busy ? "border-amber-800/60 bg-amber-950/40 text-amber-100" : "border-emerald-900/60 bg-emerald-950/30 text-emerald-100";

  return (
    <div className={`border-b px-3 py-2 text-sm md:px-4 ${tone}`}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 text-start">
        {busy ? <CalendarX2 className="h-4 w-4 shrink-0 text-amber-300" /> : <CalendarCheck className="h-4 w-4 shrink-0 text-emerald-300" />}
        <span className="min-w-0 flex-1 truncate">
          <span className="font-semibold">{label}</span>
          <span className="opacity-70"> ({SOURCE[info.source]}) · </span>
          {q.isLoading ? "בודק ביומן…" : busy ? `כבר ביומן: ${events.length} ${events.length === 1 ? "אירוע" : "אירועים"}` : "אין אירועים ביומן"}
          {closing.length > 0 && ` · ${closing.length} בתהליך סגירה`}
        </span>
        {(busy || closing.length > 0) && <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />}
      </button>
      {open && (busy || closing.length > 0) && (
        <ul className="mt-1.5 space-y-0.5 pr-6 text-xs opacity-90">
          {events.map((e) => (
            <li key={e.id}>• {e.couple_names}{e.venue ? ` · ${e.venue}` : ""}</li>
          ))}
          {closing.map((l) => (
            <li key={l.id} className="opacity-80">• בתהליך סגירה: {l.couple_names}{l.venue_name ? ` · ${l.venue_name}` : ""}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
