// The chat's "🤖" buttons (2026-10-09, the owner's request): send the bot's details request
// or the price list (image + text) to ONE conversation, by hand.
//
// Same text and image the bot would send (bot settings), recorded as the bot's own message
// (direction outbound_bot, bot:greeting / bot:pricelist) — so the echo from Green API is a
// duplicate, the bot is NOT muted, and the flow goes on: after the details request the bot
// collects the answers and sends the price list by itself; after the price list the chat is
// in "נשלח מחירון" for follow-up.
//
//   { conversationId, kind: 'greeting' | 'pricelist', preview: true } → { sends } (nothing sent)
//   { conversationId, kind }                                          → { success }
//
// Roles: owner / admin / studio_manager / lead_coordinator (the people who answer chats).
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, createServiceRoleClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { getCallerProfile, isAdmin, isLeadCoordinator } from '../_shared/permissions.ts';
import { loadBotSettings, executeSends, planManualBotSend } from '../_shared/whatsappBotSend.ts';
import { isGroupChatId } from '../_shared/phone.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
    const profile = await getCallerProfile(createUserClient(req), user.id, 'role, tenant_id');
    if (!profile?.tenant_id || !(isAdmin(profile.role) || isLeadCoordinator(profile.role))) {
      return jsonResponse({ error: 'אין הרשאה' }, { status: 403 });
    }
    const tenantId = profile.tenant_id as string;
    const body = await req.json().catch(() => ({}));
    const kind = body?.kind === 'pricelist' ? 'pricelist' : body?.kind === 'greeting' ? 'greeting' : null;
    const conversationId = String(body?.conversationId || '');
    if (!kind || !conversationId) return jsonResponse({ error: 'kind and conversationId are required' }, { status: 400 });

    const service = createServiceRoleClient();
    const { data: conv } = await service
      .from('whatsapp_conversations')
      .select('id, tenant_id, chat_id, state, source, contact_type')
      .eq('id', conversationId)
      .maybeSingle();
    if (!conv || conv.tenant_id !== tenantId) return jsonResponse({ error: 'השיחה לא נמצאה' }, { status: 404 });
    if (isGroupChatId(conv.chat_id)) return jsonResponse({ error: 'לא שולחים הודעות בוט לקבוצה' }, { status: 400 });

    const settings = await loadBotSettings(service, tenantId);
    if (!settings) return jsonResponse({ error: 'לא ניתן לטעון את הגדרות הבוט' }, { status: 500 });
    const plan = planManualBotSend(kind, settings, conv);
    if (plan.error) return jsonResponse({ error: plan.error }, { status: 400 });
    if (body?.preview) return jsonResponse({ sends: plan.sends });

    const outcome = await executeSends(service, {
      tenantId, conversationId: conv.id, phone: conv.chat_id, sends: plan.sends, kind, manual: true,
    });
    if (!outcome.sent) return jsonResponse({ error: outcome.error || 'השליחה נכשלה' }, { status: 502 });

    const nowIso = new Date().toISOString();
    const updates: Record<string, unknown> = { last_bot_message_at: nowIso };
    if (plan.nextState) updates.state = plan.nextState;
    if (kind === 'greeting') updates.bot_would_reply_at = nowIso;
    const { error } = await service.from('whatsapp_conversations').update(updates).eq('id', conv.id);
    if (error) console.error('[whatsapp-send-bot-message] conversation update failed:', error.message);
    // A partial price list (image went, text failed) is still "sent" — the failure is in the bell.
    return jsonResponse({ success: true, partial: !!outcome.error });
  } catch (e: any) {
    console.error('[whatsapp-send-bot-message]', e?.message || e);
    return jsonResponse({ error: 'שגיאה בשליחה' }, { status: 500 });
  }
});
