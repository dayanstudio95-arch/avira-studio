import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * auditCalendarReliability — READ-ONLY audit
 *
 * Compares future Base44 Events against Google Calendar.
 * Does NOT modify any data. Does NOT sync anything.
 *
 * Returns a structured JSON report with:
 *   - missingCalendarId: future events with no googleCalendarEventId
 *   - missingInGoogleCalendar: have a calendar ID but event not found in Google
 *   - dateMismatches: date in Base44 differs from date in Google Calendar
 *   - duplicateCandidates: multiple Google Calendar events found for same couple+date
 *   - summary: counts of each category
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Get Google Calendar access token (read-only usage)
    let accessToken;
    let calendarId;
    try {
      const conn = await base44.asServiceRole.connectors.getConnection('googlecalendar');
      accessToken = conn.accessToken;

      const settings = await base44.asServiceRole.entities.AppSetting.list();
      calendarId = settings.find(s => s.key === 'google_calendar_id')?.value?.trim() || 'primary';
    } catch (e) {
      return Response.json({ error: 'Google Calendar not connected: ' + e.message }, { status: 400 });
    }

    // Fetch all Base44 Events
    const allEvents = await base44.asServiceRole.entities.Event.list();

    // Filter to future events only (from today onward)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    const futureEvents = allEvents.filter(e => e.date && e.date >= todayStr && e.coupleNames);

    console.log(`[audit] Total Base44 events: ${allEvents.length}, future events: ${futureEvents.length}`);

    // ── Category 1: Missing googleCalendarEventId ──
    const missingCalendarId = futureEvents
      .filter(e => !e.googleCalendarEventId)
      .map(e => ({
        id: e.id,
        coupleNames: e.coupleNames,
        date: e.date,
        venue: e.venue || null,
      }));

    // ── For the remaining checks, only work with events that HAVE a calendar ID ──
    const eventsWithCalId = futureEvents.filter(e => e.googleCalendarEventId && !e.googleCalendarEventId.startsWith('creating_'));

    // Fetch all Google Calendar events in the future window once (more efficient than per-event lookups)
    // We'll fetch from today up to 2 years ahead to cover all future events
    const twoYearsAhead = new Date();
    twoYearsAhead.setFullYear(twoYearsAhead.getFullYear() + 2);

    const gcalUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
      + `?timeMin=${today.toISOString()}`
      + `&timeMax=${twoYearsAhead.toISOString()}`
      + `&maxResults=2500`
      + `&singleEvents=true`
      + `&orderBy=startTime`;

    const gcalRes = await fetch(gcalUrl, {
      headers: { Authorization: 'Bearer ' + accessToken },
    });

    if (!gcalRes.ok) {
      const errText = await gcalRes.text();
      return Response.json({ error: 'Failed to fetch Google Calendar events: ' + errText }, { status: 500 });
    }

    const gcalData = await gcalRes.json();
    const gcalEvents = gcalData.items || [];

    console.log(`[audit] Google Calendar future events fetched: ${gcalEvents.length}`);

    // Build a lookup map: calendarEventId → gcal event
    const gcalById = {};
    for (const ge of gcalEvents) {
      gcalById[ge.id] = ge;
    }

    // Build a lookup map: "coupleNames|date" → array of gcal events (for duplicate detection)
    const gcalByNameDate = {};
    for (const ge of gcalEvents) {
      const summary = (ge.summary || '').replace('📸 ', '').trim();
      const startDate = ge.start?.date || ge.start?.dateTime?.split('T')[0] || '';
      const key = `${summary}|${startDate}`;
      if (!gcalByNameDate[key]) gcalByNameDate[key] = [];
      gcalByNameDate[key].push(ge);
    }

    // ── Category 2: Have a calendar ID but event not found in Google ──
    const missingInGoogleCalendar = [];
    // ── Category 3: Date mismatch ──
    const dateMismatches = [];
    // ── Category 4: Duplicate candidates ──
    const duplicateCandidates = [];

    for (const event of eventsWithCalId) {
      const gcalEvent = gcalById[event.googleCalendarEventId];

      // Category 2: ID not found in Google Calendar
      if (!gcalEvent) {
        missingInGoogleCalendar.push({
          id: event.id,
          coupleNames: event.coupleNames,
          date: event.date,
          googleCalendarEventId: event.googleCalendarEventId,
          venue: event.venue || null,
        });
        continue; // No point checking date or duplicates if event is missing
      }

      // Category 3: Date mismatch
      const gcalDate = gcalEvent.start?.date || gcalEvent.start?.dateTime?.split('T')[0] || null;
      if (gcalDate && gcalDate !== event.date) {
        dateMismatches.push({
          id: event.id,
          coupleNames: event.coupleNames,
          base44Date: event.date,
          googleCalendarDate: gcalDate,
          googleCalendarEventId: event.googleCalendarEventId,
          venue: event.venue || null,
        });
      }

      // Category 4: Duplicate detection — search by couple name + date
      const nameKey = `${event.coupleNames}|${event.date}`;
      const matchingGcalEvents = gcalByNameDate[nameKey] || [];
      if (matchingGcalEvents.length > 1) {
        // More than one Google Calendar event with same couple name + date
        duplicateCandidates.push({
          id: event.id,
          coupleNames: event.coupleNames,
          date: event.date,
          base44CalendarEventId: event.googleCalendarEventId,
          allGoogleCalendarIds: matchingGcalEvents.map(ge => ge.id),
          duplicateCount: matchingGcalEvents.length,
        });
      }
    }

    // Remove duplicate entries in duplicateCandidates (same event may have been processed multiple times)
    const uniqueDuplicates = [];
    const seenDupIds = new Set();
    for (const d of duplicateCandidates) {
      if (!seenDupIds.has(d.id)) {
        seenDupIds.add(d.id);
        uniqueDuplicates.push(d);
      }
    }

    const report = {
      auditDate: new Date().toISOString(),
      auditScope: `Future events from ${todayStr} onward`,
      totalFutureEventsInBase44: futureEvents.length,
      totalGoogleCalendarFutureEvents: gcalEvents.length,
      missingCalendarId,
      missingInGoogleCalendar,
      dateMismatches,
      duplicateCandidates: uniqueDuplicates,
      summary: {
        missingCalendarId: missingCalendarId.length,
        missingInGoogleCalendar: missingInGoogleCalendar.length,
        dateMismatches: dateMismatches.length,
        duplicateCandidates: uniqueDuplicates.length,
        totalIssues:
          missingCalendarId.length +
          missingInGoogleCalendar.length +
          dateMismatches.length +
          uniqueDuplicates.length,
      },
    };

    console.log('[audit] Report summary:', JSON.stringify(report.summary));
    return Response.json(report);

  } catch (error) {
    console.error('[auditCalendarReliability] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});