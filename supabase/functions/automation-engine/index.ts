// Ports base44/functions/automationEngine/entry.ts (1144 lines) — the largest and most
// business-critical function in the app. Ports the six automation-type handlers,
// the Asia/Jerusalem-aware next_run_at scheduling math, and the three top-level
// dispatch modes (sync_schedule / single automation_id / scheduler), faithfully.
//
// Two substantive deviations from the original, both intentional:
//
// 1. WhatsApp sending: every `sendWhatsApp()` call now goes through Green API
//    (supabase/functions/_shared/whatsapp.ts) instead of MAKE_WEBHOOK_URL — per the
//    explicit user decision to eliminate Make.com entirely.
//
// 2. Multi-tenancy: Base44 was single-tenant, so its scheduler mode (no automation_id
//    in the request) just queried "all automations". This app is multi-tenant, so:
//      - Authenticated calls (dashboard "run now" / dry-run / sync_schedule buttons,
//        which always carry the user's Authorization header) resolve the caller's own
//        tenant_id and operate on that tenant only.
//      - Unauthenticated calls (meant to be triggered by a pg_cron job — not yet
//        configured, see deployment notes) must present a shared secret via the
//        `x-cron-secret` header (env: AUTOMATION_ENGINE_CRON_SECRET) and then loop
//        over every tenant, running only that tenant's due automations with a
//        service-role client explicitly filtered by tenant_id (RLS is bypassed on
//        purpose here since there's no single logged-in user to scope to).
//
// Also fixed one latent bug found while porting: runQuestionnaireReminder's original
// "already filled" guard checked `lead.questionnaireCompleted || lead.questionnaireFilled`
// and a `lead.questionnaire_reminder_sent_at` throttle — neither field exists anywhere
// in base44/entities/Lead.jsonc, so both checks were permanently no-ops (dead code).
// This port uses the real completion signal (`production_form_filled_at`, the same
// field runQuestionnaireSend already treats as the source of truth) and a real
// `questionnaire_reminder_sent_at` column (added in migration 0004) that
// approve-pending-automation now actually sets after a successful send.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createServiceRoleClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { sendWhatsApp as sendWhatsAppGreenApi } from '../_shared/whatsapp.ts';

const ROLE_LABELS: Record<string, string> = {
  photographer1: 'צלם ראשי',
  photographer2: 'צלם משני',
  videographer: 'צלם וידאו',
  videographer2: 'צלם וידאו 2',
  editor: 'עורך',
};

function getTargetMonth(mode: string) {
  const now = new Date();
  const d = mode === 'current_month' ? now : new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthHebrew(yyyyMM: string) {
  const [y, m] = yyyyMM.split('-');
  const months = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  return `${months[parseInt(m) - 1]} ${y}`;
}

function renderTemplate(template: string, vars: Record<string, unknown>) {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    const token = '{' + key + '}';
    result = result.split(token).join(String(value ?? ''));
  }
  return result;
}

function getJerusalemOffsetMinutes(utcDate: Date) {
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

function israelDateTimeToUTC(targetDateStr: string, h: number, min: number) {
  const [year, month, day] = targetDateStr.split('-').map(Number);
  const roughUTC = new Date(Date.UTC(year, month - 1, day, h, min, 0));
  const offsetMinutes = getJerusalemOffsetMinutes(roughUTC);
  const correctedUTC = new Date(roughUTC.getTime() - offsetMinutes * 60000);
  const offsetMinutes2 = getJerusalemOffsetMinutes(correctedUTC);
  return new Date(roughUTC.getTime() - offsetMinutes2 * 60000);
}

function getNextIsraelDailyDate(nowUTC: Date, h: number, min: number) {
  const ilParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(nowUTC);

  const todayRunUTC = israelDateTimeToUTC(ilParts, h, min);
  if (todayRunUTC > nowUTC) return ilParts;

  const [y, m, d] = ilParts.split('-').map(Number);
  const tomorrowUTC = new Date(Date.UTC(y, m - 1, d + 1));
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(tomorrowUTC);
}

function calculateNextRun(automation: any): string | null {
  const now = new Date();
  const [h, min] = (automation.run_time || '09:00').split(':').map(Number);

  if (automation.frequency === 'daily') {
    const targetDateStr = getNextIsraelDailyDate(now, h, min);
    return israelDateTimeToUTC(targetDateStr, h, min).toISOString();
  }

  if (automation.frequency === 'monthly_1st') {
    const runDay = automation.run_day || 1;
    const ilToday = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jerusalem',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now);
    const [iy, im] = ilToday.split('-').map(Number);
    const nextMonthDate = new Date(Date.UTC(iy, im, 1));
    const nextMonthStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jerusalem',
      year: 'numeric', month: '2-digit',
    }).format(nextMonthDate);
    const targetDateStr = `${nextMonthStr}-${String(runDay).padStart(2, '0')}`;
    return israelDateTimeToUTC(targetDateStr, h, min).toISOString();
  }

  return null;
}

