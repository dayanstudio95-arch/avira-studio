// Permanently deletes a teammate's account. Owner/admin/studio_manager only, and only
// within the caller's own tenant. Called from src/components/settings/UsersTab.jsx.
//
// Deleting via `serviceClient.auth.admin.deleteUser(userId)` is sufficient to remove the
// whole account: `profiles.id references auth.users(id) on delete cascade`
// (0001_init.sql), so the profiles row is removed automatically. Every other table with a
// foreign key onto `profiles.id` is `on delete set null` (google_calendar_accounts.connected_by,
// notifications.read_by, audit_logs.actor_id, leads.created_by_profile_id,
// staff_members.profile_id) except `ai_assistant_messages.user_id`, which is `on delete
// cascade` (that user's own AI chat history is expected to go with them) — so no FK
// violation is possible here, no manual cleanup needed before calling deleteUser.
//
// Guards (mirroring update-tenant-user's existing self-deactivation guard):
// - Can't delete your own account through this admin flow.
// - Can't delete the tenant's last remaining owner (would leave the studio with no owner
//   at all, and there is no other flow anywhere in this app that can promote someone back
//   to owner).
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

    if (!callerProfile || !isAdmin(callerProfile.role)) {
      return jsonResponse({ error: 'Forbidden — רק בעלים או מנהל יכולים למחוק משתמשים' }, { status: 403 });
    }

    const { userId } = await req.json();
    if (!userId) return jsonResponse({ error: 'Missing userId' }, { status: 400 });

    if (userId === user.id) {
      return jsonResponse({ error: 'לא ניתן למחוק את החשבון שלך דרך מסך זה' }, { status: 400 });
    }

    const serviceClient = createServiceRoleClient();

    const { data: targetProfile } = await serviceClient
      .from('profiles')
      .select('id, tenant_id, role, full_name')
      .eq('id', userId)
      .maybeSingle();

    if (!targetProfile || targetProfile.tenant_id !== callerProfile.tenant_id) {
      return jsonResponse({ error: 'משתמש לא נמצא' }, { status: 404 });
    }

    if (targetProfile.role === 'owner') {
      const { count } = await serviceClient
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', callerProfile.tenant_id)
        .eq('role', 'owner');
      if ((count ?? 0) <= 1) {
        return jsonResponse({ error: 'לא ניתן למחוק את הבעלים היחיד של הסטודיו' }, { status: 400 });
      }
    }

    const { error: deleteError } = await serviceClient.auth.admin.deleteUser(userId);
    if (deleteError) return jsonResponse({ error: deleteError.message }, { status: 500 });

    return jsonResponse({ success: true });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
