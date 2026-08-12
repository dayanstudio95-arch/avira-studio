import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * sendStaffScheduleMessage
 * Isolated function — sends a pre-built WhatsApp schedule message to a staff member.
 * Payload: { staffId: string, message: string }
 * Validates staffId, staff existence, phone, and message before sending.
 * Reuses existing MAKE_WEBHOOK_URL — no new architecture.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { staffId, message } = await req.json();

    // ── Validation ────────────────────────────────────────────────────────────
    if (!staffId || typeof staffId !== 'string') {
      return Response.json({ error: 'staffId חסר או לא תקין' }, { status: 400 });
    }
    if (!message || !message.trim()) {
      return Response.json({ error: 'ההודעה ריקה' }, { status: 400 });
    }

    const staffList = await base44.entities.StaffMember.filter({ id: staffId });
    const staff = staffList?.[0];

    if (!staff) {
      return Response.json({ error: `איש צוות עם מזהה ${staffId} לא נמצא` }, { status: 404 });
    }
    if (!staff.phoneNumber || !staff.phoneNumber.trim()) {
      return Response.json({ error: `לא נמצא מספר טלפון עבור ${staff.name}` }, { status: 400 });
    }

    const webhookUrl = Deno.env.get('MAKE_WEBHOOK_URL');
    if (!webhookUrl) {
      return Response.json({ error: 'MAKE_WEBHOOK_URL לא מוגדר' }, { status: 500 });
    }

    // ── Send via existing WhatsApp route ──────────────────────────────────────
    const payload = {
      action_type: 'send_whatsapp',
      to: staff.phoneNumber.trim(),
      message: message.trim(),
      sentAt: new Date().toISOString(),
    };

    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(err => console.error('[sendStaffScheduleMessage] webhook error:', err.message));

    return Response.json({ success: true, sentTo: staff.phoneNumber, staffName: staff.name });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});