// The WhatsApp bot's hourly housekeeping (2026-09-15), run from automation-engine's
// cron path for every tenant, every tick. Three jobs:
//
//   1. Drain deferred sends — what the bot would have said during quiet hours, held in
//      whatsapp_deferred_sends until the window ended.
//   2. Nudge, once, a conversation that went quiet mid-flow.
//   3. Send the daily digest to the studio's alert number at the configured hour.
//
// Why here and not a new cron job: the only scheduler this project can rely on is
// `automation-engine-hourly` (confirmed live). A new job would mean a new secret pasted
// into the dashboard by a non-technical owner. Riding the existing tick costs nothing.
//
// Every send goes through the same guards as the live path — master switch, the
// conversation's own bot_enabled, contact still unknown, hourly quota — and nothing is
// retried: a failed send writes a notification and steps aside for a human.
import {
  loadBotSettings, isUnderHourlyQuota, executeSends, sendBotMessage, notifyFailure,
  type BotSettings, type DeferredSendItem,
} from './whatsappBotSend.ts';
import {
  loadQuietHoursSettings, isInQuietHoursNow, getJerusalemNowHHMM, getJerusalemTodayDateStr,
} from './automationGuards.ts';
import { IN_FLOW_STATES } from './whatsappIntent.ts';
import { composeDigest, type DigestStats } from './whatsappDigest.ts';
import { sendStudioAlert } from './whatsappStudioAlerts.ts';

const DRAIN_BATCH = 20;     // per tenant per tick — the engine has a ~400s wall clock
const NUDGE_BATCH = 20;
// Default only; the tick uses settings.nudgeAfterHours (whatsapp_nudge_after_hours).
const NUDGE_AFTER_MS = 24 * 3600 * 1000;
const DIGEST_LAST_SENT_KEY = 'whatsapp_digest_last_sent_on';

export interface HousekeepingResult {
  drained: number;
  cancelled: number;
  nudged: number;
  digestSent: boolean;
  errors: number;
}

export async function runWhatsAppHousekeeping(supabase: any, tenantId: string): Promise<HousekeepingResult> {
  const r: HousekeepingResult = { drained: 0, cancelled: 0, nudged: 0, digestSent: false, errors: 0 };

  const settings = await loadBotSettings(supabase, tenantId);
  if (!settings) {
    r.errors++;
    return r;
  }

  let inQuiet = true; // fail closed, same as the webhook
  try {
    inQuiet = isInQuietHoursNow(await loadQuietHoursSettings(supabase, tenantId));
  } catch (e: any) {
    console.error('[whatsappHousekeeping] quiet-hours lookup failed, assuming quiet:', e?.message || e);
  }

  if (settings.enabled && !inQuiet) {
    try {
      await drainDeferredSends(supabase, tenantId, settings, r);
    } catch (e: any) {
      r.errors++;
      console.error('[whatsappHousekeeping] drain failed:', e?.message || e);
    }
    try {
      await sendFlowNudges(supabase, tenantId, settings, r);
    } catch (e: any) {
      r.errors++;
      console.error('[whatsappHousekeeping] nudge failed:', e?.message || e);
    }
  }

  // The digest goes out whether or not the bot is on: "the bot is off" is itself a fact
  // the owner should read every morning.
  try {
    r.digestSent = await sendDailyDigest(supabase, tenantId, settings);
  } catch (e: any) {
    r.errors++;
    console.error('[whatsappHousekeeping] digest failed:', e?.message || e);
  }

  return r;
}

