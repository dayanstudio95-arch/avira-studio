import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const DEFAULT_GRAPHIC_TEMPLATE = `היי, מצורף לינק לאירוע של {{names}} שהתקיים ב-{{event_date}} באולם {{venue}}.
נשמח לקבל סקיצה לאלבום 🙏
טלפון הזוג: {{couple_phone}}
לינק לחומרים: {{album_sketch_link}}`;

const DEFAULT_COUPLE_TEMPLATE = `שלום {{names}} 😊
מוכנה הסקיצה לאלבום שלכם!
לצפייה: {{album_sketch_link}}
נשמח לשמוע מה דעתכם 📀`;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { eventId, target } = await req.json();
    if (!eventId || !target) return Response.json({ error: 'eventId and target required' }, { status: 400 });

    const events = await base44.asServiceRole.entities.Event.filter({ id: eventId });
    const event = events[0];
    if (!event) return Response.json({ error: 'Event not found' }, { status: 404 });

    const albumSketchLink = event.albumSketchLink;
    if (!albumSketchLink) return Response.json({ error: 'אין לינק סקיצת אלבום לאירוע זה' }, { status: 400 });

    const webhookUrl = Deno.env.get('MAKE_WEBHOOK_URL');
    if (!webhookUrl) return Response.json({ error: 'MAKE_WEBHOOK_URL not configured' }, { status: 500 });

    const settings = await base44.asServiceRole.entities.AppSetting.list();

    let phone, message, updateField;

    if (target === 'graphic') {
      const staff = await base44.asServiceRole.entities.StaffMember.filter({ role: 'graphic_designer' });
      const designer = staff[0];
      if (!designer?.phoneNumber) return Response.json({ error: 'לא נמצאה גרפיקאית עם מספר טלפון בהגדרות הצוות' }, { status: 400 });

      phone = designer.phoneNumber;
      const templateSetting = settings.find(s => s.key === 'template_album_graphic');
      const template = templateSetting?.value || DEFAULT_GRAPHIC_TEMPLATE;

      const eventDate = event.date ? new Date(event.date).toLocaleDateString('he-IL') : '';
      message = template
        .replace(/{{names}}/g, event.coupleNames || '')
        .replace(/{{event_date}}/g, eventDate)
        .replace(/{{venue}}/g, event.venue || '')
        .replace(/{{couple_phone}}/g, event.phoneNumber || '')
        .replace(/{{album_sketch_link}}/g, albumSketchLink);

      updateField = { albumSketchGraphicNotified: true };

    } else if (target === 'couple') {
      if (!event.phoneNumber) return Response.json({ error: 'אין טלפון לזוג בפרטי האירוע' }, { status: 400 });

      phone = event.phoneNumber;
      const templateSetting = settings.find(s => s.key === 'template_album_couple');
      const template = templateSetting?.value || DEFAULT_COUPLE_TEMPLATE;

      const eventDate = event.date ? new Date(event.date).toLocaleDateString('he-IL') : '';
      message = template
        .replace(/{{names}}/g, event.coupleNames || '')
        .replace(/{{event_date}}/g, eventDate)
        .replace(/{{album_sketch_link}}/g, albumSketchLink);

      updateField = { albumSketchCoupleNotified: true };

    } else {
      return Response.json({ error: 'target must be graphic or couple' }, { status: 400 });
    }

    // Normalize phone number
    const normalized = phone.replace(/[-\s()]/g, '');
    const toPhone = normalized.startsWith('0') ? '972' + normalized.substring(1) : normalized;

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action_type: 'send_whatsapp', to: toPhone, message, filter: target, sentAt: new Date().toISOString() }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return Response.json({ error: `Webhook failed: ${response.status} ${errText}` }, { status: 502 });
    }

    await base44.asServiceRole.entities.Event.update(eventId, updateField);

    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});