// Webhook target for the Postgres trigger defined in
// supabase/migrations/0017_calendar_sync_trigger.sql — fires on every insert/
// update of an event's calendar-relevant columns (couple_names, date, venue,
// phone_number, team, required_crew, notes), regardless of which of the many
// frontend/backend call sites made the change. This is what makes calendar
// sync (and the banana→basil color flip once crew is complete) automatic
// instead of requiring every mutation site to remember to call
// sync-event-to-calendar itself.
//
// Deliberately NOT the same function as sync-event-to-calendar: that one
// requires a real user JWT (createUserClient/getRequestUser), and calling it
// from a DB trigger would mean embedding the far more powerful service-role
// key inside a Postgres function body (visible to anyone with DB/pg_proc
// access) instead of a narrowly-scoped secret. This function is
// unauthenticated at the JWT layer (verify_jwt=false, see config.toml) and
// instead checks a shared secret header — same trust boundary and same
// convention as reconcile-calendar-sync's x-cron-secret path, and reuses the
// same CALENDAR_RECONCILE_CRON_SECRET value (both are "trusted server-side
// caller", not a real end user).
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { syncEventToAllAccounts } from '../_shared/googleCalendarSync.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const cronSecret = Deno.env.get('CALENDAR_RECONCILE_CRON_SECRET');
    const providedSecret = req.headers.get('x-cron-secret');
    if (!cronSecret || !providedSecret || providedSecret !== cronSecret) {
      return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
    }

    const { tenantId, eventId } = await req.json();
    if (!tenantId || !eventId) {
      return jsonResponse({ error: 'tenantId and eventId required' }, { status: 400 });
    }

    const supabase = createServiceRoleClient();
    const { anyConnected, results } = await syncEventToAllAccounts(supabase, tenantId, eventId);

    return jsonResponse({ success: true, anyConnected, results });
  } catch (error) {
    console.error('[calendar-sync-webhook] Error:', error);
    // Always 200 — this is a fire-and-forget pg_net call with no retry logic
    // on the Postgres side; a non-2xx here would just be silently dropped
    // anyway, and reconcile-calendar-sync already exists as the periodic
    // safety net for anything this webhook fails to complete.
    return jsonResponse({ success: false, error: error.message }, { status: 200 });
  }
});
