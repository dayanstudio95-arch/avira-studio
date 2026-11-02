// "חשבוניות מהצוות" — the screen's scan (Avira, 2026-11-02, the owner's request; 0106). The signed-in owner / admin /
// studio manager runs the scan of _shared/staffInvoicesScan.ts for their studio: a few documents read per call (AI), no
// reminders (those go out from the hourly automation-engine tick, on working hours only). The answer says how many chat
// messages are still to look at, and the screen calls again until none are.
// The payments page's "שילמתי" (0108) uses it too: the uploaded bank screenshot read before confirming, and the
// confirmed payment sent to the team member with the screenshot.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createServiceRoleClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { readTransferShot, runStaffInvoices, sendPaymentProof } from '../_shared/staffInvoicesScan.ts';
import { probeMorningExpenses } from '../_shared/morningExpensesProbe.ts';

const ROLES = ['owner', 'admin', 'studio_manager'];

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse({ error: 'method not allowed' }, { status: 405 });
  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
    const supabase = createServiceRoleClient();
    const { data: profile } = await supabase.from('profiles').select('tenant_id, role').eq('id', user.id).maybeSingle();
    if (!profile?.tenant_id || !ROLES.includes(profile.role)) return jsonResponse({ error: 'אין הרשאה' }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    // The read-only look at Morning's expenses API (2026-11-02), before invoices are sent there as drafts.
    if (body?.action === 'morning_probe') {
      const today = new Date().toISOString().slice(0, 10);
      return jsonResponse({ success: true, probe: await probeMorningExpenses(supabase, profile.tenant_id, '2026-09-01', today) });
    }
    if (body?.action === 'read_transfer') {
      return jsonResponse({ success: true, ...(await readTransferShot(supabase, profile.tenant_id, String(body.path || ''))) });
    }
    if (body?.action === 'send_payment') {
      const sent = await sendPaymentProof(supabase, profile.tenant_id, { transferId: String(body.transferId || ''), to: String(body.to || ''), message: String(body.message || '') });
      return jsonResponse(sent.success ? { success: true } : { error: sent.error || 'השליחה נכשלה' });
    }
    const result = await runStaffInvoices(supabase, profile.tenant_id, { maxReads: 6, remind: false });
    return jsonResponse({ success: true, ...result });
  } catch (e) {
    console.error('[staff-invoices]', (e as Error)?.message || e);
    return jsonResponse({ error: (e as Error)?.message || 'שגיאה' }, { status: 500 });
  }
});
