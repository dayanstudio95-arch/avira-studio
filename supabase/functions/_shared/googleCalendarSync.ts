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
import { fetchWithRetry } from './retry.ts';

interface CalendarPayload {
  summary: string;
  description: string;
  colorId: string;
  start: { date: string };
  end: { date: string };
  attendees?: Array<{ email: string }>;
  // AUTO-05: every event we write carries our own event id, so a create that crashed
  // half-way can be found again instead of being created twice.
  extendedProperties?: { private: Record<string, string> };
}

// ── Create-lock (AUTO-01 / AUTO-05, audit 2026-10-05) ─────────────────────────────────
// Before creating a Google event we put `creating_<ms>` in event_calendar_syncs.google_event_id
// so a second sync running at the same moment does not create it again. Two bugs:
//   * a failed create left the marker there forever → every later sync skipped the event,
//     silently: the wedding never reached the calendar;
//   * the lock was taken with a plain upsert, so two simultaneous syncs could both "take" it.
// Now the lock is taken atomically, released on failure, a lock older than
// CREATE_LOCK_STALE_MS (a crashed run) is taken over, and every create first looks in the
// calendar for an event already tagged with our id.
export const CREATE_LOCK_PREFIX = 'creating_';
export const CREATE_LOCK_STALE_MS = 10 * 60 * 1000;

export function isCreateLock(googleEventId: string | null | undefined): boolean {
  return !!googleEventId && googleEventId.startsWith(CREATE_LOCK_PREFIX);
}

export function isStaleCreateLock(googleEventId: string | null | undefined, now: number = Date.now()): boolean {
  if (!isCreateLock(googleEventId)) return false;
  const at = Number(googleEventId!.slice(CREATE_LOCK_PREFIX.length));
  return !Number.isFinite(at) || at <= 0 || now - at > CREATE_LOCK_STALE_MS;
}

