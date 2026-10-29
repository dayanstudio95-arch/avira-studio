// "The couple finished choosing in Pixieset" → WhatsApp to the album group (2026-10-29, the
// owner's request). Called by a small Google Apps Script in the Gmail account Pixieset
// emails (avira.media1), which checks every 5 minutes for "[Pixieset] Check out favorites
// from …" and posts { id, subject, body, html } here. Pixieset itself has no API/webhook.
//
// verify_jwt = false (a Google script has no Supabase session). The credential is the
// x-avira-token header: a random token made in Settings ← חיבורים, stored only as its
// SHA-256 (app_settings.pixieset_notify_token_hash) — the lookup by hash is also how the
// studio (tenant) is found; nothing in the body is trusted for that.
//
// Each Gmail message id is sent once (app_settings.pixieset_notify_seen, the last 200);
// on a failed send nothing is marked, the script doesn't label the email, and the next run
// tries again. The link preview is off: WhatsApp's card for a pixieset URL is what left the
// gallery message on one grey tick (see _shared/whatsapp.ts).
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { checkRateLimitForKey } from '../_shared/rateLimit.ts';
import { hashToken } from '../_shared/albumTokens.ts';
import { sendWhatsApp } from '../_shared/whatsapp.ts';
import {
  parsePixiesetFavoritesEmail, renderPixiesetDone, matchEvent, hebrewDay, PIXIESET_DONE_TEMPLATE_KEY,
} from '../_shared/pixiesetFavorites.ts';

const SEEN_KEY = 'pixieset_notify_seen';
const SEEN_MAX = 200;

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  return fwd ? fwd.split(',')[0].trim() : req.headers.get('cf-connecting-ip')?.trim() || 'unknown';
}

async function setting(supabase: any, tenantId: string, key: string): Promise<string | null> {
  const { data } = await supabase.from('app_settings').select('value').eq('tenant_id', tenantId).eq('key', key).maybeSingle();
  return data?.value ?? null;
}

async function upsertSetting(supabase: any, tenantId: string, key: string, value: string) {
  await supabase.from('app_settings').upsert({ tenant_id: tenantId, key, value }, { onConflict: 'tenant_id,key' });
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse({ error: 'method not allowed' }, { status: 405 });

  const rl = await checkRateLimitForKey(`pixieset-notify:${clientIp(req)}`, { maxHits: 60, windowSeconds: 600 });
  if (!rl.allowed) return jsonResponse({ error: 'too many requests' }, { status: 429 });

  const token = req.headers.get('x-avira-token') || '';
  if (token.length < 20) return jsonResponse({ error: 'unauthorized' }, { status: 401 });

  const supabase = createServiceRoleClient();
  const { data: owner } = await supabase
    .from('app_settings')
    .select('tenant_id')
    .eq('key', 'pixieset_notify_token_hash')
    .eq('value', await hashToken(token))
    .maybeSingle();
  if (!owner?.tenant_id) return jsonResponse({ error: 'unauthorized' }, { status: 401 });
  const tenantId = owner.tenant_id as string;

  let body: any = {};
  try { body = await req.json(); } catch { return jsonResponse({ error: 'bad json' }, { status: 400 }); }
  const id = String(body?.id || '').slice(0, 100);
  if (!id) return jsonResponse({ error: 'missing id' }, { status: 400 });

  const parsed = parsePixiesetFavoritesEmail(String(body.subject || ''), String(body.body || ''), String(body.html || ''));
  if (!parsed) return jsonResponse({ skipped: 'not a favorites email' });

  if ((await setting(supabase, tenantId, 'pixieset_notify_enabled')) === 'false') return jsonResponse({ skipped: 'disabled' });
  const groupChatId = await setting(supabase, tenantId, 'pixieset_notify_group_chat_id');
  if (!groupChatId || !/@g\.us$/.test(groupChatId)) return jsonResponse({ error: 'no WhatsApp group chosen in Settings' }, { status: 409 });

  let seen: string[] = [];
  try { seen = JSON.parse((await setting(supabase, tenantId, SEEN_KEY)) || '[]'); } catch { seen = []; }
  if (seen.includes(id)) return jsonResponse({ duplicate: true });

  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 540 * 86400000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 400 * 86400000).toISOString().slice(0, 10);
  const { data: events } = await supabase
    .from('events')
    .select('id, couple_names, date, source_lead_id')
    .eq('tenant_id', tenantId)
    .gte('date', from)
    .lte('date', to)
    .limit(2000);
  const ev = matchEvent((events || []) as any[], parsed.couple, today);

  const template = await setting(supabase, tenantId, PIXIESET_DONE_TEMPLATE_KEY);
  const text = renderPixiesetDone(template, {
    names: ev?.couple_names || parsed.couple,
    event_date: ev?.date ? hebrewDay(ev.date) : '',
    message: parsed.message,
    link: parsed.link || '',
  });

  const sent = await sendWhatsApp(supabase, groupChatId, text, tenantId, { linkPreview: false });
  if (!sent.success) {
    console.error('[pixieset-favorites-notify] send failed:', sent.error);
    return jsonResponse({ error: 'whatsapp send failed' }, { status: 502 });
  }

  await upsertSetting(supabase, tenantId, SEEN_KEY, JSON.stringify([id, ...seen].slice(0, SEEN_MAX)));
  await upsertSetting(supabase, tenantId, 'pixieset_notify_last_at', new Date().toISOString());
  // The bell too — a trace in the system, linked to the couple's lead when it was found.
  await supabase.from('notifications').insert({
    tenant_id: tenantId,
    type: 'album_pixieset_favorites_done',
    title: `📸 ${ev?.couple_names || parsed.couple} סיימו לבחור תמונות`,
    body: parsed.message || 'הזוג שלח את המועדפים בפיקסיסט. נשלחה הודעה לקבוצת האלבומים.',
    related_lead_id: ev?.source_lead_id || null,
  }).then(() => {}, (e: unknown) => console.error('[pixieset-favorites-notify] bell insert failed:', e));

  return jsonResponse({ sent: true, matchedEvent: !!ev });
});
