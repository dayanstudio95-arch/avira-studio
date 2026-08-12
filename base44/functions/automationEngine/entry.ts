import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';
const MAKE_WEBHOOK_URL_ENV = Deno.env.get("MAKE_WEBHOOK_URL");

const ROLE_LABELS = {
  photographer1: 'צלם ראשי', photographer2: 'צלם משני',
  videographer: 'צלם וידאו', videographer2: 'צלם וידאו 2', editor: 'עורך'
};

function getTargetMonth(mode) {
  const now = new Date();
  const d = mode === 'current_month'
    ? now
    : new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthHebrew(yyyyMM) {
  const [y, m] = yyyyMM.split('-');
  const months = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
  return `${months[parseInt(m) - 1]} ${y}`;
}

// Renders template by replacing {varName} with actual values
function renderTemplate(template, vars) {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    const token = '{' + key + '}';
    result = result.split(token).join(String(value ?? ''));
  }
  return result;
}

/**
 * Returns the UTC offset in minutes for Asia/Jerusalem at a given UTC timestamp.
 * Uses Intl.DateTimeFormat — handles DST (UTC+2 winter, UTC+3 summer) automatically.
 */
function getJerusalemOffsetMinutes(utcDate) {
  // Format the date in Jerusalem time and in UTC, then diff
  const toIntlParts = (tz) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
      hour12: false,
    }).formatToParts(utcDate).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});

  const il = toIntlParts('Asia/Jerusalem');
  const utc = toIntlParts('UTC');

  const ilMs = Date.UTC(+il.year, +il.month - 1, +il.day, +il.hour % 24, +il.minute, +il.second);
  const utcMs = Date.UTC(+utc.year, +utc.month - 1, +utc.day, +utc.hour % 24, +utc.minute, +utc.second);
  return Math.round((ilMs - utcMs) / 60000); // positive = ahead of UTC
}

/**
 * Build a UTC Date that represents "YYYY-MM-DD HH:MM in Asia/Jerusalem".
 * targetDateStr = 'YYYY-MM-DD' (already in Israel calendar date),
 * h / min = hour/minute in Israel local time.
 */
function israelDateTimeToUTC(targetDateStr, h, min) {
  // Start with a rough UTC estimate: treat the Israel wall-clock time as UTC
  const [year, month, day] = targetDateStr.split('-').map(Number);
  const roughUTC = new Date(Date.UTC(year, month - 1, day, h, min, 0));

  // Get the real Jerusalem offset at that rough time and correct
  const offsetMinutes = getJerusalemOffsetMinutes(roughUTC);
  const correctedUTC = new Date(roughUTC.getTime() - offsetMinutes * 60000);

  // Re-check offset at corrected time (handles edge cases at DST boundary)
  const offsetMinutes2 = getJerusalemOffsetMinutes(correctedUTC);
  return new Date(roughUTC.getTime() - offsetMinutes2 * 60000);
}

/**
 * Get the "next" calendar date in Israel (YYYY-MM-DD) that is strictly after now,
 * at the given run_time (Israel local). Used for daily automations.
 */
function getNextIsraelDailyDate(nowUTC, h, min) {
  // What is today's date in Israel?
  const ilParts = new Intl.DateTimeFormat('en-CA', { // en-CA gives YYYY-MM-DD
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(nowUTC); // e.g. "2026-04-17"

  // Would the run-time today (in Israel) still be in the future?
  const todayRunUTC = israelDateTimeToUTC(ilParts, h, min);
  if (todayRunUTC > nowUTC) return ilParts;

  // Otherwise, tomorrow in Israel
  const [y, m, d] = ilParts.split('-').map(Number);
  const tomorrowUTC = new Date(Date.UTC(y, m - 1, d + 1)); // safe overflow handled by JS
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(tomorrowUTC);
}

function calculateNextRun(automation) {
  const now = new Date();
  const [h, min] = (automation.run_time || '09:00').split(':').map(Number);

  if (automation.frequency === 'daily') {
    const targetDateStr = getNextIsraelDailyDate(now, h, min);
    return israelDateTimeToUTC(targetDateStr, h, min).toISOString();
  }

  if (automation.frequency === 'monthly_1st') {
    const runDay = automation.run_day || 1;
    // Target = next month, runDay, in Israel calendar
    const ilToday = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jerusalem',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now);
    const [iy, im] = ilToday.split('-').map(Number);
    // Next month in Israel
    const nextMonthDate = new Date(Date.UTC(iy, im, 1)); // im = next month index (0-based im is current, so im = next)
    const nextMonthStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jerusalem',
      year: 'numeric', month: '2-digit',
    }).format(nextMonthDate);
    const targetDateStr = `${nextMonthStr}-${String(runDay).padStart(2, '0')}`;
    return israelDateTimeToUTC(targetDateStr, h, min).toISOString();
  }

  return null;
}

async function getMakeWebhookUrl(base44) {
  // Priority: 1) Environment variable, 2) AppSetting, 3) null
  if (MAKE_WEBHOOK_URL_ENV) {
    console.log(`[getMakeWebhookUrl] Using MAKE_WEBHOOK_URL from environment`);
    return MAKE_WEBHOOK_URL_ENV;
  }
  
  const rows = await base44.asServiceRole.entities.AppSetting.filter({ key: 'make_webhook_url' });
  if (rows.length > 0 && rows[0].value) {
    console.log(`[getMakeWebhookUrl] Using make_webhook_url from AppSetting`);
    return rows[0].value;
  }
  
  console.log(`[getMakeWebhookUrl] ❌ No webhook URL found in env or AppSetting!`);
  return null;
}

