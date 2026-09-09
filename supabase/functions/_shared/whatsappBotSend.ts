// The WhatsApp lead bot's send path. This is the file where the bot stops being a
// notebook and starts talking to strangers, so every guard in it fails closed.
//
// Everything about WHO gets a reply lives in whatsappIntent.ts and is unchanged by
// this file — decideBotReply() already ran, and was measured against a week of the
// studio's real traffic before anything here was written. What lives here is the
// second half of the question: given that the gate opened, is the studio currently
// willing to send at all, and what happens to the record afterwards.
//
// ⚠️ The master switch (`whatsapp_bot_enabled`) defaults to FALSE and is absent from
// app_settings until someone sets it in the Settings screen. A missing value therefore
// means silence, not "unset, so go ahead".

import { sendWhatsApp, sendWhatsAppFileByUrl, WHATSAPP_CAPTION_MAX } from './whatsapp.ts';

// Every knob the bot has, all of them per-tenant rows in app_settings.
export interface BotSettings {
  enabled: boolean;
  greetingText: string;
  replyDelaySeconds: number;
  maxBotMessagesPerHour: number;
  // Stage 3. The URL is optional — with it the price list goes out as an image with a
  // caption, without it as plain text. The text itself is not optional: a conversation
  // that collected every detail and then had nothing to send would be the worst
  // outcome of the whole flow.
  pricelistUrl: string;
  pricelistText: string;
}

export const BOT_SETTING_KEYS = [
  'whatsapp_bot_enabled',
  'whatsapp_greeting_text',
  'whatsapp_reply_delay_seconds',
  'whatsapp_max_bot_messages_per_hour',
  'whatsapp_pricelist_url',
  'whatsapp_pricelist_text',
] as const;

// Deliberately conservative. These apply when a tenant has never opened the settings
// screen, which is also the state in which nobody has agreed to anything.
const DEFAULTS = {
  replyDelaySeconds: 45,
  maxBotMessagesPerHour: 10,
};

