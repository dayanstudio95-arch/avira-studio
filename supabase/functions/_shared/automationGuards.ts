// Shared automation send-guards, used by both automation-engine/index.ts (the 5
// direct-send handlers) and approve-pending-automation/index.ts (the actual send
// point for the 2 queue-then-approve types, questionnaire_reminder/payment_reminder)
// so both send paths enforce the exact same rules and can never drift apart.
//
// Two guards live here:
//   1. Quiet Hours -- a tenant-level do-not-disturb window (migration
//      0037_settings_upgrade_2.sql: tenants.quiet_hours_enabled/_start/_end),
//      editable live via the new QuietHoursCard Settings UI. Blocks all 7
//      automation types per the user's explicit decision.
//   2. Cross-run same-day duplicate protection -- complements (does not replace)
//      each handler's existing per-invocation `sentPhones` Set, which only catches
//      duplicates *within* one run. This catches a human manually re-running the
//      same automation for the same recipient twice in one day.
//
// Jerusalem wall-clock math below is intentionally duplicated from
// automation-engine/index.ts's own getJerusalemOffsetMinutes/israelDateTimeToUTC
// rather than imported, matching this codebase's existing "kept in sync manually"
// convention for small, stable, self-contained logic (see e.g. the leadDetails
// field-list duplication note in googleCalendarSync.ts / automation-engine's daily
// brief handler).

function getJerusalemOffsetMinutes(utcDate: Date): number {
  const toIntlParts = (tz: string) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
      hour12: false,
    }).formatToParts(utcDate).reduce((acc: Record<string, string>, p) => { acc[p.type] = p.value; return acc; }, {});

  const il = toIntlParts('Asia/Jerusalem');
  const utc = toIntlParts('UTC');

  const ilMs = Date.UTC(+il.year, +il.month - 1, +il.day, +il.hour % 24, +il.minute, +il.second);
  const utcMs = Date.UTC(+utc.year, +utc.month - 1, +utc.day, +utc.hour % 24, +utc.minute, +utc.second);
  return Math.round((ilMs - utcMs) / 60000);
}

// The automation's saved "בחירת אנשי צוות" (automations.selected_staff_ids): empty = all
// staff, otherwise ONLY the ticked people receive it — that is what the settings screen
// shows (AutomationsDashboard: "כל הצוות" / "N נבחרו"). AUTO-03 (audit 2026-10-05): the
// daily brief had this inverted and sent to everyone EXCEPT the ticked people.
export function isStaffSelectedForAutomation(automation: { selected_staff_ids?: unknown } | null | undefined, staffId: string): boolean {
  const ids = automation?.selected_staff_ids;
  if (!Array.isArray(ids) || ids.length === 0) return true;
  return ids.includes(staffId);
}

export function israelDateTimeToUTC(targetDateStr: string, h: number, min: number): Date {
  const [year, month, day] = targetDateStr.split('-').map(Number);
  const roughUTC = new Date(Date.UTC(year, month - 1, day, h, min, 0));
  const offsetMinutes = getJerusalemOffsetMinutes(roughUTC);
  const correctedUTC = new Date(roughUTC.getTime() - offsetMinutes * 60000);
  const offsetMinutes2 = getJerusalemOffsetMinutes(correctedUTC);
  return new Date(roughUTC.getTime() - offsetMinutes2 * 60000);
}

export function getJerusalemNowHHMM(): { hh: number; mm: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date()).reduce((acc: Record<string, string>, p) => { acc[p.type] = p.value; return acc; }, {});
  return { hh: parseInt(parts.hour, 10) % 24, mm: parseInt(parts.minute, 10) };
}