async function sendWhatsApp(phone, message, webhookUrl, actionType = 'monthly_staff_summary') {
  console.log(`\n\n========== CRITICAL DEBUG START =========`);
  console.log(`[sendWhatsApp] FUNCTION CALLED`);
  console.log(`[sendWhatsApp] phone = "${phone}"`);
  console.log(`[sendWhatsApp] message length = ${message?.length || 0}`);
  console.log(`[sendWhatsApp] webhookUrl = "${webhookUrl}"`);
  
  if (!webhookUrl) {
    console.log(`[sendWhatsApp] ❌ WEBHOOK URL IS EMPTY - THROWING ERROR`);
    throw new Error('Make Webhook URL לא מוגדר — עדכן בהגדרות Webhooks');
  }
  
  const formattedPhone = phone.replace(/\D/g, '');
  console.log(`[sendWhatsApp] phone sanitized: "${phone}" → "${formattedPhone}"`);

  const payload = { phone: formattedPhone, message, action_type: actionType };
  console.log(`[sendWhatsApp] PAYLOAD PREPARED:`, JSON.stringify(payload));
  console.log(`[sendWhatsApp] ABOUT TO CALL FETCH...`);
  
  try {
    console.log(`[sendWhatsApp] ====== SENDING REQUEST ======`);
    console.log(`WEBHOOK_URL: ${webhookUrl}`);
    console.log(`METHOD: POST`);
    console.log(`PAYLOAD: ${JSON.stringify(payload)}`);
    
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    console.log(`[sendWhatsApp] FETCH COMPLETED`);
    console.log(`[sendWhatsApp] RESPONSE_STATUS: ${res.status}`);
    
    const responseText = await res.text().catch(() => '(no response body)');
    console.log(`[sendWhatsApp] RESPONSE_BODY: ${responseText}`);
    
    if (!res.ok) {
      console.log(`[sendWhatsApp] ❌ RESPONSE NOT OK (${res.status})`);
      throw new Error(`Make webhook נכשל: ${res.status} — ${responseText}`);
    }
    console.log(`[sendWhatsApp] ✅ SUCCESS - נשלח בהצלחה ל: ${phone}`);
  } catch (err) {
    console.log(`[sendWhatsApp] ❌ CATCH ERROR: ${err.message}`);
    throw err;
  } finally {
    console.log(`========== CRITICAL DEBUG END =========\n\n`);
  }
}

