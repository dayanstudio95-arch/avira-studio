import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { calendarEventId } = body;

    if (!calendarEventId) {
      return Response.json({ success: true, skipped: true });
    }

    // Get Google Calendar connection
    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googlecalendar');
    
    if (!accessToken) {
      return Response.json({
        success: false,
        error: 'Google Calendar is not connected',
      }, { status: 400 });
    }

    // Try to delete the event from Google Calendar
    const deleteRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${calendarEventId}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );

    // If event not found (410 or 404), treat as already deleted - skip error
    if (deleteRes.status === 404 || deleteRes.status === 410) {
      console.log(`Event ${calendarEventId} not found in Google Calendar (already deleted)`);
      return Response.json({
        success: true,
        message: 'Event was already deleted from Google Calendar',
      });
    }

    if (!deleteRes.ok) {
      const errorText = await deleteRes.text();
      console.error(`Failed to delete from Google Calendar: ${deleteRes.status}`, errorText);
      return Response.json({
        success: false,
        error: `Failed to delete from Google Calendar: ${deleteRes.status}`,
      }, { status: deleteRes.status });
    }

    return Response.json({
      success: true,
      message: 'Event deleted from Google Calendar',
    });
  } catch (error) {
    console.error('Error deleting from Google Calendar:', error.message);
    return Response.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
});