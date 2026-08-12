// Ports base44/functions/sendAlbumSketch/entry.ts.
// Templates (template_album_graphic / template_album_couple) already exist as
// editable AppSetting keys in the Settings UI (MessageTemplatesTab) — reused as-is.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { sendWhatsApp } from '../_shared/whatsapp.ts';

const DEFAULT_GRAPHIC_TEMPLATE = `היי, מצורף לינק לאירוע של {{names}} שהתקיים ב-{{event_date}} באולם {{venue}}.
נשמח לקבל סקיצה לאלבום 🙏
טלפון הזוג: {{couple_phone}}
לינק לחומרים: {{album_sketch_link}}`;

const DEFAULT_COUPLE_TEMPLATE = `שלום {{names}} 😊
מוכנה הסקיצה לאלבום שלכם!
לצפייה: {{album_sketch_link}}
נשמח לשמוע מה דעתכם 📀`;

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createUserClient(req);
    const { eventId, target } = await req.json();
    if (!eventId || !target) return jsonResponse({ error: 'eventId and target required' }, { status: 400 });

    const { data: event, error: evErr } = await supabase.from('events').select('*').eq('id', eventId).maybeSingle();
    if (evErr) return jsonResponse({ error: evErr.message }, { status: 500 });
    if (!event) return jsonResponse({ error: 'Event not found' }, { status: 404 });

    const albumSketchLink = event.album_sketch_link;
    if (!albumSketchLink) return jsonResponse({ error: 'אין לינק סקיצת אלבום לאירוע זה' }, { status: 400 });

    const { data: settings } = await supabase.from('app_settings').select('key, value');

    let phone: string | undefined;
    let message: string;
    let updateField: Record<string, boolean>;

    const eventDate = event.date ? new Date(event.date).toLocaleDateString('he-IL') : '';

    if (target === 'graphic') {
      const { data: staffList, error: staffErr } = await supabase
        .from('staff_members')
        .select('*')
        .eq('role', 'graphic_designer');
      if (staffErr) return jsonResponse({ error: staffErr.message }, { status: 500 });
      const designer = staffList?.[0];
      if (!designer?.phone_number) {
        return jsonResponse({ error: 'לא נמצאה גרפיקאית עם מספר טלפון בהגדרות הצוות' }, { status: 400 });
      }

      phone = designer.phone_number;
      const template = settings?.find((s) => s.key === 'template_album_graphic')?.value || DEFAULT_GRAPHIC_TEMPLATE;
      message = template
        .replace(/{{names}}/g, event.couple_names || '')
        .replace(/{{event_date}}/g, eventDate)
        .replace(/{{venue}}/g, event.venue || '')
        .replace(/{{couple_phone}}/g, event.phone_number || '')
        .replace(/{{album_sketch_link}}/g, albumSketchLink);

      updateField = { album_sketch_graphic_notified: true };
    } else if (target === 'couple') {
      if (!event.phone_number) return jsonResponse({ error: 'אין טלפון לזוג בפרטי האירוע' }, { status: 400 });

      phone = event.phone_number;
      const template = settings?.find((s) => s.key === 'template_album_couple')?.value || DEFAULT_COUPLE_TEMPLATE;
      message = template
        .replace(/{{names}}/g, event.couple_names || '')
        .replace(/{{event_date}}/g, eventDate)
        .replace(/{{album_sketch_link}}/g, albumSketchLink);

      updateField = { album_sketch_couple_notified: true };
    } else {
      return jsonResponse({ error: 'target must be graphic or couple' }, { status: 400 });
    }

    const result = await sendWhatsApp(supabase, phone!, message);
    if (!result.success) return jsonResponse({ error: result.error }, { status: 502 });

    const { error: updateErr } = await supabase.from('events').update(updateField).eq('id', eventId);
    if (updateErr) return jsonResponse({ error: updateErr.message }, { status: 500 });

    return jsonResponse({ success: true });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
