// "שיחה שלא נענתה" (2026-10-13, the owner's request): a WhatsApp call nobody answered
// becomes a line in the chat ("📞 שיחה שלא נענתה"), and an unknown number or a lead gets
// one message back — "ראינו שהתקשרתם, נחזור אליכם". Clients, the team, vendors and groups
// get nothing (the owner's choice), and neither does an "unknown" number the studio has
// already written to by hand (an unregistered vendor, a venue, family). Off until the
// owner switches it on in the bot control centre.
//
// Green API reports a call as incomingCall twice: 'offer' when it rings, then the outcome —
// 'pickUp' (answered), 'hungUp' (rejected / do-not-disturb) or 'declined' (unanswered or
// the caller gave up; 'missed' is the deprecated name). Verified against
// green-api.com/en/docs/api/receiving/notifications-format/IncomingCall/ on 2026-10-13.
// The notification only arrives once incomingCallWebhook is switched on for the instance.
//
// When the call comes in quiet hours the reply waits: the hourly housekeeping sends it
// after the window ends (sendPendingMissedCallReplies). Nothing is retried after a failed
// send — a notification goes to the bell instead, like every bot send.
import { classifyContact } from './whatsappContact.ts';
import { chatIdToLocalPhone, isGroupChatId } from './phone.ts';
import { loadBotSettings, isUnderHourlyQuota, sendBotMessage, type BotSettings } from './whatsappBotSend.ts';
import { loadQuietHoursSettings, isInQuietHoursNow } from './automationGuards.ts';

export const MISSED_CALL_STATUSES = ['hungUp', 'declined', 'missed'];
export const MISSED_CALL_PREVIEW = '📞 שיחה שלא נענתה';
// One reply a day per number: a second call within this window gets no second message.
export const MISSED_CALL_REPLY_COOLDOWN_MS = 20 * 3600 * 1000;
// A night call is answered in the morning; past this it is stale and left to a human.
export const MISSED_CALL_REPLY_MAX_AGE_MS = 12 * 3600 * 1000;
const REPLY_TYPES = ['unknown', 'lead'];

// When the call happened: Green API's own timestamp (seconds), not when the notification
// arrived — a backlog delivered hours later must not look like a fresh call. A missing or
// future value falls back to now.
export function callTime(payload: any, now: Date = new Date()): Date {
  const ts = Number(payload?.timestamp);
  if (!Number.isFinite(ts) || ts <= 0) return now;
  const d = new Date(ts * 1000);
  return d.getTime() > now.getTime() ? now : d;
}

export function isMissedCallStatus(status: unknown): boolean {
  return typeof status === 'string' && MISSED_CALL_STATUSES.includes(status);
}

// A new missed call opens a new reply only when the last one is older than the cooldown.
export function shouldResetMissedCallReply(prevReplyAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!prevReplyAt) return false;
  return now.getTime() - new Date(prevReplyAt).getTime() >= MISSED_CALL_REPLY_COOLDOWN_MS;
}

export type MissedCallVerdict =
  | { send: true }
  | { send: false; reason: 'disabled' | 'no_text' | 'not_lead' | 'group' | 'opted_out' | 'no_phone'
      | 'already_replied' | 'studio_replied' | 'expired' | 'no_call' | 'quiet_hours' | 'known_to_studio' };

// Pure — PART 57. 'quiet_hours' is the only reason that is "later", not "never".
export function decideMissedCallReply(i: {
  enabled: boolean; text: string; contactType: string | null; isGroup: boolean; optedOut: boolean;
  hasPhone: boolean; missedCallAt: string | null; replyAt: string | null; studioRepliedSince: boolean;
  inQuietHours: boolean; now?: Date;
  // A person from the studio ever wrote in this chat. For an unknown number that means
  // someone the owner already talks to (a vendor, a venue, family) — not a new inquiry.
  studioEverWrote?: boolean;
}): MissedCallVerdict {
  const now = i.now ?? new Date();
  if (!i.enabled) return { send: false, reason: 'disabled' };
  if (!i.text.trim()) return { send: false, reason: 'no_text' };
  if (i.isGroup) return { send: false, reason: 'group' };
  if (!REPLY_TYPES.includes(i.contactType || 'unknown')) return { send: false, reason: 'not_lead' };
  if ((i.contactType || 'unknown') === 'unknown' && i.studioEverWrote) return { send: false, reason: 'known_to_studio' };
  if (i.optedOut) return { send: false, reason: 'opted_out' };
  if (!i.hasPhone) return { send: false, reason: 'no_phone' };
  if (!i.missedCallAt) return { send: false, reason: 'no_call' };
  if (i.replyAt) return { send: false, reason: 'already_replied' };
  if (i.studioRepliedSince) return { send: false, reason: 'studio_replied' };
  if (now.getTime() - new Date(i.missedCallAt).getTime() > MISSED_CALL_REPLY_MAX_AGE_MS) return { send: false, reason: 'expired' };
  if (i.inQuietHours) return { send: false, reason: 'quiet_hours' };
  return { send: true };
}

