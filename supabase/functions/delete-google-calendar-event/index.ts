// Minimal single-event delete, PRIMARY account only — backs
// LeadCardDrawer.jsx's `deleteFromGoogleCalendar({ calendarEventId })` call,
// which is a separate, narrower case than delete-event-from-calendar: it
// deletes a lead-stage calendar event by a raw Google event id
// (lead.googleCalendarEventId), not tied to the events/event_calendar_syncs
// tables at all.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { getValidAccessToken } from '../_shared/googleCalendarAuth.ts';
import { deleteEventFromAccount } from '../_shared/googleCalendarSync.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createUserClient(req);
    const { calendarEventId } = await req.json();
    if (!calendarEventId) return jsonResponse({ error: 'Missing calendarEventId' }, { status: 400 });

    const { data: profile } = await supabase.from('profiles').select('tenant_id').eq('id', user.id).maybeSingle();
    if (!profile) return jsonResponse({ error: 'Profile not found for user' }, { status: 403 });

    const token = await getValidAccessToken(supabase, profile.tenant_id, 'primary');
    if (!token) return jsonResponse({ error: 'Google Calendar (primary) not connected' }, { status: 400 });

    await deleteEventFromAccount(token.accessToken, token.calendarId, calendarEventId);
    return jsonResponse({ success: true });
  } catch (error) {
    console.error('[delete-google-calendar-event] Error:', error);
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