async function runMonthlyStaffSummary(base44, automation, runId, opts = {}) {
  console.log(`\n\n🔴🔴🔴 START runMonthlyStaffSummary 🔴🔴🔴`);
  const { testPhone, dryRun } = opts;
  console.log(`[runMonthlyStaffSummary] dryRun = ${dryRun}`);
  console.log(`[runMonthlyStaffSummary] testPhone = ${testPhone}`);
  
  const webhookUrl = await getMakeWebhookUrl(base44);
  console.log(`[runMonthlyStaffSummary] webhookUrl retrieved = "${webhookUrl}"`);

  const targetMonth = getTargetMonth(automation.target_month_mode || 'next_month');
  const formattedMonth = formatMonthHebrew(targetMonth);
  console.log(`[runMonthlyStaffSummary] target_month = "${targetMonth}" (${formattedMonth})`);

  const [allStaff, allEvents] = await Promise.all([
    base44.asServiceRole.entities.StaffMember.list(),
    base44.asServiceRole.entities.Event.list()
  ]);

  console.log(`[runMonthlyStaffSummary] סה"כ אנשי צוות: ${allStaff.length}`);
  console.log(`[runMonthlyStaffSummary] סה"כ אירועים בDB: ${allEvents.length}`);

  const monthEvents = allEvents.filter(e => e.date?.startsWith(targetMonth));
  console.log(`[runMonthlyStaffSummary] אירועים בחודש ${targetMonth}: ${monthEvents.length}`);
  monthEvents.forEach(e => console.log(`  - ${e.date} | ${e.coupleNames} | צוות: ${JSON.stringify(e.team?.map(t => t.staffMemberName))}`));

  const DEFAULT_TEMPLATE = `היי {staff_name} 👋\nהנה סיכום האירועים שלך לחודש {target_month}:\n\n{monthly_events_summary}\n\nבהצלחה! 🎉`;
  const template = automation.messageTemplate || DEFAULT_TEMPLATE;
  console.log(`[runMonthlyStaffSummary] template = "${template.substring(0, 100)}..."`);

  let sent = 0, failed = 0, skipped = 0;
  const logs = [];
  const sentPhones = new Set();

  for (const member of allStaff) {
    if (Array.isArray(automation.selectedStaffIds) && automation.selectedStaffIds.length > 0 && !automation.selectedStaffIds.includes(member.id)) {
      console.log('[member] ' + member.name + ' - skipped (not in selectedStaffIds)');
      skipped++;
      continue;
    }
    console.log(`\n[LOOP] === PROCESSING MEMBER: ${member.name} ===`);
    const memberEvents = monthEvents.filter(e =>
      Array.isArray(e.team) && e.team.some(t => t.staffMemberName === member.name)
    );

    console.log(`[member] ${member.name} — אירועים: ${memberEvents.length}, טלפון: ${member.phoneNumber || 'אין'}`);

    // אם אין אירועים — דלג, אל תשלח
    if (memberEvents.length === 0) {
      console.log(`[member] ${member.name} — מדולג (אין אירועים)`);
      skipped++;
      continue;
    }

    // בנה רשימת אירועים
    const eventsSummary = memberEvents
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      .map(e => {
        const role = e.team.find(t => t.staffMemberName === member.name)?.role || '';
        const roleLabel = ROLE_LABELS[role] || role;
        const venue = e.venue || e.venueName || 'לא צוין';
        const [yyyy, mm, dd] = (e.date || '').split('-');
        const shortDate = e.date ? `${parseInt(dd)}/${parseInt(mm)}/${String(yyyy).slice(2)}` : '';
        return `📅 ${shortDate} | ${e.coupleNames} | ${venue} | ${roleLabel}`;
      })
      .join('\n');

    // ===== DEBUG המשתנים לפני הרינדור =====
    console.log(`\n===== DEBUG RENDER for ${member.name} =====`);
    console.log(`staff_name = "${member.name}"`);
    console.log(`target_month = "${formattedMonth}"`);
    console.log(`monthly_events_summary = "${eventsSummary}"`);

    // רנדר את ההודעה הסופית
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

    console.log(`rendered_message_text = "${finalMessage}"`);
    console.log(`===========================================\n`);

    console.log(`[member] ${member.name} — will be sent`);
    console.log(`[DEBUG] member object keys:`, Object.keys(member));
    console.log(`[DEBUG] member.phoneNumber = "${member.phoneNumber}"`);
    console.log(`[DEBUG] member.whatsapp_id = "${member.whatsapp_id}"`);
    console.log(`[DEBUG] testPhone = "${testPhone}"`);
    
    const phone = testPhone || member.phoneNumber || member.whatsapp_id;
    console.log(`[CRITICAL] phone = "${phone}"`);
    console.log(`[CRITICAL] phone === undefined? ${phone === undefined}`);
    console.log(`[CRITICAL] phone === null? ${phone === null}`);
    console.log(`[CRITICAL] phone === ""? ${phone === ""}`);
    console.log(`[CRITICAL] !!phone? ${!!phone}`);
    console.log(`[CRITICAL] dryRun = ${dryRun}`);
    
    const contact = phone || member.email || '';

    console.log(`[CRITICAL] finalMessage length = ${finalMessage?.length || 0}`);
    console.log(`[CRITICAL] finalMessage === undefined? ${finalMessage === undefined}`);
    console.log(`[CRITICAL] finalMessage === null? ${finalMessage === null}`);
    console.log(`[CRITICAL] !!finalMessage? ${!!finalMessage}`);
    
    const logEntry = {
      automation_run_id: runId,
      automation_id: automation.id,
      automation_name: automation.name,
      recipient_name: member.name,
      recipient_contact: contact,
      channel: automation.channel || 'whatsapp',
      message_content: finalMessage,
    };

    // Dedup
    if (phone && sentPhones.has(phone)) {
      console.log(`[dedup] ${member.name} — טלפון ${phone} כבר קיבל הודעה, מדלג`);
      await base44.asServiceRole.entities.AutomationMessageLog.create({
        ...logEntry, status: 'skipped', error: 'כפילות — אותו טלפון כבר קיבל הודעה בריצה זו'
      });
      skipped++;
      logs.push({ name: member.name, status: 'skipped', reason: 'dup_phone' });
      continue;
    }

    if (dryRun) {
      console.log(`[DRYRUN CHECK] dryRun = true — SKIPPING SEND`);
      logs.push({ name: member.name, phone, finalMessage, eventsCount: memberEvents.length, status: 'preview' });
      continue;
    }

    console.log(`[CRITICAL] dryRun = ${dryRun} — PROCEEDING WITH REAL SEND`);
    try {
      if ((automation.channel || 'whatsapp') === 'whatsapp') {
        console.log(`[CRITICAL] Channel is WhatsApp`);
        console.log(`[CRITICAL CHECK] !phone = ${!phone}, !finalMessage = ${!finalMessage}`);
        
        const isValidPhone = phone && phone.trim().length > 3 && phone.trim() !== '0';
        if (!isValidPhone) {
          console.log(`[CRITICAL] ❌ PHONE INVALID ("${phone}") - SKIPPING SEND`);
          console.log(`[member] ${member.name} — טלפון לא תקין, מדלג`);
          await base44.asServiceRole.entities.AutomationMessageLog.create({
            ...logEntry, status: 'skipped', error: `טלפון לא תקין: "${phone}"`
          });
          skipped++;
          logs.push({ name: member.name, status: 'skipped', reason: 'invalid_phone', phone });
          continue;
        }
        
        if (!finalMessage) {
          console.log(`[CRITICAL] ❌ MESSAGE IS FALSY - SKIPPING SEND`);
          console.log(`[CRITICAL] finalMessage value:`, finalMessage);
          await base44.asServiceRole.entities.AutomationMessageLog.create({
            ...logEntry, status: 'skipped', error: 'אין הודעה'
          });
          skipped++;
          logs.push({ name: member.name, status: 'skipped', reason: 'no_message' });
          continue;
        }
        
        // Triple-check before send
        const resolvedPhone = phone?.trim() || null;
        const resolvedMessage = finalMessage?.trim() || null;
        
        console.log(`[FINAL CHECK] resolvedPhone = "${resolvedPhone}"`);
        console.log(`[FINAL CHECK] resolvedPhone is truthy? ${!!resolvedPhone}`);
        console.log(`[FINAL CHECK] resolvedMessage length = ${resolvedMessage?.length || 0}`);
        console.log(`[FINAL CHECK] resolvedMessage is truthy? ${!!resolvedMessage}`);
        
        if (!resolvedPhone || !resolvedMessage) {
          console.log(`[CRITICAL] ❌ AFTER TRIM/RESOLVE - PHONE OR MESSAGE STILL FALSY`);
          console.log(`[CRITICAL] resolvedPhone = "${resolvedPhone}"`);
          console.log(`[CRITICAL] resolvedMessage first 100 chars = "${resolvedMessage?.substring(0, 100)}"`);
          skipped++;
          continue;
        }
        
        console.log(`[CRITICAL] ✅ BOTH phone AND message ARE VALID - CALLING sendWhatsApp`);
        console.log(`[CRITICAL] phone="${resolvedPhone}"`);
        console.log(`[CRITICAL] message length=${resolvedMessage.length}`);
        console.log(`[CRITICAL] webhook="${webhookUrl}"`);
        
        try {
          await sendWhatsApp(resolvedPhone, resolvedMessage, webhookUrl, 'monthly_staff_summary');
          console.log(`[CRITICAL] ✅ sendWhatsApp completed successfully`);
        } catch (sendErr) {
          console.log(`[CRITICAL] ❌ sendWhatsApp threw error:`, sendErr.message);
          throw sendErr;
        }
        sentPhones.add(phone);
      }
      await base44.asServiceRole.entities.AutomationMessageLog.create({
        ...logEntry, status: 'sent', sent_at: new Date().toISOString()
      });
      sent++;
      logs.push({ name: member.name, phone, status: 'sent' });
    } catch (err) {
      console.error(`[error] ${member.name}: ${err.message}`);
      await base44.asServiceRole.entities.AutomationMessageLog.create({
        ...logEntry, status: 'failed', error: err.message
      });
      failed++;
      logs.push({ name: member.name, phone, status: 'failed', error: err.message });
    }
  }

  console.log(`[runMonthlyStaffSummary] סיכום — נשלחו: ${sent}, נכשלו: ${failed}, דולגו: ${skipped}`);
  return { sent, failed, skipped, logs };
}

