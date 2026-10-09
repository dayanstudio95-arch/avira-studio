// AI sales help in the chat (2026-10-09) — "✨ הצע תשובה", "שפר" (+ "קצר יותר" / "חם יותר")
// and the conversation summary bar ("מה כבר הצעתי").
//
// ⚠️ Sends nothing. Every action returns text; the screen puts it in the box and a person
// reads, edits and presses send. The price rules (_shared/aiSalesRules.ts) decide which
// numbers a suggestion may name — the model never sees a price below the floor.
//
// Actions (body.action):
//   suggest  { conversationId }                       → { suggestions:[{label,text}], note }
//   improve  { text, tweak?: 'shorter'|'warmer' }     → { text }
//   summary  { conversationId, force? }               → { summary } (cached until a new message)
//   settings {}                                       → defaults + this month's spend (no AI call)
//
// Roles: owner / admin / studio_manager / lead_coordinator (the people who answer chats).
// The studio's own Anthropic key (tenant_secrets.anthropic_api_key) first, then the platform
// key. Every call is metered in ai_usage; past the monthly cap (app_settings
// ai_monthly_cap_ils, default 50 ₪) the buttons answer "הגעתם לתקרה".
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, createServiceRoleClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { getCallerProfile, isAdmin, isLeadCoordinator } from '../_shared/permissions.ts';
import { callClaude } from '../_shared/anthropic.ts';
import {
  DEFAULT_STYLE_RULES, DEFAULT_PRICE_RULES, DEFAULT_MONTHLY_CAP_ILS, parsePriceRules, priceRulesText, suggestPrompt, improvePrompt,
  SUMMARY_PROMPT, threadText, parseSuggestions, parseImproved, parseSummary, pickStyleExamples, hebrewDate,
  israelMonthStartIso, costIls, type ThreadLine,
} from '../_shared/aiSalesRules.ts';

const SETTING_KEYS = ['ai_style_rules', 'ai_price_rules', 'ai_monthly_cap_ils', 'ai_assist_enabled'];

