// NEW function — has no base44/functions/syncAllSignedLeads counterpart.
//
// src/pages/Leads.jsx (handleSyncAllSigned) has always called
// base44.functions.invoke('syncAllSignedLeads', {}) expecting a response shaped
// { created, linked, alreadyLinked }, but no matching entry.ts ever existed
// anywhere in base44/functions/ (confirmed via exhaustive directory search) — this
// button has been permanently broken/404ing in the live production app. Rather than
// preserve that break, this implements the feature for real: bulk-creates missing
// Events for every signed lead (same eligibility + linking rules as
// fix-missing-event-for-lead) and reports how many were newly created vs. newly
// (re)linked vs. already correctly linked, matching the response shape the existing
// frontend code has always expected.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, getRequestUser } from '../_shared/supabaseClients.ts';

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

    const eventBySourceLeadId: Record<string, { id: string }> = {};
    for (const ev of allEvents || []) {
      if (ev.source_lead_id && !eventBySourceLeadId[ev.source_lead_id]) {
        eventBySourceLeadId[ev.source_lead_id] = ev;
      }
    }

    let created = 0;
    let linked = 0;
    let alreadyLinked = 0;

    for (const lead of signedLeads || []) {
      const existingEvent = eventBySourceLeadId[lead.id];

      if (existingEvent) {
        if (lead.linked_event_id !== existingEvent.id) {
          await supabase.from('leads').update({ linked_event_id: existingEvent.id }).eq('id', lead.id);
          linked++;
        } else {
          alreadyLinked++;
        }
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
        console.error(`[syncAllSignedLeads] failed to create event for lead ${lead.id}: ${createErr.message}`);
        continue;
      }

      await supabase.from('leads').update({ linked_event_id: newEvent.id }).eq('id', lead.id);
      created++;
    }

    return jsonResponse({ success: true, created, linked, alreadyLinked });
  } catch (error) {
    console.error('Error in syncAllSignedLeads:', error);
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
