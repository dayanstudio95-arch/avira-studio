// Real backend for the AI Assistant widget (src/components/AIAssistant.jsx) and the
// read-only System Advisor panel (src/components/systemAdvisor/AskSystemPanelV2.jsx).
// Replaces the never-ported Base44 "aiAssistant" function (previously unconditionally
// in src/api/functions.js's KNOWN_UNIMPLEMENTED set, throwing synchronously on every
// message). See base44/functions/aiAssistant/entry.ts for the old regex/InvokeLLM
// reference implementation this supersedes (2 hardcoded intents + a Base44-hosted LLM
// fallback) -- this version uses real Anthropic Claude tool-calling instead, covering
// open-ended questions, not just 2 fixed intents.
//
// Security-by-construction: this function is READ-ONLY against the database. It never
// calls sendWhatsApp() or writes anything except its own ai_assistant_messages rows —
// it can only ever return an `action_proposal`, whose params are always resolved
// server-side from events/staff_members (never trusted from whatever the LLM said for
// a phone number or link). The actual send happens client-side, when the user clicks
// "אשר ובצע" in AIAssistant.jsx, which calls the existing, unchanged send-to-editor /
// send-to-couple / send-whatsapp-message functions directly with those params. So even
// a fully compromised or hallucinating prompt can't make this backend send a message
// on its own — a human always executes the real send through the already-audited path.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { checkRateLimitForKey } from '../_shared/rateLimit.ts';
import { callClaude, type ClaudeContentBlock, type ClaudeMessage } from '../_shared/anthropic.ts';

const MAX_TOOL_ITERATIONS = 6;
const ACTION_TOOL_NAMES = new Set(['send_to_editor', 'send_to_couple', 'send_whatsapp_message']);

function buildSystemPrompt(readOnly: boolean) {
  const today = new Date().toISOString().slice(0, 10);
  let prompt = `אתה עוזר תפעולי של סטודיו צילום חתונות (Avira Studio). יש לך גישה לכלים לשליפת מידע על אירועים, לידים וצוות — השתמש בהם כדי לענות על שאלות במקום לנחש. תאריך היום: ${today}.
כשמשתמש מבקש לבצע פעולה (שליחת הודעת וואטסאפ) — קרא לכלי הפעולה המתאים; הפעולה לא תבוצע מיד, המשתמש יצטרך לאשר אותה בנפרד. אל תמציא מספרי טלפון, לינקים או שמות — הכלים ישלימו/יאמתו אותם בעצמם.
ענה תמיד בעברית, בקצרה ובמדויק. אם מידע חסר או לא נמצא, אמור זאת בפירוש ואל תמציא תשובה.`;
  if (readOnly) {
    prompt += `\nמצב תצוגה בלבד: אין באפשרותך להציע פעולות (שליחת הודעות) — ענה על שאלות מידע בלבד.`;
  }
  return prompt;
}

function readToolSchemas() {
  return [
    {
      name: 'search_events',
      description: 'חיפוש אירועים לפי טווח תאריכים, שם זוג, אולם, סטטוס תשלום, או חוסרים בצוות/שליחות.',
      input_schema: {
        type: 'object',
        properties: {
          from_date: { type: 'string', description: 'YYYY-MM-DD' },
          to_date: { type: 'string', description: 'YYYY-MM-DD' },
          couple_names_contains: { type: 'string' },
          venue_contains: { type: 'string' },
          payment_status: { type: 'string', enum: ['Paid', 'Partially Paid', 'Unpaid'] },
          only_missing_editor: { type: 'boolean', description: 'רק אירועים בלי עורך משובץ' },
          only_raw_not_sent: { type: 'boolean', description: 'רק אירועים שהגלם עוד לא נשלח לעורך' },
          only_final_not_sent: { type: 'boolean', description: 'רק אירועים שהסופי עוד לא נשלח לזוג' },
          limit: { type: 'integer', description: 'ברירת מחדל 30, מקסימום 100' },
        },
      },
    },
    {
      name: 'get_unpaid_events',
      description: 'רשימת אירועים שעברו (לפני תאריך נתון) ועדיין לא שולמו במלואם.',
      input_schema: {
        type: 'object',
        properties: { as_of_date: { type: 'string', description: 'YYYY-MM-DD, ברירת מחדל היום' } },
      },
    },
    {
      name: 'get_staff_schedule',
      description: 'לוח זמנים של איש צוות (לפי שם, אפשר חלקי) לחודש או שנה נתונים.',
      input_schema: {
        type: 'object',
        properties: {
          staff_name_query: { type: 'string' },
          month: { type: 'string', description: 'YYYY-MM' },
          year: { type: 'string', description: 'YYYY' },
        },
        required: ['staff_name_query'],
      },
    },
    {
      name: 'find_lead',
      description: 'חיפוש ליד/פנייה לפי שם זוג או מספר טלפון.',
      input_schema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  ];
}

function actionToolSchemas() {
  return [
    {
      name: 'send_to_editor',
      description: 'הצעה לשליחת חומר הגלם לעורך של אירוע ספציפי בוואטסאפ. לא מבצע בפועל — רק מציע לאישור המשתמש.',
      input_schema: {
        type: 'object',
        properties: { event_id: { type: 'string', description: 'מזהה (id) של האירוע' } },
        required: ['event_id'],
      },
    },
    {
      name: 'send_to_couple',
      description: 'הצעה לשליחת התוצר הסופי (אלבום/סרטון) לזוג של אירוע ספציפי בוואטסאפ. לא מבצע בפועל — רק מציע לאישור המשתמש.',
      input_schema: {
        type: 'object',
        properties: { event_id: { type: 'string', description: 'מזהה (id) של האירוע' } },
        required: ['event_id'],
      },
    },
    {
      name: 'send_whatsapp_message',
      description: 'הצעה לשליחת הודעת וואטסאפ חופשית למספר טלפון, לאיש צוות, או לזוג. לא מבצע בפועל — רק מציע לאישור המשתמש.',
      input_schema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'מספר טלפון, או שם איש צוות/זוג לזיהוי אוטומטי' },
          message: { type: 'string' },
        },
        required: ['to', 'message'],
      },
    },
  ];
}

