// Safety-net reconciliation job for Google Calendar sync — real-time push
// (sync-event-to-calendar, called on every event create/update) already
// covers the common case; this catches anything that fell through: a sync
// call that never fired, one that crashed mid-write (stuck lock marker), or
// one that failed and was never retried.
//
// Dual auth, same convention as automation-engine's x-cron-secret header:
//   - Authenticated user (dashboard "סנכרן הכל עכשיו" button) → reconciles
//     only the caller's own tenant.
//   - x-cron-secret header matching CALENDAR_RECONCILE_CRON_SECRET → service
//     role, loops every tenant that has at least one connected account.
// Recommended cron schedule: every ~20 minutes (see DEPLOYMENT.md).
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, createServiceRoleClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { syncEventToAllAccounts } from '../_shared/googleCalendarSync.ts';

const BATCH_CAP = 50;
const STALE_PENDING_MS = 10 * 60 * 1000; // 10 minutes — long enough that a genuinely in-flight sync never gets double-run

async function reconcileTenant(supabase: any, tenantId: string) {
  const { data: connectedAccounts } = await supabase
    .from('google_calendar_accounts')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('status', 'connected');

  if (!connectedAccounts || connectedAccounts.length === 0) {
    return { tenantId, skipped: 'no connected accounts', processed: 0 };
  }
  const connectedAccountIds = new Set(connectedAccounts.map((a: any) => a.id));

  // Candidate 1+2: sync rows that are failed, or stuck 'pending' past the
  // staleness window (crashed mid-write, lock marker never cleared).
  const staleCutoff = new Date(Date.now() - STALE_PENDING_MS).toISOString();
  const { data: problemSyncRows } = await supabase
    .from('event_calendar_syncs')
    .select('event_id, status, last_synced_at')
    .eq('tenant_id', tenantId)
    .in('status', ['failed', 'pending']);

  const problemEventIds = new Set<string>();
  for (const row of problemSyncRows || []) {
    if (row.status === 'failed') problemEventIds.add(row.event_id);
    else if (row.status === 'pending' && (!row.last_synced_at || row.last_synced_at < staleCutoff)) {
      problemEventIds.add(row.event_id);
    }
  }

  // Candidate 3: events that have never been synced to one or more of the
  // tenant's currently-connected accounts at all (no row yet, or the tenant
  // connected a new account after the event already existed).
  const { data: events } = await supabase
    .from('events')
    .select('id')
    .eq('tenant_id', tenantId)
    .not('couple_names', 'is', null)
    .not('date', 'is', null)
    .limit(500);

  if (events && events.length > 0) {
    const { data: allSyncRows } = await supabase
      .from('event_calendar_syncs')
      .select('event_id, account_id, status')
      .eq('tenant_id', tenantId);

    const coveredByEvent = new Map<string, Set<string>>();
    for (const row of allSyncRows || []) {
      if (row.status !== 'success') continue;
      if (!coveredByEvent.has(row.event_id)) coveredByEvent.set(row.event_id, new Set());
      coveredByEvent.get(row.event_id)!.add(row.account_id);
    }

    for (const event of events) {
      const covered = coveredByEvent.get(event.id);
      const fullyCovered = covered && [...connectedAccountIds].every((id) => covered.has(id as string));
      if (!fullyCovered) problemEventIds.add(event.id);
    }
  }

  const eventIdsToProcess = [...problemEventIds].slice(0, BATCH_CAP);
  const results: Array<{ eventId: string; anyConnected: boolean; error?: string }> = [];

  for (const eventId of eventIdsToProcess) {
    try {
      const { anyConnected } = await syncEventToAllAccounts(supabase, tenantId, eventId);
      results.push({ eventId, anyConnected });
    } catch (err) {
      results.push({ eventId, anyConnected: true, error: String(err.message || err).slice(0, 300) });
    }
  }

  return { tenantId, processed: results.length, totalCandidates: problemEventIds.size, results };
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);

    if (user) {
      const supabase = createUserClient(req);
      const { data: profile } = await supabase.from('profiles').select('tenant_id').eq('id', user.id).maybeSingle();
      if (!profile) return jsonResponse({ error: 'Profile not found for user' }, { status: 403 });
      const result = await reconcileTenant(supabase, profile.tenant_id);
      return jsonResponse({ success: true, ...result });
    }

    const cronSecret = Deno.env.get('CALENDAR_RECONCILE_CRON_SECRET');
    const providedSecret = req.headers.get('x-cron-secret');
    if (!cronSecret || !providedSecret || providedSecret !== cronSecret) {
      return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceRoleClient();
    const { data: tenants } = await supabase.from('tenants').select('id');
    const perTenantResults = [];
    for (const t of tenants || []) {
      const result = await reconcileTenant(supabase, t.id);
      perTenantResults.push(result);
    }

    return jsonResponse({ success: true, tenants: perTenantResults });
  } catch (error) {
    console.error('[reconcile-calendar-sync] Error:', error);
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
