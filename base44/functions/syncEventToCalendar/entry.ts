import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * syncEventToCalendar — SINGLE SOURCE OF TRUTH for Google Calendar sync
 *
 * Colors:
 *   - Default: colorId '5' (banana/yellow)
 *   - Team complete: colorId '7' (peacock/turquoise)
 *
 * Features:
 *   - Creates or updates Google Calendar event
 *   - Sets color based on team completion
 *   - Adds staff members as attendees (with email)
 *   - Full description with event details + lead production info + pricing
 *
 * Called by:
 *   1. syncLeadToEventAndGoogle (after Event entity is created)
 *   2. Automation: "Sync Event Updates to Google Calendar" (on Event UPDATE when googleCalendarEventId exists)
 *   3. Frontend manually
 */
Deno.serve(async (req) => {
  // Declare outside try so catch block can access them for error recording
  let eventId = null;
  let base44 = null;

  try {
    base44 = createClientFromRequest(req);
    const body = await req.json();

    // Resolve eventId — from automation payload OR direct call
    if (body?.data?.id) {
      eventId = body.data.id;
    } else if (body?.eventId) {
      eventId = body.eventId;
    } else {
      return Response.json({ skipped: 'no event data or eventId' });
    }

    // Always re-fetch fresh data
    const freshEvents = await base44.asServiceRole.entities.Event.filter({ id: eventId });
    const freshEvent = freshEvents && freshEvents[0];

    if (!freshEvent) return Response.json({ skipped: 'event not found' });
    if (!freshEvent.coupleNames || !freshEvent.date) {
      return Response.json({ skipped: 'event missing coupleNames or date' });
    }

    const existingCalId = freshEvent.googleCalendarEventId;
    const isLocked = existingCalId && existingCalId.startsWith('creating_');
    if (isLocked) {
      return Response.json({ skipped: 'create in progress (lock marker)' });
    }

    // Mark sync as pending before any Google API call
    await base44.asServiceRole.entities.Event.update(eventId, {
      calendarSyncStatus: 'pending',
      calendarSyncError: null,
    });

    // Get Google Calendar OAuth token
    let accessToken;
    try {
      const conn = await base44.asServiceRole.connectors.getConnection('googlecalendar');
      accessToken = conn.accessToken;
    } catch (e) {
      return Response.json({ error: 'Google Calendar not connected: ' + e.message }, { status: 400 });
    }

    const settings = await base44.asServiceRole.entities.AppSetting.list();
    const calendarId = settings.find(s => s.key === 'google_calendar_id')?.value?.trim() || 'primary';

    // --- Determine team completion + color ---
    const team = freshEvent.team || [];
    const nonEditorTeam = team.filter(m => m.role !== 'editor' && m.staffMemberName);
    const requiredCrew = freshEvent.requiredCrew || 3;
    const teamComplete = nonEditorTeam.length >= requiredCrew;
    const colorId = nonEditorTeam.length === 0 ? '7' : teamComplete ? '10' : '5'; // 7=peacock(no crew), 10=basil(full), 5=banana(missing)

    // --- Build description ---
    const teamDetails = nonEditorTeam
      .map(m => '• ' + (m.staffMemberName || '—') + ' (' + m.role + ')')
      .join('\n');

    let leadDetails = '';
    let lead = null;
    try {
      if (freshEvent.leadId || freshEvent.source_lead_id) {
        const leadId = freshEvent.leadId || freshEvent.source_lead_id;
        const leads = await base44.asServiceRole.entities.Lead.filter({ id: leadId });
        lead = leads && leads[0];
        if (lead && lead.productionFormFilledAt) {
          leadDetails = '\n\n--- 📋 פרטי הפקה ---\n'
            + '📱 נייד כלה: ' + (lead.productionBridePhone || '—') + '\n'
            + '📱 נייד חתן: ' + (lead.productionGroomPhone || '—') + '\n'
            + '📍 התארגנות כלה: ' + (lead.productionBridePrepLocation || '—') + '\n'
            + '📸 אינסטגרם: ' + (lead.productionInstagram || '—') + '\n'
            + '💬 בקשות מיוחדות: ' + (lead.productionSpecialRequests || '—');
        }
      }
    } catch (e) {
      console.log('[sync] Could not load lead details:', e.message);
    }

    const notesSection = freshEvent.notes ? '\n\n--- 📝 הערות ---\n' + freshEvent.notes : '';

    const description = 'פרטי אירוע - Avira Media\n\n'
      + '👰 שמות הזוג: ' + freshEvent.coupleNames + '\n'
      + '📅 תאריך: ' + new Date(freshEvent.date).toLocaleDateString('he-IL') + '\n'
      + '🏰 אולם: ' + (freshEvent.venue || '—') + '\n'
      + '📞 טלפון: ' + (freshEvent.phoneNumber || '—') + '\n\n'
      + '👥 צוות הצילום:\n' + (teamDetails || 'טרם הוקצה')
      + (teamComplete ? '\n✅ צוות מלא' : '')
      + leadDetails
      + notesSection;

    // --- Build attendees list from staff emails ---
    let attendees = [];
    try {
      if (nonEditorTeam.length > 0) {
        const allStaff = await base44.asServiceRole.entities.StaffMember.list();
        for (const member of nonEditorTeam) {
          const staffRecord = allStaff.find(s => s.name === member.staffMemberName);
          if (staffRecord && staffRecord.email) {
            attendees.push({ email: staffRecord.email });
          }
        }
      }
    } catch (e) {
      console.log('[sync] Could not load staff emails:', e.message);
    }

    const startDate = new Date(freshEvent.date).toISOString().split('T')[0];
    const endDate = new Date(new Date(freshEvent.date).getTime() + 86400000).toISOString().split('T')[0];

    const calendarPayload = {
      summary: '📸 ' + freshEvent.coupleNames,
      description,
      colorId,
      start: { date: startDate },
      end: { date: endDate },
    };
    if (attendees.length > 0) {
      calendarPayload.attendees = attendees;
    }

    const calendarBody = JSON.stringify(calendarPayload);
    const headers = {
      'Authorization': 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
    };
    const baseUrl = 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/events';
    const sendUpdates = attendees.length > 0 ? '?sendUpdates=all' : '';

    // ===== UPDATE PATH =====
    if (existingCalId) {
      const res = await fetch(baseUrl + '/' + existingCalId + sendUpdates, { method: 'PATCH', headers, body: calendarBody });
      if (res.status === 404 || res.status === 410) {
        console.log('[sync] Calendar event ' + existingCalId + ' not found — clearing ID to recreate');
        await base44.asServiceRole.entities.Event.update(eventId, { googleCalendarEventId: null });
        return Response.json({ success: true, action: 'cleared_missing_id' });
      }
      if (!res.ok) {
        const err = await res.text();
        throw new Error('PATCH failed: ' + res.status + ' ' + err);
      }
      await base44.asServiceRole.entities.Event.update(eventId, {
        calendarSyncStatus: 'success',
        calendarSyncError: null,
      });
      console.log('[sync] Updated calendar event ' + existingCalId + ' for event ' + eventId + ' (color: ' + colorId + ', attendees: ' + attendees.length + ')');
      return Response.json({ success: true, action: 'updated', calendarEventId: existingCalId, colorId, teamComplete });
    }

    // ===== CREATE PATH — acquire lock first =====
    const lockMarker = 'creating_' + Date.now();
    await base44.asServiceRole.entities.Event.update(eventId, { googleCalendarEventId: lockMarker });
    console.log('[sync] Lock acquired for event ' + eventId);

    const res = await fetch(baseUrl + sendUpdates, { method: 'POST', headers, body: calendarBody });
    if (!res.ok) {
      await base44.asServiceRole.entities.Event.update(eventId, { googleCalendarEventId: null });
      const err = await res.text();
      throw new Error('POST failed: ' + res.status + ' ' + err);
    }

    const created = await res.json();
    await base44.asServiceRole.entities.Event.update(eventId, {
      googleCalendarEventId: created.id,
      calendarSyncStatus: 'success',
      calendarSyncError: null,
    });
    console.log('[sync] Created calendar event ' + created.id + ' for event ' + eventId + ' (color: ' + colorId + ', attendees: ' + attendees.length + ')');

    return Response.json({ success: true, action: 'created', calendarEventId: created.id, colorId, teamComplete });

  } catch (error) {
    console.error('[syncEventToCalendar] Error:', error.message);
    // Best-effort: record failure state without masking the original error
    if (base44 && eventId) {
      try {
        const safeError = String(error.message || 'Unknown error').substring(0, 500);
        await base44.asServiceRole.entities.Event.update(eventId, {
          calendarSyncStatus: 'failed',
          calendarSyncError: safeError,
        });
      } catch (writeErr) {
        console.error('[syncEventToCalendar] Could not write failed status:', writeErr.message);
      }
    }
    return Response.json({ error: error.message }, { status: 500 });
  }
});