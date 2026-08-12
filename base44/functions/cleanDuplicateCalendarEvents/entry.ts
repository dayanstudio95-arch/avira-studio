import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * One-time cleanup function: search Google Calendar for duplicate events
 * matching a given query (e.g. couple name), delete all but the best one.
 * Best = the one with the most content in description (longest description = has questionnaire data).
 * 
 * Payload: { searchQuery: "חן ונוייר", keepEventId?: "explicit_id_to_keep" }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchQuery, keepEventId } = await req.json();
    if (!searchQuery) {
      return Response.json({ error: 'searchQuery is required' }, { status: 400 });
    }

    // Get Google Calendar connection
    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googlecalendar');

    // Load calendar ID from settings
    const settings = await base44.asServiceRole.entities.AppSetting.list();
    const calendarId = settings.find(s => s.key === 'google_calendar_id')?.value?.trim() || 'primary';

    // Search for events matching the query
    const searchUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?q=${encodeURIComponent(searchQuery)}&maxResults=50&singleEvents=true`;
    const searchRes = await fetch(searchUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const searchData = await searchRes.json();
    const items = searchData.items || [];

    console.log(`[cleanDuplicates] Found ${items.length} events for query: "${searchQuery}"`);

    if (items.length <= 1) {
      return Response.json({ success: true, message: 'No duplicates found', total: items.length, items: items.map(e => ({ id: e.id, summary: e.summary, start: e.start })) });
    }

    // Determine which event to keep:
    // Priority: explicit keepEventId > longest description (most data) > most recently created
    let eventToKeep;
    if (keepEventId) {
      eventToKeep = items.find(e => e.id === keepEventId);
    }
    if (!eventToKeep) {
      // Keep the one with the longest description (has team + questionnaire data)
      eventToKeep = items.reduce((best, cur) => {
        const bestLen = (best.description || '').length;
        const curLen = (cur.description || '').length;
        return curLen > bestLen ? cur : best;
      });
    }

    console.log(`[cleanDuplicates] Keeping event: ${eventToKeep.id} — "${eventToKeep.summary}"`);

    // Delete all others
    const deleted = [];
    const failed = [];
    for (const ev of items) {
      if (ev.id === eventToKeep.id) continue;
      const delRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${ev.id}`,
        { method: 'DELETE', headers: { 'Authorization': `Bearer ${accessToken}` } }
      );
      if (delRes.ok || delRes.status === 404 || delRes.status === 410) {
        deleted.push({ id: ev.id, summary: ev.summary });
        console.log(`[cleanDuplicates] Deleted: ${ev.id}`);
      } else {
        failed.push({ id: ev.id, status: delRes.status });
        console.warn(`[cleanDuplicates] Failed to delete: ${ev.id}, status: ${delRes.status}`);
      }
    }

    // Update the DB Event record that matches — save the kept eventId
    try {
      const dbEvents = await base44.asServiceRole.entities.Event.list();
      const matchingEvent = dbEvents.find(e =>
        (e.coupleNames || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        searchQuery.toLowerCase().includes((e.coupleNames || '').toLowerCase())
      );
      if (matchingEvent) {
        await base44.asServiceRole.entities.Event.update(matchingEvent.id, { googleCalendarEventId: eventToKeep.id });
        console.log(`[cleanDuplicates] Updated DB event ${matchingEvent.id} with calendarId ${eventToKeep.id}`);
      }
    } catch (dbErr) {
      console.warn('[cleanDuplicates] Could not update DB event:', dbErr.message);
    }

    return Response.json({
      success: true,
      kept: { id: eventToKeep.id, summary: eventToKeep.summary, description_length: (eventToKeep.description || '').length },
      deleted,
      failed,
    });
  } catch (error) {
    console.error('[cleanDuplicates] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});