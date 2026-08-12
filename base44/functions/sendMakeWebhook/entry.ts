import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { action_type, whatsapp_id, message_text } = await req.json();

    if (!action_type || !whatsapp_id || !message_text) {
      return Response.json({ error: 'Missing required fields: action_type, whatsapp_id, message_text' }, { status: 400 });
    }

    const webhookUrl = Deno.env.get('MAKE_WEBHOOK_URL');
    if (!webhookUrl) return Response.json({ error: 'MAKE_WEBHOOK_URL not configured' }, { status: 500 });

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action_type, chatId: whatsapp_id, message_text }),
    });

    const responseText = await res.text();
    if (!res.ok) {
      return Response.json({ error: `Webhook failed: ${res.status}`, details: responseText }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});