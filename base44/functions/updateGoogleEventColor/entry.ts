import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

/**
 * updateGoogleEventColor
 * Called by the Event entity automation when team changes.
 * Also callable directly: { eventId (DB id) }
 *
 * Color logic:
 *   0 team members  → red   (colorId "11" = Tomato)
 *   1 team member   → yellow (colorId "5"  = Banana)
 *   2+ team members → green  (colorId "10" = Sage / in v3 API = "10" maps to Basil which is dark green)
 *
 * Google Calendar colorId reference (event colors):
 *   1=Lavender, 2=Sage, 3=Grape, 4=Flamingo, 5=Banana,
 *   6=Tangerine, 7=Peacock, 8=Blueberry, 9=Basil, 10=Tomato, 11=Flamingo
 * Note: API event colors differ from calendar colors.
 * Using: 11=Tomato(red), 5=Banana(yellow), 2=Sage(green)
 */

const COLOR_NONE = '11';   // Tomato = red (no crew)
const COLOR_PARTIAL = '5'; // Banana = yellow (partial crew)
const COLOR_FULL = '7';    // Peacock = turquoise/basil (full crew)

function getColorId(team, requiredCrew) {
  // Only photographers and videographers count for crew color logic (not editor)
  const assigned = (team || []).filter(m =>
    m.staffMemberName &&
    m.staffMemberName.trim() !== '' &&
    m.role !== 'editor'
  );
  const count = assigned.length;
  const required = requiredCrew || 3;

  if (count === 0) return COLOR_NONE;
  if (count >= required) return COLOR_FULL;
  return COLOR_PARTIAL;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();

    // Support direct call: { eventId } OR automation payload: { event, data }
    let eventData = null;
    let dbEventId = null;

    if (payload.event && payload.data) {
      // Automation payload
      eventData = payload.data;
      dbEventId = payload.event?.entity_id;
      // Only act on update events
      if (payload.event?.type !== 'update') {
        return Response.json({ message: 'Not an update, skipping' });
      }
      // Skip if team didn't change
      const oldTeam = JSON.stringify(payload.old_data?.team || []);
      const newTeam = JSON.stringify(payload.data?.team || []);
      if (oldTeam === newTeam) {
        return Response.json({ message: 'Team unchanged, skipping' });
      }
    } else if (payload.eventId) {
      // Direct call with DB event id
      dbEventId = payload.eventId;
      eventData = await base44.asServiceRole.entities.Event.get(dbEventId);
    } else {
      return Response.json({ error: 'Missing eventId or automation payload' }, { status: 400 });
    }

    if (!eventData) {
      return Response.json({ error: 'Event not found' }, { status: 404 });
    }

    const googleEventId = eventData.googleCalendarEventId;
    if (!googleEventId) {
      console.log('[updateGoogleEventColor] No googleCalendarEventId on event, skipping');
      return Response.json({ message: 'No Google Calendar event ID stored, skipping' });
    }

    // Load Calendar ID from settings
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

    const colorId = getColorId(eventData.team, eventData.requiredCrew);
    console.log(`[updateGoogleEventColor] eventId=${googleEventId} colorId=${colorId} team=${(eventData.team||[]).length}/${eventData.requiredCrew}`);

    // PATCH only the colorId — minimal update
    const patchResponse = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ colorId }),
      }
    );

    const respText = await patchResponse.text();
    console.log(`[updateGoogleEventColor] Google PATCH ${patchResponse.status}:`, respText);

    if (!patchResponse.ok) {
      let errMsg = `${patchResponse.status}`;
      try {
        const errJson = JSON.parse(respText);
        errMsg = errJson?.error?.message || errMsg;
      } catch (_) {}
      return Response.json({ error: `Google API error: ${errMsg}` }, { status: 502 });
    }

    return Response.json({ success: true, colorId, googleEventId });
  } catch (error) {
    console.error('[updateGoogleEventColor] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});