async function runDailyEventBrief(base44, automation, runId, opts = {}) {
  console.log(`\n\n🔵🔵🔵 START runDailyEventBrief 🔵🔵🔵`);
  const { testPhone, dryRun, selectedStaffIds } = opts;
  console.log(`[runDailyEventBrief] dryRun = ${dryRun}, testPhone = ${testPhone}, selectedStaffIds = ${JSON.stringify(selectedStaffIds)}`);

  const webhookUrl = await getMakeWebhookUrl(base44);
  console.log(`[runDailyEventBrief] webhookUrl = "${webhookUrl}"`);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  const [allStaff, allEvents] = await Promise.all([
    base44.asServiceRole.entities.StaffMember.list(),
    base44.asServiceRole.entities.Event.list('-date')
  ]);

  const tomorrowEvents = allEvents.filter(ev => ev.date && ev.date.startsWith(tomorrowStr));
  console.log(`[runDailyEventBrief] tomorrow=${tomorrowStr} events=${tomorrowEvents.length}`);

  const DEFAULT_TEMPLATE = `שלום {staff_name}, להלן האירועים שלך למחר ({tomorrow_date}):\n\n{daily_events_summary}\n\nבהצלחה!`;
  const template = automation.messageTemplate || DEFAULT_TEMPLATE;

  let sent = 0, failed = 0, skipped = 0;
  const logs = [];
  const sentPhones = new Set();

  for (let staffIdx = 0; staffIdx < allStaff.length; staffIdx++) {
    const member = allStaff[staffIdx];
    
    // Filter out editors — only send to photographers and videographers
    if (member.role === 'editor') {
      console.log(`[runDailyEventBrief] ${member.name} — דלג (עורך, לא רלוונטי)`);
      skipped++;
      continue;
    }
    
    // If selectedStaffIds provided (manual run with checkbox filters), skip if not in selection
    if (Array.isArray(selectedStaffIds) && selectedStaffIds.length > 0 && !selectedStaffIds.includes(member.id)) {
      console.log(`[runDailyEventBrief] ${member.name} — דלג (לא מסומן בבחירה ידנית)`);
      skipped++;
      continue;
    }

    // selectedStaffIds filter (automation setting)
    if (Array.isArray(automation.selectedStaffIds) && automation.selectedStaffIds.length > 0 && automation.selectedStaffIds.includes(member.id)) {
      skipped++;
      continue;
    }

    const phone = testPhone || member.phoneNumber || '';
    if (!phone || phone.trim().length <= 3) {
      skipped++;
      continue;
    }

    // Find this member's events tomorrow
    const memberEvents = tomorrowEvents.filter(ev =>
      Array.isArray(ev.team) && ev.team.some(t => t.staffMemberName === member.name)
    );

    if (memberEvents.length === 0) {
      skipped++;
      continue;
    }

    const eventsSummary = memberEvents
      .map(ev => `${ev.coupleNames || ''} | ${ev.venue || ''} | ${ev.date || ''}`)
      .join('\n');

    const firstEvent = memberEvents[0];
    const firstTeam = firstEvent?.team || [];
    let lead = null;
    if (firstEvent?.leadId) {
      lead = await base44.asServiceRole.entities.Lead.get(firstEvent.leadId);
    }
    if (!lead && firstEvent?.coupleNames) {
      const byName = await base44.asServiceRole.entities.Lead.filter({ coupleNames: firstEvent.coupleNames });
      lead = byName?.[0] || null;
    }
    if (!lead && firstEvent?.date) {
      const byDate = await base44.asServiceRole.entities.Lead.filter({ eventDate: firstEvent.date });
      lead = byDate?.[0] || null;
    }
    console.log(`[runDailyEventBrief] lead for ${firstEvent?.coupleNames}: ${lead ? lead.id : 'not found'}`);
    const staffNameWithPhone = (name) => {
      if (!name) return '';
      const s = allStaff.find(m => m.name === name);
      return s?.phoneNumber ? `${name} - ${s.phoneNumber}` : name;
    };
    const photographer = staffNameWithPhone(firstTeam.find(t => t.role === 'photographer1')?.staffMemberName || firstTeam.find(t => t.role === 'photographer2')?.staffMemberName || '');
    const photographer2name = firstTeam.find(t => t.role === 'photographer2')?.staffMemberName;
    const photographer2 = photographer2name ? `\n• ${staffNameWithPhone(photographer2name)}` : '';
    const videographer = staffNameWithPhone(firstTeam.find(t => t.role === 'videographer')?.staffMemberName || firstTeam.find(t => t.role === 'videographer2')?.staffMemberName || '');
    const productionDetails = firstEvent?.productionDetails || firstEvent?.description || '';
    const specialRequests = lead?.productionSpecialRequests || '';

    // אם productionBrief ריק, בנה אותו מהשדות הנפרדים
    let computedProductionBrief = lead?.finalTechnicalSummary || lead?.productionBrief || '';
    if (!computedProductionBrief && lead) {
      const parts = [];
      if (lead.productionBridePhone) parts.push(`📱 נייד כלה: ${lead.productionBridePhone}`);
      if (lead.productionGroomPhone) parts.push(`📱 נייד חתן: ${lead.productionGroomPhone}`);
      if (lead.productionBridePrepLocation) parts.push(`📍 התארגנות כלה: ${lead.productionBridePrepLocation}`);
      if (lead.productionInstagram) parts.push(`📸 אינסטגרם: ${lead.productionInstagram}`);
      if (lead.productionSpecialRequests) parts.push(`💬 בקשות מיוחדות: ${lead.productionSpecialRequests}`);
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
      coupleNames: firstEvent?.coupleNames || '',
      venue: firstEvent?.venue || '',
      time: firstEvent?.time || '',
      productionDetails,
      photographer,
      photographer2,
      videographer,
      bridePhone: lead?.productionBridePhone || '',
      groomPhone: lead?.productionGroomPhone || '',
      bridePrepLocation: lead?.productionBridePrepLocation || '',
      instagram: lead?.productionInstagram || '',
      specialRequests: lead?.productionSpecialRequests || '',
      phoneNumber: firstEvent?.phoneNumber || '',
      productionBrief: computedProductionBrief,
      finalTechnicalSummary: lead?.finalTechnicalSummary || '',
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
      await base44.asServiceRole.entities.AutomationMessageLog.create({ ...logEntry, status: 'skipped', error: 'כפילות טלפון' });
      skipped++;
      logs.push({ name: member.name, status: 'skipped', reason: 'dup_phone' });
      continue;
    }

    if (dryRun) {
      logs.push({ 
        staffId: member.id, 
        name: member.name, 
        phone, 
        finalMessage, 
        eventsCount: memberEvents.length, 
        status: 'preview' 
      });
      continue;
    }

    try {
      await sendWhatsApp(phone.trim(), finalMessage, webhookUrl, 'daily_event_brief');
      sentPhones.add(phone);
      await base44.asServiceRole.entities.AutomationMessageLog.create({ ...logEntry, status: 'sent', sent_at: new Date().toISOString() });
      sent++;
      logs.push({ staffId: member.id, name: member.name, phone, status: 'sent' });
      console.log(`[runDailyEventBrief] ✅ ${member.name} → ${phone}`);
    } catch (err) {
      console.error(`[runDailyEventBrief] ❌ ${member.name}: ${err.message}`);
      await base44.asServiceRole.entities.AutomationMessageLog.create({ ...logEntry, status: 'failed', error: err.message });
      failed++;
      logs.push({ staffId: member.id, name: member.name, phone, status: 'failed', error: err.message });
    }
  }

  console.log(`[runDailyEventBrief] סיכום — נשלחו: ${sent}, נכשלו: ${failed}, דולגו: ${skipped}`);
  return { sent, failed, skipped, logs };
}

