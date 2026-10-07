import { supabase } from "@/api/supabaseClient";
import { normalizeIsraeliPhone } from "@/lib/whatsappLeadParser";

// Every CRM lead by phone (2026-10-07). A lead opened from the leads page is never linked to
// its WhatsApp conversation (matched_lead_id is set only by "צור ליד" in the chat or by the
// bot's classification), so the chat showed a couple who had signed as a "ליד חם" in
// "נשלחה הצעה". This index lets the screens find the lead by phone — display only, nothing
// is written. Newest lead wins when two share a number.
export const CLOSED_LEAD_STATUSES = ["נסגר/חתימה", "חוזה"];

export async function fetchLeadPhoneIndex() {
  const byPhone = {};
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("leads")
      .select("id, status, signed_at, phone_number, production_bride_phone, production_groom_phone, created_at")
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const l of data || []) {
      const lead = { id: l.id, status: l.status, signed: !!l.signed_at };
      for (const raw of [l.phone_number, l.production_bride_phone, l.production_groom_phone]) {
        const p = normalizeIsraeliPhone(raw);
        if (p && !byPhone[p]) byPhone[p] = lead;
      }
    }
    if (!data || data.length < PAGE) break;
  }
  return byPhone;
}

export const LEAD_PHONE_INDEX_KEY = ["leadPhoneIndex"];

export function leadForPhone(index, phone) {
  const p = normalizeIsraeliPhone(phone);
  return (p && index?.[p]) || null;
}

export function isClosedLeadRecord(lead) {
  return !!lead && (lead.signed || CLOSED_LEAD_STATUSES.includes(lead.status));
}
