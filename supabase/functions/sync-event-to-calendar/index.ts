// Thin wrapper around the shared syncEventToAllAccounts orchestrator
// (_shared/googleCalendarSync.ts) — pushes the event to every one of the
// tenant's connected Google accounts (primary + backup) independently.
//
// Replaces the old single-account implementation that read a static,
// manually-pasted access token from app_settings (dead — tokens expire
// hourly and nothing refreshed it). Same { eventId } contract as before, so
// every existing frontend call site keeps working unchanged: UnifiedSidePanel,
// EventDetailDrawer, EventsTableWithBulkDelete, EditEvent.jsx.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { syncEventToAllAccounts } from '../_shared/googleCalendarSync.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createUserClient(req);
    const body = await req.json();
    const eventId: string | null = body?.data?.id || body?.eventId || null;
    if (!eventId) return jsonResponse({ skipped: 'no event data or eventId' });

    const { data: profile } = await supabase.from('profiles').select('tenant_id').eq('id', user.id).maybeSingle();
    if (!profile) return jsonResponse({ error: 'Profile not found for user' }, { status: 403 });

    const { anyConnected, results } = await syncEventToAllAccounts(supabase, profile.tenant_id, eventId);

    if (!anyConnected) {
      return jsonResponse({ error: 'Google Calendar not connected' }, { status: 400 });
    }

    const anySuccess = results.some((r) => r.status === 'success');
    return jsonResponse({ success: anySuccess, results });
  } catch (error) {
    console.error('[sync-event-to-calendar] Error:', error);
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
