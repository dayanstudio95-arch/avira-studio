import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    // Check admin role
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Get Google Calendar access token
    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googlecalendar');

    // Parse year from request body
    const body = await req.json();
    const year = body.year || new Date().getFullYear();

    // Fetch all events from Google Calendar for specified year
    const startDate = `${year}-01-01T00:00:00Z`;
    const endDate = `${year}-12-31T23:59:59Z`;

    const eventsUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(startDate)}&timeMax=${encodeURIComponent(endDate)}&maxResults=2500`;
    
    const eventsResponse = await fetch(eventsUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!eventsResponse.ok) {
      return Response.json({ error: 'Failed to fetch Google Calendar events' }, { status: 500 });
    }

    const eventsData = await eventsResponse.json();
    const allEvents = eventsData.items || [];

    // Group events by (summary, startDate)
    const groupedByKey = new Map();
    allEvents.forEach(event => {
      const summary = event.summary || '';
      const startDate = event.start?.date || event.start?.dateTime?.split('T')[0] || '';
      const key = `${summary}|${startDate}`;

      if (!groupedByKey.has(key)) {
        groupedByKey.set(key, []);
      }
      groupedByKey.get(key).push(event);
    });

    // Find duplicates (groups with more than 1 event)
    const duplicateGroups = Array.from(groupedByKey.values()).filter(group => group.length > 1);

    // Delete duplicates (keep the first, delete the rest)
    let deletedCount = 0;
    for (const group of duplicateGroups) {
      for (let i = 1; i < group.length; i++) {
        const eventId = group[i].id;
        const deleteUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`;
        
        const deleteResponse = await fetch(deleteUrl, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (deleteResponse.ok) {
          deletedCount++;
        }
      }
    }

    return Response.json({
      message: `נמחקו ${deletedCount} אירועים כפולים מיומן הגוגל`,
      deletedCount,
      duplicateGroupsFound: duplicateGroups.length
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});