function formatDateIL(isoDate: string | null | undefined) {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return isoDate;
  return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`;
}

// Throws on failure so callers can keep the original try/catch-per-recipient control flow.
async function sendWhatsApp(supabase: any, tenantId: string, phone: string, message: string) {
  const result = await sendWhatsAppGreenApi(supabase, phone, message, tenantId);
  if (!result.success) throw new Error(result.error || 'שליחת WhatsApp נכשלה');
}

// ─────────────────────────────────────────────────────────────────────────
// Automation type handlers
// ─────────────────────────────────────────────────────────────────────────

async function runMonthlyStaffSummary(supabase: any, tenantId: string, automation: any, runId: string, opts: any = {}) {
  const { testPhone, dryRun, selectedStaffIds } = opts;

  const targetMonth = getTargetMonth(automation.target_month_mode || 'next_month');
  const formattedMonth = formatMonthHebrew(targetMonth);

  const [{ data: allStaff }, { data: allEvents }] = await Promise.all([
    supabase.from('staff_members').select('*').eq('tenant_id', tenantId),
    supabase.from('events').select('*').eq('tenant_id', tenantId),
  ]);

  const monthEvents = (allEvents || []).filter((e: any) => e.date?.startsWith(targetMonth));

  const DEFAULT_TEMPLATE = `היי {staff_name} 👋\nהנה סיכום האירועים שלך לחודש {target_month}:\n\n{monthly_events_summary}\n\nבהצלחה! 🎉`;
  const template = automation.message_template || DEFAULT_TEMPLATE;

  let sent = 0, failed = 0, skipped = 0;
  const logs: any[] = [];
  const sentPhones = new Set<string>();

  for (const member of allStaff || []) {
    if (Array.isArray(automation.selected_staff_ids) && automation.selected_staff_ids.length > 0 && !automation.selected_staff_ids.includes(member.id)) {
      skipped++;
      continue;
    }
    // Runtime checkbox selection from the preview modal — only applied when the
    // caller actually passed a selection (e.g. confirming a manual send). The
    // scheduler and the initial dry-run preview never pass this, so nothing changes for them.
    if (Array.isArray(selectedStaffIds) && selectedStaffIds.length > 0 && !selectedStaffIds.includes(member.id)) {
      skipped++;
      continue;
    }

    const memberEvents = monthEvents.filter((e: any) => Array.isArray(e.team) && e.team.some((t: any) => t.staffMemberName === member.name));
    if (memberEvents.length === 0) {
      skipped++;
      continue;
    }

    const eventsSummary = memberEvents
      .sort((a: any, b: any) => (a.date || '').localeCompare(b.date || ''))
      .map((e: any) => {
        const role = e.team.find((t: any) => t.staffMemberName === member.name)?.role || '';
        const roleLabel = ROLE_LABELS[role] || role;
        const venue = e.venue || 'לא צוין';
        const [yyyy, mm, dd] = (e.date || '').split('-');
        const shortDate = e.date ? `${parseInt(dd)}/${parseInt(mm)}/${String(yyyy).slice(2)}` : '';
        return `📅 ${shortDate} | ${e.couple_names} | ${venue} | ${roleLabel}`;
      })
      .join('\n');

    const finalMessage = renderTemplate(template, {
      staff_name: member.name,
      staffName: member.name,
      target_month: formattedMonth,
      month: formattedMonth,
      monthly_events_summary: eventsSummary,
      eventsList: eventsSummary,
      eventCount: String(memberEvents.length),
      totalDays: String(memberEvents.length),
    });

    const phone = testPhone || member.phone_number;
    const contact = phone || member.email || '';

    const logEntry = {
      automation_run_id: runId,
      automation_id: automation.id,
      automation_name: automation.name,
      recipient_name: member.name,
      recipient_contact: contact,
      channel: automation.channel || 'whatsapp',
      message_content: finalMessage,
    };

    if (phone && sentPhones.has(phone)) {
      await supabase.from('automation_message_logs').insert({ ...logEntry, status: 'skipped', error: 'כפילות — אותו טלפון כבר קיבל הודעה בריצה זו' });
      skipped++;
      logs.push({ name: member.name, status: 'skipped', reason: 'dup_phone' });
      continue;
    }

    if (dryRun) {
      logs.push({ name: member.name, phone, finalMessage, eventsCount: memberEvents.length, status: 'preview' });
      continue;
    }

    const isValidPhone = phone && phone.trim().length > 3 && phone.trim() !== '0';
    if (!isValidPhone) {
      await supabase.from('automation_message_logs').insert({ ...logEntry, status: 'skipped', error: `טלפון לא תקין: "${phone}"` });
      skipped++;
      logs.push({ name: member.name, status: 'skipped', reason: 'invalid_phone', phone });
      continue;
    }

    try {
      if ((automation.channel || 'whatsapp') === 'whatsapp') {
        await sendWhatsApp(supabase, tenantId, phone.trim(), finalMessage);
        sentPhones.add(phone);
      }
      await supabase.from('automation_message_logs').insert({ ...logEntry, status: 'sent', sent_at: new Date().toISOString() });
      sent++;
      logs.push({ name: member.name, phone, status: 'sent' });
    } catch (err) {
      await supabase.from('automation_message_logs').insert({ ...logEntry, status: 'failed', error: err.message });
      failed++;
      logs.push({ name: member.name, phone, status: 'failed', error: err.message });
    }
  }

  return { sent, failed, skipped, logs };
}

async function runDailyEventBrief(supabase: any, tenantId: string, automation: any, runId: string, opts: any = {}) {
  const { testPhone, dryRun, selectedStaffIds } = opts;

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  const [{ data: allStaff }, { data: allEvents }] = await Promise.all([
    supabase.from('staff_members').select('*').eq('tenant_id', tenantId),
    supabase.from('events').select('*').eq('tenant_id', tenantId).order('date', { ascending: false }),
  ]);

  const tomorrowEvents = (allEvents || []).filter((ev: any) => ev.date && ev.date.startsWith(tomorrowStr));

  const DEFAULT_TEMPLATE = `שלום {staff_name}, להלן האירועים שלך למחר ({tomorrow_date}):\n\n{daily_events_summary}\n\nבהצלחה!`;
  const template = automation.message_template || DEFAULT_TEMPLATE;

  let sent = 0, failed = 0, skipped = 0;
  const logs: any[] = [];
  const sentPhones = new Set<string>();

  for (const member of allStaff || []) {
    if (member.role === 'editor') { skipped++; continue; }

    if (Array.isArray(selectedStaffIds) && selectedStaffIds.length > 0 && !selectedStaffIds.includes(member.id)) {
      skipped++;
      continue;
    }
    if (Array.isArray(automation.selected_staff_ids) && automation.selected_staff_ids.length > 0 && automation.selected_staff_ids.includes(member.id)) {
      skipped++;
      continue;
    }

    const phone = testPhone || member.phone_number || '';
    if (!phone || phone.trim().length <= 3) { skipped++; continue; }

    const memberEvents = tomorrowEvents.filter((ev: any) => Array.isArray(ev.team) && ev.team.some((t: any) => t.staffMemberName === member.name));
    if (memberEvents.length === 0) { skipped++; continue; }

    const eventsSummary = memberEvents.map((ev: any) => `${ev.couple_names || ''} | ${ev.venue || ''} | ${ev.date || ''}`).join('\n');

    const firstEvent = memberEvents[0];
    const firstTeam = firstEvent?.team || [];

    let lead: any = null;
    const leadRef = firstEvent?.source_lead_id || firstEvent?.lead_id;
    if (leadRef) {
      const { data } = await supabase.from('leads').select('*').eq('id', leadRef).maybeSingle();
      lead = data || null;
    }
    if (!lead && firstEvent?.couple_names) {
      const { data } = await supabase.from('leads').select('*').eq('tenant_id', tenantId).eq('couple_names', firstEvent.couple_names).limit(1);
      lead = data?.[0] || null;
    }
    if (!lead && firstEvent?.date) {
      const { data } = await supabase.from('leads').select('*').eq('tenant_id', tenantId).eq('event_date', firstEvent.date).limit(1);
      lead = data?.[0] || null;
    }

    const staffNameWithPhone = (name: string | undefined) => {
      if (!name) return '';
      const s = (allStaff || []).find((m: any) => m.name === name);
      return s?.phone_number ? `${name} - ${s.phone_number}` : name;
    };
    const photographer = staffNameWithPhone(firstTeam.find((t: any) => t.role === 'photographer1')?.staffMemberName || firstTeam.find((t: any) => t.role === 'photographer2')?.staffMemberName || '');
    const photographer2name = firstTeam.find((t: any) => t.role === 'photographer2')?.staffMemberName;
    const photographer2 = photographer2name ? `\n• ${staffNameWithPhone(photographer2name)}` : '';
    const videographer = staffNameWithPhone(firstTeam.find((t: any) => t.role === 'videographer')?.staffMemberName || firstTeam.find((t: any) => t.role === 'videographer2')?.staffMemberName || '');

    let computedProductionBrief = lead?.final_technical_summary || lead?.production_brief || '';
    if (!computedProductionBrief && lead) {
      const parts = [];
      if (lead.production_bride_phone) parts.push(`📱 נייד כלה: ${lead.production_bride_phone}`);
      if (lead.production_groom_phone) parts.push(`📱 נייד חתן: ${lead.production_groom_phone}`);
      if (lead.production_bride_prep_location) parts.push(`📍 התארגנות כלה: ${lead.production_bride_prep_location}`);
      if (lead.production_instagram) parts.push(`📸 אינסטגרם: ${lead.production_instagram}`);
      if (lead.production_special_requests) parts.push(`💬 בקשות מיוחדות: ${lead.production_special_requests}`);
      computedProductionBrief = parts.join('\n');
    }

    const [ty, tm, td] = tomorrowStr.split('-');
    const formattedDate = `${parseInt(td)}/${parseInt(tm)}/${ty.slice(2)}`;

    const finalMessage = renderTemplate(template, {
      staff_name: member.name,
      staffName: member.name,
      tomorrow_date: formattedDate,
      date: formattedDate,
      daily_events_summary: eventsSummary,
      events_count: String(memberEvents.length),
      coupleNames: firstEvent?.couple_names || '',
      venue: firstEvent?.venue || '',
      photographer,
      photographer2,
      videographer,
      bridePhone: lead?.production_bride_phone || '',
      groomPhone: lead?.production_groom_phone || '',
      bridePrepLocation: lead?.production_bride_prep_location || '',
      instagram: lead?.production_instagram || '',
      specialRequests: lead?.production_special_requests || '',
      phoneNumber: firstEvent?.phone_number || '',
      productionBrief: computedProductionBrief,
      finalTechnicalSummary: lead?.final_technical_summary || '',
    });

    const logEntry = {
      automation_run_id: runId,
      automation_id: automation.id,
      automation_name: automation.name,
      recipient_name: member.name,
      recipient_contact: phone,
      channel: automation.channel || 'whatsapp',
      message_content: finalMessage,
    };

    if (sentPhones.has(phone)) {
      await supabase.from('automation_message_logs').insert({ ...logEntry, status: 'skipped', error: 'כפילות טלפון' });
      skipped++;
      logs.push({ name: member.name, status: 'skipped', reason: 'dup_phone' });
      continue;
    }

    if (dryRun) {
      logs.push({ staffId: member.id, name: member.name, phone, finalMessage, eventsCount: memberEvents.length, status: 'preview' });
      continue;
    }

    try {
      await sendWhatsApp(supabase, tenantId, phone.trim(), finalMessage);
      sentPhones.add(phone);
      await supabase.from('automation_message_logs').insert({ ...logEntry, status: 'sent', sent_at: new Date().toISOString() });
      sent++;
      logs.push({ staffId: member.id, name: member.name, phone, status: 'sent' });
    } catch (err) {
      await supabase.from('automation_message_logs').insert({ ...logEntry, status: 'failed', error: err.message });
      failed++;
      logs.push({ staffId: member.id, name: member.name, phone, status: 'failed', error: err.message });
    }
  }

  return { sent, failed, skipped, logs };
}

async function runQuestionnaireReminder(supabase: any, tenantId: string, automation: any, runId: string, opts: any = {}) {
  const { testPhone, dryRun, selectedStaffIds } = opts;

  const now = new Date();
  const targetStart = new Date(now);
  targetStart.setDate(targetStart.getDate() + 1);
  const targetEnd = new Date(now);
  targetEnd.setDate(targetEnd.getDate() + 35);
  const targetStartStr = targetStart.toISOString().split('T')[0];
  const targetEndStr = targetEnd.toISOString().split('T')[0];

  const { data: allLeads } = await supabase.from('leads').select('*').eq('tenant_id', tenantId);

  const eligible = (allLeads || []).filter((lead: any) => {
    const eventDate = lead.event_date || '';
    if (!eventDate || eventDate < targetStartStr || eventDate > targetEndStr) return false;
    if (!lead.phone_number) return false;
    // Real completion signal (see file header note on the original's dead fields).
    if (lead.production_form_filled_at) return false;
    if (lead.questionnaire_reminder_sent_at) {
      const sentAt = new Date(lead.questionnaire_reminder_sent_at);
      const diffDays = (now.getTime() - sentAt.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays < 3) return false;
    }
    return true;
  });

  const DEFAULT_TEMPLATE = `שלום {coupleNames} 😊\nאנחנו מתרגשים לאירוע שלכם ב-{eventDate}!\nכדי שנוכל להיכנס בצורה הטובה ביקשנו למלא את השאלון המצורף:\n{questionnaireLink}\nתודה! 🙏\nAvira Studio`;
  const template = automation.message_template || DEFAULT_TEMPLATE;

  const pendingMessages = [];
  for (const lead of eligible) {
    const phone = testPhone || lead.phone_number;
    const questionnaireLink = `https://www.avira-studio.com/questionnaire/${lead.id}`;

    const finalMessage = renderTemplate(template, {
      coupleNames: lead.couple_names || '',
      eventDate: lead.event_date || '',
      venue: lead.venue_name || '',
      questionnaireLink,
    });

    pendingMessages.push({
      leadId: lead.id,
      coupleNames: lead.couple_names,
      phoneNumber: phone,
      messageText: finalMessage,
      eventDate: lead.event_date,
      venueName: lead.venue_name,
      questionnaireLink,
    });
  }

  if (dryRun) {
    const previews = pendingMessages.map((m) => ({ staffId: m.leadId, name: m.coupleNames, staffPhone: m.phoneNumber, message: m.messageText, eventDate: m.eventDate, eventCount: 1 }));
    return { sent: 0, failed: 0, skipped: 0, pending: 0, logs: pendingMessages, previews };
  }

  // Runtime checkbox selection from the preview modal (keyed by leadId, matching the
  // `staffId: m.leadId` mapping used to build the dry-run previews above). Only applied
  // when the caller actually passed a selection — the scheduler sends none, so it still
  // queues everyone eligible, same as before.
  const toQueue = Array.isArray(selectedStaffIds) && selectedStaffIds.length > 0
    ? pendingMessages.filter((m) => selectedStaffIds.includes(m.leadId))
    : pendingMessages;

  if (toQueue.length > 0) {
    await supabase.from('pending_automations').insert({
      tenant_id: tenantId,
      automation_type: 'questionnaire_reminder',
      automation_name: 'תזכורת שאלון',
      status: 'pending',
      messages: toQueue,
      total_count: toQueue.length,
    });
  }

  return { sent: 0, failed: 0, skipped: 0, pending: toQueue.length, logs: toQueue };
}

