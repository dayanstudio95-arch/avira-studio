import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { eventIds } = await req.json();

    if (!eventIds || !Array.isArray(eventIds) || eventIds.length === 0) {
      return Response.json({ error: 'No event IDs provided' }, { status: 400 });
    }

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googlecalendar');

    let deleted = 0;
    let failed = 0;

    for (const eventId of eventIds) {
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.ok || response.status === 404) {
        deleted++;
      } else {
        failed++;
        console.error(`Failed to delete event ${eventId}:`, response.status);
      }
    }

    return Response.json({
      success: true,
      deleted,
      failed,
      message: `Deleted ${deleted} events from Google Calendar`
    });
  } catch (error) {
    console.error('Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});