// app_settings stores everything as text, so "false", "0" and "" all have to mean off.
// Anything not explicitly affirmative is off — an unrecognised value is a
// misconfiguration, and the safe reading of a misconfigured send switch is "don't".
function parseBool(value: unknown): boolean {
  const v = String(value ?? '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

function parseIntInRange(value: unknown, fallback: number, min: number, max: number): number {
  const n = parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Returns null when the settings can't be read at all. Callers must treat null as
// "do not send" rather than as "use defaults": the defaults are for missing individual
// knobs, not for a failed lookup.
export async function loadBotSettings(supabase: any, tenantId: string): Promise<BotSettings | null> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('key, value')
    .eq('tenant_id', tenantId)
    .in('key', BOT_SETTING_KEYS as unknown as string[]);

  if (error) {
    console.error('[whatsappBotSend] settings lookup failed, staying silent:', error.message);
    return null;
  }

  const get = (key: string) => data?.find((r: any) => r.key === key)?.value;

  return {
    enabled: parseBool(get('whatsapp_bot_enabled')),
    greetingText: String(get('whatsapp_greeting_text') ?? '').trim(),
    // Upper bounds are not paranoia: replyDelaySeconds runs inside EdgeRuntime.waitUntil,
    // which the platform will kill at ~400s wall clock, so a typo'd "600" would silently
    // mean "never sent" rather than "sent late".
    replyDelaySeconds: parseIntInRange(get('whatsapp_reply_delay_seconds'), DEFAULTS.replyDelaySeconds, 0, 300),
    maxBotMessagesPerHour: parseIntInRange(
      get('whatsapp_max_bot_messages_per_hour'), DEFAULTS.maxBotMessagesPerHour, 1, 60
    ),
    pricelistUrl: String(get('whatsapp_pricelist_url') ?? '').trim(),
    pricelistText: String(get('whatsapp_pricelist_text') ?? '').trim(),
  };
}

// The studio-wide hourly ceiling: a blast radius limit, not a politeness setting. If the
// gate ever misfires on a burst of traffic, this is what caps the damage at N strangers
// instead of everyone who wrote in that hour.
//
// Counts rows actually written to whatsapp_messages rather than using
// _shared/rateLimit.ts, for two reasons: that helper counts attempts and fails OPEN by
// design (correct for a couple signing their own contract, wrong for a bot messaging
// strangers), and whatsapp_messages is the honest record of what was really sent.
export async function isUnderHourlyQuota(
  supabase: any,
  tenantId: string,
  maxPerHour: number
): Promise<boolean> {
  const sinceIso = new Date(Date.now() - 3600 * 1000).toISOString();
  const { count, error } = await supabase
    .from('whatsapp_messages')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('direction', 'outbound_bot')
    .gte('created_at', sinceIso);

  if (error) {
    // Fail CLOSED, unlike the generic rate limiter. If we cannot tell how much the bot
    // has already said this hour, the claim we are least entitled to make is "a bit more
    // is fine".
    console.error('[whatsappBotSend] quota lookup failed, assuming exhausted:', error.message);
    return false;
  }
  return (count ?? 0) < maxPerHour;
}

export interface BotSendOutcome {
  sent: boolean;
  error?: string;
}

// Surfaces a failed send where a human will actually look. A bot that fails quietly is
// worse than one that never ran: the conversation sits mid-flow having said nothing,
// and the customer is waiting for a reply that is never coming.
//
// Schema per 0026_notifications_trigger.sql: the text column is `body` (not `message`),
// and `type` is a free-text not-null tag — no check constraint, so the convention is a
// snake_case event name like respond-staff-availability-public's
// 'staff_availability_response'.
async function notifyFailure(supabase: any, tenantId: string, phone: string, what: string) {
  try {
    await supabase.from('notifications').insert({
      tenant_id: tenantId,
      type: 'whatsapp_bot_send_failed',
      title: 'שליחת הודעת בוט נכשלה',
      body: `${what} (${phone}). כדאי לענות ידנית מתוך מסך השיחות.`,
    });
  } catch (e: any) {
    console.error('[whatsappBotSend] notification insert failed:', e?.message || e);
  }
}

// Records a message the bot sent, so it appears in the inbox next to everything a human
// said, tagged `outbound_bot` and never mistakable for Daniel's own words.
//
// Green API's returned idMessage matters more than it looks: the outgoing*MessageReceived
// webhook echoes this same message back to us moments later, and storing the real id
// means that echo lands on the existing (tenant_id, id_message) unique constraint and is
// deduped. Without it the bot's own message would be re-inserted as `outbound_human` and
// would look like Daniel had replied — which would also permanently mute the bot in that
// conversation, since an outbound human message sets bot_enabled = false.
async function recordBotMessage(
  supabase: any,
  { tenantId, conversationId, idMessage, text, typeMessage, mediaUrl }: {
    tenantId: string; conversationId: string; idMessage?: string;
    text: string; typeMessage: string; mediaUrl?: string;
  }
) {
  const { error } = await supabase.from('whatsapp_messages').insert({
    tenant_id: tenantId,
    conversation_id: conversationId,
    id_message: idMessage || `bot-${conversationId}-${Date.now()}`,
    direction: 'outbound_bot',
    type_webhook: 'botSend',
    type_message: typeMessage,
    body_text: text,
    media_url: mediaUrl ?? null,
    // Left null on purpose: bot_would_reply records a decision made ABOUT an inbound
    // message. An outbound row was never a question the gate was asked.
    bot_would_reply: null,
    bot_skip_reason: null,
  });
  if (error) {
    // The customer has the message; only our copy of it failed. Never report this as a
    // failed send — that would trigger a retry and message them twice.
    console.error('[whatsappBotSend] message row insert failed (message WAS sent):', error.message);
  }
}

// Sends one bot message and records it. Returns rather than throws: the caller is
// running inside EdgeRuntime.waitUntil, after the 200 has already gone back to Green
// API, so there is nobody left to throw to.
//
// The recorded row is what makes the message visible in the inbox next to everything a
// human said, tagged `outbound_bot` so it can never be mistaken for Daniel's own words.
export async function sendBotMessage(
  supabase: any,
  {
    tenantId,
    conversationId,
    phone,
    text,
  }: { tenantId: string; conversationId: string; phone: string; text: string }
): Promise<BotSendOutcome> {
  const result = await sendWhatsApp(supabase, phone, text, tenantId);

  if (!result.success) {
    console.error('[whatsappBotSend] send failed:', result.error);
    await notifyFailure(supabase, tenantId, phone, 'לא הצלחנו לשלוח הודעה אוטומטית');
    return { sent: false, error: result.error };
  }

  await recordBotMessage(supabase, {
    tenantId,
    conversationId,
    idMessage: (result.raw as any)?.idMessage,
    text,
    typeMessage: 'textMessage',
  });

  return { sent: true };
}

// Sends the price list: image-with-caption, plain text, or image plus a follow-up
// message, whichever planPricelistSend decided.
//
// Returns sent:true if the CUSTOMER GOT THE PRICE LIST, which is what the caller uses
// to decide whether to move the conversation to PRICELIST_SENT. When a long list is
// split, the image failing means they got nothing — but the follow-up text failing
// after the image succeeded still counts as sent, because re-running would send the
// image a second time. That residual case is reported to Daniel as a notification
// instead, so a human closes the gap rather than the bot repeating itself.
export async function sendPricelist(
  supabase: any,
  {
    tenantId,
    conversationId,
    phone,
    pricelistUrl,
    pricelistText,
  }: {
    tenantId: string; conversationId: string; phone: string;
    pricelistUrl: string; pricelistText: string;
  }
): Promise<BotSendOutcome> {
  const plan = planPricelistSend(pricelistUrl, pricelistText);

  if (!plan.imageUrl && !plan.followUpText) {
    return { sent: false, error: 'no price list configured' };
  }

  if (plan.imageUrl) {
    const fileResult = await sendWhatsAppFileByUrl(
      supabase, phone, plan.imageUrl, 'pricelist.jpg', plan.caption ?? undefined, tenantId
    );
    if (!fileResult.success) {
      console.error('[whatsappBotSend] price list image failed:', fileResult.error);
      await notifyFailure(supabase, tenantId, phone, 'שליחת המחירון נכשלה');
      return { sent: false, error: fileResult.error };
    }
    await recordBotMessage(supabase, {
      tenantId, conversationId,
      idMessage: (fileResult.raw as any)?.idMessage,
      text: plan.caption || '[מחירון — תמונה]',
      typeMessage: 'imageMessage',
      mediaUrl: plan.imageUrl,
    });
  }

  if (plan.followUpText) {
    const textResult = await sendWhatsApp(supabase, phone, plan.followUpText, tenantId);
    if (!textResult.success) {
      console.error('[whatsappBotSend] price list text failed:', textResult.error);
      await notifyFailure(
        supabase, tenantId, phone,
        plan.imageUrl
          ? 'תמונת המחירון נשלחה אבל הטקסט עם הקישורים לא — כדאי לשלוח אותו ידנית'
          : 'שליחת המחירון נכשלה'
      );
      // Image already delivered: report success so the state advances and the customer
      // is not sent the image again.
      return plan.imageUrl ? { sent: true } : { sent: false, error: textResult.error };
    }
    await recordBotMessage(supabase, {
      tenantId, conversationId,
      idMessage: (textResult.raw as any)?.idMessage,
      text: plan.followUpText,
      typeMessage: 'textMessage',
    });
  }

  return { sent: true };
}

// Waits before replying so the bot doesn't answer within the same second the customer
// pressed send, which reads as a machine and is exactly the tell Daniel disliked about
// the previous vendor's bot.
//
// ⚠️ Only ever call this from inside EdgeRuntime.waitUntil, never in the request body:
// Green API pauses the whole webhook for 60s and retries for 24h if a notification is
// not answered promptly, so a delay taken before the 200 would stall every other
// message the studio receives.
export function sleep(seconds: number): Promise<void> {
  if (seconds <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

// How the price list has to be split to survive Green API's 1024-character caption cap.
//
// The studio's real price list is well over that — it carries package prices plus
// Instagram, YouTube, a reviews link and a sample gallery. Truncating it would cut the
// links off the end, so a long one goes out as the image with a short caption first,
// immediately followed by the full text as its own message.
//
// Pure and exported so the decision is testable without sending anything.
export function planPricelistSend(
  pricelistUrl: string,
  pricelistText: string,
  shortCaption = '🧾 המחירון שלנו'
): { imageUrl: string | null; caption: string | null; followUpText: string | null } {
  const url = (pricelistUrl || '').trim();
  const text = (pricelistText || '').trim();

  // No image configured: the text is the whole message. WhatsApp's own limit for a
  // plain text message is far above anything a price list will reach, so no split.
  if (!url) return { imageUrl: null, caption: null, followUpText: text || null };

  // Short enough to ride along with the image as one clean message.
  if (text.length <= WHATSAPP_CAPTION_MAX) {
    return { imageUrl: url, caption: text || null, followUpText: null };
  }

  // Too long: image + placeholder caption, then the real text. Never truncated — the
  // links live at the end, which is exactly what a naive slice() would remove.
  return { imageUrl: url, caption: shortCaption, followUpText: text };
}
