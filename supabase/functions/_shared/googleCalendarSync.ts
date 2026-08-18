// Shared Google Calendar push/delete logic, used by both connected accounts
// (primary + backup) for a tenant. Extracted from the old single-account
// sync-event-to-calendar/index.ts — the description/attendee-building logic
// below is preserved from that original. Color is a deliberate 2-state
// palette: banana (5) by default/partial crew, basil (10) once the crew is
// fully staffed — see buildEventPayload below.
//
// sync-event-to-calendar/index.ts is now a thin wrapper calling
// syncEventToAllAccounts(..., 'upsert'). delete-event-from-calendar/index.ts
// calls syncEventToAllAccounts(..., 'delete') — a capability that did not
// exist before this feature (deleteFromGoogleCalendar was unimplemented,
// meaning deleted events were previously left orphaned in Google Calendar
// forever).
import { getConnectedAccounts, getValidAccessToken, type AccountRole } from './googleCalendarAuth.ts';

interface CalendarPayload {
  summary: string;
  description: string;
  colorId: string;
  start: { date: string };
  end: { date: string };
  attendees?: Array<{ email: string }>;
}

export async function buildEventPayload(supabase: any, event: any): Promise<CalendarPayload> {
  const team: Array<{ role?: string; staffMemberName?: string }> = event.team || [];
  const nonEditorTeam = team.filter((m) => m.role !== 'editor' && m.staffMemberName);
  const requiredCrew = event.required_crew || 3;
  const teamComplete = nonEditorTeam.length >= requiredCrew;
  // 2-state palette: banana (5) is the default/normal state — used both when no
  // crew is assigned yet and when the crew is partial — basil (10) only once the
  // crew is fully staffed. (Previously had a 3rd "peacock" state for zero-team;
  // removed per product decision — zero and partial should look identical so the
  // color only communicates "is the crew complete or not".)
  const colorId = teamComplete ? '10' : '5';

  const teamDetails = nonEditorTeam.map((m) => `• ${m.staffMemberName || '—'} (${m.role})`).join('\n');

  let leadDetails = '';
  try {
    const leadId = event.source_lead_id || event.lead_id;
    if (leadId) {
      const { data: lead } = await supabase.from('leads').select('*').eq('id', leadId).maybeSingle();
      if (lead && lead.production_form_filled_at) {
        // Every questionnaire field the couple can fill in (see
        // EventQuestionnaire.jsx / migration 0009_questionnaire_fields.sql),
        // each included only when actually filled in — no "—" placeholders,
        // so the description only ever shows real answers.
        const lines: Array<string | false | null | undefined> = [
          lead.production_bride_phone && `📱 נייד כלה: ${lead.production_bride_phone}`,
          lead.production_groom_phone && `📱 נייד חתן: ${lead.production_groom_phone}`,
          lead.production_companion_name && `🧑‍🤝‍🧑 שם מלווה: ${lead.production_companion_name}`,
          lead.production_companion_phone && `📱 נייד מלווה: ${lead.production_companion_phone}`,
          lead.production_bride_prep_location && `📍 מקום התארגנות הכלה: ${lead.production_bride_prep_location}`,
          lead.production_checkin_time && `🕐 שעת הגעה / קבלת פנים: ${lead.production_checkin_time}`,
          lead.production_chuppah_time && `💍 שעת חופה משוערת: ${lead.production_chuppah_time}`,
          lead.production_bride_instagram && `📸 אינסטגרם כלה: ${lead.production_bride_instagram}`,
          lead.production_groom_instagram && `📸 אינסטגרם חתן: ${lead.production_groom_instagram}`,
          lead.production_has_social_creator &&
            `📷 סושיאל קריאייטור באירוע: ${[lead.production_social_creator_name, lead.production_social_creator_phone].filter(Boolean).join(' — ') || '—'}`,
          lead.production_has_external_planner &&
            `🗂️ יש מנהל/ת אירוע חיצוני/ת: ${[lead.production_external_planner_name, lead.production_external_planner_phone].filter(Boolean).join(' — ') || '—'}`,
          lead.production_family_bride && `👪 משפחת הכלה: ${lead.production_family_bride}`,
          lead.production_family_groom && `👪 משפחת החתן: ${lead.production_family_groom}`,
          lead.production_important_people && `⭐ אנשים חשובים במיוחד לצלם: ${lead.production_important_people}`,
          lead.production_family_sensitivities && `⚠️ רגישויות משפחתיות: ${lead.production_family_sensitivities}`,
          lead.production_planned_surprises && `🎁 הפתעות מתוכננות באירוע: ${lead.production_planned_surprises}`,
          lead.production_special_requests && `💬 בקשות מיוחדות: ${lead.production_special_requests}`,
        ];
        const filled = lines.filter(Boolean) as string[];
        if (filled.length > 0) {
          leadDetails = '\n\n--- 📋 פרטי הפקה ---\n' + filled.join('\n');
        }
      }
    }
  } catch (e) {
    console.log('[googleCalendarSync] Could not load lead details:', e.message);
  }

  const notesSection = event.notes ? `\n\n--- 📝 הערות ---\n${event.notes}` : '';

  const description =
    'פרטי אירוע - Avira Media\n\n' +
    `👰 שמות הזוג: ${event.couple_names}\n` +
    `📅 תאריך: ${new Date(event.date).toLocaleDateString('he-IL')}\n` +
    `🏰 אולם: ${event.venue || '—'}\n` +
    `📞 טלפון: ${event.phone_number || '—'}\n\n` +
    `👥 צוות הצילום:\n${teamDetails || 'טרם הוקצה'}` +
    (teamComplete ? '\n✅ צוות מלא' : '') +
    leadDetails +
    notesSection;

  let attendees: Array<{ email: string }> = [];
  try {
    if (nonEditorTeam.length > 0) {
      const { data: allStaff } = await supabase.from('staff_members').select('name, email');
      for (const member of nonEditorTeam) {
        const staffRecord = allStaff?.find((s: any) => s.name === member.staffMemberName);
        if (staffRecord?.email) attendees.push({ email: staffRecord.email });
      }
    }
  } catch (e) {
    console.log('[googleCalendarSync] Could not load staff emails:', e.message);
  }

  const startDate = new Date(event.date).toISOString().split('T')[0];
  const endDate = new Date(new Date(event.date).getTime() + 86400000).toISOString().split('T')[0];

  const payload: CalendarPayload = {
    summary: `📸 ${event.couple_names}`,
    description,
    colorId,
    start: { date: startDate },
    end: { date: endDate },
  };
  if (attendees.length > 0) payload.attendees = attendees;
  return payload;
}

