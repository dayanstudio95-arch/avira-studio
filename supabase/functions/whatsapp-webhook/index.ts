// Green API incoming-webhook receiver — STAGE 2: the bot may now send a greeting.
//
// ⚠️ It sends ONLY when the tenant's `whatsapp_bot_enabled` setting is explicitly true.
// That key does not exist until someone sets it in the Settings screen, and anything
// other than an affirmative value reads as off (_shared/whatsappBotSend.ts), so the
// default state of this function is still total silence. Authorised by the user on
// 2026-09-08, replacing a paid third-party bot they had switched off for replying to
// couples with things that didn't apply to them.
//
// The bot sends exactly one kind of message today: a greeting to a stranger whose first
// message the gate recognised as a photography inquiry. Parsing their answer and sending
// the price list is Stage 3 and is not wired up here yet.
//
// How the decision is made, and why it is trusted enough to act on:
//   - WHO gets a reply is decided entirely by _shared/whatsappIntent.ts, unchanged by
//     Stage 2. It was built as a dry run (migration 0056) that recorded "I would have
//     replied to this" without sending, precisely so it could be judged against real
//     traffic instead of on faith. That measurement found and fixed five real defects
//     before a single message was ever sent — including a Hebrew final-letter bug that
//     silently broke matching, and a competing lab's out-of-office auto-reply that
//     scored as a customer asking about availability.
//   - WHETHER the studio is currently willing to send at all — master switch, hourly
//     ceiling, quiet hours — is decided in _shared/whatsappBotSend.ts. Every one of
//     those guards fails closed.
//   - The verdict is still recorded on every inbound row exactly as it was during the
//     dry run, so the inbox remains an audit trail of what the gate decided and why.
//
// Why that caution: the studio runs ONE Green API instance, already used by 11+ Edge
// Functions to send contracts, payment reminders, questionnaires, staff schedules and
// album sketches. Turning on `incomingWebhook` routes every reply from everyone here —
// couples mid-production, photographers, editors, group chats. See contact_type below.
//
// Green API contract (verified against green-api.com's official webhook docs,
// 2026-09-08):
//   - Delivery is an HTTP POST with `Authorization: Bearer <webhookUrlToken>`
//     (Bearer is the default when the token is configured without a type prefix).
//   - We MUST answer 200. On a non-200 or a timeout (180s), Green API pauses 60
//     seconds and resends the SAME notification, retrying for up to 24 hours.
//     => the handler has to be idempotent, which is what
//        whatsapp_messages' `unique (tenant_id, id_message)` provides.
//   - Payload shape:
//       { typeWebhook, instanceData: { idInstance, wid, typeInstance }, timestamp,
//         idMessage, senderData: { chatId, sender, chatName, senderName,
//         senderContactName }, messageData: { typeMessage, ... } }
//
// Auth: `verify_jwt = false` in config.toml (Green API cannot supply a Supabase user
// JWT), so the webhookUrlToken checked in this file IS the authentication. It is
// REQUIRED — if no token is configured for the tenant we reject rather than accept
// anonymous writes, because an unauthenticated writer could otherwise inject fake
// conversations into the inbox today, and (once Stage 2 lands) trick the studio's own
// WhatsApp number into messaging arbitrary people.
//
// Never log a raw message body or token at info level — these are real customer
// conversations.

import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { normalizeIsraeliPhone, chatIdToLocalPhone, isGroupChatId } from '../_shared/phone.ts';
import { loadQuietHoursSettings, isInQuietHoursNow } from '../_shared/automationGuards.ts';
import { decideBotReply } from '../_shared/whatsappIntent.ts';
import { loadBotSettings, isUnderHourlyQuota, sendBotMessage, sleep } from '../_shared/whatsappBotSend.ts';

const PG_UNIQUE_VIOLATION = '23505';

// Green API webhook types that carry an actual chat message we want to record.
// Everything else (outgoingMessageStatus / stateInstanceChanged / deviceInfo /
// incomingCall / quotaExceeded / ...) is acknowledged with 200 and ignored.
const INBOUND_TYPES = ['incomingMessageReceived'];
const OUTBOUND_TYPES = ['outgoingMessageReceived', 'outgoingAPIMessageReceived'];

interface ExtractedMessage {
  typeMessage: string | null;
  bodyText: string | null;
  mediaUrl: string | null;
}