async function runPaymentReminder(supabase: any, tenantId: string, automation: any, runId: string, opts: any = {}) {
  const { testPhone, dryRun, selectedStaffIds } = opts;

  // NOTE: the original Base44 `Automation` entity had no `triggerDays` field either
  // (confirmed against base44/entities/Automation.jsonc — only `event_automations`,
  // a separate table for the per-event custom-automation feature, has `trigger_days`).
  // So `automation.trigger_days` was always undefined in the original too; this constant
  // reproduces that behavior explicitly instead of reading a non-existent column.
  const triggerDays = 1;
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() - triggerDays);
  const targetDateStr = targetDate.toISOString().split('T')[0];

  const { data: allEvents } = await supabase.from('events').select('*').eq('tenant_id', tenantId);
  const eligible = (allEvents || []).filter((event: any) => {
    if (!event.date || event.date !== targetDateStr) return false;
    if (event.client_payment_status === 'Paid') return false;
    if (!event.phone_number) return false;
    return true;
  });

  const DEFAULT_TEMPLATE = `שלום {coupleNames} 😊\nתודה שבחרתם בנו לצלם את האירוע המיוחד שלכם!\nלפי הרשומות שלנו, נותר לכם לשלם: {remainingBalance}₪\nנשמח לסגור את התשלום בהקדם 🙏\nAvira Studio`;
  const template = automation.message_template || DEFAULT_TEMPLATE;

  const pendingMessages = [];
  for (const event of eligible) {
    const phone = (testPhone || event.phone_number).replace(/[^0-9]/g, '');

    // remaining_balance lives on Lead, not Event, in this schema — look it up via the link.
    let remainingBalance: number | string = '';
    const leadRef = event.source_lead_id || event.lead_id;
    if (leadRef) {
      const { data: lead } = await supabase.from('leads').select('remaining_balance').eq('id', leadRef).maybeSingle();
      remainingBalance = lead?.remaining_balance ?? '';
    }

    const finalMessage = renderTemplate(template, {
      coupleNames: event.couple_names || '',
      remainingBalance,
      eventDate: event.date || '',
      venueName: event.venue || '',
    });

    pendingMessages.push({
      eventId: event.id,
      coupleNames: event.couple_names,
      phoneNumber: phone,
      messageText: finalMessage,
      eventDate: event.date,
      venueName: event.venue,
      remainingBalance,
    });
  }

  if (dryRun) {
    const previews = pendingMessages.map((m) => ({ staffId: m.eventId, name: m.coupleNames, staffPhone: m.phoneNumber, message: m.messageText, eventDate: m.eventDate, eventCount: 1 }));
    return { sent: 0, failed: 0, skipped: 0, pending: 0, logs: pendingMessages, previews };
  }

  // Runtime checkbox selection from the preview modal (keyed by eventId, matching the
  // `staffId: m.eventId` mapping used to build the dry-run previews above). Only applied
  // when the caller actually passed a selection — the scheduler sends none, so it still
  // queues everyone eligible, same as before.
  const toQueue = Array.isArray(selectedStaffIds) && selectedStaffIds.length > 0
    ? pendingMessages.filter((m) => selectedStaffIds.includes(m.eventId))
    : pendingMessages;

  if (toQueue.length > 0) {
    await supabase.from('pending_automations').insert({
      tenant_id: tenantId,
      automation_type: 'payment_reminder',
      automation_name: automation.name || 'תזכורת תשלום לאחר אירוע',
      status: 'pending',
      messages: toQueue,
      total_count: toQueue.length,
    });
  }

  return { sent: 0, failed: 0, skipped: 0, pending: toQueue.length, logs: toQueue };
}

