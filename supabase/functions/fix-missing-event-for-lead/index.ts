// Ports base44/functions/fixMissingEventForLead/entry.ts.
// Safely creates missing Events for signed leads that have none. Uses ONLY
// source_lead_id as the canonical link — never studio_id matching (same rule as
// sync-lead-to-event). Called from Leads.jsx as an admin/manual repair action.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, getRequestUser } from '../_shared/supabaseClients.ts';

// ONLY "נסגר/חתימה" is eligible to have an Event — same guard as sync-lead-to-event.
const ELIGIBLE_STATUS = 'נסגר/חתימה';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createUserClient(req);

    const [{ data: signedLeads, error: leadsErr }, { data: allEvents, error: eventsErr }] = await Promise.all([
      supabase.from('leads').select('*').eq('status', ELIGIBLE_STATUS),
      supabase.from('events').select('id, source_lead_id'),
    ]);
    if (leadsErr) return jsonResponse({ error: leadsErr.message }, { status: 500 });
    if (eventsErr) return jsonResponse({ error: eventsErr.message }, { status: 500 });

    // Build canonical map: source_lead_id -> event (ONLY safe link). If duplicates
    // exist, keep the first (oldest, since the default select order is insertion order).
    const eventBySourceLeadId: Record<string, { id: string }> = {};
    for (const ev of allEvents || []) {
      if (ev.source_lead_id && !eventBySourceLeadId[ev.source_lead_id]) {
        eventBySourceLeadId[ev.source_lead_id] = ev;
      }
    }

    let created = 0;
    let alreadyLinked = 0;
    const createdList: Array<{ leadId: string; coupleNames: string; eventId: string }> = [];

    for (const lead of signedLeads || []) {
      const existingEvent = eventBySourceLeadId[lead.id];

      if (existingEvent) {
        if (lead.linked_event_id !== existingEvent.id) {
          await supabase.from('leads').update({ linked_event_id: existingEvent.id }).eq('id', lead.id);
        }
        alreadyLinked++;
        continue;
      }

      const { data: newEvent, error: createErr } = await supabase
        .from('events')
        .insert({
          couple_names: lead.couple_names,
          date: lead.event_date || new Date().toISOString().split('T')[0],
          phone_number: lead.phone_number || '',
          venue: lead.venue_name || '',
          total_amount_gross: lead.final_price || lead.base_price || 0,
          client_payment_status: 'Unpaid',
          notes: `הומר מליד | ${lead.notes || ''}`,
          studio_id: lead.studio_id || null,
          source_lead_id: lead.id,
          lead_id: lead.id,
          package_id: lead.package_id || null,
        })
        .select()
        .single();

      if (createErr) {
        console.error(`[fixMissingEventForLead] failed to create event for lead ${lead.id}: ${createErr.message}`);
        continue;
      }

      await supabase.from('leads').update({ linked_event_id: newEvent.id }).eq('id', lead.id);

      created++;
      createdList.push({ leadId: lead.id, coupleNames: lead.couple_names, eventId: newEvent.id });
    }

    return jsonResponse({
      total_eligible: (signedLeads || []).length,
      already_linked: alreadyLinked,
      created,
      created_list: createdList,
      message: `יצרו ${created} אירועים חדשים, ${alreadyLinked} כבר מקושרים`,
    });
  } catch (error) {
    console.error('Error in fixMissingEventForLead:', error);
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