async function runQuestionnaireReminder(base44, automation, runId, opts = {}) {
  console.log(`\n\n🟢🟢🟢 START runQuestionnaireReminder 🟢🟢🟢`);
  const { testPhone, dryRun } = opts;

  const webhookUrl = await getMakeWebhookUrl(base44);
  if (!webhookUrl) throw new Error('MAKE_WEBHOOK_URL not configured');

  // Check if event is ~1 month away
  const now = new Date();
  const targetStart = new Date(now);
  targetStart.setDate(targetStart.getDate() + 1);
  const targetEnd = new Date(now);
  targetEnd.setDate(targetEnd.getDate() + 35);
  const targetStartStr = targetStart.toISOString().split('T')[0];
  const targetEndStr = targetEnd.toISOString().split('T')[0];
  console.log(`[runQuestionnaireReminder] range: ${targetStartStr} – ${targetEndStr}`);

  const allLeads = await base44.asServiceRole.entities.Lead.list();

  const eligible = allLeads.filter(lead => {
    const eventDate = lead.eventDate || '';
    if (!eventDate || eventDate < targetStartStr || eventDate > targetEndStr) return false;
    if (!lead.phoneNumber) return false;
    // Check if questionnaire already filled
    if (lead.questionnaireCompleted || lead.questionnaireFilled) {
      console.log(`[questionnaireReminder] ${lead.coupleNames} — שאלון מולא, דולג`);
      return false;
    }
    // Follow-up throttle: skip if sent less than 3 days ago
    if (lead.questionnaire_reminder_sent_at) {
      const sentAt = new Date(lead.questionnaire_reminder_sent_at);
      const diffDays = (now - sentAt) / (1000 * 60 * 60 * 24);
      if (diffDays < 3) {
        console.log(`[questionnaireReminder] ${lead.coupleNames} — נשלח לפני ${diffDays.toFixed(1)} ימים, דולג`);
        return false;
      }
    }
    return true;
  });

  console.log(`[runQuestionnaireReminder] eligible leads: ${eligible.length}`);

  const DEFAULT_TEMPLATE = `שלום {coupleNames} 😊\nאנחנו מתרגשים לאירוע שלכם ב-{eventDate}!\nכדי שנוכל להיכנס בצורה הטובה ביקשנו למלא את השאלון המצורף:\n{questionnaireLink}\nתודה! 🙏\nAvira Studio`;
  const template = automation.messageTemplate || DEFAULT_TEMPLATE;

  const pendingMessages = [];

  for (const lead of eligible) {
    const phone = testPhone || lead.phoneNumber;
    const questionnaireLink = `https://www.avira-studio.com/questionnaire/${lead.id}`;

    const finalMessage = renderTemplate(template, {
      coupleNames: lead.coupleNames || '',
      eventDate: lead.eventDate || '',
      venue: lead.venueName || '',
      questionnaireLink,
    });

    pendingMessages.push({
      leadId: lead.id,
      coupleNames: lead.coupleNames,
      phoneNumber: phone,
      messageText: finalMessage,
      eventDate: lead.eventDate,
      venueName: lead.venueName,
      questionnaireLink,
    });
  }

  console.log(`[runQuestionnaireReminder] נאספו ${pendingMessages.length} הודעות לאישור`);

  if (dryRun) {
    const previews = pendingMessages.map(m => ({
      staffId: m.leadId,
      name: m.coupleNames,
      staffPhone: m.phoneNumber,
      message: m.messageText,
      eventDate: m.eventDate,
      eventCount: 1,
    }));
    return { sent: 0, failed: 0, skipped: 0, pending: 0, logs: pendingMessages, previews };
  }

  if (pendingMessages.length > 0) {
    await base44.asServiceRole.entities.PendingAutomation.create({
      automationType: 'questionnaire_reminder',
      automationName: 'תזכורת שאלון',
      status: 'pending',
      messages: JSON.stringify(pendingMessages),
      totalCount: pendingMessages.length,
    });
    console.log(`[runQuestionnaireReminder] נוצר PendingAutomation עם ${pendingMessages.length} הודעות`);
  }

  return { sent: 0, failed: 0, skipped: 0, pending: pendingMessages.length, logs: pendingMessages }
}

