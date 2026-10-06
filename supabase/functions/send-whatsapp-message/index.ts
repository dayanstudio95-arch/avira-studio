// Ports base44/functions/sendWhatsAppMessage/entry.ts.
// The only live frontend call site is WhatsAppAutomation.jsx's "send test message"
// button: base44.functions.invoke('sendWhatsAppMessage', { to, message }). A bulk
// mode (action_type: 'monthly_summary_bulk') existed in the original but has no
// frontend caller in this codebase — kept here for forward-compat, now actually
// iterating and sending each recipient directly via Green API since there's no more
// Make.com scenario to do that iteration for us.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, createServiceRoleClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { loadOptOutList, isOptedOut, OPTED_OUT_REASON } from '../_shared/whatsappOptOut.ts';
import { sendWhatsApp } from '../_shared/whatsapp.ts';
import { getCallerProfile, hasRole, ADMIN_ROLES, LEAD_COORDINATOR_ROLE, ALBUM_MANAGER_ROLE } from '../_shared/permissions.ts';

// Who may send from the studio's WhatsApp number (2026-10-05). Before this, any logged-in
// user of the tenant — a photographer included — could send any text to any number.
// The roles are exactly the ones whose screens call this function: the admin panel,
// lead_coordinator (leads + inbox) and album_manager (album order page).
const SENDER_ROLES = [...ADMIN_ROLES, LEAD_COORDINATOR_ROLE, ALBUM_MANAGER_ROLE];

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createUserClient(req);
    const profile = await getCallerProfile(supabase, user.id, 'role, tenant_id');
    if (!profile || !hasRole(profile.role, SENDER_ROLES)) {
      return jsonResponse({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    // `chatId` (2026-10-05): the inbox sends the conversation's own WhatsApp id, so a
    // reply reaches a number from abroad, a group or an @lid chat. Phone numbers still
    // work exactly as before; sendWhatsApp tells the two apart.
    const { message, action_type, recipients } = body;
    const to = body.chatId || body.to;

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

    // AUTO-07: bulk screens (follow-up dialogs) pass respect_opt_out — a person who wrote
    // "הסר" is skipped, reported as skipped (not as a failure). A message typed by hand to
    // one person (chat reply, side panel) does not pass it and still goes out.
    if (body.respect_opt_out === true) {
      if (!profile.tenant_id) return jsonResponse({ error: 'Forbidden' }, { status: 403 });
      const optOut = await loadOptOutList(createServiceRoleClient(), profile.tenant_id);
      if (isOptedOut(optOut, to)) return jsonResponse({ success: false, skipped: true, reason: OPTED_OUT_REASON });
    }

    const result = await sendWhatsApp(supabase, to, message);
    if (!result.success) return jsonResponse({ error: result.error }, { status: 502 });

    return jsonResponse({ success: true });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
