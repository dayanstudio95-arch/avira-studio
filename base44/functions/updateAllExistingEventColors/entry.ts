import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

/**
 * updateAllExistingEventColors
 * Updates all existing Google Calendar events with the new color scheme:
 * - Red (11) → Banana (5)
 * - Sage (2) → Peacock (7)
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch all events with googleCalendarEventId
    const allEvents = await base44.asServiceRole.entities.Event.list('-created_date', 999);
    const eventsWithCal = allEvents.filter(e => e.googleCalendarEventId && !e.googleCalendarEventId.startsWith('creating_'));

    console.log(`[updateAllExistingEventColors] Found ${eventsWithCal.length} events to update`);

    // Load Calendar ID
    const settings = await base44.asServiceRole.entities.AppSetting.list();
    const calendarId = settings.find(s => s.key === 'google_calendar_id')?.value?.trim() || 'primary';

    // Get OAuth token
    let accessToken;
    try {
      const conn = await base44.asServiceRole.connectors.getConnection('googlecalendar');
      accessToken = conn.accessToken;
    } catch (e) {
      return Response.json({ error: `Google Calendar not connected: ${e.message}` }, { status: 400 });
    }

    let updated = 0;
    let failed = 0;

    // Update each event
    for (const event of eventsWithCal) {
      try {
        const googleEventId = event.googleCalendarEventId;

        // Determine new color based on team status
        const assigned = (event.team || []).filter(m =>
          m.staffMemberName && m.staffMemberName.trim() !== '' && m.role !== 'editor'
        );
        const count = assigned.length;
        const required = event.requiredCrew || 3;

        const newColorId = count === 0 ? '5' : (count >= required ? '7' : '5');

        const patchResponse = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
          {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ colorId: newColorId }),
          }
        );

        if (patchResponse.ok) {
          updated++;
          console.log(`[updateAllExistingEventColors] Updated ${googleEventId} → colorId=${newColorId}`);
        } else {
          failed++;
          console.warn(`[updateAllExistingEventColors] Failed to update ${googleEventId}`);
        }
      } catch (err) {
        failed++;
        console.error('[updateAllExistingEventColors] Error:', err.message);
      }
    }

    return Response.json({
      success: true,
      total: eventsWithCal.length,
      updated,
      failed,
      message: `עדכנו ${updated} אירועים ביומן גוגל`
    });
  } catch (error) {
    console.error('[updateAllExistingEventColors] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});