// Changes a teammate's role and/or active status. Owner/admin only, and only within the
// caller's own tenant. Called from src/components/settings/UsersTab.jsx.
//
// 2026-08-20: also optionally links/unlinks a `staff_members` roster row to this profile
// (`staffMemberId`, or `null` to explicitly unlink) — the linkage the new
// photographer-events edge function depends on to resolve "which events is this
// photographer crew on". Done server-side (service-role) rather than leaving the
// frontend to call `entities.StaffMember.update()` directly, so the "clear any other
// staff row currently pointing at this profile" step (enforcing the one-profile-per-
// staff-member invariant backed by 0029_scoped_roles.sql's unique index) happens
// atomically alongside the role change instead of as a separate, easy-to-forget step.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, createServiceRoleClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { getCallerProfile, isAdmin } from '../_shared/permissions.ts';

const ALLOWED_ROLES = ['owner', 'admin', 'studio_manager', 'photographer', 'editor', 'album_manager', 'lead_coordinator'];

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createUserClient(req);
    const callerProfile = await getCallerProfile(supabase, user.id);

    if (!callerProfile || !isAdmin(callerProfile.role)) {
      return jsonResponse({ error: 'Forbidden — רק בעלים או מנהל יכולים לערוך משתמשים' }, { status: 403 });
    }

    const { userId, role, isActive, staffMemberId } = await req.json();
    if (!userId) return jsonResponse({ error: 'Missing userId' }, { status: 400 });
    if (role !== undefined && !ALLOWED_ROLES.includes(role)) {
      return jsonResponse({ error: 'תפקיד לא תקין' }, { status: 400 });
    }
    if (isActive !== undefined && typeof isActive !== 'boolean') {
      return jsonResponse({ error: 'ערך לא תקין' }, { status: 400 });
    }
    if (userId === user.id && isActive === false) {
      return jsonResponse({ error: 'לא ניתן להשבית את המשתמש שלך' }, { status: 400 });
    }

    const serviceClient = createServiceRoleClient();

    const { data: targetProfile } = await serviceClient
      .from('profiles')
      .select('id, tenant_id')
      .eq('id', userId)
      .maybeSingle();

    if (!targetProfile || targetProfile.tenant_id !== callerProfile.tenant_id) {
      return jsonResponse({ error: 'משתמש לא נמצא' }, { status: 404 });
    }

    const updates: Record<string, unknown> = {};
    if (role !== undefined) updates.role = role;
    if (isActive !== undefined) updates.is_active = isActive;

    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await serviceClient.from('profiles').update(updates).eq('id', userId);
      if (updateError) return jsonResponse({ error: updateError.message }, { status: 500 });
    }

    if (staffMemberId !== undefined) {
      if (staffMemberId) {
        const { data: staffRow } = await serviceClient
          .from('staff_members')
          .select('id, tenant_id')
          .eq('id', staffMemberId)
          .maybeSingle();
        if (!staffRow || staffRow.tenant_id !== callerProfile.tenant_id) {
          return jsonResponse({ error: 'איש הצוות לא נמצא' }, { status: 404 });
        }
        // Clear any other staff row previously linked to this profile before linking the
        // new one — a profile may be linked to at most one staff_members row.
        await serviceClient.from('staff_members').update({ profile_id: null }).eq('profile_id', userId);
        const { error: linkError } = await serviceClient
          .from('staff_members')
          .update({ profile_id: userId })
          .eq('id', staffMemberId);
        if (linkError) return jsonResponse({ error: linkError.message }, { status: 500 });
      } else {
        await serviceClient.from('staff_members').update({ profile_id: null }).eq('profile_id', userId);
      }
    }

    if (Object.keys(updates).length === 0 && staffMemberId === undefined) {
      return jsonResponse({ error: 'אין מה לעדכן' }, { status: 400 });
    }

    return jsonResponse({ success: true });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
