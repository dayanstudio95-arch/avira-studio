// "העבר" — forwards one message from a chat to up to five other chats (2026-10-13, the
// owner's request), through Green API's forwardMessages: the recipient sees it as
// "Forwarded", media included. Each forwarded copy comes back through the webhook as an
// outgoing message, so it appears in the target chats (and quiets the bot there) by
// itself, exactly like a message typed in the chat.
//
// Same senders as send-whatsapp-message. Everything is read with the caller's tenant:
// the source chat, the message (it must be on record in that chat — Green API accepts an
// unknown id with 200 and silently drops it) and every target chat.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, createServiceRoleClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { getCallerProfile, hasRole, ADMIN_ROLES, LEAD_COORDINATOR_ROLE, ALBUM_MANAGER_ROLE } from '../_shared/permissions.ts';
import { forwardWhatsAppMessage } from '../_shared/whatsapp.ts';
import { isForwardableMessage, planForward } from '../_shared/whatsappForward.ts';

const SENDER_ROLES = [...ADMIN_ROLES, LEAD_COORDINATOR_ROLE, ALBUM_MANAGER_ROLE];

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
    const profile = await getCallerProfile(createUserClient(req), user.id, 'role, tenant_id');
    if (!profile?.tenant_id || !hasRole(profile.role, SENDER_ROLES)) {
      return jsonResponse({ error: 'Forbidden' }, { status: 403 });
    }
    const tenantId = profile.tenant_id;

    const body = await req.json().catch(() => ({}));
    const { conversationId, idMessage, targetConversationIds } = body || {};
    if (!conversationId || !idMessage) return jsonResponse({ error: 'conversationId and idMessage are required' }, { status: 400 });

    const supabase = createServiceRoleClient();
    const { data: source } = await supabase
      .from('whatsapp_conversations').select('id, chat_id')
      .eq('tenant_id', tenantId).eq('id', conversationId).maybeSingle();
    if (!source?.chat_id) return jsonResponse({ error: 'השיחה לא נמצאה' }, { status: 404 });

    const { data: msg } = await supabase
      .from('whatsapp_messages').select('id_message, type_message')
      .eq('tenant_id', tenantId).eq('conversation_id', source.id).eq('id_message', String(idMessage)).maybeSingle();
    if (!msg || !isForwardableMessage({ idMessage: msg.id_message, typeMessage: msg.type_message })) {
      return jsonResponse({ error: 'אי אפשר להעביר את ההודעה הזו' }, { status: 400 });
    }

    const requested = Array.isArray(targetConversationIds) ? targetConversationIds.map(String).slice(0, 20) : [];
    const { data: targets } = requested.length
      ? await supabase.from('whatsapp_conversations').select('id, chat_id').eq('tenant_id', tenantId).in('id', requested)
      : { data: [] };
    const withChat = (targets || []).filter((t: any) => !!t.chat_id);
    const plan = planForward({ sourceConversationId: source.id, targetIds: targetConversationIds, knownTargetIds: withChat.map((t: any) => t.id) });
    if (!plan.ok) return jsonResponse({ error: plan.error }, { status: 400 });

    const byId = Object.fromEntries(withChat.map((t: any) => [t.id, t.chat_id]));
    const results: { conversationId: string; success: boolean; error?: string }[] = [];
    for (const id of plan.targets) {
      const r = await forwardWhatsAppMessage(supabase, { chatId: byId[id], chatIdFrom: source.chat_id, idMessage: msg.id_message }, tenantId);
      results.push({ conversationId: id, success: r.success, error: r.error });
    }
    const sent = results.filter((r) => r.success).length;
    return jsonResponse({ success: sent > 0, sent, failed: results.length - sent, results }, { status: sent > 0 ? 200 : 502 });
  } catch (error: any) {
    return jsonResponse({ error: error?.message || 'error' }, { status: 500 });
  }
});