async function runAlbumReminder(supabase: any, tenantId: string, automation: any, runId: string, opts: any = {}) {
  const { testPhone, dryRun, selectedEventIds } = opts;

  const { data: allEvents } = await supabase.from('events').select('*').eq('tenant_id', tenantId).order('date', { ascending: false });

  const now = new Date();
  const eligible = (allEvents || []).filter((event: any) => {
    if (!event.date || new Date(event.date) >= now) return false;
    if (event.album_status === 'sent') return false;
    if (!event.phone_number) return false;
    return true;
  });

  const DEFAULT_TEMPLATE = `היי {coupleNames} 👋\nעבר חודש מהאירוע המדהים שלכם! 📸\nרציתי להזכיר שיש אפשרות להזמין סט 3 אלבומים 📚\nAvira Studio`;
  const template = automation.message_template || DEFAULT_TEMPLATE;

  const pendingMessages = [];
  for (const event of eligible) {
    const phone = (testPhone || event.phone_number).replace(/[^0-9]/g, '');
    const daysSinceEvent = Math.floor((now.getTime() - new Date(event.date).getTime()) / (1000 * 60 * 60 * 24));

    const finalMessage = renderTemplate(template, {
      coupleNames: event.couple_names || '',
      eventDate: event.date || '',
      venueName: event.venue || '',
    });

    pendingMessages.push({
      eventId: event.id,
      coupleNames: event.couple_names,
      phoneNumber: phone,
      messageText: finalMessage,
      eventDate: event.date,
      venueName: event.venue,
      daysSinceEvent,
      albumStatus: event.album_status,
      album_reminder_sent: event.album_reminder_sent || false,
      album_reminder_sent_at: event.album_reminder_sent_at || null,
    });
  }

  if (dryRun) {
    const previews = pendingMessages.map((m) => ({
      eventId: m.eventId, staffId: m.eventId, name: m.coupleNames, staffPhone: m.phoneNumber, message: m.messageText,
      eventDate: m.eventDate, venueName: m.venueName, daysSinceEvent: m.daysSinceEvent, albumStatus: m.albumStatus,
      album_reminder_sent: m.album_reminder_sent, album_reminder_sent_at: m.album_reminder_sent_at,
    }));
    return { sent: 0, failed: 0, skipped: 0, pending: 0, logs: pendingMessages, previews };
  }

  const toSend = selectedEventIds ? pendingMessages.filter((m) => selectedEventIds.includes(m.eventId)) : [];

  let sent = 0, failed = 0;
  for (const item of toSend) {
    if (!item.phoneNumber) { failed++; continue; }
    try {
      await sendWhatsApp(supabase, tenantId, item.phoneNumber.trim(), item.messageText);
      await supabase.from('events').update({ album_reminder_sent: true, album_reminder_sent_at: new Date().toISOString() }).eq('id', item.eventId);
      sent++;
    } catch {
      failed++;
    }
  }

  return { sent, failed, skipped: 0, logs: toSend };
}

