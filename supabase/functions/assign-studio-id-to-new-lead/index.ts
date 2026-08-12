// Ports base44/functions/assignStudioIdToNewLead/entry.ts.
// Called right after a new lead is created (LeadFormDialog.jsx) to give it the next
// sequential studio_id (see migration 0005_studio_id.sql). The original had no auth
// check at all (an oversight, given every other business function requires one) —
// hardened here to require a logged-in user like the rest of the ported functions.
//
// Same race-condition caveat as the original: max+1 is computed via a full-table
// scan with no locking, so two near-simultaneous new leads could theoretically get
// the same studio_id. Not fixed here (would require a DB sequence/atomic increment,
// out of scope for a 1:1 port) — flagged for a future hardening pass.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, getRequestUser } from '../_shared/supabaseClients.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createUserClient(req);
    const { leadId } = await req.json();
    if (!leadId) return jsonResponse({ error: 'leadId required' }, { status: 400 });

    const { data: allLeads, error: leadsErr } = await supabase.from('leads').select('studio_id');
    if (leadsErr) return jsonResponse({ error: leadsErr.message }, { status: 500 });

    const maxStudioId = (allLeads || []).reduce((max, lead) => Math.max(max, Number(lead.studio_id) || 0), 0);
    const nextId = maxStudioId + 1;

    const { error: updErr } = await supabase.from('leads').update({ studio_id: nextId }).eq('id', leadId);
    if (updErr) return jsonResponse({ error: updErr.message }, { status: 500 });

    return jsonResponse({ studio_id: nextId, leadId });
  } catch (error) {
    console.error('Error:', error);
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
