// New (2026-08-13): auto-flips a lead's status from "נשלחה הצעה" (contract sent, not
// yet signed) to "פולו-אפ" once 48h have passed since the contract was sent — per
// explicit request: "אני רוצה שכל ליד שנשלח לו החוזה והוא לא חתם ב-48 השעות לאחר
// שנשלח לו, הליד הופך לסטטוס פולו-אפ".
//
// There is NO cron/scheduler infrastructure in this project (see automation-engine's
// header comment — pg_cron is "not yet configured"), so rather than provisioning
// pg_cron/pg_net on the Supabase project just for this, this runs opportunistically:
// called from the frontend (Leads.jsx / Dashboard.jsx) on every page load. Good enough
// in practice since staff open these pages throughout the day, and it keeps this
// feature self-contained with zero new infra dependencies.
//
// Authenticated + RLS-scoped (createUserClient) — automatically limited to the caller's
// own tenant's leads, same pattern as assignStudioIds/syncAllSignedLeads.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, getRequestUser } from '../_shared/supabaseClients.ts';

const FOLLOW_UP_HOURS = 48;

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createUserClient(req);
    const cutoff = new Date(Date.now() - FOLLOW_UP_HOURS * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('leads')
      .update({ status: 'פולו-אפ' })
      .eq('status', 'נשלחה הצעה')
      .not('contract_sent_at', 'is', null)
      .lt('contract_sent_at', cutoff)
      .select('id');

    if (error) return jsonResponse({ error: error.message }, { status: 500 });

    return jsonResponse({ success: true, updated: (data || []).length });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
