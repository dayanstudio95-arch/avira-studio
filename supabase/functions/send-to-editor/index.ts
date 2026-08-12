// Ports base44/functions/sendToEditor/entry.ts.
// Called from ProgressStatus.jsx (handleSendToEditor) and AIAssistant.jsx's
// send_to_editor action. Originally forwarded a payload to Make.com, whose scenario
// composed the actual WhatsApp message text. Since Make is eliminated, the message is
// now composed here from an editable app_settings template (template_raw_link),
// following the same {{placeholder}} convention as sendAlbumSketch, and sent directly
// via Green API.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { sendWhatsApp } from '../_shared/whatsapp.ts';

const DEFAULT_RAW_LINK_TEMPLATE = `היי {{editor_name}}, מצורף לינק לחומר הגלם של {{names}} מתאריך {{event_date}} באולם {{venue}}.
טלפון הזוג: {{couple_phone}}
לינק לחומרים: {{raw_link}}`;

function formatPhone(p: string | undefined | null) {
  if (!p) return '';
  const clean = p.replace(/[^0-9]/g, '');
  return clean.startsWith('0') ? '972' + clean.substring(1) : clean;
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createUserClient(req);
    const body = await req.json();
    const { eventId, coupleNames, eventDate, venue, phoneNumber, editorName, editorPhone, rawLink } = body;

    if (!rawLink) return jsonResponse({ error: 'חסר לינק גלם' }, { status: 400 });
    if (!editorPhone) return jsonResponse({ error: 'חסר טלפון עורך' }, { status: 400 });

    const { data: settings } = await supabase
      .from('app_settings')
      .select('key, value')
      .eq('key', 'template_raw_link');
    const template = settings?.[0]?.value || DEFAULT_RAW_LINK_TEMPLATE;

    const formattedDate = eventDate ? new Date(eventDate).toLocaleDateString('he-IL') : '';
    const message = template
      .replace(/{{editor_name}}/g, editorName || '')
      .replace(/{{names}}/g, coupleNames || '')
      .replace(/{{event_date}}/g, formattedDate)
      .replace(/{{venue}}/g, venue || '')
      .replace(/{{couple_phone}}/g, formatPhone(phoneNumber))
      .replace(/{{raw_link}}/g, rawLink);

    const result = await sendWhatsApp(supabase, editorPhone, message);
    if (!result.success) return jsonResponse({ error: result.error }, { status: 502 });

    const { error: updateErr } = await supabase
      .from('events')
      .update({ raw_sent_to_editor: true, raw_sent_at: new Date().toISOString() })
      .eq('id', eventId);

    if (updateErr) return jsonResponse({ error: updateErr.message }, { status: 500 });

    return jsonResponse({ success: true });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
