// "What would the bot have done with this message?" — the simulator behind the box at
// the bottom of Settings → בוט לידים (2026-09-15).
//
// The owner asked "why didn't it answer?" twice in one week, and both times the answer
// took a database query to find. This runs the REAL chain — the same classifyContact,
// the same loadBotSettings, the same quiet-hours clock, the same decideBotReply — on a
// message that was never received, and returns the verdict with the reason and the
// words that fired. It sends nothing and writes nothing.
//
// Assumes a fresh conversation: "first message from this number". If a conversation
// with the number already exists, that is reported as a note rather than simulated,
// because the interesting question is almost always about the first message.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, createServiceRoleClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { getCallerProfile, isAdmin } from '../_shared/permissions.ts';
import { normalizeIsraeliPhone } from '../_shared/phone.ts';
import { classifyContact } from '../_shared/whatsappContact.ts';
import { loadBotSettings } from '../_shared/whatsappBotSend.ts';
import { loadQuietHoursSettings, isInQuietHoursNow } from '../_shared/automationGuards.ts';
import { decideBotReply } from '../_shared/whatsappIntent.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const userClient = createUserClient(req);
    const profile = await getCallerProfile(userClient, user.id);
    if (!profile || !profile.tenant_id || !isAdmin(profile.role)) {
      return jsonResponse({ error: 'Forbidden' }, { status: 403 });
    }
    const tenantId = profile.tenant_id;

    const body = await req.json().catch(() => ({}));
    const text: string = typeof body.text === 'string' ? body.text : '';
    const rawPhone: string = typeof body.phone === 'string' ? body.phone.trim() : '';
    const fromAd = !!body.fromAd;

    const supabase = createServiceRoleClient();
    const notes: string[] = [];

    // Who is this number to the studio — the same lookup the webhook runs.
    let contactType = 'unknown';
    const phone = rawPhone ? normalizeIsraeliPhone(rawPhone) : null;
    if (rawPhone && !phone) {
      notes.push('המספר לא זוהה כמספר ישראלי תקין — נבדק כמספר לא מוכר');
    }
    if (phone) {
      const match = await classifyContact(supabase, tenantId, phone);
      contactType = match.contactType;
      const { data: existing } = await supabase
        .from('whatsapp_conversations')
        .select('state, bot_enabled')
        .eq('tenant_id', tenantId)
        .eq('phone', phone)
        .limit(1)
        .maybeSingle();
      if (existing) {
        notes.push(
          `כבר קיימת שיחה עם המספר הזה (מצב: ${existing.state}${existing.bot_enabled ? '' : ', הבוט מושתק בה'}). הבדיקה כאן מניחה הודעה ראשונה.`
        );
      }
    } else {
      notes.push('בלי מספר — הבדיקה מניחה מספר לא מוכר');
    }

    const settings = await loadBotSettings(supabase, tenantId);
    const masterEnabled = !!settings?.enabled;

    let inQuietHours = false;
    try {
      inQuietHours = isInQuietHoursNow(await loadQuietHoursSettings(supabase, tenantId));
    } catch {
      inQuietHours = true;
      notes.push('לא הצלחנו לקרוא את שעות השקט — הבוט היה מניח שעות שקט');
    }

    const decision = decideBotReply({
      contactType,
      botEnabled: true,
      state: 'NEW',
      isGroup: false,
      typeMessage: 'textMessage',
      bodyText: text,
      inQuietHours,
      alreadyDecidedToReply: false,
      fromAd,
    });

    const greeting = settings
      ? (fromAd && settings.greetingTextAd ? settings.greetingTextAd : settings.greetingText)
      : '';

    if (!masterEnabled) notes.push('הבוט כבוי בהגדרות — גם אם השער נפתח, שום דבר לא היה נשלח');
    if (masterEnabled && !greeting) notes.push('אין הודעת פתיחה מוגדרת — הבוט לא היה שולח');
    if (decision.reason === 'quiet_hours_deferred') {
      notes.push('שעות שקט עכשיו — ההודעה הייתה נכנסת לתור ונשלחת בסיום שעות השקט');
    }

    const wouldSend =
      masterEnabled && !!greeting && (decision.wouldReply || decision.reason === 'quiet_hours_deferred');

    return jsonResponse({
      wouldReply: decision.wouldReply,
      reason: decision.reason,
      intent: decision.intent,
      contactType,
      inQuietHours,
      masterEnabled,
      greeting: greeting || null,
      wouldSend,
      notes,
    });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
