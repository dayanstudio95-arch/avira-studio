// Sends Web Push notifications to the studio's devices (stage 1ב, 2026-10-05).
//
// Library: jsr:@negrel/webpush 0.5.0 (RFC 8291 / 8292, WebCrypto — runs in Deno). Usage
// taken from its own example server (example/main.ts in the repo), not from memory:
//   importVapidKeys(jwks, { extractable: false }) → ApplicationServer.new({
//   contactInformation, vapidKeys }) → appServer.subscribe(subscription)
//   .pushTextMessage(text, { ttl, urgency, topic }); a PushMessageError with isGone()
//   means the device unsubscribed and the row is deleted.
//
// Keys: the VAPID_KEYS_B64 Edge Function secret (base64 of {publicKey, privateKey} JWKs),
// set once by the owner from .secrets/vapid.json. Without it nothing is sent and nothing
// breaks — notifications are an addition, never a dependency.
//
// Never throws. Every caller runs this after the webhook has already answered.
import * as webpush from 'jsr:@negrel/webpush@0.5.0';
import { categoryForContactType, shouldNotify, type PushCategory } from './pushPrefs.ts';
import { getJerusalemNowHHMM } from './automationGuards.ts';

let appServerPromise: Promise<any> | null = null;

function appServer(): Promise<any> | null {
  if (appServerPromise) return appServerPromise;
  const b64 = Deno.env.get('VAPID_KEYS_B64');
  if (!b64) return null;
  appServerPromise = (async () => {
    const jwks = JSON.parse(atob(b64));
    const vapidKeys = await webpush.importVapidKeys(jwks, { extractable: false });
    return await webpush.ApplicationServer.new({
      // A URL, not a person's e-mail: this goes to Apple's and Google's push services.
      contactInformation: 'https://new.avira-studio.com',
      vapidKeys,
    });
  })();
  appServerPromise.catch(() => { appServerPromise = null; });
  return appServerPromise;
}

export interface PushPayload {
  title: string;
  body: string;
  conversationId?: string | null;
}

async function unreadBadge(supabase: any, tenantId: string): Promise<number | null> {
  try {
    const { data } = await supabase
      .from('whatsapp_conversations')
      .select('id, last_inbound_at, last_read_at, contact_type, archived_at')
      .eq('tenant_id', tenantId)
      .is('archived_at', null)
      .not('last_inbound_at', 'is', null)
      .limit(1000);
    return (data || []).filter((c: any) =>
      c.contact_type !== 'group' && (!c.last_read_at || c.last_inbound_at > c.last_read_at)
    ).length;
  } catch {
    return null;
  }
}

// Send to every device of the tenant whose switches allow `category`.
export async function sendPush(
  supabase: any, tenantId: string, category: PushCategory, payload: PushPayload,
  onlySubscriptionId?: string,
): Promise<{ sent: number; skipped: number; removed: number }> {
  const out = { sent: 0, skipped: 0, removed: 0 };
  try {
    const server = appServer();
    if (!server) return out;
    let q = supabase.from('push_subscriptions').select('id, endpoint, p256dh, auth, prefs, failure_count').eq('tenant_id', tenantId);
    if (onlySubscriptionId) q = q.eq('id', onlySubscriptionId);
    const { data: subs, error } = await q;
    if (error || !subs?.length) return out;

    const t = getJerusalemNowHHMM();
    const now = `${String(t.hh).padStart(2, '0')}:${String(t.mm).padStart(2, '0')}`;
    const targets = onlySubscriptionId ? subs : subs.filter((s: any) => shouldNotify(s.prefs, category, now));
    out.skipped = subs.length - targets.length;
    if (!targets.length) return out;

    const app = await server;
    const badge = await unreadBadge(supabase, tenantId);
    const text = JSON.stringify({
      title: payload.title.slice(0, 80),
      body: payload.body.slice(0, 180),
      url: payload.conversationId ? `/chat?c=${payload.conversationId}` : '/chat',
      tag: payload.conversationId ? `c-${payload.conversationId}` : `a-${category}`,
      badge,
    });
    // Topic: a newer notification for the same chat replaces one still waiting in the push
    // service (max 32 url-safe characters — a uuid without dashes is exactly 32).
    const topic = payload.conversationId ? payload.conversationId.replace(/-/g, '').slice(0, 32) : undefined;

    for (const s of targets) {
      try {
        const subscriber = app.subscribe({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } });
        await subscriber.pushTextMessage(text, { ttl: 24 * 3600, urgency: webpush.Urgency.High, topic });
        out.sent++;
        await supabase.from('push_subscriptions').update({ last_sent_at: new Date().toISOString(), failure_count: 0 }).eq('id', s.id);
      } catch (e: any) {
        if (e instanceof webpush.PushMessageError && e.isGone()) {
          await supabase.from('push_subscriptions').delete().eq('id', s.id);
          out.removed++;
        } else {
          console.error('[webPush] send failed:', e?.message || e);
          await supabase.from('push_subscriptions').update({ failure_count: (s.failure_count || 0) + 1 }).eq('id', s.id);
        }
      }
    }
  } catch (e: any) {
    console.error('[webPush] failed:', e?.message || e);
  }
  return out;
}

export { categoryForContactType };