async function runQuestionnaireSend(supabase: any, tenantId: string, automation: any, runId: string, opts: any = {}) {
  const { testPhone, dryRun, targetYYYYMM: targetYYYYMMOverride, selectedEventIds } = opts;

  let targetYYYYMM = targetYYYYMMOverride;
  if (!targetYYYYMM) {
    const monthsAhead = automation.months_ahead || 1;
    const now = new Date();
    const targetDate = new Date(now.getFullYear(), now.getMonth() + monthsAhead, 1);
    targetYYYYMM = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
  }

  const { data: allEvents } = await supabase.from('events').select('*').eq('tenant_id', tenantId).order('date', { ascending: false });
  const targetEvents = (allEvents || []).filter((ev: any) => ev.date && ev.date.startsWith(targetYYYYMM));

  const { data: allLeads } = await supabase.from('leads').select('*').eq('tenant_id', tenantId);
  const leadsById: Record<string, any> = {};
  for (const lead of allLeads || []) leadsById[lead.id] = lead;

  const DEFAULT_TEMPLATE = `היי {coupleNames}, ההתרגשות בשיאה! 🥂\nלקראת האירוע שלכם, אנחנו רוצים לוודא שכל הפרטים מסונכרנים אצלנו במערכת. 📋\nנשמח אם תוכלו למלא את השאלון הקצר בקישור הבא כדי שנוכל לתת לכם את השירות הטוב ביותר ❤️\n{questionnaireUrl}\nתודה! אווירה צלמים 📸`;
  const rawTemplate = automation.message_template || DEFAULT_TEMPLATE;
  const template = rawTemplate
    .replace(/\$couple_names/g, '{coupleNames}')
    .replace(/\$questionnaire_link/g, '{questionnaireUrl}')
    .replace(/\$questionnaire_url/g, '{questionnaireUrl}')
    .replace(/\$event_date/g, '{date}')
    .replace(/\$venue/g, '{venue}');

  const groups: { readyToSend: any[]; sentNoReply: any[]; completed: any[] } = { readyToSend: [], sentNoReply: [], completed: [] };
  let sent = 0, skipped = 0;

  for (const event of targetEvents) {
    const phone = testPhone || event.phone_number || '';

    const validLeadId = event.source_lead_id || event.lead_id;
    if (!validLeadId) continue;

    const questionnaireUrl = `https://www.avira-studio.com/questionnaire/${validLeadId}`;
    const formattedDate = formatDateIL(event.date);

    const finalMessage = renderTemplate(template, {
      coupleNames: event.couple_names || '',
      venue: event.venue || '',
      date: formattedDate,
      questionnaireUrl,
    });

    const linkedLeadId = event.lead_id || event.source_lead_id || null;
    const linkedLead = linkedLeadId ? leadsById[linkedLeadId] : null;

    const isCompleted = !!linkedLead?.production_form_filled_at;
    const isSent = !!event.questionnaire_sent_at;

    const baseItem = {
      eventId: event.id,
      staffId: event.id,
      name: event.couple_names || '',
      staffPhone: phone,
      message: finalMessage,
      eventDate: event.date,
      venue: event.venue || '',
      questionnaireSentAt: event.questionnaire_sent_at || null,
      productionFormFilledAt: linkedLead?.production_form_filled_at || null,
      hasLinkedLead: !!linkedLead,
    };

    if (isCompleted) groups.completed.push({ ...baseItem, group: 'completed' });
    else if (isSent) groups.sentNoReply.push({ ...baseItem, group: 'sentNoReply' });
    else groups.readyToSend.push({ ...baseItem, group: 'readyToSend' });
  }

  if (dryRun) return { status: 'preview', groups };

  const toSend = selectedEventIds
    ? [...groups.readyToSend, ...groups.sentNoReply].filter((e) => selectedEventIds.includes(e.eventId))
    : groups.readyToSend;

  for (const item of toSend) {
    if (!item.staffPhone) { skipped++; continue; }
    try {
      await sendWhatsApp(supabase, tenantId, item.staffPhone.trim(), item.message);
      await supabase.from('events').update({ questionnaire_sent_at: new Date().toISOString() }).eq('id', item.eventId);
      sent++;
    } catch {
      // matches original: swallow and move on, no failed counter for this handler
    }
  }

  return { sent, skipped };
}

