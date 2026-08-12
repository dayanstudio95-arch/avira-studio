// Ports base44/functions/sendWhatsAppMessage/entry.ts.
// The only live frontend call site is WhatsAppAutomation.jsx's "send test message"
// button: base44.functions.invoke('sendWhatsAppMessage', { to, message }). A bulk
// mode (action_type: 'monthly_summary_bulk') existed in the original but has no
// frontend caller in this codebase — kept here for forward-compat, now actually
// iterating and sending each recipient directly via Green API since there's no more
// Make.com scenario to do that iteration for us.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { sendWhatsApp } from '../_shared/whatsapp.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createUserClient(req);
    const body = await req.json();
    const { to, message, action_type, recipients } = body;

    if (action_type === 'monthly_summary_bulk') {
      if (!Array.isArray(recipients) || recipients.length === 0) {
        return jsonResponse({ error: 'recipients array is required for bulk mode' }, { status: 400 });
      }

      let sent = 0;
      let failed = 0;
      const results = [];
      for (const r of recipients) {
        const phone = r.phone || r.to || r.phoneNumber;
        const msg = r.message || r.messageText;
        const result = await sendWhatsApp(supabase, phone, msg);
        if (result.success) sent++; else failed++;
        results.push({ phone, success: result.success, error: result.error });
      }

      return jsonResponse({ success: true, sent, failed, results });
    }

    if (!to || !message) return jsonResponse({ error: 'to and message are required' }, { status: 400 });

    const result = await sendWhatsApp(supabase, to, message);
    if (!result.success) return jsonResponse({ error: result.error }, { status: 502 });

    return jsonResponse({ success: true });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
