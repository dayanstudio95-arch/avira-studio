// Ports base44/functions/approvePendingAutomation/entry.ts.
// Approves (sends) or rejects a batch of pre-built messages queued by automationEngine
// for manual review (questionnaire_reminder / payment_reminder automation types).
//
// Schema note: Base44's PendingAutomation.automationType stored the automation *type*
// string (e.g. "questionnaire_reminder"), and AutomationMessageLog.automation_id was
// loosely typed and just held that same string — no real foreign key. Our Postgres
// schema enforces automation_message_logs.automation_id as a real NOT NULL FK into
// automations(id). So here we look up the matching Automation row by type and use its
// real id for the log entries; if no Automation of that type exists (e.g. it was
// deleted since the PendingAutomation was created), messages still send but are not
// logged per-recipient — the pending_automations row itself remains the record.
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
    const body = await req.json().catch(() => ({}));
    const { pending_id, action } = body;

    if (!pending_id || !action) return jsonResponse({ error: 'Missing pending_id or action' }, { status: 400 });
    if (action !== 'approve' && action !== 'reject') return jsonResponse({ error: 'Invalid action' }, { status: 400 });

    const { data: record, error: fetchErr } = await supabase
      .from('pending_automations')
      .select('*')
      .eq('id', pending_id)
      .maybeSingle();

    if (fetchErr) return jsonResponse({ error: fetchErr.message }, { status: 500 });
    if (!record) return jsonResponse({ error: 'PendingAutomation not found' }, { status: 404 });

    if (action === 'reject') {
      const { error: rejectErr } = await supabase
        .from('pending_automations')
        .update({ status: 'rejected' })
        .eq('id', pending_id);
      if (rejectErr) return jsonResponse({ error: rejectErr.message }, { status: 500 });
      return jsonResponse({ success: true, action: 'rejected', pending_id });
    }

    // action === 'approve'
    const messages: Array<{ phoneNumber: string; messageText: string; coupleNames?: string; leadId?: string }> =
      Array.isArray(record.messages) ? record.messages : [];

    const { data: matchingAutomation } = await supabase
      .from('automations')
      .select('id')
      .eq('type', record.automation_type)
      .limit(1)
      .maybeSingle();

    let sent = 0;
    let failed = 0;

    for (const msg of messages) {
      const result = await sendWhatsApp(supabase, msg.phoneNumber, msg.messageText);

      if (matchingAutomation?.id) {
        await supabase.from('automation_message_logs').insert({
          automation_id: matchingAutomation.id,
          automation_name: record.automation_name,
          recipient_name: msg.coupleNames || msg.leadId || '',
          recipient_contact: msg.phoneNumber,
          channel: 'whatsapp',
          message_content: msg.messageText,
          status: result.success ? 'sent' : 'failed',
          error: result.success ? null : result.error,
        });
      }

      // Throttle marker so runQuestionnaireReminder (automation-engine) doesn't
      // re-queue the same lead every run — see migration 0004_lead_questionnaire_reminder.sql.
      if (result.success && record.automation_type === 'questionnaire_reminder' && msg.leadId) {
        await supabase
          .from('leads')
          .update({ questionnaire_reminder_sent_at: new Date().toISOString() })
          .eq('id', msg.leadId);
      }

      if (result.success) {
        sent++;
        console.log(`[approvePendingAutomation] sent to ${msg.phoneNumber}`);
      } else {
        failed++;
        console.error(`[approvePendingAutomation] failed for ${msg.phoneNumber}: ${result.error}`);
      }
    }

    const { error: updateErr } = await supabase
      .from('pending_automations')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('id', pending_id);
    if (updateErr) return jsonResponse({ error: updateErr.message }, { status: 500 });

    return jsonResponse({ success: true, action: 'approved', pending_id, sent, failed, total: messages.length });
  } catch (error) {
    console.error(`[approvePendingAutomation] error: ${error.message}`);
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