// Defensive extractor: Green API has ~15 message shapes and adds more over time. We
// pull text/media where we recognize the shape and otherwise fall back to the type
// name — the complete payload is stored in `raw` either way, so nothing is ever lost.
function extractMessage(messageData: any): ExtractedMessage {
  if (!messageData || typeof messageData !== 'object') {
    return { typeMessage: null, bodyText: null, mediaUrl: null };
  }
  const typeMessage: string | null = messageData.typeMessage ?? null;

  const text =
    messageData.textMessageData?.textMessage ??
    messageData.extendedTextMessageData?.text ??
    messageData.fileMessageData?.caption ??
    messageData.templateMessageData?.contentText ??
    null;

  const mediaUrl = messageData.fileMessageData?.downloadUrl ?? null;

  // Shapes with no text at all get a short human-readable placeholder so the inbox
  // thread doesn't render an empty bubble.
  let bodyText: string | null = typeof text === 'string' && text.trim() ? text : null;
  if (!bodyText) {
    if (messageData.locationMessageData) {
      const loc = messageData.locationMessageData;
      bodyText = `📍 ${[loc.nameLocation, loc.address].filter(Boolean).join(' — ') || 'מיקום'}`;
    } else if (messageData.contactMessageData) {
      bodyText = `👤 ${messageData.contactMessageData.displayName || 'איש קשר'}`;
    } else if (messageData.fileMessageData?.fileName) {
      bodyText = `📎 ${messageData.fileMessageData.fileName}`;
    }
  }

  return { typeMessage, bodyText, mediaUrl };
}

// Resolves which tenant this instance belongs to. There is no tenant_id anywhere in a
// Green API payload, so the instance id is the only link — matched against the
// whatsapp_instance_id each tenant already configures in Settings → Integrations.
// Deliberately does NOT fall back to "the only tenant" when unmatched: this codebase
// is multi-tenant and a wrong-tenant write would leak one studio's conversations into
// another's inbox.
async function resolveTenantId(supabase: any, idInstance: unknown): Promise<string | null> {
  if (idInstance === null || idInstance === undefined) return null;
  const { data, error } = await supabase
    .from('app_settings')
    .select('tenant_id, value')
    .eq('key', 'whatsapp_instance_id')
    .eq('value', String(idInstance))
    .limit(1);
  if (error) {
    console.error('[whatsapp-webhook] tenant lookup failed:', error.message);
    return null;
  }
  return data?.[0]?.tenant_id ?? null;
}

async function loadWebhookToken(supabase: any, tenantId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('tenant_secrets')
    .select('value')
    .eq('tenant_id', tenantId)
    .eq('key', 'whatsapp_webhook_token')
    .limit(1);
  if (error) {
    console.error('[whatsapp-webhook] token lookup failed:', error.message);
    return null;
  }
  const value = data?.[0]?.value;
  // Trimmed on purpose, and this is not cosmetic. The presented header is trimmed
  // below, so without the same treatment here a token pasted into Settings with a
  // trailing space or newline — the single easiest mistake to make when copying a
  // secret between two browser tabs — can never match, and the only symptom is a
  // silent "token mismatch" for every message forever.
  const token = value ? String(value).trim() : '';
  return token || null;
}

// Constant-time-ish comparison. The token is short and this endpoint is rate-limited,
// so this is belt-and-braces rather than load-bearing.
function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface ContactMatch {
  contactType: 'unknown' | 'lead' | 'client' | 'staff' | 'group';
  leadId: string | null;
  eventId: string | null;
}

