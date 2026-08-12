import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

/**
 * createGoogleEvent
 * Payload: { summary, description, startDate, endDate, location, leadId? }
 * Uses Google Calendar OAuth connector + Calendar ID from AppSetting.
 * If leadId is provided, writes result to lead.googleCalendarStatus.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { summary, description, startDate, endDate, location, leadId, dbEventId } = await req.json();

    if (!summary || !startDate) {
      return Response.json({ error: 'summary and startDate are required' }, { status: 400 });
    }

    // Guard: if DB event already has a googleCalendarEventId (and it's not a "creating_" marker), route to syncEventToCalendar instead
    if (dbEventId) {
      const dbEvents = await base44.asServiceRole.entities.Event.filter({ id: dbEventId });
      const dbEvent = dbEvents?.[0];
      if (dbEvent?.googleCalendarEventId && !dbEvent.googleCalendarEventId.startsWith('creating_')) {
        console.log(`[createGoogleEvent] Event ${dbEventId} already has calendarId ${dbEvent.googleCalendarEventId} — delegating to syncEventToCalendar`);
        // Delegate to the single source of truth for calendar sync
        const syncResult = await base44.asServiceRole.functions.invoke('syncEventToCalendar', { eventId: dbEventId });
        return Response.json({ success: true, delegated: true, syncResult });
      }
    }

    // Validate and normalize date to YYYY-MM-DD (Google all-day event format)
    const normalizeDate = (d) => {
      if (!d) return null;
      // If it's already YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
      // Otherwise parse and convert
      const parsed = new Date(d);
      if (isNaN(parsed.getTime())) return null;
      return parsed.toISOString().split('T')[0];
    };

    const normalizedStart = normalizeDate(startDate);
    const normalizedEnd = normalizeDate(endDate) || normalizedStart;

    if (!normalizedStart) {
      return Response.json({ error: `Invalid startDate format: ${startDate}` }, { status: 400 });
    }

    // Load Calendar ID from settings
    const settings = await base44.asServiceRole.entities.AppSetting.list();
    const calendarIdSetting = settings.find((s) => s.key === 'google_calendar_id')?.value?.trim();
    const calendarId = calendarIdSetting || 'primary';

    console.log(`[createGoogleEvent] calendarId="${calendarId}" startDate="${normalizedStart}"`);

    // Get Google Calendar OAuth token
    let accessToken;
    try {
      const conn = await base44.asServiceRole.connectors.getConnection('googlecalendar');
      accessToken = conn.accessToken;
    } catch (e) {
      const errMsg = `Google Calendar not connected: ${e.message}`;
      console.error('[createGoogleEvent]', errMsg);
      if (leadId) {
        await base44.asServiceRole.entities.Lead.update(leadId, { googleCalendarStatus: errMsg });
      }
      return Response.json({ error: errMsg }, { status: 400 });
    }

    const event = {
      summary,
      description: description || '',
      location: location || '',
      colorId: '5', // Default: Banana (yellow) = new event created
      start: {
        date: normalizedStart,
        timeZone: 'Asia/Jerusalem',
      },
      end: {
        date: normalizedEnd,
        timeZone: 'Asia/Jerusalem',
      },
    };

    console.log('[createGoogleEvent] Sending event:', JSON.stringify(event));

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      }
    );

    const responseText = await response.text();
    console.log(`[createGoogleEvent] Google response ${response.status}:`, responseText);

    if (!response.ok) {
      let friendlyErr = `${response.status} ${response.statusText}`;
      try {
        const errJson = JSON.parse(responseText);
        friendlyErr = errJson?.error?.message || friendlyErr;
      } catch (_) { /* use raw */ }

      const errMsg = `שגיאה מגוגל: ${friendlyErr}`;
      if (leadId) {
        await base44.asServiceRole.entities.Lead.update(leadId, { googleCalendarStatus: errMsg });
      }
      return Response.json({ error: errMsg }, { status: 502 });
    }

    const created = JSON.parse(responseText);
    const successMsg = `הצליח — אירוע נוצר ב-${new Date().toLocaleDateString('he-IL')}`;

    // Save Google Event ID on Lead and on DB Event (if provided)
    const updates = [];
    if (leadId) {
      updates.push(base44.asServiceRole.entities.Lead.update(leadId, { googleCalendarStatus: successMsg }));
    }
    if (dbEventId) {
      updates.push(base44.asServiceRole.entities.Event.update(dbEventId, { googleCalendarEventId: created.id }));
    }
    await Promise.all(updates);

    return Response.json({ success: true, eventId: created.id, htmlLink: created.htmlLink });
  } catch (error) {
    console.error('[createGoogleEvent] Unexpected error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});