export function getJerusalemTodayDateStr(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function parseHHMM(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

export interface QuietHoursSettings {
  quiet_hours_enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
}

// Loads once per automation run (not once per recipient) -- callers pass the
// resulting object into isInQuietHoursNow() for every recipient in their loop.
export async function loadQuietHoursSettings(supabase: any, tenantId: string): Promise<QuietHoursSettings> {
  const { data } = await supabase
    .from('tenants')
    .select('quiet_hours_enabled, quiet_hours_start, quiet_hours_end')
    .eq('id', tenantId)
    .maybeSingle();
  return {
    quiet_hours_enabled: !!data?.quiet_hours_enabled,
    quiet_hours_start: data?.quiet_hours_start ?? null,
    quiet_hours_end: data?.quiet_hours_end ?? null,
  };
}

// Asia/Jerusalem wall-clock check, handling the overnight-wrap case (e.g. a
// 22:00 -> 08:00 window that spans midnight). Fails open (never blocks a send)
// if quiet hours are enabled but the window itself isn't validly configured yet.
export function isInQuietHoursNow(settings: QuietHoursSettings): boolean {
  if (!settings.quiet_hours_enabled) return false;
  const startMin = parseHHMM(settings.quiet_hours_start);
  const endMin = parseHHMM(settings.quiet_hours_end);
  if (startMin === null || endMin === null || startMin === endMin) return false;

  const { hh, mm } = getJerusalemNowHHMM();
  const nowMin = hh * 60 + mm;

  if (startMin < endMin) return nowMin >= startMin && nowMin < endMin;
  return nowMin >= startMin || nowMin < endMin; // overnight wrap
}

// When does the current (or next) quiet-hours window END, as a UTC instant?
//
// Added 2026-09-15 for the WhatsApp bot's deferred sends: a message the bot would have
// sent at 23:30 is held and sent at this moment instead of being dropped. Returns null
// when quiet hours are off or misconfigured (in which case nothing should be deferred
// in the first place — isInQuietHoursNow is false for the same inputs).
//
// `now` is injectable so the two boundary cases are testable: the end is later today,
// or it has already passed and the next one is tomorrow. Jerusalem wall clock, same
// as everything else in this file.
export function nextQuietHoursEnd(settings: QuietHoursSettings, now: Date = new Date()): Date | null {
  if (!settings.quiet_hours_enabled) return null;
  const startMin = parseHHMM(settings.quiet_hours_start);
  const endMin = parseHHMM(settings.quiet_hours_end);
  if (startMin === null || endMin === null || startMin === endMin) return null;

  const todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const endToday = israelDateTimeToUTC(todayStr, Math.floor(endMin / 60), endMin % 60);
  if (endToday.getTime() > now.getTime()) return endToday;

  // Already past today's end: the next window ends tomorrow at the same wall time.
  const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
  const tomorrowStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(tomorrow);
  return israelDateTimeToUTC(tomorrowStr, Math.floor(endMin / 60), endMin % 60);
}

// Cross-run duplicate protection: has this automation already sent successfully
// to this exact contact today (Israel calendar day)? Complements, does not
// replace, each handler's existing in-run `sentPhones` Set.
export async function wasAlreadySentToday(supabase: any, automationId: string | null | undefined, recipientContact: string | null | undefined): Promise<boolean> {
  if (!automationId || !recipientContact) return false;
  const todayStr = getJerusalemTodayDateStr();
  const dayStartUTC = israelDateTimeToUTC(todayStr, 0, 0);
  const { data } = await supabase
    .from('automation_message_logs')
    .select('id')
    .eq('automation_id', automationId)
    .eq('recipient_contact', recipientContact)
    .eq('status', 'sent')
    .gte('created_at', dayStartUTC.toISOString())
    .limit(1);
  return !!(data && data.length > 0);
}

// Same question as wasAlreadySentToday, answered with WHEN (ISO) or null. For the manual
// run's preview (2026-10-01): the owner saw "18 to send", confirmed, and 11 were
// silently skipped as already-sent — by that morning's scheduled run, which had gone
// out for the wrong month. The preview now says who already got a message today and at
// what time, so the choice to send again is his and is made with the facts on screen.
export async function sentTodayAt(supabase: any, automationId: string | null | undefined, recipientContact: string | null | undefined): Promise<string | null> {
  if (!automationId || !recipientContact) return null;
  const todayStr = getJerusalemTodayDateStr();
  const dayStartUTC = israelDateTimeToUTC(todayStr, 0, 0);
  const { data } = await supabase
    .from('automation_message_logs')
    .select('created_at')
    .eq('automation_id', automationId)
    .eq('recipient_contact', recipientContact)
    .eq('status', 'sent')
    .gte('created_at', dayStartUTC.toISOString())
    .order('created_at', { ascending: false })
    .limit(1);
  return data && data.length > 0 ? data[0].created_at : null;
}

// AUTO-19 (audit 2026-10-05): a queued reminder (pending_automations) can wait days for
// approval. Re-check, at send time, the same conditions that put it in the queue —
// mirrors runQuestionnaireReminder / runPaymentReminder in automation-engine. Returns the
// Hebrew skip reason, or null when the message is still due.
export function staleReasonFromRows(
  automationType: string,
  row: Record<string, any> | null,
  now: Date = new Date(),
): string | null {
  if (automationType === 'questionnaire_reminder') {
    if (!row) return 'הליד כבר לא קיים';
    if (row.production_form_filled_at) return 'השאלון כבר מולא';
    if (row.questionnaire_reminder_sent_at &&
        now.getTime() - new Date(row.questionnaire_reminder_sent_at).getTime() < 3 * 24 * 60 * 60 * 1000) {
      return 'כבר נשלחה תזכורת בימים האחרונים';
    }
    if (row.event_date && row.event_date < now.toISOString().split('T')[0]) return 'האירוע כבר עבר';
    return null;
  }
  if (automationType === 'payment_reminder') {
    if (!row) return 'האירוע כבר לא קיים';
    if (row.client_payment_status === 'Paid') return 'כבר שולם';
    return null;
  }
  return null;
}

export async function staleReasonForQueuedMessage(
  supabase: any,
  automationType: string,
  msg: { leadId?: string; eventId?: string },
): Promise<string | null> {
  if (automationType === 'questionnaire_reminder' && msg.leadId) {
    const { data } = await supabase.from('leads')
      .select('id, production_form_filled_at, questionnaire_reminder_sent_at, event_date')
      .eq('id', msg.leadId).maybeSingle();
    return staleReasonFromRows(automationType, data);
  }
  if (automationType === 'payment_reminder' && msg.eventId) {
    const { data } = await supabase.from('events')
      .select('id, client_payment_status')
      .eq('id', msg.eventId).maybeSingle();
    return staleReasonFromRows(automationType, data);
  }
  return null;
}

// R1ב (Daniel, 2026-10-06): a staff broadcast with no real text is never sent. The
// "הודעה מותאמת אישית לצוות" automation is created with a placeholder ("כתבו כאן הודעה
// חופשית…") as its saved template; a run that falls back to it must send nothing.
export function isPlaceholderTemplate(text: string | null | undefined): boolean {
  const t = String(text ?? '').trim();
  return !t || t.startsWith('כתבו כאן');
}