// ---------------------------------------------------------------------------------
// 1. Deferred sends
// ---------------------------------------------------------------------------------
async function drainDeferredSends(supabase: any, tenantId: string, settings: BotSettings, r: HousekeepingResult) {
  const nowIso = new Date().toISOString();
  const { data: rows, error } = await supabase
    .from('whatsapp_deferred_sends')
    .select('id, conversation_id, kind, expected_state, payload')
    .eq('tenant_id', tenantId)
    .is('sent_at', null)
    .is('cancelled_reason', null)
    .lte('send_after', nowIso)
    .order('send_after', { ascending: true })
    .limit(DRAIN_BATCH);
  if (error) throw new Error(`deferred select: ${error.message}`);
  if (!rows || rows.length === 0) return;

  const convIds = [...new Set(rows.map((x: any) => x.conversation_id))];
  const { data: convs, error: convErr } = await supabase
    .from('whatsapp_conversations')
    .select('id, state, bot_enabled, phone, contact_type')
    .in('id', convIds);
  if (convErr) throw new Error(`deferred conversations: ${convErr.message}`);
  const byId = new Map((convs || []).map((c: any) => [c.id, c]));

  const cancel = async (id: string, reason: string) => {
    await supabase.from('whatsapp_deferred_sends').update({ cancelled_reason: reason }).eq('id', id);
    r.cancelled++;
  };

  for (const row of rows) {
    const conv: any = byId.get(row.conversation_id);
    if (!conv) { await cancel(row.id, 'conversation_missing'); continue; }
    // The world may have moved on while the message waited. Each of these is a reason
    // the live path would also have stayed silent.
    if (conv.state !== row.expected_state) { await cancel(row.id, 'state_changed'); continue; }
    if (!conv.bot_enabled) { await cancel(row.id, 'bot_muted'); continue; }
    if (conv.contact_type !== 'unknown') { await cancel(row.id, 'known_contact'); continue; }
    if (!conv.phone) { await cancel(row.id, 'no_phone'); continue; }

    // Quota exhausted: stop, don't skip. The rows stay pending for the next hour, in
    // order, instead of some being dropped.
    if (!(await isUnderHourlyQuota(supabase, tenantId, settings.maxBotMessagesPerHour))) break;

    const kind = row.kind === 'greeting' ? 'greeting' : (row.expected_state === 'PRICELIST_SENT' ? 'pricelist' : 'question');
    const outcome = await executeSends(supabase, {
      tenantId,
      conversationId: conv.id,
      phone: conv.phone,
      sends: (row.payload || []) as DeferredSendItem[],
      kind,
    });

    if (outcome.sent) {
      await supabase.from('whatsapp_deferred_sends').update({ sent_at: new Date().toISOString() }).eq('id', row.id);
      await supabase.from('whatsapp_conversations').update({ last_bot_message_at: new Date().toISOString() }).eq('id', conv.id);
      r.drained++;
    } else {
      // executeSends already wrote the notification. No retry — a human answers.
      await cancel(row.id, 'send_failed');
    }
  }
}

// ---------------------------------------------------------------------------------
// 2. The one-time mid-flow nudge
// ---------------------------------------------------------------------------------
export function isStalledInFlow(c: {
  state?: string | null; last_bot_message_at?: string | null; last_inbound_at?: string | null;
}, now = Date.now(), afterMs = NUDGE_AFTER_MS): boolean {
  if (!c.state || !IN_FLOW_STATES.includes(c.state)) return false;
  if (!c.last_bot_message_at) return false;
  const bot = new Date(c.last_bot_message_at).getTime();
  if (!Number.isFinite(bot) || now - bot < afterMs) return false;
  if (!c.last_inbound_at) return true;
  const inbound = new Date(c.last_inbound_at).getTime();
  return !Number.isFinite(inbound) || inbound < bot;
}

async function sendFlowNudges(supabase: any, tenantId: string, settings: BotSettings, r: HousekeepingResult) {
  const afterMs = settings.nudgeAfterHours * 3600 * 1000;
  const cutoff = new Date(Date.now() - afterMs).toISOString();
  const { data: convs, error } = await supabase
    .from('whatsapp_conversations')
    .select('id, state, bot_enabled, phone, contact_type, last_bot_message_at, last_inbound_at')
    .eq('tenant_id', tenantId)
    .in('state', IN_FLOW_STATES)
    .eq('bot_enabled', true)
    .eq('contact_type', 'unknown')
    .is('nudge_sent_at', null)
    .lte('last_bot_message_at', cutoff)
    .order('last_bot_message_at', { ascending: true })
    .limit(NUDGE_BATCH);
  if (error) throw new Error(`nudge select: ${error.message}`);
  const candidates = (convs || []).filter((c: any) => c.phone && isStalledInFlow(c, Date.now(), afterMs));
  if (candidates.length === 0) return;

  // A conversation with a message already waiting for quiet hours to end is not
  // silent — it is about to hear from us.
  const { data: pending } = await supabase
    .from('whatsapp_deferred_sends')
    .select('conversation_id')
    .eq('tenant_id', tenantId)
    .is('sent_at', null)
    .is('cancelled_reason', null)
    .in('conversation_id', candidates.map((c: any) => c.id));
  const hasPending = new Set((pending || []).map((p: any) => p.conversation_id));

  for (const c of candidates) {
    if (hasPending.has(c.id)) continue;
    if (!(await isUnderHourlyQuota(supabase, tenantId, settings.maxBotMessagesPerHour))) break;

    const outcome = await sendBotMessage(supabase, {
      tenantId, conversationId: c.id, phone: c.phone, text: settings.flowNudgeText, kind: 'nudge',
    });
    // Marked either way: a nudge that failed is not retried next hour (sendBotMessage
    // already told a human), and the row must leave the candidate set.
    await supabase
      .from('whatsapp_conversations')
      .update({
        nudge_sent_at: new Date().toISOString(),
        ...(outcome.sent ? { last_bot_message_at: new Date().toISOString() } : {}),
      })
      .eq('id', c.id);
    if (outcome.sent) r.nudged++;
  }
}