export async function pushEventToAccount(
  accessToken: string,
  calendarId: string,
  payload: CalendarPayload,
  existingGoogleEventId: string | null,
): Promise<{ action: 'created' | 'updated' | 'cleared_missing_id'; googleEventId: string | null }> {
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  const baseUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const sendUpdates = payload.attendees && payload.attendees.length > 0 ? '?sendUpdates=all' : '';
  const body = JSON.stringify(payload);

  const hasRealExistingId = existingGoogleEventId && !existingGoogleEventId.startsWith('creating_');

  if (hasRealExistingId) {
    const res = await fetch(`${baseUrl}/${existingGoogleEventId}${sendUpdates}`, { method: 'PATCH', headers, body });
    if (res.status === 404 || res.status === 410) {
      console.log(`[googleCalendarSync] Calendar event ${existingGoogleEventId} not found — clearing to recreate next sync`);
      return { action: 'cleared_missing_id', googleEventId: null };
    }
    if (!res.ok) throw new Error(`PATCH failed: ${res.status} ${await res.text()}`);
    return { action: 'updated', googleEventId: existingGoogleEventId };
  }

  const res = await fetch(`${baseUrl}${sendUpdates}`, { method: 'POST', headers, body });
  if (!res.ok) throw new Error(`POST failed: ${res.status} ${await res.text()}`);
  const created = await res.json();
  return { action: 'created', googleEventId: created.id };
}

