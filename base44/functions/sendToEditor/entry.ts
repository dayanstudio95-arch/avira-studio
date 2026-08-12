import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { eventId, coupleNames, eventDate, venue, phoneNumber, editorName, editorPhone, rawLink } = body;

    const formatPhone = (p) => {
      if (!p) return '';
      const clean = p.replace(/[^0-9]/g, '');
      return clean.startsWith('0') ? '972' + clean.substring(1) : clean;
    };

    if (!rawLink) return Response.json({ error: 'חסר לינק גלם' }, { status: 400 });
    if (!editorPhone) return Response.json({ error: 'חסר טלפון עורך' }, { status: 400 });

    const webhookUrl = Deno.env.get('MAKE_WEBHOOK_URL');
    if (!webhookUrl) return Response.json({ error: 'MAKE_WEBHOOK_URL not configured' }, { status: 500 });

    const payload = {
      action_type: 'send_to_editor',
      eventId,
      coupleNames,
      eventDate,
      venue: venue || '',
      phoneNumber: formatPhone(phoneNumber),
      editorName: editorName || '',
      editorPhone: formatPhone(editorPhone),
      rawLink,
      sentAt: new Date().toISOString(),
    };

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error('Webhook failed: ' + res.status + ' ' + txt);
    }

    // Mark event as sent
    await base44.entities.Event.update(eventId, {
      raw_sent_to_editor: true,
      raw_sent_at: new Date().toISOString(),
    });

    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});