const CONV_COLUMNS = 'id, phone, contact_type, contact_type_manual_at, opted_out_at, archived_at, missed_call_at, missed_call_reply_at, display_name, last_message_at, last_answered_call_id';

// The webhook's incomingCall branch. Returns what happened, for the 200 body / logs.
// `later` runs work after the response (EdgeRuntime.waitUntil); `push` is injected so this
// module stays loadable by the test bundle (webPush pulls a Deno-only package).
export async function handleIncomingCall(
  supabase: any, tenantId: string, payload: any,
  { later, push }: {
    later: (p: Promise<unknown>) => void;
    push: (contactType: string, p: { title: string; body: string; conversationId: string }) => Promise<unknown>;
  },
): Promise<string> {
  const status = payload?.status;
  const answered = status === 'pickUp';
  if (!answered && !isMissedCallStatus(status)) return 'ignored_status';
  const chatId = payload?.from ? String(payload.from) : '';
  const callId = payload?.idMessage ? String(payload.idMessage) : '';
  if (!chatId || !callId) return 'missing_ids';
  if (isGroupChatId(chatId)) return 'group';
  const phone = chatIdToLocalPhone(chatId);

  // ---- Conversation (create or fetch) -------------------------------------
  let { data: conv } = await supabase
    .from('whatsapp_conversations').select(CONV_COLUMNS)
    .eq('tenant_id', tenantId).eq('chat_id', chatId).maybeSingle();
  if (!conv) {
    const match = await classifyContact(supabase, tenantId, phone);
    const { data: inserted, error } = await supabase
      .from('whatsapp_conversations')
      .insert({
        tenant_id: tenantId, chat_id: chatId, phone,
        contact_type: match.contactType, matched_lead_id: match.leadId, matched_event_id: match.eventId,
      })
      .select(CONV_COLUMNS).single();
    if (error) {
      // A message from the same person landed at the same moment — read its row.
      const { data: raced } = await supabase
        .from('whatsapp_conversations').select(CONV_COLUMNS)
        .eq('tenant_id', tenantId).eq('chat_id', chatId).maybeSingle();
      if (!raced) throw new Error(`conversation insert: ${error.message}`);
      conv = raced;
    } else {
      conv = inserted;
    }
  }

  // An answered call is only remembered, so that a stray 'hungUp' for the same call id
  // is never taken for a missed call.
  if (answered) {
    await supabase.from('whatsapp_conversations').update({ last_answered_call_id: callId }).eq('id', conv.id);
    return 'answered';
  }
  if (conv.last_answered_call_id === callId) return 'answered_earlier';

  const now = new Date();
  const at = callTime(payload, now);
  const atIso = at.toISOString();

  // ---- The line in the chat (this insert IS the dedupe) -------------------
  const { error: msgError } = await supabase.from('whatsapp_messages').insert({
    created_at: atIso,
    tenant_id: tenantId,
    conversation_id: conv.id,
    id_message: `call-${callId}`,
    direction: 'inbound',
    type_webhook: 'incomingCall',
    type_message: 'missedCall',
    body_text: MISSED_CALL_PREVIEW,
    raw: payload,
  });
  if (msgError) {
    if (msgError.code === '23505') return 'duplicate';
    throw new Error(`call message insert: ${msgError.message}`);
  }

  // ---- Conversation aggregates --------------------------------------------
  // A late-delivered old call adds its line but does not jump the chat to the top.
  const isLatest = !conv.last_message_at || at.getTime() >= new Date(conv.last_message_at).getTime();
  const updates: Record<string, unknown> = {};
  if (isLatest) {
    updates.last_message_at = atIso;
    updates.last_message_preview = MISSED_CALL_PREVIEW;
    updates.last_inbound_at = atIso;
    if (conv.archived_at) updates.archived_at = null;
  }
  if (!conv.missed_call_at || at.getTime() > new Date(conv.missed_call_at).getTime()) {
    updates.missed_call_at = atIso;
    if (shouldResetMissedCallReply(conv.missed_call_reply_at, at)) updates.missed_call_reply_at = null;
  }
  let contactType = conv.contact_type;
  if (contactType === 'unknown' && !conv.contact_type_manual_at && phone) {
    const match = await classifyContact(supabase, tenantId, phone);
    if (match.contactType !== 'unknown') {
      contactType = match.contactType;
      updates.contact_type = match.contactType;
      updates.matched_lead_id = match.leadId;
      updates.matched_event_id = match.eventId;
    }
  }
  if (Object.keys(updates).length) {
    const { error: updError } = await supabase.from('whatsapp_conversations').update(updates).eq('id', conv.id);
    if (updError) throw new Error(`conversation update: ${updError.message}`);
  }
  if (now.getTime() - at.getTime() > MISSED_CALL_REPLY_MAX_AGE_MS) return 'recorded_late';

  later(push(contactType, {
    title: conv.display_name || phone || 'מספר לא מוכר',
    body: MISSED_CALL_PREVIEW,
    conversationId: conv.id,
  }).catch((e) => console.error('[whatsappMissedCall] push failed:', e?.message || e)));
  later(replyToMissedCall(supabase, tenantId, conv.id).catch((e) =>
    console.error('[whatsappMissedCall] reply failed:', e?.message || e)));
  return 'recorded';
}

