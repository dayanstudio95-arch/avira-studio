// Ports base44/functions/syncEventToCalendar/entry.ts — SINGLE SOURCE OF TRUTH for
// Google Calendar sync (original's own description). Called directly by the
// frontend (UnifiedSidePanel, EventDetailDrawer, EventsTableWithBulkDelete,
// EditEvent.jsx, GoogleSettingsPage, GoogleCalendarDashboard — all with { eventId }).
//
// GOOGLE CALENDAR OAUTH GAP (same one documented in submit-production-questionnaire):
// the original obtained a token via Base44's `asServiceRole.connectors.getConnection
// ('googlecalendar')`. No Supabase equivalent exists yet (Phase 4 integrations UI,
// not built). Until then this reads `google_calendar_access_token` /
// `google_calendar_id` from app_settings (RLS-scoped to the caller's tenant since
// this uses the user client, unlike the public functions which pass tenant_id
// explicitly). UNLIKE submit-production-questionnaire, the original treats a
// missing/failed calendar connection as a HARD ERROR for this function (its entire
// purpose is the calendar sync) — preserved as-is, not downgraded to best-effort.
//
// Color logic preserved verbatim from the original even though its own header
// comment ("Default: 5, Team complete: 7") doesn't match its own code
// (empty team -> 7, complete -> 10, else -> 5) — that mismatch is a pre-existing
// doc bug in the source, not something introduced here; the CODE's actual behavior
// is what's ported, not the stale comment.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, getRequestUser } from '../_shared/supabaseClients.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  let eventId: string | null = null;
  let supabase: ReturnType<typeof createUserClient> | null = null;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    supabase = createUserClient(req);
    const body = await req.json();

    eventId = body?.data?.id || body?.eventId || null;
    if (!eventId) return jsonResponse({ skipped: 'no event data or eventId' });

    const { data: freshEvent, error: evErr } = await supabase.from('events').select('*').eq('id', eventId).maybeSingle();
    if (evErr) return jsonResponse({ error: evErr.message }, { status: 500 });
    if (!freshEvent) return jsonResponse({ skipped: 'event not found' });
    if (!freshEvent.couple_names || !freshEvent.date) {
      return jsonResponse({ skipped: 'event missing coupleNames or date' });
    }

    const existingCalId: string | null = freshEvent.google_calendar_event_id;
    const isLocked = existingCalId && existingCalId.startsWith('creating_');
    if (isLocked) return jsonResponse({ skipped: 'create in progress (lock marker)' });

    await supabase.from('events').update({ calendar_sync_status: 'pending', calendar_sync_error: null }).eq('id', eventId);

    const { data: settings } = await supabase
      .from('app_settings')
      .select('key, value')
      .in('key', ['google_calendar_access_token', 'google_calendar_id']);
    const accessToken = settings?.find((s) => s.key === 'google_calendar_access_token')?.value;
    const calendarId = settings?.find((s) => s.key === 'google_calendar_id')?.value?.trim() || 'primary';

    if (!accessToken) {
      return jsonResponse({ error: 'Google Calendar not connected' }, { status: 400 });
    }

    // --- Determine team completion + color ---
    const team: Array<{ role?: string; staffMemberName?: string }> = freshEvent.team || [];
    const nonEditorTeam = team.filter((m) => m.role !== 'editor' && m.staffMemberName);
    const requiredCrew = freshEvent.required_crew || 3;
    const teamComplete = nonEditorTeam.length >= requiredCrew;
    const colorId = nonEditorTeam.length === 0 ? '7' : teamComplete ? '10' : '5';

    const teamDetails = nonEditorTeam.map((m) => `• ${m.staffMemberName || '—'} (${m.role})`).join('\n');

    let leadDetails = '';
    try {
      const leadId = freshEvent.source_lead_id || freshEvent.lead_id;
      if (leadId) {
        const { data: lead } = await supabase.from('leads').select('*').eq('id', leadId).maybeSingle();
        if (lead && lead.production_form_filled_at) {
          leadDetails =
            '\n\n--- 📋 פרטי הפקה ---\n' +
            `📱 נייד כלה: ${lead.production_bride_phone || '—'}\n` +
            `📱 נייד חתן: ${lead.production_groom_phone || '—'}\n` +
            `📍 התארגנות כלה: ${lead.production_bride_prep_location || '—'}\n` +
            `📸 אינסטגרם: ${lead.production_instagram || '—'}\n` +
            `💬 בקשות מיוחדות: ${lead.production_special_requests || '—'}`;
        }
      }
    } catch (e) {
      console.log('[sync] Could not load lead details:', e.message);
    }

    const notesSection = freshEvent.notes ? `\n\n--- 📝 הערות ---\n${freshEvent.notes}` : '';

    const description =
      'פרטי אירוע - Avira Media\n\n' +
      `👰 שמות הזוג: ${freshEvent.couple_names}\n` +
      `📅 תאריך: ${new Date(freshEvent.date).toLocaleDateString('he-IL')}\n` +
      `🏰 אולם: ${freshEvent.venue || '—'}\n` +
      `📞 טלפון: ${freshEvent.phone_number || '—'}\n\n` +
      `👥 צוות הצילום:\n${teamDetails || 'טרם הוקצה'}` +
      (teamComplete ? '\n✅ צוות מלא' : '') +
      leadDetails +
      notesSection;

    let attendees: Array<{ email: string }> = [];
    try {
      if (nonEditorTeam.length > 0) {
        const { data: allStaff } = await supabase.from('staff_members').select('name, email');
        for (const member of nonEditorTeam) {
          const staffRecord = allStaff?.find((s) => s.name === member.staffMemberName);
          if (staffRecord?.email) attendees.push({ email: staffRecord.email });
        }
      }
    } catch (e) {
      console.log('[sync] Could not load staff emails:', e.message);
    }

    const startDate = new Date(freshEvent.date).toISOString().split('T')[0];
    const endDate = new Date(new Date(freshEvent.date).getTime() + 86400000).toISOString().split('T')[0];

    const calendarPayload: Record<string, unknown> = {
      summary: `📸 ${freshEvent.couple_names}`,
      description,
      colorId,
      start: { date: startDate },
      end: { date: endDate },
    };
    if (attendees.length > 0) calendarPayload.attendees = attendees;

    const calendarBody = JSON.stringify(calendarPayload);
    const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
    const baseUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
    const sendUpdates = attendees.length > 0 ? '?sendUpdates=all' : '';

    // ===== UPDATE PATH =====
    if (existingCalId) {
      const res = await fetch(`${baseUrl}/${existingCalId}${sendUpdates}`, { method: 'PATCH', headers, body: calendarBody });
      if (res.status === 404 || res.status === 410) {
        console.log(`[sync] Calendar event ${existingCalId} not found — clearing ID to recreate`);
        await supabase.from('events').update({ google_calendar_event_id: null }).eq('id', eventId);
        return jsonResponse({ success: true, action: 'cleared_missing_id' });
      }
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`PATCH failed: ${res.status} ${err}`);
      }
      await supabase.from('events').update({ calendar_sync_status: 'success', calendar_sync_error: null }).eq('id', eventId);
      console.log(`[sync] Updated calendar event ${existingCalId} for event ${eventId} (color: ${colorId}, attendees: ${attendees.length})`);
      return jsonResponse({ success: true, action: 'updated', calendarEventId: existingCalId, colorId, teamComplete });
    }

    // ===== CREATE PATH — acquire lock first =====
    const lockMarker = `creating_${Date.now()}`;
    await supabase.from('events').update({ google_calendar_event_id: lockMarker }).eq('id', eventId);
    console.log(`[sync] Lock acquired for event ${eventId}`);

    const res = await fetch(`${baseUrl}${sendUpdates}`, { method: 'POST', headers, body: calendarBody });
    if (!res.ok) {
      await supabase.from('events').update({ google_calendar_event_id: null }).eq('id', eventId);
      const err = await res.text();
      throw new Error(`POST failed: ${res.status} ${err}`);
    }

    const created = await res.json();
    await supabase
      .from('events')
      .update({ google_calendar_event_id: created.id, calendar_sync_status: 'success', calendar_sync_error: null })
      .eq('id', eventId);
    console.log(`[sync] Created calendar event ${created.id} for event ${eventId} (color: ${colorId}, attendees: ${attendees.length})`);

    return jsonResponse({ success: true, action: 'created', calendarEventId: created.id, colorId, teamComplete });
  } catch (error) {
    console.error('[syncEventToCalendar] Error:', error.message);
    if (supabase && eventId) {
      try {
        const safeError = String(error.message || 'Unknown error').substring(0, 500);
        await supabase.from('events').update({ calendar_sync_status: 'failed', calendar_sync_error: safeError }).eq('id', eventId);
      } catch (writeErr) {
        console.error('[syncEventToCalendar] Could not write failed status:', writeErr.message);
      }
    }
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
