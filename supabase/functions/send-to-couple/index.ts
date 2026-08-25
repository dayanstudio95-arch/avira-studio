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
מדריך לבחירת תמונות והזמנת אלבום: {{album_guide_link}}
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

    // Needed to build the Album Guide Page link below (tenant-scoped, public,
    // no-login companion page -- see supabase/functions/get-album-guide-public
    // and src/pages/AlbumGuide.jsx). getRequestUser()/createUserClient() don't
    // expose tenant_id directly, so it's looked up explicitly here.
    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single();
    const albumGuideLink = profile?.tenant_id
      ? `${Deno.env.get('APP_BASE_URL') ?? ''}/album-guide/${profile.tenant_id}`
      : '';

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
      .replace(/{{final_link}}/g, finalLink)
      .replace(/{{album_guide_link}}/g, albumGuideLink);

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
