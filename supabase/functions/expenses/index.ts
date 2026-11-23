// "מרכז הוצאות" — the screen's server side (Avira, 2026-11-23, the owner approved the plan; 0117). The signed-in owner /
// admin / studio manager:
//   refresh (default)  the "קבלות" group caught up, a few documents read by AI (the screen calls again while
//                      `remaining`), the group answered, Morning's expenses copied when stale (read only);
//   morning            Morning copied now ("עדכון מהמורנינג");
//   set_entity         the business for a document, and with `remember` for its supplier from now on;
//   retry              a document that could not be read, read again;
//   mark               not an expense / back to the list.
// All the work is in _shared/expenseIntake.ts; the decisions in _shared/expenses.ts.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createServiceRoleClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { processPending, runExpenses, setEntity, syncMorning } from '../_shared/expenseIntake.ts';
import { isExpenseEntity } from '../_shared/expenses.ts';

const ROLES = ['owner', 'admin', 'studio_manager'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    const tenantId = profile.tenant_id as string;
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || 'refresh');
    const id = String(body?.id || '');

    if (action === 'morning') {
      return jsonResponse({ success: true, morning: await syncMorning(supabase, tenantId) });
    }
    if (action === 'set_entity') {
      if (!UUID.test(id) || !isExpenseEntity(body?.entity)) return jsonResponse({ error: 'בקשה לא תקינה' }, { status: 400 });
      return jsonResponse({ success: true, updated: await setEntity(supabase, tenantId, id, body.entity, body?.remember === true) });
    }
    if (action === 'retry') {
      if (!UUID.test(id)) return jsonResponse({ error: 'בקשה לא תקינה' }, { status: 400 });
      await supabase.from('expense_docs').update({ read_status: 'pending', read_tries: 0, read_error: null, updated_at: new Date().toISOString() })
        .eq('tenant_id', tenantId).eq('id', id).in('read_status', ['failed', 'manual', 'pending']);
      return jsonResponse({ success: true, ...(await processPending(supabase, tenantId, { ids: [id], maxReads: 1 })) });
    }
    if (action === 'mark') {
      if (!UUID.test(id) || !['not_expense', 'done'].includes(body?.status)) return jsonResponse({ error: 'בקשה לא תקינה' }, { status: 400 });
      const patch = body.status === 'not_expense'
        ? { read_status: 'not_expense', note: 'סומן ידנית: לא הוצאה', updated_at: new Date().toISOString() }
        : { read_status: 'done', note: null, dup_of: null, staff_invoice_id: null, updated_at: new Date().toISOString() };
      await supabase.from('expense_docs').update(patch).eq('tenant_id', tenantId).eq('id', id).in('read_status', body.status === 'not_expense' ? ['done', 'failed', 'manual'] : ['not_expense', 'duplicate']);
      return jsonResponse({ success: true });
    }
    const result = await runExpenses(supabase, tenantId, { maxReads: 4, morning: body?.morning === 'skip' ? 'skip' : 'auto' });
    return jsonResponse({ success: true, ...result });
  } catch (e) {
    console.error('[expenses]', (e as Error)?.message || e);
    return jsonResponse({ error: (e as Error)?.message || 'שגיאה' }, { status: 500 });
  }
});
