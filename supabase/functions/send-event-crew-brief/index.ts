// "שלח לצוות" in the lead/event panel (2026-10-24, the owner's request): sends this
// event's crew the same message as the "תזכורת צלם יום לפני" automation
// (automations.type = 'daily_event_brief', built by _shared/eventBrief.ts), now.
//
//   { eventId, mode: 'preview' }  → who would get it and the message for each; sends nothing.
//   { eventId, mode: 'send', recipients: [{ staffId, message }] } → sends to those people only,
//     each of whom must be on this event's crew (checked here, not trusted from the browser);
//     the message may be the preview edited by the owner.
//
// Same rules as the automation: editors don't get it; the automation's own template; its
// test mode blocks real sends. For an event that is not tomorrow the template's "מחר"
// becomes the event's day (adjustTomorrowWording). A send for tomorrow's event is logged
// under the automation, so the automatic run later today does not send it twice; a send
// for another day is not, so it never stops tomorrow's automatic reminder.
// Admin roles only — the same people who manage the crew.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, createServiceRoleClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { getCallerProfile, isAdmin } from '../_shared/permissions.ts';
import { sendWhatsApp } from '../_shared/whatsapp.ts';
import { getJerusalemTodayDateStr, sentTodayAt } from '../_shared/automationGuards.ts';
import { DAILY_BRIEF_DEFAULT_TEMPLATE, findBriefLead, dailyBriefVars, renderBriefTemplate, adjustTomorrowWording } from '../_shared/eventBrief.ts';

const SLOT_LABELS: Record<string, string> = {
  photographer1: 'צלם 1',
  photographer2: 'צלם 2',
  videographer: 'וידאו 1',
  videographer2: 'וידאו 2',
};
const MAX_MESSAGE = 4000;

// sendWhatsApp's error can carry the Green API URL, and that URL holds the instance's API
// token — never hand it to the browser or store it in the logs. The detail stays in the
// function's own log.
function friendlySendError(raw: string | undefined): string {
  console.error('send-event-crew-brief: send failed:', raw);
  if (/network error|dns|connect|timed? ?out/i.test(raw || '')) return 'אין חיבור לשירות הוואטסאפ — נסו שוב בעוד רגע';
  if (/required|settings/i.test(raw || '')) return 'הוואטסאפ לא מחובר בהגדרות';
  return 'שליחת הוואטסאפ נכשלה';
}

function nextDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const profile = await getCallerProfile(createUserClient(req), user.id, 'role, tenant_id');
    if (!profile || !isAdmin(profile.role) || !profile.tenant_id) {
      return jsonResponse({ error: 'אין הרשאה לשלוח הודעות לצוות' }, { status: 403 });
    }
    const tenantId = profile.tenant_id;

    const body = await req.json().catch(() => ({}));
    const { eventId, mode } = body || {};
    if (!eventId || typeof eventId !== 'string') return jsonResponse({ error: 'eventId is required' }, { status: 400 });
    if (mode !== 'preview' && mode !== 'send') return jsonResponse({ error: 'mode must be preview or send' }, { status: 400 });

    const service = createServiceRoleClient();
    const { data: event } = await service.from('events').select('*').eq('id', eventId).maybeSingle();
    // Another studio's event looks exactly like a missing one.
    if (!event || event.tenant_id !== tenantId) return jsonResponse({ error: 'האירוע לא נמצא' }, { status: 404 });
    const eventDate = String(event.date || '').slice(0, 10);
    if (!eventDate) return jsonResponse({ error: 'לאירוע אין תאריך' }, { status: 400 });

    const [{ data: automation }, { data: allStaff }] = await Promise.all([
      service.from('automations').select('id, name, message_template, test_mode')
        .eq('tenant_id', tenantId).eq('type', 'daily_event_brief')
        .order('created_at', { ascending: true }).limit(1).maybeSingle(),
      service.from('staff_members').select('*').eq('tenant_id', tenantId),
    ]);

    const today = getJerusalemTodayDateStr();
    const tomorrow = nextDay(today);
    const template = adjustTomorrowWording(automation?.message_template || DAILY_BRIEF_DEFAULT_TEMPLATE, eventDate, today, tomorrow);
    const lead = await findBriefLead(service, tenantId, event);

    // The crew: everyone on the event but the editor, once per person (two slots = one message).
    const people = new Map<string, { staff: any | null; name: string; slots: string[] }>();
    for (const m of Array.isArray(event.team) ? event.team : []) {
      const name = String(m?.staffMemberName || '').trim();
      if (!name || m.role === 'editor') continue;
      const staff = (allStaff || []).find((s: any) => String(s.name || '').trim() === name) || null;
      if (staff?.role === 'editor') continue;
      const key = staff?.id || `name:${name}`;
      const entry = people.get(key) || { staff, name, slots: [] };
      entry.slots.push(SLOT_LABELS[m.role] || m.role || '');
      people.set(key, entry);
    }

    const recipients = [];
    for (const { staff, name, slots } of people.values()) {
      const phone = String(staff?.phone_number || '').trim();
      const problem = !staff ? 'לא ברשימת הצוות' : phone.length <= 3 ? 'אין טלפון' : null;
      const message = staff
        ? renderBriefTemplate(template, dailyBriefVars({ member: staff, memberEvents: [event], lead, allStaff: allStaff || [], dateStr: eventDate }))
        : '';
      const already = !problem && automation ? await sentTodayAt(service, automation.id, phone) : null;
      recipients.push({ staffId: staff?.id || null, name, slots, phone: problem ? null : phone, message, problem, sentTodayAt: already });
    }

    if (mode === 'preview') {
      return jsonResponse({
        success: true,
        coupleNames: event.couple_names,
        date: eventDate,
        isTomorrow: eventDate === tomorrow,
        testMode: !!automation?.test_mode,
        automationName: automation?.name || null,
        recipients,
      });
    }

    if (automation?.test_mode) {
      return jsonResponse({ error: `"${automation.name}" במצב בדיקה — לא נשלחות הודעות אמיתיות` }, { status: 409 });
    }
    const wanted = Array.isArray(body.recipients) ? body.recipients : [];
    if (wanted.length === 0) return jsonResponse({ error: 'לא נבחר אף איש צוות' }, { status: 400 });

    const results = [];
    const sentPhones = new Set<string>();
    for (const w of wanted) {
      const r = recipients.find((x) => x.staffId && x.staffId === w?.staffId);
      if (!r || r.problem || !r.phone) {
        results.push({ staffId: w?.staffId ?? null, name: r?.name || null, status: 'skipped', error: r?.problem || 'לא בצוות של האירוע' });
        continue;
      }
      if (sentPhones.has(r.phone)) {
        results.push({ staffId: r.staffId, name: r.name, status: 'skipped', error: 'כפילות טלפון' });
        continue;
      }
      const text = typeof w.message === 'string' && w.message.trim() ? w.message.slice(0, MAX_MESSAGE) : r.message;
      const sent = await sendWhatsApp(service, r.phone, text, tenantId);
      const sendError = sent.success ? null : friendlySendError(sent.error);
      sentPhones.add(r.phone);
      if (automation && eventDate === tomorrow) {
        await service.from('automation_message_logs').insert({
          tenant_id: tenantId,
          automation_id: automation.id,
          automation_name: `${automation.name} · שלח לצוות`,
          recipient_name: r.name,
          recipient_contact: r.phone,
          channel: 'whatsapp',
          message_content: text,
          status: sent.success ? 'sent' : 'failed',
          error: sendError,
        });
      }
      results.push({ staffId: r.staffId, name: r.name, status: sent.success ? 'sent' : 'failed', error: sendError || undefined });
    }
    return jsonResponse({ success: true, results });
  } catch (error) {
    return jsonResponse({ error: error?.message || String(error) }, { status: 500 });
  }
});