function textOf(res: { content: { type: string; text?: string }[] }): string {
  return res.content.filter((b) => b.type === 'text').map((b) => b.text || '').join('\n');
}

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
    const action = String(body?.action || '');
    if (!['suggest', 'improve', 'summary', 'settings'].includes(action)) {
      return jsonResponse({ error: 'פעולה לא מוכרת' }, { status: 400 });
    }

    const service = createServiceRoleClient();

    // ---- settings + monthly cap -----------------------------------------------------
    const { data: settingRows } = await service
      .from('app_settings').select('key, value').eq('tenant_id', tenantId).in('key', SETTING_KEYS);
    const setting = (k: string) => settingRows?.find((r: any) => r.key === k)?.value ?? null;
    // The settings screen: the built-in defaults (so the screen never keeps a second copy
    // of them) and what this month has cost so far. Says whether a key exists — never the key.
    if (action === 'settings') {
      const { data: usage } = await service
        .from('ai_usage').select('cost_ils, kind').eq('tenant_id', tenantId).gte('created_at', israelMonthStartIso());
      const { count: keyCount } = await service
        .from('tenant_secrets').select('key', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('key', 'anthropic_api_key');
      const byKind: Record<string, number> = {};
      for (const r of usage || []) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
      return jsonResponse({
        defaults: { styleRules: DEFAULT_STYLE_RULES, priceRules: DEFAULT_PRICE_RULES, monthlyCap: DEFAULT_MONTHLY_CAP_ILS },
        spentIls: Math.round((usage || []).reduce((sum: number, r: any) => sum + Number(r.cost_ils || 0), 0) * 100) / 100,
        callsByKind: byKind,
        hasKey: (keyCount || 0) > 0 || !!Deno.env.get('ANTHROPIC_API_KEY'),
      });
    }
    if (setting('ai_assist_enabled') === 'false') {
      return jsonResponse({ error: 'העוזר כבוי בהגדרות (הגדרות ← עוזר מכירות AI)' }, { status: 400 });
    }
    const cap = Number(setting('ai_monthly_cap_ils')) > 0 ? Number(setting('ai_monthly_cap_ils')) : DEFAULT_MONTHLY_CAP_ILS;
    const { data: usageRows } = await service
      .from('ai_usage').select('cost_ils').eq('tenant_id', tenantId).gte('created_at', israelMonthStartIso());
    const spent = (usageRows || []).reduce((sum: number, r: any) => sum + Number(r.cost_ils || 0), 0);
    if (spent >= cap) {
      return jsonResponse({ error: `הגעתם לתקרה החודשית (${cap} ₪). אפשר להעלות אותה בהגדרות ← עוזר מכירות AI.` }, { status: 429 });
    }
    const style = (setting('ai_style_rules') || '').trim() || DEFAULT_STYLE_RULES;

    const { data: keyRow } = await service
      .from('tenant_secrets').select('value').eq('tenant_id', tenantId).eq('key', 'anthropic_api_key').limit(1);
    const apiKey = keyRow?.[0]?.value || null;

    const meter = async (kind: string, usage: any) => {
      const inT = usage?.input_tokens || 0;
      const outT = usage?.output_tokens || 0;
      const { error } = await service.from('ai_usage').insert({
        tenant_id: tenantId, kind, input_tokens: inT, output_tokens: outT, cost_ils: costIls(inT, outT), user_id: user.id,
      });
      if (error) console.error('[whatsapp-ai-assist] ai_usage insert failed:', error.message);
    };

    // ---- improve: only the draft and the style ---------------------------------------
    if (action === 'improve') {
      const draft = String(body?.text || '').trim();
      if (!draft) return jsonResponse({ error: 'אין טקסט לשפר' }, { status: 400 });
      if (draft.length > 2000) return jsonResponse({ error: 'הטקסט ארוך מדי' }, { status: 400 });
      const tweak = body?.tweak === 'shorter' || body?.tweak === 'warmer' ? body.tweak : null;
      const res = await callClaude({
        system: improvePrompt(style, tweak), messages: [{ role: 'user', content: draft }], apiKey, temperature: 0.3,
      });
      await meter('improve', res.usage);
      const text = parseImproved(textOf(res));
      if (!text) return jsonResponse({ error: 'לא התקבל ניסוח — נסו שוב' }, { status: 502 });
      return jsonResponse({ text });
    }

    // ---- suggest / summary: the conversation -----------------------------------------
    const conversationId = String(body?.conversationId || '');
    if (!conversationId) return jsonResponse({ error: 'conversationId is required' }, { status: 400 });
    const { data: conv } = await service
      .from('whatsapp_conversations')
      .select('id, tenant_id, display_name, couple_names, event_date, venue, guest_count, matched_lead_id, contact_type, ai_tag, ai_summary, ai_summary_at, lead_temperature')
      .eq('id', conversationId).maybeSingle();
    if (!conv || conv.tenant_id !== tenantId) return jsonResponse({ error: 'השיחה לא נמצאה' }, { status: 404 });

    const { data: msgRows } = await service
      .from('whatsapp_messages')
      .select('direction, body_text, created_at')
      .eq('conversation_id', conversationId)
      .not('body_text', 'is', null)
      .order('created_at', { ascending: false })
      .limit(24);
    const msgs = (msgRows || []).reverse();
    if (!msgs.length) return jsonResponse({ error: 'אין עדיין הודעות בשיחה' }, { status: 400 });
    const lastAt = msgs[msgs.length - 1].created_at;
    const lines: ThreadLine[] = msgs.map((m: any) => ({
      who: m.direction === 'inbound' ? 'lead' : m.direction === 'outbound_bot' ? 'bot' : 'studio',
      text: String(m.body_text).slice(0, 700),
      at: new Date(m.created_at).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric' }),
    }));

    if (action === 'summary') {
      if (!body?.force && conv.ai_summary && conv.ai_summary_at && conv.ai_summary_at >= lastAt) {
        return jsonResponse({ summary: conv.ai_summary, cached: true });
      }
      const res = await callClaude({
        system: SUMMARY_PROMPT, messages: [{ role: 'user', content: threadText(lines) }], apiKey, temperature: 0,
      });
      await meter('summary', res.usage);
      const summary = parseSummary(textOf(res));
      if (!summary) return jsonResponse({ error: 'לא התקבל סיכום — נסו שוב' }, { status: 502 });
      await service.from('whatsapp_conversations')
        .update({ ai_summary: summary, ai_summary_at: new Date().toISOString() }).eq('id', conversationId);
      return jsonResponse({ summary });
    }

    // suggest — what we know about the couple, the allowed prices, and the studio's voice.
    let lead: any = null;
    if (conv.matched_lead_id) {
      const { data } = await service
        .from('leads').select('couple_names, event_date, venue_name, package_choice, final_price, status, notes')
        .eq('id', conv.matched_lead_id).eq('tenant_id', tenantId).maybeSingle();
      lead = data;
    }
    const eventDate: string | null = lead?.event_date || conv.event_date || null;
    let busy = 0;
    if (eventDate) {
      const { count } = await service
        .from('events').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('date', eventDate);
      busy = count || 0;
    }
    const facts = [
      `שמות: ${lead?.couple_names || conv.couple_names || conv.display_name || 'לא ידוע'}`,
      eventDate ? `תאריך האירוע: ${hebrewDate(eventDate)}${busy ? ` (כבר יש ביומן ${busy} אירועים בתאריך הזה — לא להבטיח זמינות, להגיד שנבדוק)` : ''}` : 'תאריך האירוע: לא ידוע',
      (lead?.venue_name || conv.venue) ? `אולם: ${lead?.venue_name || conv.venue}` : '',
      conv.guest_count ? `מוזמנים: ${conv.guest_count}` : '',
      lead?.package_choice ? `חבילה שסומנה: ${lead.package_choice}${lead.final_price ? ` · מחיר בליד ${Number(lead.final_price).toLocaleString('en-US')} ₪` : ''}` : '',
      lead?.status ? `סטטוס ליד: ${lead.status}` : '',
      lead?.notes ? `הערות: ${String(lead.notes).slice(0, 300)}` : '',
      conv.ai_tag ? `תיוג אחרון: ${conv.ai_tag}` : '',
    ].filter(Boolean).join('\n');
    const offered = Array.isArray(conv.ai_summary?.offers) && conv.ai_summary.offers.length
      ? conv.ai_summary.offers.map((o: any) => `${Number(o.price).toLocaleString('en-US')} ₪${o.date ? ` (${o.date})` : ''}`).join(', ')
      : '';

    const { data: sampleRows } = await service
      .from('whatsapp_messages').select('body_text')
      .eq('tenant_id', tenantId).eq('direction', 'outbound_human').not('body_text', 'is', null)
      .order('created_at', { ascending: false }).limit(80);
    const examples = pickStyleExamples((sampleRows || []).map((r: any) => r.body_text));

    const res = await callClaude({
      system: suggestPrompt({
        style, prices: priceRulesText(parsePriceRules(setting('ai_price_rules')), eventDate), examples, facts, offered,
      }),
      messages: [{ role: 'user', content: `השיחה (מהישנה לחדשה):\n${threadText(lines)}\n\nנסח הצעות לתשובה הבאה של הסטודיו.` }],
      apiKey,
      temperature: 0.6,
      maxTokens: 1200,
    });
    await meter('suggest', res.usage);
    const out = parseSuggestions(textOf(res));
    if (!out.suggestions.length) return jsonResponse({ error: 'לא התקבלו הצעות — נסו שוב' }, { status: 502 });
    return jsonResponse(out);
  } catch (e: any) {
    console.error('[whatsapp-ai-assist]', e?.message || e);
    const msg = String(e?.message || '');
    return jsonResponse({ error: msg.includes('Anthropic') ? msg : 'שגיאה בעוזר — נסו שוב' }, { status: 500 });
  }
});
