// Ports base44/functions/assignStudioIds/entry.ts.
// Bulk-backfills the human-readable studio_id reference number (see migration
// 0005_studio_id.sql) for every lead/event in the caller's tenant that's missing one.
// Called from Leads.jsx as an admin-only maintenance action.
//
// Base44's role check was `user.role !== 'admin'`. The new schema has more roles
// (owner/admin/studio_manager/photographer/editor/album_manager) — 'owner' is
// treated as admin-equivalent here since it's the highest-privilege role and the
// original single-tenant app only ever had one "admin".
//
// Note: matching logic (source_lead_id → lead_id → exact coupleNames+date) is
// preserved from the original, but field names are adapted to snake_case
// (couple_names, event_date/date) per 0001_init.sql.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, getRequestUser } from '../_shared/supabaseClients.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createUserClient(req);

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (!profile || !['owner', 'admin'].includes(profile.role)) {
      return jsonResponse({ error: 'Forbidden' }, { status: 403 });
    }

    const [{ data: leads, error: leadsErr }, { data: events, error: eventsErr }] = await Promise.all([
      supabase.from('leads').select('*').order('created_at'),
      supabase.from('events').select('*').order('date'),
    ]);
    if (leadsErr) return jsonResponse({ error: leadsErr.message }, { status: 500 });
    if (eventsErr) return jsonResponse({ error: eventsErr.message }, { status: 500 });

    const allIds = [...(leads || []).map((l) => l.studio_id || 0), ...(events || []).map((e) => e.studio_id || 0)];
    const maxId = Math.max(0, ...allIds);
    let nextId = maxId + 1;
    let assigned = 0;

    // Step 1: assign unique IDs to leads that don't have one.
    for (const lead of leads || []) {
      if (!lead.studio_id) {
        await supabase.from('leads').update({ studio_id: nextId }).eq('id', lead.id);
        lead.studio_id = nextId;
        nextId++;
        assigned++;
      }
    }

    // Step 2: for events, match to a lead using reliable unique identifiers only.
    for (const event of events || []) {
      if (event.studio_id) continue;

      let matchedLead: any = null;

      if (event.source_lead_id) {
        matchedLead = (leads || []).find((l) => l.id === event.source_lead_id) || null;
      }
      if (!matchedLead && event.lead_id) {
        matchedLead = (leads || []).find((l) => l.id === event.lead_id) || null;
      }
      if (!matchedLead && event.couple_names && event.date) {
        const candidates = (leads || []).filter((l) => l.couple_names === event.couple_names && l.event_date === event.date);
        if (candidates.length === 1) matchedLead = candidates[0];
      }

      if (matchedLead?.studio_id) {
        const updateData: Record<string, unknown> = { studio_id: matchedLead.studio_id };
        if (!event.source_lead_id && matchedLead.id) updateData.source_lead_id = matchedLead.id;
        await supabase.from('events').update(updateData).eq('id', event.id);
        assigned++;
      } else {
        await supabase.from('events').update({ studio_id: nextId }).eq('id', event.id);
        nextId++;
        assigned++;
      }
    }

    return jsonResponse({ success: true, assigned, nextId });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
