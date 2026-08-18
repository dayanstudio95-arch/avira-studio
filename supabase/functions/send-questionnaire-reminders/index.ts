// Ports base44/functions/sendQuestionnaireReminders/entry.ts.
// Invoked from TeamAutomationTab.jsx's "שאלון הכנה" button (dynamic fnName ===
// "sendQuestionnaireReminders", payload {}).
//
// The original already called Green API directly (not Make.com) but used a
// slightly different endpoint shape (`/sendMessage/{apiKey}` path param + `{chatId,
// message}` body) than every other function in this codebase (`/sendMessage?apiKey=`
// query param + `{phone, message}` body, via _shared/whatsapp.ts). Ported to use the
// shared sendWhatsApp() helper instead, for one consistent Green API calling
// convention app-wide — same gateway/apiKey settings either way, this only changes
// the wire-format, not user-visible behavior.
//
// Role check: uses the shared ADMIN_ROLES set (owner/admin/studio_manager — see
// _shared/permissions.ts) — studio_manager was previously excluded here, inconsistent
// with the admin-panel gate itself (src/App.jsx), per the 2026-08-17 security audit.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { sendWhatsApp } from '../_shared/whatsapp.ts';
import { getCallerProfile, isAdmin } from '../_shared/permissions.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createUserClient(req);
    const profile = await getCallerProfile(supabase, user.id, 'role');
    if (!profile || !isAdmin(profile.role)) {
      return jsonResponse({ error: 'Forbidden' }, { status: 403 });
    }

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const monthOffset = body.monthOffset ?? 1;
    const now = new Date();
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    const nextMonthEnd = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0);

    const { data: templateSetting } = await supabase.from('app_settings').select('value').eq('key', 'template_questionnaire_reminder').maybeSingle();
    const messageTemplate =
      templateSetting?.value || 'היי $couple_names, החודש שלכם כבר כמעט כאן! 🎊 נשמח אם תמלאו את השאלון: $questionnaire_link';

    const { data: allLeads, error: leadsErr } = await supabase.from('leads').select('id, event_date, phone_number, couple_names, venue_name');
    if (leadsErr) return jsonResponse({ error: leadsErr.message }, { status: 500 });

    const targetLeads = (allLeads || []).filter((lead) => {
      if (!lead.event_date || !lead.phone_number) return false;
      const d = new Date(lead.event_date);
      return d >= nextMonthStart && d <= nextMonthEnd;
    });

    if (targetLeads.length === 0) {
      return jsonResponse({ success: true, message: 'No leads with events next month', results: [] });
    }

    const baseUrl = 'https://www.avira-studio.com';
    const results: Array<{ leadName: string; success: boolean; error?: string }> = [];

    for (const lead of targetLeads) {
      const questionnaireLink = `${baseUrl}/questionnaire/${lead.id}`;
      const eventDateStr = lead.event_date ? new Date(lead.event_date).toLocaleDateString('he-IL') : '';

      const messageText = messageTemplate
        .replace(/\$couple_names/g, lead.couple_names || '')
        .replace(/\$questionnaire_link/g, questionnaireLink)
        .replace(/\$event_date/g, eventDateStr)
        .replace(/\$venue/g, lead.venue_name || '');

      const result = await sendWhatsApp(supabase, lead.phone_number, messageText);
      results.push({ leadName: lead.couple_names, success: result.success, error: result.success ? undefined : result.error });
    }

    return jsonResponse({ success: true, total: results.length, sent: results.filter((r) => r.success).length, results });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