async function runPaymentReminder(base44, automation, runId, opts = {}) {
  console.log(`\n\n🟡🟡🟡 START runPaymentReminder 🟡🟡🟡`);
  const { testPhone, dryRun } = opts;

  const webhookUrl = await getMakeWebhookUrl(base44);
  if (!webhookUrl) throw new Error('MAKE_WEBHOOK_URL not configured');

  const triggerDays = automation.triggerDays || 1;
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() - triggerDays);
  const targetDateStr = targetDate.toISOString().split('T')[0];
  console.log(`[runPaymentReminder] targetDate=${targetDateStr} (triggerDays=${triggerDays})`);

  const allEvents = await base44.asServiceRole.entities.Event.list();
  const eligible = allEvents.filter(event => {
    if (!event.date || event.date !== targetDateStr) return false;
    if (event.clientPaymentStatus === 'Paid') return false;
    if (!event.phoneNumber) return false;
    return true;
  });

  console.log(`[runPaymentReminder] eligible events: ${eligible.length}`);

  const DEFAULT_TEMPLATE = `שלום {coupleNames} 😊\nתודה שבחרתם בנו לצלם את האירוע המיוחד שלכם!\nלפי הרשומות שלנו, נותר לכם לשלם: {remainingBalance}₪\nנשמח לסגור את התשלום בהקדם 🙏\nAvira Studio`;
  const template = automation.messageTemplate || DEFAULT_TEMPLATE;

  const pendingMessages = [];

  for (const event of eligible) {
    const phone = (testPhone || event.phoneNumber).replace(/[^0-9]/g, '');
    // Calculate remaining balance from the lead if available, or use a placeholder
    const remainingBalance = event.remainingBalance || '';
    const finalMessage = renderTemplate(template, {
      coupleNames: event.coupleNames || '',
      remainingBalance,
      eventDate: event.date || '',
      venueName: event.venue || '',
    });

    pendingMessages.push({
      eventId: event.id,
      coupleNames: event.coupleNames,
      phoneNumber: phone,
      messageText: finalMessage,
      eventDate: event.date,
      venueName: event.venue,
      remainingBalance,
    });
  }

  console.log(`[runPaymentReminder] נאספו ${pendingMessages.length} הודעות לאישור`);

  if (dryRun) {
    const previews = pendingMessages.map(m => ({
      staffId: m.eventId,
      name: m.coupleNames,
      staffPhone: m.phoneNumber,
      message: m.messageText,
      eventDate: m.eventDate,
      eventCount: 1,
    }));
    return { sent: 0, failed: 0, skipped: 0, pending: 0, logs: pendingMessages, previews };
  }

  if (pendingMessages.length > 0) {
    await base44.asServiceRole.entities.PendingAutomation.create({
      automationType: 'payment_reminder',
      automationName: automation.name || 'תזכורת תשלום לאחר אירוע',
      status: 'pending',
      messages: JSON.stringify(pendingMessages),
      totalCount: pendingMessages.length,
    });
    console.log(`[runPaymentReminder] נוצר PendingAutomation עם ${pendingMessages.length} הודעות`);
  }

  return { sent: 0, failed: 0, skipped: 0, pending: pendingMessages.length, logs: pendingMessages };
}

async function runAlbumReminder(base44, automation, runId, opts = {}) {
  console.log(`\n\n🟠🟠🟠 START runAlbumReminder 🟠🟠🟠`);
  const { testPhone, dryRun, selectedEventIds } = opts;

  const webhookUrl = await getMakeWebhookUrl(base44);
  if (!webhookUrl) throw new Error('MAKE_WEBHOOK_URL not configured');

  const allEvents = await base44.asServiceRole.entities.Event.list('-date');

  // Eligible: albumStatus !== 'sent', event in the past, has phone
  const now = new Date();
  const eligible = allEvents.filter(event => {
    if (!event.date || new Date(event.date) >= now) return false;
    if (event.albumStatus === 'sent') return false; // Filter out sent albums
    if (!event.phoneNumber) return false;
    return true;
  });

  console.log(`[runAlbumReminder] eligible events (for preview): ${eligible.length}`);

  const DEFAULT_TEMPLATE = `היי {coupleNames} 👋\nעבר חודש מהאירוע המדהים שלכם! 📸\nרציתי להזכיר שיש אפשרות להזמין סט 3 אלבומים 📚\nAvira Studio`;
  const template = automation.messageTemplate || DEFAULT_TEMPLATE;

  const pendingMessages = [];

  for (const event of eligible) {
    const phone = (testPhone || event.phoneNumber).replace(/[^0-9]/g, '');
    const daysSinceEvent = Math.floor((now - new Date(event.date)) / (1000 * 60 * 60 * 24));
    
    const finalMessage = renderTemplate(template, {
      coupleNames: event.coupleNames || '',
      eventDate: event.date || '',
      venueName: event.venue || '',
    });

    pendingMessages.push({
      eventId: event.id,
      coupleNames: event.coupleNames,
      phoneNumber: phone,
      messageText: finalMessage,
      eventDate: event.date,
      venueName: event.venue,
      daysSinceEvent,
      albumStatus: event.albumStatus,
      album_reminder_sent: event.album_reminder_sent || false,
      album_reminder_sent_at: event.album_reminder_sent_at || null,
    });
  }

  console.log(`[runAlbumReminder] נאספו ${pendingMessages.length} הודעות`);

  if (dryRun) {
    const previews = pendingMessages.map(m => ({
      eventId: m.eventId,
      staffId: m.eventId,
      name: m.coupleNames,
      staffPhone: m.phoneNumber,
      message: m.messageText,
      eventDate: m.eventDate,
      venueName: m.venueName,
      daysSinceEvent: m.daysSinceEvent,
      albumStatus: m.albumStatus,
      album_reminder_sent: m.album_reminder_sent,
      album_reminder_sent_at: m.album_reminder_sent_at,
    }));
    return { sent: 0, failed: 0, skipped: 0, pending: 0, logs: pendingMessages, previews };
  }

  // Real send — only send to selectedEventIds if provided
  const toSend = selectedEventIds
    ? pendingMessages.filter(m => selectedEventIds.includes(m.eventId))
    : []; // Manual run must have selectedEventIds, scheduler doesn't reach here

  let sent = 0, failed = 0;

  for (const item of toSend) {
    if (!item.phoneNumber) { failed++; continue; }
    try {
      await sendWhatsApp(item.phoneNumber.trim(), item.messageText, webhookUrl, 'album_reminder');
      // Mark as sent
      await base44.asServiceRole.entities.Event.update(item.eventId, {
        album_reminder_sent: true,
        album_reminder_sent_at: new Date().toISOString(),
      });
      sent++;
    } catch (err) {
      console.error(`[runAlbumReminder] שגיאה: ${err.message}`);
      failed++;
    }
  }

  return { sent, failed, skipped: 0, logs: toSend };
}

