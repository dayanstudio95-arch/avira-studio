// Deletes an event from every Google account it was ever synced to (reads
// event_calendar_syncs, tries every row's account). New capability — the
// old flow had no delete support at all (deleteFromGoogleCalendar was in
// KNOWN_UNIMPLEMENTED), so deleted events sat orphaned in Google Calendar
// forever. Called BEFORE the events row itself is deleted by every call
// site (cancel-event, EventsTableWithBulkDelete, EventDetails, Leads dedup)
// since event_calendar_syncs cascades off events.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { deleteEventFromAllAccounts } from '../_shared/googleCalendarSync.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createUserClient(req);
    const { eventId } = await req.json();
    if (!eventId) return jsonResponse({ error: 'Missing eventId' }, { status: 400 });

    const { data: profile } = await supabase.from('profiles').select('tenant_id').eq('id', user.id).maybeSingle();
    if (!profile) return jsonResponse({ error: 'Profile not found for user' }, { status: 403 });

    const results = await deleteEventFromAllAccounts(supabase, profile.tenant_id, eventId);
    return jsonResponse({ success: true, results });
  } catch (error) {
    console.error('[delete-event-from-calendar] Error:', error);
    // Never blocks the caller's own DB deletion — Google-side cleanup is
    // best-effort by design (see call sites: cancel-event, etc).
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
