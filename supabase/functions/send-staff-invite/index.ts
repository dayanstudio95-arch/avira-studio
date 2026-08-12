// Ports base44/functions/sendStaffInvite/entry.ts.
// Adds (or removes) a staff member as an ATTENDEE on the EXISTING main Google
// Calendar event for an Event — does NOT create a new calendar event.
//
// BUG FIX vs. the original: base44/functions/sendStaffInvite/entry.ts destructures
// `{ eventId, staffMemberId, action }`, but the ONLY live frontend call site
// (src/components/events/EventsTableWithBulkDelete.jsx sendCalendarInviteByName,
// called whenever a staff member is assigned to a role via StaffPickerCell) has
// always sent `{ eventId, staffName }` — no staffMemberId, no action. Against the
// original backend this meant every single call hit `Missing required fields` and
// was silently swallowed (the caller only console.errors, never toasts) — the
// Google Calendar invite feature has never actually worked in production. Since
// every real call site only ever wants to invite-by-name (no cancel call site
// exists anywhere in src/), this port resolves staffMemberId by staffName when
// given and defaults action to 'invite', while still accepting the original
// staffMemberId/action shape for forward-compatibility.
//
// Same Google Calendar OAuth-token gap as sync-event-to-calendar /
// submit-production-questionnaire: reads google_calendar_access_token /
// google_calendar_id from app_settings (RLS-scoped to caller's tenant) instead of
// Base44's connectors abstraction.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, getRequestUser } from '../_shared/supabaseClients.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createUserClient(req);
    const body = await req.json();
    const { eventId, staffName } = body;
    let { staffMemberId, action } = body;
    action = action || 'invite';

    if (!eventId) return jsonResponse({ error: 'Missing required fields' }, { status: 400 });

    const { data: event, error: evErr } = await supabase.from('events').select('*').eq('id', eventId).maybeSingle();
    if (evErr) return jsonResponse({ error: evErr.message }, { status: 500 });
    if (!event) return jsonResponse({ error: 'Event not found' }, { status: 404 });

    let staffMember: { id: string; name: string; email?: string } | null = null;
    if (staffMemberId) {
      const { data } = await supabase.from('staff_members').select('*').eq('id', staffMemberId).maybeSingle();
      staffMember = data || null;
    } else if (staffName) {
      const { data } = await supabase.from('staff_members').select('*').eq('name', staffName).maybeSingle();
      staffMember = data || null;
    }

    if (!staffMemberId && !staffName) return jsonResponse({ error: 'Missing required fields' }, { status: 400 });
    if (!staffMember) return jsonResponse({ error: 'Staff member not found' }, { status: 404 });
    if (!staffMember.email) return jsonResponse({ error: 'Staff member email not set' }, { status: 400 });

    const { data: settings } = await supabase
      .from('app_settings')
      .select('key, value')
      .in('key', ['google_calendar_access_token', 'google_calendar_id']);
    const accessToken = settings?.find((s) => s.key === 'google_calendar_access_token')?.value;
    const calendarId = settings?.find((s) => s.key === 'google_calendar_id')?.value?.trim() || 'primary';

    if (!accessToken) return jsonResponse({ error: 'Google Calendar not connected' }, { status: 400 });

    const mainCalendarEventId: string | null = event.google_calendar_event_id;

    if (!mainCalendarEventId || mainCalendarEventId.startsWith('creating_')) {
      return jsonResponse({ success: true, message: 'No main calendar event yet — skipped invite' });
    }

    const getRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${mainCalendarEventId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!getRes.ok) {
      const err = await getRes.text();
      console.error('[sendStaffInvite] Failed to fetch calendar event:', err);
      return jsonResponse({ error: 'Could not fetch calendar event' }, { status: 502 });
    }

    const calEvent = await getRes.json();
    let attendees: Array<{ email: string }> = calEvent.attendees || [];

    if (action === 'invite') {
      const alreadyInvited = attendees.some((a) => a.email === staffMember!.email);
      if (!alreadyInvited) attendees = [...attendees, { email: staffMember.email! }];

      const patchRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${mainCalendarEventId}`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ attendees }),
        }
      );
      if (!patchRes.ok) {
        const err = await patchRes.text();
        console.error('[sendStaffInvite] PATCH failed:', err);
        return jsonResponse({ error: 'Failed to add attendee' }, { status: 502 });
      }

      if (event.team) {
        const updatedTeam = (event.team as any[]).map((m) =>
          m.staffMemberName === staffMember!.name ? { ...m, calendarEventId: mainCalendarEventId, calendarStatus: 'pending' } : m
        );
        await supabase.from('events').update({ team: updatedTeam }).eq('id', eventId);
      }

      console.log(`[sendStaffInvite] Added ${staffMember.email} as attendee to event ${mainCalendarEventId}`);
      return jsonResponse({ success: true, calendarEventId: mainCalendarEventId });
    } else if (action === 'cancel') {
      attendees = attendees.filter((a) => a.email !== staffMember!.email);

      const patchRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${mainCalendarEventId}`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ attendees }),
        }
      );
      if (!patchRes.ok) {
        const err = await patchRes.text();
        console.error('[sendStaffInvite] PATCH (remove) failed:', err);
      }

      if (event.team) {
        const updatedTeam = (event.team as any[]).map((m) =>
          m.staffMemberName === staffMember!.name ? { ...m, calendarEventId: null, calendarStatus: null } : m
        );
        await supabase.from('events').update({ team: updatedTeam }).eq('id', eventId);
      }

      console.log(`[sendStaffInvite] Removed ${staffMember.email} from event ${mainCalendarEventId}`);
      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('[sendStaffInvite] Error:', error.message);
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
