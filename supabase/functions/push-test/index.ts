// "שלח התראת בדיקה" in אווירה צ'אט's notification settings (stage 1ב, 2026-10-05).
// Sends one notification to ONE device — the caller's own, proven by reading it through
// the caller's RLS (a user only ever sees their own push_subscriptions rows). Nothing is
// sent to any customer; this never touches WhatsApp.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, createServiceRoleClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { sendPush } from '../_shared/webPush.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
    const { subscriptionId } = await req.json().catch(() => ({}));
    if (!subscriptionId) return jsonResponse({ error: 'subscriptionId is required' }, { status: 400 });

    const userClient = createUserClient(req);
    const { data: sub } = await userClient
      .from('push_subscriptions')
      .select('id, tenant_id')
      .eq('id', subscriptionId)
      .maybeSingle();
    if (!sub) return jsonResponse({ error: 'Not found' }, { status: 404 });

    if (!Deno.env.get('VAPID_KEYS_B64')) {
      return jsonResponse({ error: 'מפתחות ההתראות עוד לא הוגדרו בשרת (VAPID_KEYS_B64)' }, { status: 503 });
    }
    const result = await sendPush(createServiceRoleClient(), sub.tenant_id, 'lead', {
      title: "אווירה צ'אט",
      body: 'התראת בדיקה — ההתראות עובדות במכשיר הזה ✓',
    }, sub.id);
    return jsonResponse({ success: result.sent > 0, ...result });
  } catch (e: any) {
    return jsonResponse({ error: e?.message || 'error' }, { status: 500 });
  }
});