function formatDateIL(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return isoDate;
  return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`;
}

async function runQuestionnaireSend(base44, automation, runId, opts = {}) {
  console.log(`[runQuestionnaireSend] מתחילה הרצה`);
  const { testPhone, dryRun, targetYYYYMM: targetYYYYMMOverride } = opts;
  const webhookUrl = await getMakeWebhookUrl(base44);
  if (!webhookUrl) throw new Error('MAKE_WEBHOOK_URL not configured');

  // Use override (from manual run with month picker) or fall back to months_ahead setting
  let targetYYYYMM = targetYYYYMMOverride;
  if (!targetYYYYMM) {
    const monthsAhead = automation.months_ahead || 1;
    const now = new Date();
    const targetDate = new Date(now.getFullYear(), now.getMonth() + monthsAhead, 1);
    targetYYYYMM = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
  }
  console.log(`[runQuestionnaireSend] targetYYYYMM: ${targetYYYYMM}`);

  const allEvents = await base44.asServiceRole.entities.Event.list('-date');
  const targetEvents = allEvents.filter(ev => ev.date && ev.date.startsWith(targetYYYYMM));
  console.log(`[runQuestionnaireSend] events בחודש ${targetYYYYMM}: ${targetEvents.length}`);

  // Load all leads once for efficient lookup — source of truth for questionnaire completion is Lead.productionFormFilledAt
  const allLeads = await base44.asServiceRole.entities.Lead.list();
  const leadsById = {};
  for (const lead of allLeads) {
    leadsById[lead.id] = lead;
  }

  const DEFAULT_TEMPLATE = `היי {coupleNames}, ההתרגשות בשיאה! 🥂\nלקראת האירוע שלכם, אנחנו רוצים לוודא שכל הפרטים מסונכרנים אצלנו במערכת. 📋\nנשמח אם תוכלו למלא את השאלון הקצר בקישור הבא כדי שנוכל לתת לכם את השירות הטוב ביותר ❤️\n{questionnaireUrl}\nתודה! אווירה צלמים 📸`;
  const rawTemplate = automation.messageTemplate || DEFAULT_TEMPLATE;
  const template = rawTemplate
    .replace(/\$couple_names/g, '{coupleNames}')
    .replace(/\$questionnaire_link/g, '{questionnaireUrl}')
    .replace(/\$questionnaire_url/g, '{questionnaireUrl}')
    .replace(/\$event_date/g, '{date}')
    .replace(/\$venue/g, '{venue}');

  // Build preview groups (dryRun) or send (real run)
  const groups = { readyToSend: [], sentNoReply: [], completed: [] };
  let sent = 0, skipped = 0;

  for (const event of targetEvents) {
    const phone = testPhone || event.phoneNumber || event.phone || '';

    // Resolve lead ID — prefer source_lead_id, fall back to leadId. Never use event.id.
    const validLeadId = event.source_lead_id || event.leadId;
    if (!validLeadId) {
      console.warn(`[runQuestionnaireSend] דולג על ${event.coupleNames} (${event.id}) — אין source_lead_id ואין leadId`);
      continue;
    }
    const questionnaireUrl = `https://www.avira-studio.com/questionnaire/${validLeadId}`;
    const formattedDate = formatDateIL(event.date);

    const finalMessage = renderTemplate(template, {
      coupleNames: event.coupleNames || '',
      venue: event.venue || '',
      date: formattedDate,
      questionnaireUrl,
    });

    // Resolve linked lead — prefer leadId, fall back to source_lead_id
    const linkedLeadId = event.leadId || event.source_lead_id || null;
    const linkedLead = linkedLeadId ? leadsById[linkedLeadId] : null;

    // SOURCE OF TRUTH: Lead.productionFormFilledAt
    // If no linked lead exists, we cannot determine completion — treat as not completed
    const isCompleted = !!(linkedLead?.productionFormFilledAt);
    const isSent = !!(event.questionnaireSentAt);

    console.log(`[runQuestionnaireSend] ${event.coupleNames} | leadId=${linkedLeadId} | lead.productionFormFilledAt=${linkedLead?.productionFormFilledAt || 'null'} | event.questionnaireSentAt=${event.questionnaireSentAt || 'null'} | isCompleted=${isCompleted}`);

    const baseItem = {
      eventId: event.id,
      staffId: event.id,
      name: event.coupleNames || '',
      staffPhone: phone,
      message: finalMessage,
      eventDate: event.date,
      venue: event.venue || '',
      questionnaireSentAt: event.questionnaireSentAt || null,
      productionFormFilledAt: linkedLead?.productionFormFilledAt || null,
      hasLinkedLead: !!linkedLead,
    };

    // Classify into groups
    if (isCompleted) {
      groups.completed.push({ ...baseItem, group: 'completed' });
    } else if (isSent) {
      groups.sentNoReply.push({ ...baseItem, group: 'sentNoReply' });
    } else {
      groups.readyToSend.push({ ...baseItem, group: 'readyToSend' });
    }
  }

  if (dryRun) {
    return { status: 'preview', groups };
  }

  // Real send — only send to readyToSend (or selectedEventIds if provided)
  const toSend = opts.selectedEventIds
    ? [...groups.readyToSend, ...groups.sentNoReply].filter(e => opts.selectedEventIds.includes(e.eventId))
    : groups.readyToSend;

  for (const item of toSend) {
    if (!item.staffPhone) { skipped++; continue; }
    try {
      await sendWhatsApp(item.staffPhone.trim(), item.message, webhookUrl, 'questionnaire_send');
      sent++;
    } catch (err) {
      console.error(`[runQuestionnaireSend] שגיאה: ${err.message}`);
    }
  }

  return { sent, skipped };
}

