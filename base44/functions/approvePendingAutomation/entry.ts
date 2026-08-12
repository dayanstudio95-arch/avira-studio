import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

async function getMakeWebhookUrl(base44) {
  const envUrl = Deno.env.get("MAKE_WEBHOOK_URL");
  if (envUrl) return envUrl;
  
  const rows = await base44.asServiceRole.entities.AppSetting.filter({ key: 'MAKE_WEBHOOK_URL' });
  if (rows.length > 0 && rows[0].value) return rows[0].value;
  
  return null;
}

async function sendWhatsApp(phone, message, webhookUrl) {
  if (!webhookUrl) throw new Error('Make Webhook URL לא מוגדר');
  
  const intl = phone.replace(/^0/, '972').replace(/[^0-9]/g, '');
  const chatId = `${intl}@c.us`;
  const payload = { chatId, message, message_text: message, action_type: 'approve_pending', meta_source: 'approvePendingAutomation' };
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  
  if (!res.ok) {
    throw new Error(`Make webhook נכשל: ${res.status}`);
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { pending_id, action } = body;

    if (!pending_id || !action) {
      return Response.json({ error: 'Missing pending_id or action' }, { status: 400 });
    }

    if (action !== 'approve' && action !== 'reject') {
      return Response.json({ error: 'Invalid action' }, { status: 400 });
    }

    // Fetch the PendingAutomation record
    const pending = await base44.asServiceRole.entities.PendingAutomation.list();
    const record = pending.find(p => p.id === pending_id);
    
    if (!record) {
      return Response.json({ error: 'PendingAutomation not found' }, { status: 404 });
    }

    if (action === 'reject') {
      // Simple reject: just update status

      await base44.asServiceRole.entities.PendingAutomation.update(pending_id, {
        status: 'rejected'
      });
      return Response.json({ success: true, action: 'rejected', pending_id });
    }

    // action === 'approve'
    const messages = JSON.parse(record.messages || '[]');
    const webhookUrl = await getMakeWebhookUrl(base44);
    
    if (!webhookUrl) {
      return Response.json({ error: 'Make Webhook URL not configured' }, { status: 500 });
    }

    let sent = 0, failed = 0;

    for (const msg of messages) {
      try {
        await sendWhatsApp(msg.phoneNumber, msg.messageText, webhookUrl);
        
        // Create AutomationMessageLog
        await base44.asServiceRole.entities.AutomationMessageLog.create({
          automation_id: record.automationType,
          automation_name: record.automationName,
          recipient_name: msg.coupleNames || msg.leadId || '',
          recipient_contact: msg.phoneNumber,
          channel: 'whatsapp',
          message_content: msg.messageText,
          status: 'sent',
          sent_at: new Date().toISOString()
        });
        
        sent++;
        console.log(`[approvePendingAutomation] ✅ sent to ${msg.phoneNumber}`);
      } catch (err) {
        failed++;
        console.error(`[approvePendingAutomation] ❌ failed for ${msg.phoneNumber}: ${err.message}`);
        
        // Log failure
        await base44.asServiceRole.entities.AutomationMessageLog.create({
          automation_id: record.automationType,
          automation_name: record.automationName,
          recipient_name: msg.coupleNames || msg.leadId || '',
          recipient_contact: msg.phoneNumber,
          channel: 'whatsapp',
          message_content: msg.messageText,
          status: 'failed',
          error: err.message
        });
      }
    }

    // Update PendingAutomation status
    await base44.asServiceRole.entities.PendingAutomation.update(pending_id, {
      status: 'approved',
      approvedAt: new Date().toISOString()
    });

    return Response.json({
      success: true,
      action: 'approved',
      pending_id,
      sent,
      failed,
      total: messages.length
    });
  } catch (error) {
    console.error(`[approvePendingAutomation] error: ${error.message}`);
    return Response.json({ error: error.message }, { status: 500 });
  }
});