// THE safety check of this whole module.
//
// Phones are compared in normalized local form on BOTH sides: the DB stores
// '0501234567' (sometimes with spaces/dashes/bidi junk from a paste), while Green API
// delivers '972501234567@c.us'. Comparing the raw strings matches nothing, which would
// classify every existing client and every photographer as an unknown stranger — and,
// in Stage 2, price-list them. That is why this normalizes in JS over a small set of
// phone columns instead of doing an `.eq()` in SQL.
//
// Precedence is deliberate: client (has a signed event) beats lead beats staff, so a
// couple who is also in the leads table is never treated as a fresh inquiry.
async function classifyContact(supabase: any, tenantId: string, phone: string | null): Promise<ContactMatch> {
  const none: ContactMatch = { contactType: 'unknown', leadId: null, eventId: null };
  if (!phone) return none;

  const [leadsRes, eventsRes, staffRes, profilesRes] = await Promise.all([
    supabase
      .from('leads')
      .select('id, phone_number, signed_phone_number, production_bride_phone, production_groom_phone')
      .eq('tenant_id', tenantId),
    supabase.from('events').select('id, phone_number').eq('tenant_id', tenantId),
    supabase.from('staff_members').select('id, phone_number').eq('tenant_id', tenantId),
    supabase.from('profiles').select('id, phone').eq('tenant_id', tenantId),
  ]);

  if (leadsRes.error || eventsRes.error || staffRes.error || profilesRes.error) {
    // Fail CLOSED, unlike the rate limiter: if we can't prove this number is a
    // stranger, we must not let a later stage treat it as one. 'staff' is the safest
    // label because the bot never acts on it.
    console.error(
      '[whatsapp-webhook] contact classification failed, defaulting to staff (bot-silent):',
      leadsRes.error?.message || eventsRes.error?.message || staffRes.error?.message || profilesRes.error?.message
    );
    return { contactType: 'staff', leadId: null, eventId: null };
  }

  const matches = (value: unknown) => !!value && normalizeIsraeliPhone(value) === phone;

  const event = (eventsRes.data || []).find((e: any) => matches(e.phone_number));
  if (event) return { contactType: 'client', leadId: null, eventId: event.id };

  const leads = leadsRes.data || [];
  const productionLead = leads.find(
    (l: any) => matches(l.production_bride_phone) || matches(l.production_groom_phone)
  );
  if (productionLead) return { contactType: 'client', leadId: productionLead.id, eventId: null };

  const lead = leads.find((l: any) => matches(l.phone_number) || matches(l.signed_phone_number));
  if (lead) return { contactType: 'lead', leadId: lead.id, eventId: null };

  if ((staffRes.data || []).some((s: any) => matches(s.phone_number))) {
    return { contactType: 'staff', leadId: null, eventId: null };
  }
  if ((profilesRes.data || []).some((p: any) => matches(p.phone))) {
    return { contactType: 'staff', leadId: null, eventId: null };
  }

  return none;
}

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, { status: 405 });
  }

  // Generous limit: this is a machine caller, and Green API legitimately bursts when
  // it flushes a backlog. Fails open (see rateLimit.ts), so a limiter hiccup can never
  // cost us a real message.
  const limit = await checkRateLimit(req, 'whatsapp-webhook', { maxHits: 600, windowSeconds: 600 });
  if (!limit.allowed) {
    return jsonResponse({ error: 'Too many requests' }, { status: 429 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    // Unparseable body is permanent — answer 200 so Green API stops retrying it for
    // the next 24 hours.
    console.warn('[whatsapp-webhook] unparseable body, acknowledging');
    return jsonResponse({ ok: true, ignored: 'unparseable' });
  }

  const typeWebhook: string = payload?.typeWebhook || '';
  const supabase = createServiceRoleClient();

  const tenantId = await resolveTenantId(supabase, payload?.instanceData?.idInstance);
  if (!tenantId) {
    console.warn(`[whatsapp-webhook] no tenant for idInstance=${payload?.instanceData?.idInstance}`);
    return jsonResponse({ ok: true, ignored: 'unknown_instance' });
  }

  // ---- Authentication -------------------------------------------------------
  const expectedToken = await loadWebhookToken(supabase, tenantId);
  if (!expectedToken) {
    // Refusing (rather than accepting) when unconfigured is intentional — see header.
    console.error('[whatsapp-webhook] no whatsapp_webhook_token configured for tenant; rejecting');
    return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
  }
  const authHeader = req.headers.get('Authorization') || '';
  const presented = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!presented || !tokensMatch(presented, expectedToken)) {
    // Lengths only — never the values themselves, and never the raw header. Which of
    // the two sides is wrong is otherwise unknowable from outside, and a bare
    // "mismatch" sends you round-tripping through the Green API console guessing.
    // Equal lengths point at a typo or a case difference; different lengths usually
    // mean one side got stray whitespace or an outright different string.
    console.warn(
      `[whatsapp-webhook] token mismatch; rejecting ` +
        `(header ${presented.length} chars, configured ${expectedToken.length} chars` +
        `${authHeader ? '' : ', no Authorization header sent'})`
    );
    return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
  }

  const isInbound = INBOUND_TYPES.includes(typeWebhook);
  const isOutbound = OUTBOUND_TYPES.includes(typeWebhook);
  if (!isInbound && !isOutbound) {
    // Status receipts, instance-state changes, calls, quota warnings — nothing to
    // record in Stage 1.
    return jsonResponse({ ok: true, ignored: typeWebhook || 'unknown_type' });
  }

  const idMessage: string | null = payload?.idMessage ? String(payload.idMessage) : null;
  const chatId: string | null = payload?.senderData?.chatId ? String(payload.senderData.chatId) : null;
  if (!idMessage || !chatId) {
    console.warn(`[whatsapp-webhook] ${typeWebhook} without idMessage/chatId, acknowledging`);
    return jsonResponse({ ok: true, ignored: 'missing_ids' });
  }

  try {
    const isGroup = isGroupChatId(chatId);
    const phone = chatIdToLocalPhone(chatId);
    // Whose name this is depends entirely on the direction, and getting it wrong names
    // the conversation after ourselves. Verified against Green API's documented
    // payloads (notifications-format/{incoming,outgoing}-message):
    //
    //   inbound  — sender* describe the person who wrote to us. senderContactName is
    //              their entry in our own phonebook, so it is the best of the three.
    //   outbound — `sender` is the studio's own number, so senderName /
    //              senderContactName are the STUDIO ("AVIRA אווירה צלמים אווירה"), not
    //              the person we wrote to. Only `chatName` names the other side, since
    //              the chat is keyed by `chatId` = the recipient.
    //
    // Reading sender* on an outbound webhook is what titled five separate chats — five
    // different phone numbers — "AVIRA אווירה צלמים אווירה" on the first morning:
    // every conversation whose first-ever webhook happened to be one of ours going out
    // (a contract, a reminder, or Daniel replying from his phone) was named after us.
    const senderData = payload?.senderData || {};
    const displayName = isInbound
      ? senderData.senderContactName || senderData.senderName || senderData.chatName || null
      : senderData.chatName || null;

    // ---- Conversation (create or fetch) -------------------------------------
    const { data: existingRows, error: convSelectError } = await supabase
      .from('whatsapp_conversations')
      .select('id, contact_type, bot_enabled, display_name, state, bot_would_reply_at')
      .eq('tenant_id', tenantId)
      .eq('chat_id', chatId)
      .limit(1);
    if (convSelectError) throw new Error(`conversation lookup: ${convSelectError.message}`);

    let conversation = existingRows?.[0] ?? null;

    if (!conversation) {
      const match = isGroup
        ? { contactType: 'group' as const, leadId: null, eventId: null }
        : await classifyContact(supabase, tenantId, phone);

      const { data: inserted, error: insertConvError } = await supabase
        .from('whatsapp_conversations')
        .insert({
          tenant_id: tenantId,
          chat_id: chatId,
          phone,
          contact_type: match.contactType,
          matched_lead_id: match.leadId,
          matched_event_id: match.eventId,
          display_name: displayName,
        })
        .select('id, contact_type, bot_enabled, display_name, state, bot_would_reply_at')
        .single();

      if (insertConvError) {
        if (insertConvError.code === PG_UNIQUE_VIOLATION) {
          // Two webhooks for a brand-new chat arrived concurrently; re-read the row
          // the other one created.
          const { data: raced } = await supabase
            .from('whatsapp_conversations')
            .select('id, contact_type, bot_enabled, display_name, state, bot_would_reply_at')
            .eq('tenant_id', tenantId)
            .eq('chat_id', chatId)
            .limit(1);
          conversation = raced?.[0] ?? null;
        }
        if (!conversation) throw new Error(`conversation insert: ${insertConvError.message}`);
      } else {
        conversation = inserted;
      }
    }

    const { typeMessage, bodyText, mediaUrl } = extractMessage(payload?.messageData);
    const direction = isInbound ? 'inbound' : 'outbound_human';

    // ---- Re-classification (must happen BEFORE the verdict) -----------------
    //
    // A stranger can become a lead later (Daniel presses "צור ליד", or adds them by
    // hand, or fills in the couple's second phone number). Re-classify while the label
    // still says 'unknown' so it — and the bot-eligibility decision below — stays
    // truthful. Settled labels are left alone.
    //
    // The order is load-bearing: this used to run after the message insert, but the
    // dry-run verdict reads contact_type, and a verdict computed from a stale 'unknown'
    // would report "would reply" for someone we had just learned is a client. Running
    // it first costs one extra classification pass on the rare redelivery, which is a
    // trade worth making for a decision that Stage 2 will act on.
    let effectiveContactType = conversation.contact_type;
    let reclassified: ContactMatch | null = null;
    if (conversation.contact_type === 'unknown' && !isGroup && phone) {
      const match = await classifyContact(supabase, tenantId, phone);
      if (match.contactType !== 'unknown') {
        reclassified = match;
        effectiveContactType = match.contactType;
      }
    }

    // ---- Dry-run verdict ----------------------------------------------------
    //
    // ⚠️ Computes what Stage 2 WOULD do. Sends nothing — there is no branch below that
    // sends, deliberately. When Stage 2 is authorised the send goes here, guarded by
    // `decision.wouldReply`, and the gate chain itself needs no change.
    //
    // Only inbound messages get a verdict. Outbound rows are left null so that "the bot
    // chose silence" is never confused with "nothing was ever asked of the bot".
    let decision: ReturnType<typeof decideBotReply> | null = null;
    if (isInbound) {
      // Quiet hours costs a DB read, so it's only fetched when the cheap gates have
      // already passed — otherwise the chain would have stopped before reaching it and
      // the value would be thrown away. Passing `false` when unreachable is safe for
      // exactly that reason.
      const cheapGatesPass =
        !isGroup &&
        effectiveContactType === 'unknown' &&
        conversation.bot_enabled &&
        conversation.state === 'NEW' &&
        !conversation.bot_would_reply_at;

      let inQuietHours = false;
      if (cheapGatesPass) {
        try {
          inQuietHours = isInQuietHoursNow(await loadQuietHoursSettings(supabase, tenantId));
        } catch (quietErr: any) {
          // Fail CLOSED, like classifyContact. If we can't tell what time it is for
          // this tenant, "the bot would have messaged a stranger" is the claim we are
          // least entitled to make.
          console.error('[whatsapp-webhook] quiet-hours lookup failed, assuming quiet:', quietErr?.message || quietErr);
          inQuietHours = true;
        }
      }

      decision = decideBotReply({
        contactType: effectiveContactType,
        botEnabled: !!conversation.bot_enabled,
        state: conversation.state || 'NEW',
        isGroup,
        typeMessage,
        bodyText,
        inQuietHours,
        alreadyDecidedToReply: !!conversation.bot_would_reply_at,
      });
    }

    // ---- Message (this insert IS the dedupe) --------------------------------
    const { error: msgError } = await supabase.from('whatsapp_messages').insert({
      tenant_id: tenantId,
      conversation_id: conversation.id,
      id_message: idMessage,
      direction,
      type_webhook: typeWebhook,
      type_message: typeMessage,
      body_text: bodyText,
      media_url: mediaUrl,
      raw: payload,
      bot_would_reply: decision ? decision.wouldReply : null,
      bot_skip_reason: decision ? decision.reason : null,
    });

    if (msgError) {
      if (msgError.code === PG_UNIQUE_VIOLATION) {
        // Green API redelivered a notification we already handled. Exit without
        // touching anything else — this is the retry path, and it must be a no-op.
        return jsonResponse({ ok: true, duplicate: true });
      }
      throw new Error(`message insert: ${msgError.message}`);
    }

    // ---- Conversation aggregates --------------------------------------------
    const nowIso = new Date().toISOString();
    const updates: Record<string, unknown> = {
      last_message_at: nowIso,
      last_message_preview: bodyText ? bodyText.slice(0, 200) : typeMessage,
    };
    if (isInbound) {
      updates.last_inbound_at = nowIso;
      // Overwrite rather than fill-if-empty. An inbound name is authoritative — it is
      // the contact naming themselves, or our own phonebook naming them — so the newest
      // one always wins. This is also what repairs the rows already mislabelled with the
      // studio's own name by the outbound bug above: they heal by themselves the next
      // time that contact writes in, with no backfill migration needed.
      if (displayName && displayName !== conversation.display_name) {
        updates.display_name = displayName;
      }
    }

    if (isOutbound) {
      // Self-repair for chats that may never receive another inbound message. On an
      // outbound webhook the sender* fields are the studio's own name, so a stored
      // display_name equal to one of them cannot be a real contact name — it can only
      // be residue of the direction bug fixed above. `chatName` is the correct value.
      const ourOwnName = senderData.senderContactName || senderData.senderName || null;
      const storedIsUs = ourOwnName && conversation.display_name === ourOwnName;
      if (displayName && (storedIsUs || !conversation.display_name)) {
        updates.display_name = displayName;
      }

      // ⚠️ THE most important line in this module. Green API reports a message the
      // studio sent from its own phone (or from any of our other Edge Functions) as
      // outgoing*MessageReceived. The moment a human is in the conversation the bot
      // must fall silent in it permanently — otherwise, once Stage 2 is live, it would
      // talk over Daniel mid-sentence in front of a client.
      updates.bot_enabled = false;
    }

    // Persist the re-classification computed above the message insert.
    if (reclassified) {
      updates.contact_type = reclassified.contactType;
      updates.matched_lead_id = reclassified.leadId;
      updates.matched_event_id = reclassified.eventId;
    }

    // Conversation-level mirror of the verdict, so the inbox list can flag the chats
    // worth reviewing without loading every message. `bot_would_reply_at` is set once
    // and never cleared: it marks "the gate opened here at least once", which is the
    // exact population a human should read through before Stage 2 is switched on. It
    // also stands in for the state transition the dry run can't perform — see
    // `alreadyDecidedToReply` in _shared/whatsappIntent.ts.
    if (decision) {
      updates.bot_last_decision = decision.reason;
      if (decision.wouldReply && !conversation.bot_would_reply_at) {
        updates.bot_would_reply_at = nowIso;
      }
    }

    // ---- Stage 2: should the bot actually greet this person? ------------------
    //
    // `decision.wouldReply` answered "does this person qualify". The remaining checks
    // ask "is the studio willing to send right now" — a separate question with its own
    // switches, all of which fail closed. Quiet hours is NOT rechecked here: it is
    // already a gate inside decideBotReply, so a message arriving at 02:00 never reaches
    // this branch at all.
    let greeting: string | null = null;
    let replyDelaySeconds = 0;
    if (decision?.wouldReply) {
      const botSettings = await loadBotSettings(supabase, tenantId);
      if (!botSettings) {
        console.warn('[whatsapp-webhook] bot settings unreadable — not sending');
      } else if (!botSettings.enabled) {
        // The normal state until the studio flips the master switch. Not an error: the
        // verdict above is still recorded, so the dry run keeps working unchanged.
      } else if (!botSettings.greetingText) {
        console.warn('[whatsapp-webhook] bot enabled but no greeting text configured — not sending');
      } else if (!(await isUnderHourlyQuota(supabase, tenantId, botSettings.maxBotMessagesPerHour))) {
        console.warn('[whatsapp-webhook] hourly bot quota reached — not sending');
      } else {
        greeting = botSettings.greetingText;
        replyDelaySeconds = botSettings.replyDelaySeconds;
        // ⚠️ Advance the state BEFORE sending, not after. The customer may well send
        // three messages in a row ("היי" / "מתחתן ביוני" / "כמה זה עולה") while the
        // reply delay is still counting down; each one is a separate webhook that would
        // otherwise re-run this branch and greet them again. `state !== 'NEW'` is a gate
        // inside decideBotReply, so writing it here closes that window. The cost of
        // being wrong in this direction is a greeting that never arrives — visible in
        // the inbox, and recoverable by hand. The cost of the other direction is
        // greeting a stranger three times.
        updates.state = 'AWAITING_DETAILS';
        updates.last_bot_message_at = nowIso;
      }
    }

    const { error: updateError } = await supabase
      .from('whatsapp_conversations')
      .update(updates)
      .eq('id', conversation.id);
    if (updateError) {
      // The message is already safely stored; a failed aggregate update is cosmetic,
      // and returning non-200 here would make Green API redeliver a message we have.
      console.error('[whatsapp-webhook] conversation update failed:', updateError.message);
      // ...but it is NOT cosmetic when a send is pending: the row still says state='NEW',
      // so the next inbound message would greet this person a second time. Stand down.
      greeting = null;
    }

    // ---- The send, after the 200 ---------------------------------------------
    //
    // Green API pauses the entire webhook for 60s and retries for up to 24h if a
    // notification is not answered promptly, so the reply delay must never be taken
    // inside the request body. EdgeRuntime.waitUntil keeps the work alive after the
    // response has gone back.
    if (greeting && phone) {
      const text = greeting;
      const delaySeconds = replyDelaySeconds;
      EdgeRuntime.waitUntil(
        (async () => {
          try {
            await sleep(delaySeconds);
            await sendBotMessage(supabase, {
              tenantId,
              conversationId: conversation.id,
              phone,
              text,
            });
          } catch (sendErr: any) {
            // Nothing above us can catch this — the response is long gone.
            console.error('[whatsapp-webhook] deferred greeting failed:', sendErr?.message || sendErr);
          }
        })()
      );
    }

    return jsonResponse({ ok: true });
  } catch (e: any) {
    // Return 500 so Green API retries in 60s — a transient DB error should not lose a
    // customer's message. The unique constraint makes that retry safe.
    console.error('[whatsapp-webhook] failed:', e?.message || e);
    return jsonResponse({ error: 'Internal error' }, { status: 500 });
  }
});