// ─────────────────────────────────────────────────────────────────────────
// Orchestration
// ─────────────────────────────────────────────────────────────────────────

async function executeAutomation(supabase: any, tenantId: string, automation: any, opts: any = {}) {
  const { triggeredBy, testPhone, dryRun, selectedStaffIds, targetYYYYMM, selectedEventIds } = opts;

  let runId = 'dryrun';
  if (!dryRun) {
    const { data: run } = await supabase
      .from('automation_runs')
      .insert({
        tenant_id: tenantId,
        automation_id: automation.id,
        automation_name: automation.name,
        started_at: new Date().toISOString(),
        status: 'running',
        triggered_by: triggeredBy || 'scheduler',
      })
      .select()
      .single();
    runId = run.id;
  }

  try {
    let result: any = { sent: 0, failed: 0, skipped: 0, logs: [] };

    if (automation.type === 'monthly_staff_summary') result = await runMonthlyStaffSummary(supabase, tenantId, automation, runId, { testPhone, dryRun, selectedStaffIds });
    if (automation.type === 'daily_event_brief') result = await runDailyEventBrief(supabase, tenantId, automation, runId, { testPhone, dryRun, selectedStaffIds });
    if (automation.type === 'questionnaire_reminder') result = await runQuestionnaireReminder(supabase, tenantId, automation, runId, { testPhone, dryRun, selectedStaffIds });
    if (automation.type === 'payment_reminder') result = await runPaymentReminder(supabase, tenantId, automation, runId, { testPhone, dryRun, selectedStaffIds });
    if (automation.type === 'album_reminder') result = await runAlbumReminder(supabase, tenantId, automation, runId, { testPhone, dryRun, selectedEventIds });
    if (automation.type === 'questionnaire_send') result = await runQuestionnaireSend(supabase, tenantId, automation, runId, { testPhone, dryRun, targetYYYYMM, selectedEventIds });

    if (!dryRun) {
      const nextRunAt = calculateNextRun(automation);
      await Promise.all([
        supabase.from('automation_runs').update({
          completed_at: new Date().toISOString(),
          status: 'completed',
          messages_sent: result.sent || 0,
          messages_failed: result.failed || 0,
        }).eq('id', runId),
        supabase.from('automations').update({
          last_run_at: new Date().toISOString(),
          next_run_at: nextRunAt,
          last_run_results: { sent: result.sent || 0, failed: result.failed || 0, skipped: result.skipped || 0 },
        }).eq('id', automation.id),
      ]);
    }

    if (dryRun) {
      if (automation.type === 'questionnaire_send') {
        return { automation_id: automation.id, name: automation.name, status: 'preview_grouped', groups: result.groups };
      }
      let previews;
      if (result.previews) {
        previews = result.previews;
      } else {
        previews = (result.logs || []).map((l: any) => ({
          staffId: l.staffId, name: l.name, staffName: l.name, staffPhone: l.phone, message: l.finalMessage, eventCount: l.eventsCount ?? 0,
        }));
      }
      return { automation_id: automation.id, name: automation.name, status: 'preview', previews };
    }
    return { automation_id: automation.id, name: automation.name, status: 'completed', ...result };
  } catch (error) {
    if (!dryRun && runId !== 'dryrun') {
      await supabase.from('automation_runs').update({
        completed_at: new Date().toISOString(),
        status: 'error',
        error_message: error.message,
      }).eq('id', runId);
    }
    throw error;
  }
}