// ---------------------------------------------------------------------------------
// 3. Daily digest
// ---------------------------------------------------------------------------------
async function sendDailyDigest(supabase: any, tenantId: string, settings: BotSettings): Promise<boolean> {
  const { hh } = getJerusalemNowHHMM();
  const today = getJerusalemTodayDateStr();
  // `>=` rather than `===`: a tick that failed at the digest hour is retried on the
  // next one, and the date marker stops it going twice.
  if (hh < settings.digestHour) return false;

  const { data: marker } = await supabase
    .from('app_settings')
    .select('value')
    .eq('tenant_id', tenantId)
    .eq('key', DIGEST_LAST_SENT_KEY)
    .maybeSingle();
  if (marker?.value === today) return false;

  const stats = await gatherDigestStats(supabase, tenantId, settings);
  const text = composeDigest(stats, today.split('-').reverse().join('/'));

  const result = await sendStudioAlert(supabase, tenantId, text);
  if (result.skipped === 'no_phone') return false;
  if (!result.sent) {
    await notifyFailure(supabase, tenantId, '—', 'הסיכום היומי של הבוט לא נשלח', 'whatsapp_digest_failed');
    return false;
  }

  // Marked only after a successful send.
  const { error } = await supabase
    .from('app_settings')
    .upsert({ tenant_id: tenantId, key: DIGEST_LAST_SENT_KEY, value: today }, { onConflict: 'tenant_id,key' });
  if (error) console.error('[whatsappHousekeeping] digest marker write failed:', error.message);
  return true;
}

async function gatherDigestStats(supabase: any, tenantId: string, settings: BotSettings): Promise<DigestStats> {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const count = async (build: (q: any) => any): Promise<number> => {
    const q = build(supabase.from('whatsapp_conversations').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId));
    const { count: n } = await q;
    return n ?? 0;
  };

  const [newStrangers, waitingFollowUp, mediaFromStrangers] = await Promise.all([
    count((q) => q.eq('contact_type', 'unknown').gte('created_at', since)),
    count((q) => q.eq('state', 'PRICELIST_SENT').is('followup_sent_at', null).is('lead_temperature', null)),
    count((q) => q.eq('contact_type', 'unknown').eq('state', 'NEW').eq('bot_last_decision', 'not_text').eq('bot_enabled', true).gte('last_inbound_at', weekAgo)),
  ]);

  const { data: botSends } = await supabase
    .from('whatsapp_messages')
    .select('type_webhook')
    .eq('tenant_id', tenantId)
    .eq('direction', 'outbound_bot')
    .gte('created_at', since)
    .limit(1000);
  const greetings = (botSends || []).filter((m: any) => m.type_webhook === 'bot:greeting').length;
  const pricelists = (botSends || []).filter((m: any) => m.type_webhook === 'bot:pricelist').length;

  const { count: inboundMessages } = await supabase
    .from('whatsapp_messages')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('direction', 'inbound')
    .gte('created_at', since);

  const { data: hot } = await supabase
    .from('whatsapp_conversations')
    .select('couple_names, display_name, phone')
    .eq('tenant_id', tenantId)
    .eq('lead_temperature', 'hot')
    .gte('lead_temperature_at', since)
    .limit(20);
  const hotLeads = (hot || []).map((c: any) => c.couple_names || c.display_name || c.phone).filter(Boolean);

  const { data: inFlow } = await supabase
    .from('whatsapp_conversations')
    .select('state, last_bot_message_at, last_inbound_at')
    .eq('tenant_id', tenantId)
    .in('state', IN_FLOW_STATES)
    .eq('bot_enabled', true)
    .limit(500);
  const stalledFlow = (inFlow || []).filter((c: any) => isStalledInFlow(c, Date.now(), settings.nudgeAfterHours * 3600 * 1000)).length;

  const { count: deferredPending } = await supabase
    .from('whatsapp_deferred_sends')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .is('sent_at', null)
    .is('cancelled_reason', null);

  return {
    newStrangers,
    greetings,
    pricelists,
    hotLeads,
    waitingFollowUp,
    stalledFlow,
    mediaFromStrangers,
    deferredPending: deferredPending ?? 0,
    inboundMessages: inboundMessages ?? 0,
    botEnabled: settings.enabled,
  };
}
