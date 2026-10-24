// The crew reminder ("תזכורת צלם יום לפני", automations.type = 'daily_event_brief'):
// how its message is built. Moved out of automation-engine's runDailyEventBrief on
// 2026-10-24 so the "שלח לצוות" button in the lead/event panel (send-event-crew-brief)
// sends exactly the same message as the daily automation — one builder, no drift.
import { extraAnswerLines } from './questionnaireExtras.ts';

export const DAILY_BRIEF_DEFAULT_TEMPLATE = `שלום {staff_name}, להלן האירועים שלך למחר ({tomorrow_date}):\n\n{daily_events_summary}\n\nבהצלחה!`;

export function renderBriefTemplate(template: string, vars: Record<string, unknown>) {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    const token = '{' + key + '}';
    result = result.split(token).join(String(value ?? ''));
  }
  return result;
}

// The event's lead: by source_lead_id / lead_id, else the same couple names, else the
// same event date (the automation's original fallbacks, kept as they were).
export async function findBriefLead(supabase: any, tenantId: string, event: any) {
  let lead: any = null;
  const leadRef = event?.source_lead_id || event?.lead_id;
  if (leadRef) {
    const { data } = await supabase.from('leads').select('*').eq('id', leadRef).maybeSingle();
    lead = data || null;
  }
  if (!lead && event?.couple_names) {
    const { data } = await supabase.from('leads').select('*').eq('tenant_id', tenantId).eq('couple_names', event.couple_names).limit(1);
    lead = data?.[0] || null;
  }
  if (!lead && event?.date) {
    const { data } = await supabase.from('leads').select('*').eq('tenant_id', tenantId).eq('event_date', event.date).limit(1);
    lead = data?.[0] || null;
  }
  return lead;
}

// Full questionnaire field list — mirrors _shared/googleCalendarSync.ts's
// buildEventPayload leadDetails block exactly (same fields/labels/emoji,
// same skip-if-empty rule) so the WhatsApp reminder and the calendar
// description never drift out of sync. Keep both in sync manually if
// fields are added/removed in either place.
export function briefProductionDetails(lead: any): string {
  let computedProductionDetails = '';
  if (lead) {
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
      // the studio's own questions (Settings → שאלון הפקה, 2026-10-24)
      ...extraAnswerLines(lead),
    ];
    computedProductionDetails = (lines.filter(Boolean) as string[]).join('\n');
  }
  if (!computedProductionDetails) {
    computedProductionDetails = lead?.final_technical_summary || lead?.production_brief || 'הזוג טרם מילא שאלון הפקה';
  }
  return computedProductionDetails;
}

// The template variables for one crew member. `memberEvents` are his events on that day
// (the first one supplies the details), `dateStr` is that day ("YYYY-MM-DD").
export function dailyBriefVars({ member, memberEvents, lead, allStaff, dateStr }: {
  member: any; memberEvents: any[]; lead: any; allStaff: any[]; dateStr: string;
}): Record<string, string> {
  const eventsSummary = memberEvents.map((ev: any) => `${ev.couple_names || ''} | ${ev.venue || ''} | ${ev.date || ''}`).join('\n');
  const firstEvent = memberEvents[0];
  const firstTeam = firstEvent?.team || [];

  const staffNameWithPhone = (name: string | undefined) => {
    if (!name) return '';
    const s = (allStaff || []).find((m: any) => m.name === name);
    return s?.phone_number ? `${name} - ${s.phone_number}` : name;
  };
  const photographer = staffNameWithPhone(firstTeam.find((t: any) => t.role === 'photographer1')?.staffMemberName || firstTeam.find((t: any) => t.role === 'photographer2')?.staffMemberName || '');
  const photographer2name = firstTeam.find((t: any) => t.role === 'photographer2')?.staffMemberName;
  const photographer2 = photographer2name ? `\n• ${staffNameWithPhone(photographer2name)}` : '';
  const videographer = staffNameWithPhone(firstTeam.find((t: any) => t.role === 'videographer')?.staffMemberName || firstTeam.find((t: any) => t.role === 'videographer2')?.staffMemberName || '');

  const computedProductionDetails = briefProductionDetails(lead);

  const [ty, tm, td] = dateStr.split('-');
  const formattedDate = `${parseInt(td)}/${parseInt(tm)}/${ty.slice(2)}`;
  const eventTime = lead?.production_checkin_time || lead?.production_chuppah_time || '';

  return {
    staff_name: member.name,
    staffName: member.name,
    tomorrow_date: formattedDate,
    date: formattedDate,
    time: eventTime,
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
    productionDetails: computedProductionDetails,
    productionBrief: computedProductionDetails,
    finalTechnicalSummary: lead?.final_technical_summary || '',
  };
}

// "שלח לצוות" for an event that is not tomorrow (the owner's choice, 2026-10-24): the
// template's own "מחר" / "למחר" becomes the event's day — "ב-22/10" / "ל-22/10", or
// "היום" / "להיום" on the day itself. Tomorrow's event keeps the template word for word.
// Applied to the template before the variables, so nothing inside the couple's answers
// is touched. Whole words only ("מחרוזת" stays).
export function adjustTomorrowWording(template: string, eventDateStr: string, todayStr: string, tomorrowStr: string): string {
  if (!template || !eventDateStr || eventDateStr === tomorrowStr) return template;
  const isToday = eventDateStr === todayStr;
  const [, m, d] = eventDateStr.split('-');
  const dm = `${parseInt(d)}/${parseInt(m)}`;
  return template.replace(/(^|[^֐-׿])(ל?)מחר(?![֐-׿])/g, (_all, before, la) => {
    if (isToday) return `${before}${la ? 'להיום' : 'היום'}`;
    return `${before}${la ? 'ל' : 'ב'}-${dm}`;
  });
}
