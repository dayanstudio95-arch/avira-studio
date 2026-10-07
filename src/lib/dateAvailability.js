// "Is that date free?" for many dates at once (2026-10-07) — the chat list shows it on
// every row. Same rule as the in-thread check (components/chat/DateAvailability.jsx):
// events already in the calendar that day, and leads closing on it (status נסגר/חתימה).
// Read-only.
import { supabase } from "@/api/supabaseClient";
import { findDatesInText } from "@/lib/chatModel";

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


// For each conversation: the newest date the customer wrote in a message (null when none),
// exactly like the thread's eventDateFor. → { conversationId: "2027-06-30" | null }
export async function fetchMessageDates(conversationIds, today = new Date()) {
  const ids = Array.from(new Set(conversationIds || [])).sort();
  const out = Object.fromEntries(ids.map((id) => [id, null]));
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const { data, error } = await supabase
      .from("whatsapp_messages")
      .select("conversation_id, body_text, created_at")
      .in("conversation_id", chunk)
      .eq("direction", "inbound")
      .not("body_text", "is", null)
      .order("created_at", { ascending: false })
      .limit(1500);
    if (error) throw error;
    for (const m of data || []) {
      if (out[m.conversation_id]) continue;
      const dates = findDatesInText(m.body_text, today);
      if (dates.length) out[m.conversation_id] = dates[0];
    }
  }
  return out;
}