async function executeReadTool(supabase: any, name: string, input: any) {
  try {
    if (name === 'search_events') {
      let q = supabase
        .from('events')
        .select('id, couple_names, date, venue, phone_number, team, client_payment_status, raw_link, final_link, raw_sent_to_editor, final_done_manual, album_status')
        .order('date', { ascending: true })
        .limit(Math.min(input?.limit || 30, 100));
      if (input?.from_date) q = q.gte('date', input.from_date);
      if (input?.to_date) q = q.lte('date', input.to_date);
      if (input?.couple_names_contains) q = q.ilike('couple_names', `%${input.couple_names_contains}%`);
      if (input?.venue_contains) q = q.ilike('venue', `%${input.venue_contains}%`);
      if (input?.payment_status) q = q.eq('client_payment_status', input.payment_status);
      const { data, error } = await q;
      if (error) return { error: error.message };
      let rows = data || [];
      if (input?.only_missing_editor) rows = rows.filter((e: any) => !(e.team || []).some((m: any) => m.role === 'editor' && m.staffMemberName));
      if (input?.only_raw_not_sent) rows = rows.filter((e: any) => !e.raw_sent_to_editor);
      if (input?.only_final_not_sent) rows = rows.filter((e: any) => !e.final_done_manual);
      return { events: rows };
    }

    if (name === 'get_unpaid_events') {
      const asOf = input?.as_of_date || new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from('events')
        .select('id, couple_names, date, venue, phone_number, client_payment_status, total_amount_gross')
        .lt('date', asOf)
        .neq('client_payment_status', 'Paid')
        .order('date', { ascending: false });
      if (error) return { error: error.message };
      return { unpaidEvents: data || [] };
    }

    if (name === 'get_staff_schedule') {
      const query = (input?.staff_name_query || '').trim();
      if (!query) return { error: 'staff_name_query is required' };
      const { data: staff, error: staffErr } = await supabase
        .from('staff_members')
        .select('id, name, role, phone_number')
        .ilike('name', `%${query}%`);
      if (staffErr) return { error: staffErr.message };
      if (!staff || staff.length === 0) return { notFound: true, query };
      if (staff.length > 1) return { ambiguous: true, candidates: staff.map((s: any) => s.name) };

      const matched = staff[0];
      let fromDate: string, toDate: string;
      if (input?.month) {
        const [y, m] = input.month.split('-').map(Number);
        fromDate = `${y}-${String(m).padStart(2, '0')}-01`;
        toDate = new Date(y, m, 0).toISOString().slice(0, 10);
      } else if (input?.year) {
        fromDate = `${input.year}-01-01`;
        toDate = `${input.year}-12-31`;
      } else {
        const now = new Date();
        fromDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
      }

      const { data: events, error: eventsErr } = await supabase
        .from('events')
        .select('id, couple_names, date, venue, team')
        .gte('date', fromDate)
        .lte('date', toDate)
        .order('date', { ascending: true });
      if (eventsErr) return { error: eventsErr.message };
      const matchedEvents = (events || []).filter((e: any) =>
        (e.team || []).some((m: any) => m.staffMemberName === matched.name)
      );
      return {
        staffId: matched.id,
        staffName: matched.name,
        role: matched.role,
        events: matchedEvents.map((e: any) => ({
          id: e.id, coupleNames: e.couple_names, date: e.date, venue: e.venue,
          role: (e.team || []).find((m: any) => m.staffMemberName === matched.name)?.role,
        })),
      };
    }

    if (name === 'find_lead') {
      const query = (input?.query || '').trim();
      if (!query) return { error: 'query is required' };
      const { data, error } = await supabase
        .from('leads')
        .select('id, couple_names, phone_number, status, event_date, total_paid, remaining_balance, production_form_filled_at')
        .or(`couple_names.ilike.%${query}%,phone_number.ilike.%${query}%`)
        .limit(10);
      if (error) return { error: error.message };
      return { leads: data || [] };
    }

    return { error: `unknown tool: ${name}` };
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}

// Resolves+validates an action tool call server-side and returns either a proposal
// ready for the frontend's confirm step, or a plain explanatory answer if something
// required is missing (never a half-valid proposal).
async function buildActionProposal(supabase: any, block: ClaudeContentBlock & { type: 'tool_use' }) {
  const input = block.input as any;

  if (block.name === 'send_to_editor') {
    const { data: event, error } = await supabase
      .from('events')
      .select('id, couple_names, date, venue, phone_number, raw_link, raw_sent_to_editor, team')
      .eq('id', input?.event_id)
      .maybeSingle();
    if (error || !event) return { type: 'answer', text: 'לא מצאתי אירוע כזה.' };
    if (event.raw_sent_to_editor) return { type: 'answer', text: `הגלם כבר נשלח לעורך עבור אירוע ${event.couple_names}.` };
    if (!event.raw_link) return { type: 'answer', text: `אין לינק גלם מוגדר עבור אירוע ${event.couple_names} — אי אפשר לשלוח.` };
    const editorMember = (event.team || []).find((m: any) => m.role === 'editor' && m.staffMemberName);
    if (!editorMember) return { type: 'answer', text: `לא הוגדר עורך לאירוע ${event.couple_names}.` };
    const { data: staffRecord } = await supabase
      .from('staff_members').select('phone_number').eq('name', editorMember.staffMemberName).maybeSingle();
    if (!staffRecord?.phone_number) return { type: 'answer', text: `חסר מספר טלפון לעורך ${editorMember.staffMemberName}.` };

    return {
      type: 'action_proposal',
      description: `שליחת חומר הגלם של ${event.couple_names} (${event.date}) לעורך ${editorMember.staffMemberName} בוואטסאפ.`,
      confirmText: 'שלח לעורך',
      action: {
        name: 'send_to_editor',
        params: {
          eventId: event.id, coupleNames: event.couple_names, eventDate: event.date, venue: event.venue,
          phoneNumber: event.phone_number, editorName: editorMember.staffMemberName,
          editorPhone: staffRecord.phone_number, rawLink: event.raw_link,
        },
      },
    };
  }

  if (block.name === 'send_to_couple') {
    const { data: event, error } = await supabase
      .from('events')
      .select('id, couple_names, date, venue, phone_number, final_link, final_done_manual')
      .eq('id', input?.event_id)
      .maybeSingle();
    if (error || !event) return { type: 'answer', text: 'לא מצאתי אירוע כזה.' };
    if (event.final_done_manual) return { type: 'answer', text: `התוצר הסופי כבר נשלח לזוג ${event.couple_names}.` };
    if (!event.final_link) return { type: 'answer', text: `אין לינק סופי מוגדר עבור אירוע ${event.couple_names} — אי אפשר לשלוח.` };
    if (!event.phone_number) return { type: 'answer', text: `אין מספר טלפון לזוג ${event.couple_names}.` };

    return {
      type: 'action_proposal',
      description: `שליחת התוצר הסופי של ${event.couple_names} (${event.date}) לזוג בוואטסאפ.`,
      confirmText: 'שלח לזוג',
      action: {
        name: 'send_to_couple',
        params: {
          eventId: event.id, coupleNames: event.couple_names, eventDate: event.date,
          venue: event.venue, phoneNumber: event.phone_number, finalLink: event.final_link,
        },
      },
    };
  }

  if (block.name === 'send_whatsapp_message') {
    const to = (input?.to || '').trim();
    const message = (input?.message || '').trim();
    if (!to || !message) return { type: 'answer', text: 'חסר נמען או תוכן הודעה.' };

    let resolvedPhone = to;
    let resolvedLabel = to;
    if (!/^[\d+\-\s()]{6,}$/.test(to)) {
      const { data: staff } = await supabase.from('staff_members').select('name, phone_number').ilike('name', `%${to}%`);
      if (staff && staff.length === 1 && staff[0].phone_number) {
        resolvedPhone = staff[0].phone_number;
        resolvedLabel = staff[0].name;
      } else {
        const { data: events } = await supabase.from('events').select('couple_names, phone_number').ilike('couple_names', `%${to}%`).limit(2);
        if (events && events.length === 1 && events[0].phone_number) {
          resolvedPhone = events[0].phone_number;
          resolvedLabel = events[0].couple_names;
        } else {
          return { type: 'answer', text: `לא הצלחתי לזהות באופן חד-משמעי את "${to}" כמספר טלפון או שם. נסה לציין מספר טלפון ישירות.` };
        }
      }
    }

    return {
      type: 'action_proposal',
      description: `שליחת הודעת וואטסאפ ל${resolvedLabel}: "${message}"`,
      confirmText: 'שלח הודעה',
      action: { name: 'send_whatsapp_message', params: { to: resolvedPhone, message } },
    };
  }

  return { type: 'answer', text: 'פעולה לא מוכרת.' };
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const rl = await checkRateLimitForKey(`ai-assistant:${user.id}`, { maxHits: 20, windowSeconds: 60 });
    if (!rl.allowed) return jsonResponse({ error: 'יותר מדי בקשות, נסה שוב בעוד רגע' }, { status: 429 });

    const supabase = createUserClient(req);
    const { data: profile } = await supabase.from('profiles').select('tenant_id').eq('id', user.id).single();
    if (!profile?.tenant_id) return jsonResponse({ error: 'Profile/tenant not found' }, { status: 400 });

    const body = await req.json();
    const message = (body?.message || '').trim();
    const readOnly = body?.readOnly === true;
    if (!message) return jsonResponse({ error: 'message is required' }, { status: 400 });

    // Per-tenant Anthropic key override (Settings -> אינטגרציות), same tenant_secrets
    // table/pattern as WhatsApp/Morning credentials — see IntegrationsTab.jsx. Falls
    // back to the platform-wide ANTHROPIC_API_KEY secret inside callClaude() when a
    // tenant hasn't set their own (undefined here, not queried per-row by tenant_id
    // since the user-scoped client is already RLS-limited to this tenant).
    const { data: tenantKeyRow } = await supabase
      .from('tenant_secrets')
      .select('value')
      .eq('key', 'anthropic_api_key')
      .maybeSingle();
    const tenantApiKey = tenantKeyRow?.value || undefined;

    await supabase.from('ai_assistant_messages').insert({
      tenant_id: profile.tenant_id, user_id: user.id, role: 'user', content: message,
    });

    const { data: history } = await supabase
      .from('ai_assistant_messages')
      .select('role, content')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10);

    const claudeMessages: ClaudeMessage[] = (history || [])
      .reverse()
      .filter((m: any) => m.content)
      .map((m: any) => ({ role: m.role, content: m.content }));

    const tools = readOnly ? readToolSchemas() : [...readToolSchemas(), ...actionToolSchemas()];
    const system = buildSystemPrompt(readOnly);

    let result: any = null;

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const resp = await callClaude({ system, messages: claudeMessages, tools, apiKey: tenantApiKey });
      const toolUseBlocks = (resp.content || []).filter((b) => b.type === 'tool_use') as (ClaudeContentBlock & { type: 'tool_use' })[];
      const textBlock = (resp.content || []).find((b) => b.type === 'text') as (ClaudeContentBlock & { type: 'text' }) | undefined;

      if (toolUseBlocks.length === 0) {
        result = { type: 'answer', text: textBlock?.text || 'לא הבנתי, נסה לנסח אחרת.' };
        break;
      }

      const actionBlock = toolUseBlocks.find((b) => ACTION_TOOL_NAMES.has(b.name));
      if (actionBlock) {
        result = await buildActionProposal(supabase, actionBlock);
        break;
      }

      claudeMessages.push({ role: 'assistant', content: resp.content });
      const toolResults = await Promise.all(
        toolUseBlocks.map(async (b) => ({
          type: 'tool_result' as const,
          tool_use_id: b.id,
          content: JSON.stringify(await executeReadTool(supabase, b.name, b.input)),
        }))
      );
      claudeMessages.push({ role: 'user', content: toolResults });

      if (i === MAX_TOOL_ITERATIONS - 1) {
        result = { type: 'answer', text: 'לא הצלחתי להשלים את הבקשה, נסה לפרט יותר.' };
      }
    }

    const { data: saved } = await supabase
      .from('ai_assistant_messages')
      .insert({
        tenant_id: profile.tenant_id,
        user_id: user.id,
        role: 'assistant',
        content: result.type === 'answer' ? result.text : result.description || null,
        structured_data: result.type === 'structured_answer' ? result : null,
        pending_action: result.type === 'action_proposal'
          ? { name: result.action.name, params: result.action.params, description: result.description, confirmText: result.confirmText }
          : null,
        action_status: result.type === 'action_proposal' ? 'pending' : null,
      })
      .select('id')
      .single();

    if (result.type === 'action_proposal' && saved?.id) result.messageId = saved.id;

    return jsonResponse({ result });
  } catch (error) {
    console.error('ai-assistant error:', error);
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
