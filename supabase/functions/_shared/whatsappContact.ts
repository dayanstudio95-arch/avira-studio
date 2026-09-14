// Who is this phone number to the studio?
//
// Moved here from whatsapp-webhook/index.ts on 2026-09-15, unchanged, so that the
// simulator (whatsapp-bot-simulate) runs the SAME classification the live webhook
// does. A simulator with its own copy would drift, and "the bot would have answered"
// is only worth showing if it is the real answer.
import { normalizeIsraeliPhone } from './phone.ts';

export interface ContactMatch {
  contactType: 'unknown' | 'lead' | 'client' | 'staff' | 'group';
  leadId: string | null;
  eventId: string | null;
}

// THE safety check of this whole module.
//
// Phones are compared in normalized local form on BOTH sides: the DB stores
// '0501234567' (sometimes with spaces/dashes/bidi junk from a paste), while Green API
// delivers '972501234567@c.us'. Comparing the raw strings matches nothing, which would
// classify every existing client and every photographer as an unknown stranger — and,
// in Stage 2, price-list them. That is why this normalizes in JS over a small set of
// phone columns instead of doing an `.eq()` in SQL.
//
// Precedence is deliberate: client (has a signed event) beats lead beats staff, so a
// couple who is also in the leads table is never treated as a fresh inquiry.
export async function classifyContact(supabase: any, tenantId: string, phone: string | null): Promise<ContactMatch> {
  const none: ContactMatch = { contactType: 'unknown', leadId: null, eventId: null };
  if (!phone) return none;

  const [leadsRes, eventsRes, staffRes, profilesRes] = await Promise.all([
    supabase
      .from('leads')
      .select('id, phone_number, signed_phone_number, production_bride_phone, production_groom_phone')
      .eq('tenant_id', tenantId),
    supabase.from('events').select('id, phone_number').eq('tenant_id', tenantId),
    supabase.from('staff_members').select('id, phone_number').eq('tenant_id', tenantId),
    supabase.from('profiles').select('id, phone').eq('tenant_id', tenantId),
  ]);

  if (leadsRes.error || eventsRes.error || staffRes.error || profilesRes.error) {
    // Fail CLOSED, unlike the rate limiter: if we can't prove this number is a
    // stranger, we must not let a later stage treat it as one. 'staff' is the safest
    // label because the bot never acts on it.
    console.error(
      '[whatsappContact] contact classification failed, defaulting to staff (bot-silent):',
      leadsRes.error?.message || eventsRes.error?.message || staffRes.error?.message || profilesRes.error?.message
    );
    return { contactType: 'staff', leadId: null, eventId: null };
  }

  const matches = (value: unknown) => !!value && normalizeIsraeliPhone(value) === phone;

  const event = (eventsRes.data || []).find((e: any) => matches(e.phone_number));
  if (event) return { contactType: 'client', leadId: null, eventId: event.id };

  const leads = leadsRes.data || [];
  const productionLead = leads.find(
    (l: any) => matches(l.production_bride_phone) || matches(l.production_groom_phone)
  );
  if (productionLead) return { contactType: 'client', leadId: productionLead.id, eventId: null };

  const lead = leads.find((l: any) => matches(l.phone_number) || matches(l.signed_phone_number));
  if (lead) return { contactType: 'lead', leadId: lead.id, eventId: null };

  if ((staffRes.data || []).some((s: any) => matches(s.phone_number))) {
    return { contactType: 'staff', leadId: null, eventId: null };
  }
  if ((profilesRes.data || []).some((p: any) => matches(p.phone))) {
    return { contactType: 'staff', leadId: null, eventId: null };
  }

  return none;
}
