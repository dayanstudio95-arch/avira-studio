import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { eventId, coupleNames, eventDate, venue, phoneNumber, finalLink } = body;

    const formatPhone = (p) => {
      if (!p) return '';
      const clean = p.replace(/[-\s()]/g, '');
      return clean.startsWith('0') ? '972' + clean.substring(1) : clean;
    };

    if (!finalLink) return Response.json({ error: 'חסר לינק סופי' }, { status: 400 });
    if (!phoneNumber) return Response.json({ error: 'חסר טלפון זוג' }, { status: 400 });

    const webhookUrl = Deno.env.get('MAKE_WEBHOOK_URL');
    if (!webhookUrl) return Response.json({ error: 'MAKE_WEBHOOK_URL not configured' }, { status: 500 });

    const payload = {
      action_type: 'send_to_couple',
      eventId,
      coupleNames,
      eventDate,
      venue: venue || '',
      phoneNumber: formatPhone(phoneNumber),
      finalLink,
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

    await base44.entities.Event.update(eventId, {
      final_done_manual: true,
    });

    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});