export async function deleteEventFromAccount(accessToken: string, calendarId: string, googleEventId: string | null): Promise<void> {
  if (!googleEventId || googleEventId.startsWith('creating_')) return;
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${googleEventId}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`DELETE failed: ${res.status} ${await res.text()}`);
  }
}

interface AccountSyncResult {
  accountRole: AccountRole;
  status: 'success' | 'failed' | 'skipped';
  error?: string;
  googleEventId?: string | null;
}

async function mirrorPrimaryOntoLegacyColumns(
  supabase: any,
  eventId: string,
  status: 'pending' | 'success' | 'failed',
  googleEventId: string | null | undefined,
  error: string | null,
) {
  const update: Record<string, unknown> = { calendar_sync_status: status, calendar_sync_error: error };
  if (googleEventId !== undefined) update.google_calendar_event_id = googleEventId;
  await supabase.from('events').update(update).eq('id', eventId);
}

// Pushes (create/update) the given event to every one of the tenant's
// 'connected' Google accounts (primary + backup), independently — one
// account failing (expired reauth, bad calendar id, network error) never
// blocks the other. Returns per-account results; the caller decides how to
// turn that into an HTTP response.
export async function syncEventToAllAccounts(
  supabase: any,
  tenantId: string,
  eventId: string,
): Promise<{ anyConnected: boolean; results: AccountSyncResult[] }> {
  const { data: event, error: evErr } = await supabase.from('events').select('*').eq('id', eventId).maybeSingle();
  if (evErr) throw new Error(evErr.message);
  if (!event) throw new Error('Event not found');
  if (!event.couple_names || !event.date) throw new Error('Event missing coupleNames or date');

  const connectedAccounts = await getConnectedAccounts(supabase, tenantId);
  if (connectedAccounts.length === 0) return { anyConnected: false, results: [] };

  const payload = await buildEventPayload(supabase, event);
  const results: AccountSyncResult[] = [];

  for (const account of connectedAccounts) {
    const role = account.account_role as AccountRole;
    try {
      const token = await getValidAccessToken(supabase, tenantId, role);
      if (!token) {
        results.push({ accountRole: role, status: 'skipped', error: 'account needs reauth or is disconnected' });
        continue;
      }

      const { data: existingSync } = await supabase
        .from('event_calendar_syncs')
        .select('*')
        .eq('event_id', eventId)
        .eq('account_id', token.accountId)
        .maybeSingle();

      const existingGoogleEventId: string | null = existingSync?.google_event_id ?? null;
      const isLocked = existingGoogleEventId?.startsWith('creating_');
      if (isLocked) {
        results.push({ accountRole: role, status: 'skipped', error: 'create in progress (lock marker)' });
        continue;
      }

      // Acquire a create-lock before the network call, mirroring the
      // original single-account implementation's race-avoidance strategy.
      if (!existingGoogleEventId) {
        const lockMarker = `creating_${Date.now()}`;
        await supabase.from('event_calendar_syncs').upsert(
          {
            tenant_id: tenantId,
            event_id: eventId,
            account_id: token.accountId,
            account_role: role,
            google_event_id: lockMarker,
            status: 'pending',
            last_error: null,
            last_synced_at: new Date().toISOString(),
          },
          { onConflict: 'event_id,account_id' },
        );
        if (role === 'primary') await mirrorPrimaryOntoLegacyColumns(supabase, eventId, 'pending', lockMarker, null);
      }

      const pushResult = await pushEventToAccount(token.accessToken, token.calendarId, payload, existingGoogleEventId);

      if (pushResult.action === 'cleared_missing_id') {
        await supabase.from('event_calendar_syncs').upsert(
          {
            tenant_id: tenantId,
            event_id: eventId,
            account_id: token.accountId,
            account_role: role,
            google_event_id: null,
            status: 'pending',
            last_error: null,
            last_synced_at: new Date().toISOString(),
          },
          { onConflict: 'event_id,account_id' },
        );
        if (role === 'primary') await mirrorPrimaryOntoLegacyColumns(supabase, eventId, 'pending', null, null);
        results.push({ accountRole: role, status: 'success', googleEventId: null });
        continue;
      }

      await supabase.from('event_calendar_syncs').upsert(
        {
          tenant_id: tenantId,
          event_id: eventId,
          account_id: token.accountId,
          account_role: role,
          google_event_id: pushResult.googleEventId,
          status: 'success',
          last_error: null,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: 'event_id,account_id' },
      );
      if (role === 'primary') await mirrorPrimaryOntoLegacyColumns(supabase, eventId, 'success', pushResult.googleEventId, null);
      await supabase.from('google_calendar_accounts').update({ last_synced_at: new Date().toISOString() }).eq('id', token.accountId);

      results.push({ accountRole: role, status: 'success', googleEventId: pushResult.googleEventId });
    } catch (err) {
      const message = String(err.message || err).slice(0, 500);
      console.error(`[googleCalendarSync] ${role} account sync failed for event ${eventId}:`, message);
      await supabase.from('event_calendar_syncs').upsert(
        {
          tenant_id: tenantId,
          event_id: eventId,
          account_id: account.id,
          account_role: role,
          status: 'failed',
          last_error: message,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: 'event_id,account_id' },
      );
      if (role === 'primary') await mirrorPrimaryOntoLegacyColumns(supabase, eventId, 'failed', undefined, message);
      results.push({ accountRole: role, status: 'failed', error: message });
    }
  }

  return { anyConnected: true, results };
}

