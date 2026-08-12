import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * sendWhatsAppMessage
 * Payload: { to: string, message: string }
 * Sends to MAKE_WEBHOOK_URL (unified WhatsApp endpoint)
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { to, message, action_type, recipients } = body;

    // Bulk mode
    if (action_type === 'monthly_summary_bulk') {
      if (!Array.isArray(recipients) || recipients.length === 0) {
        return Response.json({ error: 'recipients array is required for bulk mode' }, { status: 400 });
      }
    } else {
      if (!to || !message) return Response.json({ error: 'to and message are required' }, { status: 400 });
    }

    const webhookUrl = Deno.env.get('MAKE_WEBHOOK_URL');
    if (!webhookUrl) {
      return Response.json({ error: 'MAKE_WEBHOOK_URL not configured' }, { status: 500 });
    }

    const payload = action_type === 'monthly_summary_bulk'
      ? { action_type, recipients, sentAt: new Date().toISOString() }
      : { action_type: action_type || 'send_whatsapp', to, message, sentAt: new Date().toISOString() };

    // Fire and forget — don't await Make's response to avoid timeout
    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(err => console.error('[sendWhatsAppMessage] webhook error:', err.message));

    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});