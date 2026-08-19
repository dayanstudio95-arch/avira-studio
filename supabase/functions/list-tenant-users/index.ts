// Lists every teammate (profiles row) in the caller's tenant, with their email attached
// from auth.users (profiles has no email column — see 0001_init.sql). Runs with the
// service role so it works regardless of the `profiles_tenant_select` RLS policy, and so
// it can read auth.users, which the browser client never has access to.
//
// Called from src/components/settings/UsersTab.jsx on mount.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, createServiceRoleClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { getCallerProfile, isAdmin } from '../_shared/permissions.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createUserClient(req);
    const callerProfile = await getCallerProfile(supabase, user.id);

    // Same gate as the admin panel itself (src/App.jsx) — anyone who can open Settings
    // can see the team list.
    if (!callerProfile || !isAdmin(callerProfile.role)) {
      return jsonResponse({ error: 'Forbidden' }, { status: 403 });
    }

    const serviceClient = createServiceRoleClient();

    const { data: profiles, error: profilesError } = await serviceClient
      .from('profiles')
      .select('id, role, full_name, phone, is_active, created_at')
      .eq('tenant_id', callerProfile.tenant_id)
      .order('created_at', { ascending: true });

    if (profilesError) return jsonResponse({ error: profilesError.message }, { status: 500 });

    // Which staff_members roster row (if any) each profile is linked to — powers the
    // photographer↔staff_members link picker in UsersTab.jsx (see 0029_scoped_roles.sql,
    // update-tenant-user/index.ts's staffMemberId handling).
    const { data: linkedStaff } = await serviceClient
      .from('staff_members')
      .select('id, name, profile_id')
      .eq('tenant_id', callerProfile.tenant_id)
      .not('profile_id', 'is', null);
    const staffByProfileId = new Map((linkedStaff || []).map((s) => [s.profile_id, s]));

    // listUsers is paginated (default 50/page); a single studio's team is always tiny,
    // but ask for a generous page size so we don't silently drop anyone.
    const { data: authList, error: authError } = await serviceClient.auth.admin.listUsers({ perPage: 1000 });
    if (authError) return jsonResponse({ error: authError.message }, { status: 500 });

    const emailById = new Map((authList?.users || []).map((u) => [u.id, u.email]));
    // Exposed so the frontend can show a "Resend invite" action only for teammates who
    // never confirmed their account (never clicked their invite link / never set a
    // password) — see resend-invite/index.ts.
    const confirmedById = new Map((authList?.users || []).map((u) => [u.id, !!u.email_confirmed_at]));

    const result = (profiles || []).map((p) => ({
      id: p.id,
      email: emailById.get(p.id) || null,
      fullName: p.full_name,
      phone: p.phone,
      role: p.role,
      isActive: p.is_active,
      createdAt: p.created_at,
      isSelf: p.id === user.id,
      isConfirmed: confirmedById.get(p.id) ?? true,
      staffMemberId: staffByProfileId.get(p.id)?.id ?? null,
      staffMemberName: staffByProfileId.get(p.id)?.name ?? null,
    }));

    return jsonResponse({ users: result });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
