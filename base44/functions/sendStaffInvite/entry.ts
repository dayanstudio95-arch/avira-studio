import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * sendStaffInvite
 * Adds or removes a staff member as an ATTENDEE on the EXISTING main calendar event.
 * Does NOT create a new calendar event — that would cause duplicate events in the calendar.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { eventId, staffMemberId, action } = await req.json();

    if (!eventId || !staffMemberId) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const [event, staffMember] = await Promise.all([
      base44.asServiceRole.entities.Event.get(eventId),
      base44.asServiceRole.entities.StaffMember.get(staffMemberId)
    ]);

    if (!event) return Response.json({ error: 'Event not found' }, { status: 404 });
    if (!staffMember) return Response.json({ error: 'Staff member not found' }, { status: 404 });
    if (!staffMember.email) return Response.json({ error: 'Staff member email not set' }, { status: 400 });

    // Get Google Calendar connection
    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googlecalendar');
    if (!accessToken) return Response.json({ error: 'Google Calendar not connected' }, { status: 400 });

    // Load calendar ID from settings
    const settings = await base44.asServiceRole.entities.AppSetting.list();
    const calendarId = settings.find(s => s.key === 'google_calendar_id')?.value?.trim() || 'primary';

    const mainCalendarEventId = event.googleCalendarEventId;

    if (!mainCalendarEventId || mainCalendarEventId.startsWith('creating_')) {
      // No main event yet — just update team record without calendar invite
      return Response.json({ success: true, message: 'No main calendar event yet — skipped invite' });
    }

    // Fetch current attendees from the main event
    const getRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${mainCalendarEventId}`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );

    if (!getRes.ok) {
      const err = await getRes.text();
      console.error('[sendStaffInvite] Failed to fetch calendar event:', err);
      return Response.json({ error: 'Could not fetch calendar event' }, { status: 502 });
    }

    const calEvent = await getRes.json();
    let attendees = calEvent.attendees || [];

    if (action === 'invite') {
      // Add staff member as attendee (if not already there)
      const alreadyInvited = attendees.some(a => a.email === staffMember.email);
      if (!alreadyInvited) {
        attendees = [...attendees, { email: staffMember.email }];
      }

      const patchRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${mainCalendarEventId}`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ attendees }),
        }
      );

      if (!patchRes.ok) {
        const err = await patchRes.text();
        console.error('[sendStaffInvite] PATCH failed:', err);
        return Response.json({ error: 'Failed to add attendee' }, { status: 502 });
      }

      // Mark in team record that invite was sent (using the main event ID)
      if (event.team) {
        const updatedTeam = event.team.map(m =>
          m.staffMemberName === staffMember.name
            ? { ...m, calendarEventId: mainCalendarEventId, calendarStatus: 'pending' }
            : m
        );
        await base44.asServiceRole.entities.Event.update(eventId, { team: updatedTeam });
      }

      console.log(`[sendStaffInvite] Added ${staffMember.email} as attendee to event ${mainCalendarEventId}`);
      return Response.json({ success: true, calendarEventId: mainCalendarEventId });

    } else if (action === 'cancel') {
      // Remove staff member from attendees
      attendees = attendees.filter(a => a.email !== staffMember.email);

      const patchRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${mainCalendarEventId}`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ attendees }),
        }
      );

      if (!patchRes.ok) {
        const err = await patchRes.text();
        console.error('[sendStaffInvite] PATCH (remove) failed:', err);
      }

      // Clear calendarEventId from team member
      if (event.team) {
        const updatedTeam = event.team.map(m =>
          m.staffMemberName === staffMember.name
            ? { ...m, calendarEventId: null, calendarStatus: null }
            : m
        );
        await base44.asServiceRole.entities.Event.update(eventId, { team: updatedTeam });
      }

      console.log(`[sendStaffInvite] Removed ${staffMember.email} from event ${mainCalendarEventId}`);
      return Response.json({ success: true });
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('[sendStaffInvite] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});