async function executeAutomation(base44, automation, opts = {}) {
  const { triggeredBy, testPhone, dryRun, selectedStaffIds, targetYYYYMM, selectedEventIds } = opts;

  let runId = 'dryrun';
  if (!dryRun) {
    const run = await base44.asServiceRole.entities.AutomationRun.create({
      automation_id: automation.id,
      automation_name: automation.name,
      started_at: new Date().toISOString(),
      status: 'running',
      triggered_by: triggeredBy || 'scheduler'
    });
    runId = run.id;
  }

  try {
    let result = { sent: 0, failed: 0, skipped: 0, logs: [] };

    if (automation.type === 'monthly_staff_summary') {
      result = await runMonthlyStaffSummary(base44, automation, runId, { testPhone, dryRun });
    }
    if (automation.type === 'daily_event_brief') {
      result = await runDailyEventBrief(base44, automation, runId, { testPhone, dryRun, selectedStaffIds });
    }
    if (automation.type === 'questionnaire_reminder') {
      result = await runQuestionnaireReminder(base44, automation, runId, { testPhone, dryRun });
    }
    if (automation.type === 'payment_reminder') {
      result = await runPaymentReminder(base44, automation, runId, { testPhone, dryRun });
    }
    if (automation.type === 'album_reminder') {
      result = await runAlbumReminder(base44, automation, runId, { testPhone, dryRun });
    }
    if (automation.type === 'questionnaire_send') {
      result = await runQuestionnaireSend(base44, automation, runId, { testPhone, dryRun, targetYYYYMM: opts.targetYYYYMM, selectedEventIds: opts.selectedEventIds });
    }

    if (!dryRun) {
      const nextRunAt = calculateNextRun(automation);
      await Promise.all([
        base44.asServiceRole.entities.AutomationRun.update(runId, {
          completed_at: new Date().toISOString(),
          status: 'completed',
          messages_sent: result.sent,
          messages_failed: result.failed
        }),
        base44.asServiceRole.entities.Automation.update(automation.id, {
          last_run_at: new Date().toISOString(),
          next_run_at: nextRunAt,
          lastRunResults: JSON.stringify({ sent: result.sent, failed: result.failed, skipped: result.skipped })
        })
      ]);
    }

    if (dryRun) {
      if (automation.type === 'questionnaire_send') {
        // questionnaire_send returns grouped preview
        return { automation_id: automation.id, name: automation.name, status: 'preview_grouped', groups: result.groups };
      }
      let previews;
      if (result.previews) {
        previews = result.previews;
      } else {
        // monthly_staff_summary, daily_event_brief build from logs
        previews = (result.logs || []).map(l => ({
          staffId: l.staffId,
          name: l.name,
          staffName: l.name,
          staffPhone: l.phone,
          message: l.finalMessage,
          eventCount: l.eventsCount ?? 0,
        }));
      }
      return { automation_id: automation.id, name: automation.name, status: 'preview', previews };
    }
    return { automation_id: automation.id, name: automation.name, status: 'completed', ...result };
  } catch (error) {
    console.error(`[executeAutomation] שגיאה: ${error.message}`);
    if (!dryRun && runId !== 'dryrun') {
      await base44.asServiceRole.entities.AutomationRun.update(runId, {
        completed_at: new Date().toISOString(),
        status: 'error',
        error_message: error.message
      });
    }
    throw error;
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { automation_id, triggered_by, test_phone, dry_run, sync_schedule } = body;

    console.log(`[automationEngine] קריאה נכנסת — automation_id: ${automation_id}, triggered_by: ${triggered_by}, test_phone: ${test_phone}, dry_run: ${dry_run}, sync_schedule: ${sync_schedule}`);

    // ── Sync schedule mode: recompute next_run_at using calculateNextRun, write ONLY that field ──
    if (sync_schedule && automation_id) {
      const all = await base44.asServiceRole.entities.Automation.filter({});
      const automation = all.find(a => a.id === automation_id);
      if (!automation) return Response.json({ success: false, error: 'אוטומציה לא נמצאה' }, { status: 404 });
      if (!automation.isActive) return Response.json({ success: false, error: 'אוטומציה לא פעילה' }, { status: 400 });
      if (automation.frequency === 'manual') return Response.json({ success: false, error: 'אוטומציה ידנית — אין תזמון' }, { status: 400 });

      const newNextRunAt = calculateNextRun(automation);
      if (!newNextRunAt) return Response.json({ success: false, error: 'לא ניתן לחשב תזמון' }, { status: 400 });

      // Write ONLY next_run_at — nothing else
      await base44.asServiceRole.entities.Automation.update(automation_id, { next_run_at: newNextRunAt });

      // Verify: format back to Israel time for confirmation
      const israelTime = new Date(newNextRunAt).toLocaleString('he-IL', {
        timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false,
        day: '2-digit', month: '2-digit', year: '2-digit',
      });
      console.log(`[syncSchedule] ${automation.name} → next_run_at=${newNextRunAt} (ישראל: ${israelTime})`);
      return Response.json({ success: true, next_run_at: newNextRunAt, israel_time: israelTime });
    }

    let automationsToRun = [];

    if (automation_id) {
      const all = await base44.asServiceRole.entities.Automation.filter({});
      automationsToRun = all.filter(a => a.id === automation_id);
      console.log(`[automationEngine] נמצאו ${automationsToRun.length} אוטומציות עם id=${automation_id}`);
    } else {
      // Scheduler mode
      const all = await base44.asServiceRole.entities.Automation.filter({});
      const now = new Date().toISOString();
      automationsToRun = all
        .filter(a => a.isActive && ['monthly_staff_summary', 'daily_event_brief', 'payment_reminder', 'questionnaire_reminder', 'questionnaire_send'].includes(a.type))
        .filter(a => !a.next_run_at || a.next_run_at <= now);
      console.log(`[automationEngine] scheduler mode — ${automationsToRun.length} אוטומציות לריצה`);
    }

    if (automationsToRun.length === 0) {
      console.log(`[automationEngine] ⚠️ לא נמצאו אוטומציות להרצה`);
      return Response.json({ success: true, ran: 0, results: [], warning: 'לא נמצאו אוטומציות להרצה' });
    }

    const results = [];
    for (const automation of automationsToRun) {
      console.log(`[automationEngine] מריץ: ${automation.name} (${automation.id}), סוג: ${automation.type}`);
      const result = await executeAutomation(base44, automation, {
        triggeredBy: triggered_by || (automation_id ? 'manual' : 'scheduler'),
        testPhone: test_phone || null,
        dryRun: !!dry_run,
        selectedStaffIds: body.selectedStaffIds || null,
        targetYYYYMM: body.targetYYYYMM || null,
        selectedEventIds: body.selectedEventIds || null,
      });
      results.push(result);
    }

    return Response.json({ success: true, ran: results.length, results });
  } catch (error) {
    console.error(`[automationEngine] שגיאה קריטית: ${error.message}`);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});