export async function buildEventPayload(supabase: any, event: any, accountRole: AccountRole = 'primary'): Promise<CalendarPayload> {
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

  // Backup account only: full financial/package details, absent from the
  // primary account's description on purpose — the backup exists purely as a
  // disaster-recovery duplicate, so it carries the extra business info that's
  // useful if the main system or the primary Google Calendar is ever lost,
  // while the primary calendar (used operationally, shared via invites)
  // stays exactly as it was.
  let backupDetails = '';
  if (accountRole === 'backup') {
    const priceLine =
      event.total_amount_gross != null
        ? `💰 סכום סגירה: ₪${Number(event.total_amount_gross).toLocaleString('he-IL')}`
        : null;
    let packageName: string | null = null;
    if (event.package_id) {
      try {
        const { data: pkg } = await supabase.from('packages').select('name').eq('id', event.package_id).maybeSingle();
        packageName = pkg?.name || null;
      } catch (e) {
        console.log('[googleCalendarSync] Could not load package name:', e.message);
      }
    }
    const packageLine = packageName ? `📦 חבילה: ${packageName}` : null;
    const backupLines = [priceLine, packageLine].filter(Boolean) as string[];
    if (backupLines.length > 0) {
      backupDetails = '\n\n--- 💼 פרטי סגירה (גיבוי בלבד) ---\n' + backupLines.join('\n');
    }
  }

  const description =
    'פרטי אירוע - Avira Media\n\n' +
    `👰 שמות הזוג: ${event.couple_names}\n` +
    `📅 תאריך: ${new Date(event.date).toLocaleDateString('he-IL')}\n` +
    `🏰 אולם: ${event.venue || '—'}\n` +
    `📞 טלפון: ${event.phone_number || '—'}\n\n` +
    `👥 צוות הצילום:\n${teamDetails || 'טרם הוקצה'}` +
    (teamComplete ? '\n✅ צוות מלא' : '') +
    leadDetails +
    backupDetails +
    notesSection;

  // Attendees (→ Google calendar invites) are only ever added for the
  // primary account. The backup account is a pure disaster-recovery
  // duplicate — it must never notify/invite staff, even when the same crew
  // is listed in the description above (per explicit product decision).
  let attendees: Array<{ email: string }> = [];
  if (accountRole !== 'backup') {
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
  }

  const startDate = new Date(event.date).toISOString().split('T')[0];
  const endDate = new Date(new Date(event.date).getTime() + 86400000).toISOString().split('T')[0];

  const payload: CalendarPayload = {
    summary: `📸 ${event.couple_names}`,
    description,
    colorId,
    start: { date: startDate },
    end: { date: endDate },
    extendedProperties: { private: { aviraEventId: String(event.id) } },
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
  // Deliberately never ask Google to email attendees on create/update.
  // Previously this was '?sendUpdates=all' whenever the event had ≥1
  // attendee — but syncEventToAllAccounts (via pushEventToAccount) is what
  // the calendar_sync_webhook_trigger fires on EVERY change to couple_names,
  // date, venue, phone_number, team, required_crew, OR notes (see
  // 0017_calendar_sync_trigger.sql) — so any unrelated edit (e.g. changing
  // venue or notes) was re-emailing "event updated" to every already-
  // assigned crew member, not just when a new person actually joined the
  // team. Product decision: staff already get a real assignment email
  // implicitly (they're added as an attendee so the event still lands on
  // their own Google Calendar if it's linked) — Google's own extra
  // notification email on top of that was pure noise/spam, so it's turned
  // off entirely rather than trying to selectively target only new
  // attendees (Google's API has no such per-guest option on a single PATCH).
  const sendUpdates = '';
  const body = JSON.stringify(payload);

  const hasRealExistingId = existingGoogleEventId && !isCreateLock(existingGoogleEventId);

  if (hasRealExistingId) {
    const res = await fetchWithRetry(`${baseUrl}/${existingGoogleEventId}${sendUpdates}`, { method: 'PATCH', headers, body });
    if (res.status === 404 || res.status === 410) {
      console.log(`[googleCalendarSync] Calendar event ${existingGoogleEventId} not found — clearing to recreate next sync`);
      return { action: 'cleared_missing_id', googleEventId: null };
    }
    if (!res.ok) throw new Error(`PATCH failed: ${res.status} ${await res.text()}`);
    return { action: 'updated', googleEventId: existingGoogleEventId };
  }

  // Create is NOT retried on a 5xx/network error (AUTO-05): Google may have created it
  // already, and a blind retry makes a duplicate. The lock is released instead, and the next
  // sync finds the event by its tag (findTaggedEvent) before creating anything.
  const res = await fetchWithRetry(`${baseUrl}${sendUpdates}`, { method: 'POST', headers, body }, { retryUnsafe: false });
  if (!res.ok) throw new Error(`POST failed: ${res.status} ${await res.text()}`);
  const created = await res.json();
  return { action: 'created', googleEventId: created.id };
}

// AUTO-05: the Google event we already created for this AVIRA event, if any (tagged by
// buildEventPayload). Used when taking over a stale create-lock.
async function findTaggedEvent(accessToken: string, calendarId: string, eventId: string): Promise<string | null> {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events` +
    `?privateExtendedProperty=${encodeURIComponent(`aviraEventId=${eventId}`)}&maxResults=1&showDeleted=false`;
  const res = await fetchWithRetry(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`lookup failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data?.items?.[0]?.id ?? null;
}

export async function deleteEventFromAccount(accessToken: string, calendarId: string, googleEventId: string | null): Promise<void> {
  if (!googleEventId || isCreateLock(googleEventId)) return;
  const res = await fetchWithRetry(
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

  const results: AccountSyncResult[] = [];

  for (const account of connectedAccounts) {
    const role = account.account_role as AccountRole;
    let heldLock: string | null = null; // AUTO-01: released if this run fails
    try {
      // Built per-account (not once and reused) so the backup account can
      // get its own payload variant — extra financial/package details, no
      // attendees — independently of what's sent to primary.
      const payload = await buildEventPayload(supabase, event, role);
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
      let idToPush: string | null = existingGoogleEventId;

      if (isCreateLock(existingGoogleEventId) && !isStaleCreateLock(existingGoogleEventId)) {
        results.push({ accountRole: role, status: 'skipped', error: 'create in progress (lock marker)' });
        continue;
      }

      // Take the create-lock atomically (see CREATE_LOCK_* above). Whoever loses the race
      // skips; the winner creates.
      if (!existingGoogleEventId || isCreateLock(existingGoogleEventId)) {
        const lockMarker = `${CREATE_LOCK_PREFIX}${Date.now()}`;
        const lockRow = {
          google_event_id: lockMarker,
          status: 'pending',
          last_error: null,
          last_synced_at: new Date().toISOString(),
        };
        let took = false;
        if (!existingSync) {
          const { error: insErr } = await supabase.from('event_calendar_syncs').insert({
            tenant_id: tenantId, event_id: eventId, account_id: token.accountId, account_role: role, ...lockRow,
          });
          if (insErr && insErr.code !== '23505') throw new Error(`lock insert: ${insErr.message}`);
          took = !insErr;
        } else {
          let q = supabase.from('event_calendar_syncs').update(lockRow).eq('id', existingSync.id);
          q = existingGoogleEventId ? q.eq('google_event_id', existingGoogleEventId) : q.is('google_event_id', null);
          const { data: upd, error: updErr } = await q.select('id');
          if (updErr) throw new Error(`lock update: ${updErr.message}`);
          took = !!upd && upd.length > 0;
        }
        if (!took) {
          results.push({ accountRole: role, status: 'skipped', error: 'create in progress (lock taken by another sync)' });
          continue;
        }
        heldLock = lockMarker;
        if (role === 'primary') await mirrorPrimaryOntoLegacyColumns(supabase, eventId, 'pending', lockMarker, null);
        // Before creating, look in the calendar for an event already tagged with this id: an
        // earlier run may have died mid-create, or a create may have succeeded on Google's
        // side while we saw an error. Found → update it instead of creating a second one.
        // (One GET per new event — creates are rare.)
        idToPush = await findTaggedEvent(token.accessToken, token.calendarId, eventId);
      }

      const pushResult = await pushEventToAccount(token.accessToken, token.calendarId, payload, idToPush);

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
          // AUTO-01: release our create-lock so the next sync (the 20-minute reconcile)
          // tries again, instead of skipping this event forever.
          ...(heldLock ? { google_event_id: null } : {}),
        },
        { onConflict: 'event_id,account_id' },
      );
      if (role === 'primary') await mirrorPrimaryOntoLegacyColumns(supabase, eventId, 'failed', heldLock ? null : undefined, message);
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
