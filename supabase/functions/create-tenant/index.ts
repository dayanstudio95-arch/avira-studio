// Spins up a brand new, fully isolated tenant ("studio") for a different business —
// added 2026-08-13 per explicit request: "אני רוצה לתת לחבר שיש לו גם סטודיו כמו שלי
// להשתמש במערכת" (want to give a friend who also runs a studio access to the system,
// with his own separate data). Called from src/components/settings/CreateStudioDialog.jsx
// ("צור סטודיו חדש" button in Settings -> משתמשים).
//
// This is DELIBERATELY separate from invite-user/index.ts: invite-user always attaches the
// new person to the CALLER's own tenant_id (a teammate joining your studio). create-tenant
// does the opposite — it creates a brand new `tenants` row and makes the invited person the
// 'owner' of that new tenant, so their leads/events/packages/staff are 100% isolated from
// the caller's data via the existing per-table RLS policies (tenant_id = current_tenant_id()).
//
// Gated to role === 'owner' only (stricter than invite-user's owner-or-admin bar), since
// creating a whole new tenant is a bigger, rarer action than inviting a teammate.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, createServiceRoleClient, getRequestUser } from '../_shared/supabaseClients.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createUserClient(req);
    const { data: callerProfile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (!callerProfile || callerProfile.role !== 'owner') {
      return jsonResponse({ error: 'Forbidden — רק בעלים יכול ליצור סטודיו חדש' }, { status: 403 });
    }

    const { studioName, email, fullName, origin } = await req.json();

    if (!studioName || typeof studioName !== 'string' || !studioName.trim()) {
      return jsonResponse({ error: 'יש להזין שם סטודיו' }, { status: 400 });
    }
    if (!email || typeof email !== 'string' || !EMAIL_RE.test(email)) {
      return jsonResponse({ error: 'כתובת אימייל לא תקינה' }, { status: 400 });
    }

    const serviceClient = createServiceRoleClient();

    // 1. Create the new, isolated tenant.
    const { data: newTenant, error: tenantError } = await serviceClient
      .from('tenants')
      .insert({ name: studioName.trim() })
      .select('id')
      .single();

    if (tenantError || !newTenant) {
      return jsonResponse({ error: tenantError?.message || 'יצירת הסטודיו נכשלה' }, { status: 500 });
    }

    // 2. Invite the new owner (same auth.admin flow as invite-user — lands on /accept-invite
    //    to set their password).
    const redirectTo = `${origin || Deno.env.get('SUPABASE_URL') || ''}/accept-invite`;
    const { data: inviteData, error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName || null },
      redirectTo,
    });

    if (inviteError || !inviteData?.user) {
      // Don't leave an orphaned tenant with no owner behind.
      await serviceClient.from('tenants').delete().eq('id', newTenant.id);
      return jsonResponse({ error: inviteError?.message || 'שליחת ההזמנה נכשלה' }, { status: 400 });
    }

    // 3. Make them the 'owner' of their own brand new tenant.
    const { error: profileError } = await serviceClient.from('profiles').insert({
      id: inviteData.user.id,
      tenant_id: newTenant.id,
      role: 'owner',
      full_name: fullName || null,
      is_active: true,
    });

    if (profileError) {
      await serviceClient.auth.admin.deleteUser(inviteData.user.id);
      await serviceClient.from('tenants').delete().eq('id', newTenant.id);
      return jsonResponse({ error: profileError.message }, { status: 500 });
    }

    return jsonResponse({ success: true, tenantId: newTenant.id, userId: inviteData.user.id });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