// Sends the reply if it is due now. Safe to call twice: the claim on missed_call_reply_at
// lets exactly one caller send.
export async function replyToMissedCall(
  supabase: any, tenantId: string, conversationId: string, preloaded?: { settings?: BotSettings | null; inQuiet?: boolean },
): Promise<string> {
  const { data: conv } = await supabase
    .from('whatsapp_conversations')
    .select('id, phone, chat_id, contact_type, opted_out_at, missed_call_at, missed_call_reply_at')
    .eq('tenant_id', tenantId).eq('id', conversationId).maybeSingle();
  if (!conv) return 'no_conversation';

  const settings = preloaded?.settings !== undefined ? preloaded.settings : await loadBotSettings(supabase, tenantId);
  if (!settings) return 'no_settings';

  let inQuiet = preloaded?.inQuiet;
  if (inQuiet === undefined) {
    inQuiet = true; // fail closed, like every other bot send
    try {
      inQuiet = isInQuietHoursNow(await loadQuietHoursSettings(supabase, tenantId));
    } catch (e: any) {
      console.error('[whatsappMissedCall] quiet-hours lookup failed, assuming quiet:', e?.message || e);
    }
  }

  let studioRepliedSince = false;
  if (conv.missed_call_at) {
    const { count } = await supabase
      .from('whatsapp_messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conv.id)
      .eq('direction', 'outbound_human')
      .gte('created_at', conv.missed_call_at);
    studioRepliedSince = (count ?? 0) > 0;
  }

  let studioEverWrote = false;
  if ((conv.contact_type || 'unknown') === 'unknown') {
    const { count } = await supabase
      .from('whatsapp_messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conv.id)
      .eq('direction', 'outbound_human');
    studioEverWrote = (count ?? 0) > 0;
  }

  const verdict = decideMissedCallReply({
    studioEverWrote,
    enabled: settings.missedCallEnabled,
    text: settings.missedCallText,
    contactType: conv.contact_type,
    isGroup: isGroupChatId(conv.chat_id || ''),
    optedOut: !!conv.opted_out_at,
    hasPhone: !!conv.phone,
    missedCallAt: conv.missed_call_at,
    replyAt: conv.missed_call_reply_at,
    studioRepliedSince,
    inQuietHours: inQuiet,
  });
  if (!verdict.send) return verdict.reason;

  if (!(await isUnderHourlyQuota(supabase, tenantId, settings.maxBotMessagesPerHour))) return 'quota';

  // The claim: only one caller (webhook or the hourly tick) gets the row back.
  const { data: claimed } = await supabase
    .from('whatsapp_conversations')
    .update({ missed_call_reply_at: new Date().toISOString() })
    .eq('id', conv.id)
    .is('missed_call_reply_at', null)
    .select('id');
  if (!claimed?.length) return 'claimed_elsewhere';

  const out = await sendBotMessage(supabase, {
    tenantId, conversationId: conv.id, phone: conv.phone, text: settings.missedCallText, kind: 'missed_call',
  });
  return out.sent ? 'sent' : 'failed';
}

// The hourly tick: night calls whose reply waited for the quiet hours to end.
export async function sendPendingMissedCallReplies(
  supabase: any, tenantId: string, settings: BotSettings, inQuiet: boolean,
): Promise<number> {
  if (inQuiet || !settings.missedCallEnabled) return 0;
  const since = new Date(Date.now() - MISSED_CALL_REPLY_MAX_AGE_MS).toISOString();
  const { data: rows } = await supabase
    .from('whatsapp_conversations')
    .select('id')
    .eq('tenant_id', tenantId)
    .not('missed_call_at', 'is', null)
    .is('missed_call_reply_at', null)
    .gte('missed_call_at', since)
    .in('contact_type', REPLY_TYPES)
    .is('opted_out_at', null)
    .limit(20);
  let sent = 0;
  for (const r of rows || []) {
    const res = await replyToMissedCall(supabase, tenantId, r.id, { settings, inQuiet });
    if (res === 'sent') sent++;
    if (res === 'quota') break;
  }
  return sent;
}
