// New (2026-08-13): auto-flips a lead's status from "נשלחה הצעה" (contract sent, not
// yet signed) to "פולו-אפ" once 48h have passed since the contract was sent — per
// explicit request: "אני רוצה שכל ליד שנשלח לו החוזה והוא לא חתם ב-48 השעות לאחר
// שנשלח לו, הליד הופך לסטטוס פולו-אפ".
//
// ⚠️ STALE COMMENT CORRECTED 2026-09-09. This used to say "There is NO cron/scheduler
// infrastructure in this project", which was true when written and is no longer.
// Verified against the live database today (`select jobname, schedule, active from
// cron.job`): three jobs are installed and active —
//   automation-engine-hourly    0 * * * *
//   calendar-reconcile-20min    */20 * * * *
//   monthly-events-backup       0 6 1 * *
// The `cron.schedule` calls are a manual dashboard step documented in DEPLOYMENT.md §3
// and were never committed, which is why the repo alone cannot answer the question and
// why this comment survived so long. Do not trust a source comment on this — run the
// query.
//
// This function still runs opportunistically — called from the frontend (Leads.jsx /
// Dashboard.jsx) on every page load — and that remains a reasonable choice: staff open
// those pages throughout the day, and a 48h status flip does not need better resolution
// than that. But it is now a choice rather than a workaround, and moving it onto the
// hourly engine is available if it ever matters.
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
