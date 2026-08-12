import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  // Get Google Calendar OAuth token
  let accessToken;
  try {
    const conn = await base44.asServiceRole.connectors.getConnection('googlecalendar');
    accessToken = conn.accessToken;
  } catch (e) {
    return Response.json({ error: 'Google Calendar not connected: ' + e.message }, { status: 400 });
  }

  // Get calendar ID from AppSettings
  const settings = await base44.asServiceRole.entities.AppSetting.list();
  const calendarId = settings.find(s => s.key === 'google_calendar_id')?.value?.trim() || 'primary';

  // Get all events with a Google Calendar event ID
  const allEvents = await base44.asServiceRole.entities.Event.list();
  const eventsWithCal = allEvents.filter(e => e.googleCalendarEventId);

  let updated = 0;
  let errors = 0;

  for (const event of eventsWithCal) {
    try {
      // Calculate color based on crew status (same logic as syncEventToCalendar)
      const team = event.team || [];
      const nonEditorTeam = team.filter((m) => m.role !== 'editor' && m.staffMemberName);
      const requiredCrew = event.requiredCrew || 3;
      const teamComplete = nonEditorTeam.length >= requiredCrew;
      // 7=peacock(no crew), 10=basil(full crew), 5=banana(missing crew)
      const colorId = nonEditorTeam.length === 0 ? '7' : teamComplete ? '10' : '5';

      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${event.googleCalendarEventId}?fields=id,colorId`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer ' + accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ colorId }),
      });

      if (res.ok) {
        updated++;
      } else {
        console.error(`Failed event ${event.id}: ${res.status} ${await res.text()}`);
        errors++;
      }
    } catch (err) {
      console.error(`Error event ${event.id}:`, err.message);
      errors++;
    }
  }

  return Response.json({ updated, errors, total: eventsWithCal.length });
});