// Invites a new teammate into the caller's tenant.
// Called from src/components/settings/UsersTab.jsx ("הזמן משתמש חדש" button).
//
// Flow: caller must already be owner/admin of their tenant -> we send a Supabase Auth
// invite email (auth.admin.inviteUserByEmail) which creates the auth.users row and mails
// a magic link -> the link lands on the public /accept-invite page (src/pages/AcceptInvite.jsx),
// where the new teammate sets their password -> we eagerly insert their `profiles` row here
// (tenant_id + role) so they're fully provisioned the moment they land, without needing a
// second server round-trip from the accept-invite page.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, createServiceRoleClient, getRequestUser } from '../_shared/supabaseClients.ts';

const ALLOWED_ROLES = ['owner', 'admin', 'studio_manager', 'photographer', 'editor', 'album_manager'];
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
      .select('role, tenant_id')
      .eq('id', user.id)
      .maybeSingle();

    if (!callerProfile || !['owner', 'admin'].includes(callerProfile.role)) {
      return jsonResponse({ error: 'Forbidden — רק בעלים או מנהל יכולים להזמין משתמשים' }, { status: 403 });
    }

    const { email, fullName, role, origin } = await req.json();

    if (!email || typeof email !== 'string' || !EMAIL_RE.test(email)) {
      return jsonResponse({ error: 'כתובת אימייל לא תקינה' }, { status: 400 });
    }
    if (!role || !ALLOWED_ROLES.includes(role)) {
      return jsonResponse({ error: 'תפקיד לא תקין' }, { status: 400 });
    }

    const serviceClient = createServiceRoleClient();
    const redirectTo = `${origin || Deno.env.get('SUPABASE_URL') || ''}/accept-invite`;

    const { data: inviteData, error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName || null },
      redirectTo,
    });

    if (inviteError || !inviteData?.user) {
      return jsonResponse({ error: inviteError?.message || 'שליחת ההזמנה נכשלה' }, { status: 400 });
    }

    const { error: profileError } = await serviceClient.from('profiles').insert({
      id: inviteData.user.id,
      tenant_id: callerProfile.tenant_id,
      role,
      full_name: fullName || null,
      is_active: true,
    });

    if (profileError) {
      // Don't leave an orphaned auth user with no profile behind.
      await serviceClient.auth.admin.deleteUser(inviteData.user.id);
      return jsonResponse({ error: profileError.message }, { status: 500 });
    }

    return jsonResponse({ success: true, userId: inviteData.user.id });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