// Deletes the event from every Google account it was ever synced to
// (reads event_calendar_syncs — works even for accounts that are no longer
// 'connected', as long as their refresh token still resolves). Clears the
// sync rows and the legacy events columns. Must be called BEFORE the
// events row itself is deleted (event_calendar_syncs cascades off events,
// so deleting the row first would destroy the very data needed to know
// what to delete on Google's side).
export async function deleteEventFromAllAccounts(supabase: any, tenantId: string, eventId: string): Promise<AccountSyncResult[]> {
  const { data: syncRows } = await supabase
    .from('event_calendar_syncs')
    .select('*, google_calendar_accounts(account_role)')
    .eq('event_id', eventId);

  const results: AccountSyncResult[] = [];
  if (!syncRows || syncRows.length === 0) return results;

  for (const row of syncRows) {
    const role = row.account_role as AccountRole;
    try {
      const token = await getValidAccessToken(supabase, tenantId, role);
      if (!token) {
        results.push({ accountRole: role, status: 'skipped', error: 'account needs reauth or is disconnected' });
        continue;
      }
      await deleteEventFromAccount(token.accessToken, token.calendarId, row.google_event_id);
      await supabase.from('event_calendar_syncs').update({ status: 'deleted', last_error: null, last_synced_at: new Date().toISOString() }).eq('id', row.id);
      results.push({ accountRole: role, status: 'success' });
    } catch (err) {
      const message = String(err.message || err).slice(0, 500);
      console.error(`[googleCalendarSync] ${role} account delete failed for event ${eventId}:`, message);
      await supabase.from('event_calendar_syncs').update({ status: 'failed', last_error: message, last_synced_at: new Date().toISOString() }).eq('id', row.id);
      results.push({ accountRole: role, status: 'failed', error: message });
    }
  }

  try {
    await supabase.from('events').update({ google_calendar_event_id: null, calendar_sync_status: null, calendar_sync_error: null }).eq('id', eventId);
  } catch {
    // Event row may already be gone if the caller deletes it right after — harmless.
  }

  return results;
}
