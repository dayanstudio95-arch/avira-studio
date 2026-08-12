// Changes a teammate's role and/or active status. Owner/admin only, and only within the
// caller's own tenant. Called from src/components/settings/UsersTab.jsx.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, createServiceRoleClient, getRequestUser } from '../_shared/supabaseClients.ts';

const ALLOWED_ROLES = ['owner', 'admin', 'studio_manager', 'photographer', 'editor', 'album_manager'];

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createUserClient(req);
    const { data: callerProfile } = await supabase
      .from('profiles')
      .select('role, tenant_id')
      .eq('id', user.id)
      .maybeSingle();

    if (!callerProfile || !['owner', 'admin'].includes(callerProfile.role)) {
      return jsonResponse({ error: 'Forbidden — רק בעלים או מנהל יכולים לערוך משתמשים' }, { status: 403 });
    }

    const { userId, role, isActive } = await req.json();
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

    if (Object.keys(updates).length === 0) {
      return jsonResponse({ error: 'אין מה לעדכן' }, { status: 400 });
    }

    const { error: updateError } = await serviceClient.from('profiles').update(updates).eq('id', userId);
    if (updateError) return jsonResponse({ error: updateError.message }, { status: 500 });

    return jsonResponse({ success: true });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