const SCHEDULER_ELIGIBLE_TYPES = ['monthly_staff_summary', 'daily_event_brief', 'payment_reminder', 'questionnaire_reminder', 'questionnaire_send'];

// Runs the full request body's intent (sync_schedule / automation_id / scheduler-select)
// against a single tenant. Shared by both the authenticated single-tenant path and the
// cron multi-tenant loop.
async function handleForTenant(supabase: any, tenantId: string, body: any) {
  const { automation_id, triggered_by, test_phone, dry_run, sync_schedule } = body;

  if (sync_schedule && automation_id) {
    const { data: automation } = await supabase.from('automations').select('*').eq('id', automation_id).eq('tenant_id', tenantId).maybeSingle();
    if (!automation) return { success: false, error: 'אוטומציה לא נמצאה', status: 404 };
    if (!automation.is_active) return { success: false, error: 'אוטומציה לא פעילה', status: 400 };
    if (automation.frequency === 'manual') return { success: false, error: 'אוטומציה ידנית — אין תזמון', status: 400 };

    const newNextRunAt = calculateNextRun(automation);
    if (!newNextRunAt) return { success: false, error: 'לא ניתן לחשב תזמון', status: 400 };

    await supabase.from('automations').update({ next_run_at: newNextRunAt }).eq('id', automation_id);

    const israelTime = new Date(newNextRunAt).toLocaleString('he-IL', {
      timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false, day: '2-digit', month: '2-digit', year: '2-digit',
    });
    return { success: true, next_run_at: newNextRunAt, israel_time: israelTime };
  }

  let automationsToRun: any[] = [];

  if (automation_id) {
    const { data } = await supabase.from('automations').select('*').eq('id', automation_id).eq('tenant_id', tenantId);
    automationsToRun = data || [];
  } else {
    const { data: all } = await supabase.from('automations').select('*').eq('tenant_id', tenantId);
    const now = new Date().toISOString();
    automationsToRun = (all || [])
      .filter((a: any) => a.is_active && SCHEDULER_ELIGIBLE_TYPES.includes(a.type))
      .filter((a: any) => !a.next_run_at || a.next_run_at <= now);
  }

  if (automationsToRun.length === 0) {
    return { success: true, ran: 0, results: [], warning: 'לא נמצאו אוטומציות להרצה' };
  }

  const results = [];
  for (const automation of automationsToRun) {
    const result = await executeAutomation(supabase, tenantId, automation, {
      triggeredBy: triggered_by || (automation_id ? 'manual' : 'scheduler'),
      testPhone: test_phone || null,
      dryRun: !!dry_run,
      selectedStaffIds: body.selectedStaffIds || null,
      targetYYYYMM: body.targetYYYYMM || null,
      selectedEventIds: body.selectedEventIds || null,
    });
    results.push(result);
  }

  return { success: true, ran: results.length, results };
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const body = await req.json().catch(() => ({}));
    const supabase = createServiceRoleClient();

    const user = await getRequestUser(req);

    if (user) {
      // Authenticated dashboard call — single tenant, resolved from the caller's own profile.
      const { data: profile } = await supabase.from('profiles').select('tenant_id').eq('id', user.id).maybeSingle();
      if (!profile) return jsonResponse({ error: 'Profile not found for user' }, { status: 403 });

      const result = await handleForTenant(supabase, profile.tenant_id, body);
      const status = result.status || (result.success === false ? 400 : 200);
      return jsonResponse(result, { status });
    }

    // No user — must be a cron trigger. Require a shared secret; there is no other way
    // to authenticate a request that isn't tied to a logged-in studio user.
    const cronSecret = Deno.env.get('AUTOMATION_ENGINE_CRON_SECRET');
    const providedSecret = req.headers.get('x-cron-secret');
    if (!cronSecret || !providedSecret || providedSecret !== cronSecret) {
      return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: tenants } = await supabase.from('tenants').select('id');
    const perTenantResults = [];
    for (const t of tenants || []) {
      const result = await handleForTenant(supabase, t.id, body);
      perTenantResults.push({ tenant_id: t.id, ...result });
    }

    return jsonResponse({ success: true, tenants: perTenantResults.length, results: perTenantResults });
  } catch (error) {
    console.error(`[automationEngine] שגיאה קריטית: ${error.message}`);
    return jsonResponse({ success: false, error: error.message }, { status: 500 });
  }
});
