// Ports base44/functions/syncLeadToEvent/entry.ts.
// Called directly by the frontend after a Lead is created/updated (LeadFormDialog,
// Leads.jsx, UnifiedSidePanel — all call base44.functions.invoke('syncLeadToEvent', { leadId })).
// Uses a user-scoped client so RLS naturally keeps everything within the caller's tenant.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient } from '../_shared/supabaseClients.ts';

// GUARD: ONLY "נסגר/חתימה" (closed/signed) may create or sync an Event.
// All other statuses — including "חוזה" (contract) — are blocked. Load-bearing
// for data integrity: do not relax this without explicit user sign-off.
const ELIGIBLE_STATUS = 'נסגר/חתימה';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const supabase = createUserClient(req);
    const body = await req.json();
    const leadId = body.leadId;

    if (!leadId) return jsonResponse({ error: 'leadId is required' }, { status: 400 });

    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .maybeSingle();

    if (leadErr) return jsonResponse({ error: leadErr.message }, { status: 500 });
    if (!lead) return jsonResponse({ skipped: 'no lead data' });

    if (lead.status !== ELIGIBLE_STATUS) {
      console.log(`[syncLeadToEvent] Skipping — lead status "${lead.status}" is not eligible. Only "${ELIGIBLE_STATUS}" is allowed.`);
      return jsonResponse({ skipped: `status_blocked: ${lead.status}` });
    }

    // source_lead_id is the ONLY canonical link field.
    const { data: existingEvents, error: evErr } = await supabase
      .from('events')
      .select('id')
      .eq('source_lead_id', lead.id);

    if (evErr) return jsonResponse({ error: evErr.message }, { status: 500 });

    if (existingEvents && existingEvents.length > 1) {
      console.error(`[syncLeadToEvent] CRITICAL: ${existingEvents.length} events found for lead ${lead.id}. Using first. Event IDs: ${existingEvents.map((e) => e.id).join(', ')}`);
    }

    let linkedEvent = existingEvents?.[0] || null;

    const resolveRequiredCrew = async (): Promise<number> => {
      let requiredCrew = lead.required_crew || 3;
      if (lead.package_choice) {
        const { data: pkgs, error: pkgErr } = await supabase.from('packages').select('name, total_crew_count');
        if (pkgErr) {
          console.log('[syncLeadToEvent] Error fetching packages:', pkgErr.message);
        } else {
          const matched = pkgs?.find((p: any) => p.name === lead.package_choice);
          if (matched?.total_crew_count) {
            requiredCrew = matched.total_crew_count;
            console.log('[syncLeadToEvent] Package found:', matched.name, '-> requiredCrew:', requiredCrew);
          }
        }
      }
      return requiredCrew;
    };

    if (!linkedEvent) {
      console.log(`[syncLeadToEvent] No linked event found. Creating new Event for lead ${lead.id}`);
      const requiredCrew = await resolveRequiredCrew();

      const { data: created, error: createErr } = await supabase
        .from('events')
        .insert({
          source_lead_id: lead.id,
          lead_id: lead.id, // legacy compat field, kept in sync alongside source_lead_id
          couple_names: lead.couple_names || 'Unknown',
          date: lead.event_date || '2000-01-01',
          total_amount_gross: lead.final_price || 0,
          venue: lead.venue_name || '',
          phone_number: lead.phone_number || '',
          package_id: lead.package_id || null,
          required_crew: requiredCrew,
        })
        .select()
        .single();

      if (createErr) return jsonResponse({ error: createErr.message }, { status: 500 });
      linkedEvent = created;
      console.log(`[syncLeadToEvent] Created new event ${linkedEvent.id} for lead ${lead.id}`);

      await supabase.from('leads').update({ linked_event_id: linkedEvent.id }).eq('id', lead.id);
    }

    // Sync key fields from lead to event.
    const syncData: Record<string, unknown> = {
      source_lead_id: lead.id,
      lead_id: lead.id,
    };
    if (lead.couple_names) syncData.couple_names = lead.couple_names;
    if (lead.event_date) syncData.date = lead.event_date;
    if (lead.venue_name) syncData.venue = lead.venue_name;
    if (lead.phone_number) syncData.phone_number = lead.phone_number;
    if (lead.final_price) syncData.total_amount_gross = lead.final_price;
    if (lead.package_id) syncData.package_id = lead.package_id;
    syncData.required_crew = await resolveRequiredCrew();

    const { error: updateErr } = await supabase.from('events').update(syncData).eq('id', linkedEvent.id);
    if (updateErr) return jsonResponse({ error: updateErr.message }, { status: 500 });

    return jsonResponse({ success: true, eventId: linkedEvent.id, synced: Object.keys(syncData) });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
