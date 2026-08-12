import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// Triggered by entity automation on Event delete
// Deletes the linked Google Calendar event if one exists
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    const eventData = body.data;
    const calendarEventId = eventData?.googleCalendarEventId;

    if (!calendarEventId) {
      return Response.json({ skipped: 'no googleCalendarEventId on event' });
    }

    let accessToken;
    try {
      const conn = await base44.asServiceRole.connectors.getConnection('googlecalendar');
      accessToken = conn.accessToken;
    } catch (e) {
      return Response.json({ error: `Google Calendar not connected: ${e.message}` }, { status: 400 });
    }

    // Load calendar ID from settings
    const settings = await base44.asServiceRole.entities.AppSetting.list();
    const calendarIdSetting = settings.find(s => s.key === 'google_calendar_id')?.value?.trim();
    const calendarId = calendarIdSetting || 'primary';

    const deleteRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${calendarEventId}`,
      {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${accessToken}` },
      }
    );

    // 404/410 means already deleted — treat as success
    if (deleteRes.status === 404 || deleteRes.status === 410) {
      console.log(`[onEventDeleted] Calendar event ${calendarEventId} already gone.`);
      return Response.json({ success: true, skipped: 'already deleted from calendar' });
    }

    if (!deleteRes.ok) {
      const errText = await deleteRes.text();
      throw new Error(`Failed to delete from calendar: ${deleteRes.status} ${errText}`);
    }

    console.log(`[onEventDeleted] Deleted calendar event ${calendarEventId}`);
    return Response.json({ success: true, calendarEventId });

  } catch (error) {
    console.error('[onEventDeleted] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});