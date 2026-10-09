// "Is that date free?" for many dates at once (2026-10-07) — the chat list shows it on
// every row, and the in-thread bar (components/chat/DateAvailability.jsx) asks for its one
// date the same way: events already in the calendar that day, signed leads with no event
// yet, and other leads deciding on the same date (2026-10-09). Read-only.
import { supabase } from "@/api/supabaseClient";
import { findDatesInText, buildDateMap, OPEN_LEAD_STATUSES } from "@/lib/chatModel";

// → chatModel.buildDateMap's shape (dates with nothing are absent). chatModel.dateStatus()
// reads one conversation's answer.
export async function fetchDateAvailability(dates) {
  const list = Array.from(new Set((dates || []).filter(Boolean).map((d) => String(d).slice(0, 10)))).sort();
  if (!list.length) return {};
  const raw = { events: [], closing: [], leadIdsWithEvent: [], openLeads: [], convs: [], leadStatusById: {} };
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    const [ev, cl, op, cv] = await Promise.all([
      supabase.from("events").select("id, date, source_lead_id, couple_names, venue").in("date", chunk),
      supabase.from("leads").select("id, event_date, couple_names, venue_name").in("event_date", chunk).eq("status", "נסגר/חתימה"),
      supabase.from("leads").select("id, event_date, couple_names").in("event_date", chunk).in("status", OPEN_LEAD_STATUSES),
      supabase
        .from("whatsapp_conversations")
        .select("id, event_date, couple_names, display_name, matched_lead_id, ai_tag")
        .in("event_date", chunk)
        .in("contact_type", ["lead", "unknown"])
        .is("archived_at", null)
        .is("opted_out_at", null),
    ]);
    for (const r of [ev, cl, op, cv]) if (r.error) throw r.error;
    raw.events.push(...(ev.data || []));
    raw.closing.push(...(cl.data || []));
    raw.openLeads.push(...(op.data || []));
    raw.convs.push(...(cv.data || []));
  }
  // A signed lead whose event sits on another date (date changed) still has an event.
  const closingIds = raw.closing.map((l) => l.id);
  const matchedIds = Array.from(new Set(raw.convs.map((c) => c.matched_lead_id).filter(Boolean)));
  const openIds = raw.openLeads.map((l) => l.id);
  const [withEvent, statuses, openChats] = await Promise.all([
    closingIds.length ? supabase.from("events").select("source_lead_id").in("source_lead_id", closingIds) : { data: [] },
    matchedIds.length ? supabase.from("leads").select("id, status").in("id", matchedIds) : { data: [] },
    openIds.length ? supabase.from("whatsapp_conversations").select("id, matched_lead_id").in("matched_lead_id", openIds) : { data: [] },
  ]);
  raw.leadIdsWithEvent = (withEvent.data || []).map((e) => e.source_lead_id);
  raw.leadStatusById = Object.fromEntries((statuses.data || []).map((l) => [l.id, l.status]));
  raw.convIdByLeadId = Object.fromEntries((openChats.data || []).map((c) => [c.matched_lead_id, c.id]));
  return buildDateMap(raw);
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
