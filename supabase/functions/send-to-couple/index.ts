// Ports base44/functions/sendToCouple/entry.ts.
// Called from ProgressStatus.jsx (handleSendToCouple). Message now composed from an
// editable app_settings template (template_final_link) and sent directly via Green
// API instead of forwarding to Make.com.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { sendWhatsApp } from '../_shared/whatsapp.ts';

const DEFAULT_FINAL_LINK_TEMPLATE = `שלום {{names}} 😊
האלבום/סרטון הסופי שלכם מוכן!
תאריך האירוע: {{event_date}}
לצפייה: {{final_link}}
מקווים שתיהנו לצפות 🎉`;

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createUserClient(req);
    const body = await req.json();
    const { eventId, coupleNames, eventDate, venue, phoneNumber, finalLink } = body;

    if (!finalLink) return jsonResponse({ error: 'חסר לינק סופי' }, { status: 400 });
    if (!phoneNumber) return jsonResponse({ error: 'חסר טלפון זוג' }, { status: 400 });

    const { data: settings } = await supabase
      .from('app_settings')
      .select('key, value')
      .eq('key', 'template_final_link');
    const template = settings?.[0]?.value || DEFAULT_FINAL_LINK_TEMPLATE;

    const formattedDate = eventDate ? new Date(eventDate).toLocaleDateString('he-IL') : '';
    const message = template
      .replace(/{{names}}/g, coupleNames || '')
      .replace(/{{event_date}}/g, formattedDate)
      .replace(/{{venue}}/g, venue || '')
      .replace(/{{final_link}}/g, finalLink);

    const result = await sendWhatsApp(supabase, phoneNumber, message);
    if (!result.success) return jsonResponse({ error: result.error }, { status: 502 });

    const { error: updateErr } = await supabase
      .from('events')
      .update({ final_done_manual: true })
      .eq('id', eventId);

    if (updateErr) return jsonResponse({ error: updateErr.message }, { status: 500 });

    return jsonResponse({ success: true });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
