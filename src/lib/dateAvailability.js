// "Is that date free?" for many dates at once (2026-10-07) — the chat list shows it on
// every row. Same rule as the in-thread check (components/chat/DateAvailability.jsx):
// events already in the calendar that day, and leads closing on it (status נסגר/חתימה).
// Read-only.
import { supabase } from "@/api/supabaseClient";

// → { "2026-08-14": { eventLeadIds: [sourceLeadId|null, …], closingLeadIds: ["…"] }, … }
// (dates with nothing are absent). chatModel.dateStatus() reads one row's answer.
export async function fetchDateAvailability(dates) {
  const list = Array.from(new Set((dates || []).filter(Boolean))).sort();
  if (!list.length) return {};
  const out = {};
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    const [{ data: events, error: e1 }, { data: closing, error: e2 }] = await Promise.all([
      supabase.from("events").select("date, source_lead_id").in("date", chunk),
      supabase.from("leads").select("id, event_date").in("event_date", chunk).eq("status", "נסגר/חתימה"),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;
    for (const e of events || []) {
      const d = String(e.date).slice(0, 10);
      (out[d] ||= { eventLeadIds: [], closingLeadIds: [] }).eventLeadIds.push(e.source_lead_id || null);
    }
    for (const l of closing || []) {
      const d = String(l.event_date).slice(0, 10);
      (out[d] ||= { eventLeadIds: [], closingLeadIds: [] }).closingLeadIds.push(l.id);
    }
  }
  return out;
}

