// Invites a new teammate into the caller's tenant.
// Called from src/components/settings/UsersTab.jsx ("הזמן משתמש חדש" button).
//
// Two modes, both provisioning the same `profiles` row afterward:
//  - Default (no `password` in the request): sends a Supabase Auth invite email
//    (auth.admin.inviteUserByEmail), which creates the auth.users row and mails a magic
//    link -> the link lands on the public /accept-invite page
//    (src/pages/AcceptInvite.jsx), where the new teammate sets their own password.
//    Depends on Supabase's own mailer, which is rate-limited and occasionally doesn't
//    arrive (see resend-invite/index.ts for the WhatsApp-based fallback for this case).
//  - Manual password (2026-08-19, added after a real delivery failure): if the caller
//    supplies `password`, we instead create the account directly via
//    auth.admin.createUser({..., email_confirm: true}) with that password — no email
//    involved at all. The admin is then responsible for relaying the email+password to
//    the new teammate themselves (e.g. via the "שלח פרטי התחברות בוואטסאפ" action in
//    UsersTab.jsx, which reuses the existing send-whatsapp-message function).
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, createServiceRoleClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { getCallerProfile, isAdmin } from '../_shared/permissions.ts';

const ALLOWED_ROLES = ['owner', 'admin', 'studio_manager', 'photographer', 'editor', 'album_manager'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createUserClient(req);
    const callerProfile = await getCallerProfile(supabase, user.id);

    if (!callerProfile || !isAdmin(callerProfile.role)) {
      return jsonResponse({ error: 'Forbidden — רק בעלים או מנהל יכולים להזמין משתמשים' }, { status: 403 });
    }

    const { email, fullName, role, phone, password, origin } = await req.json();

    if (!email || typeof email !== 'string' || !EMAIL_RE.test(email)) {
      return jsonResponse({ error: 'כתובת אימייל לא תקינה' }, { status: 400 });
    }
    if (!role || !ALLOWED_ROLES.includes(role)) {
      return jsonResponse({ error: 'תפקיד לא תקין' }, { status: 400 });
    }
    if (password && (typeof password !== 'string' || password.length < 6)) {
      return jsonResponse({ error: 'הסיסמה חייבת להכיל לפחות 6 תווים' }, { status: 400 });
    }

    const serviceClient = createServiceRoleClient();

    let newUser;
    let usedManualPassword = false;

    if (password) {
      // Manual-password path: create the account fully confirmed, no email sent at all —
      // the admin relays the credentials to the new teammate themselves.
      const { data, error } = await serviceClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName || null },
      });
      if (error || !data?.user) {
        return jsonResponse({ error: error?.message || 'יצירת המשתמש נכשלה' }, { status: 400 });
      }
      newUser = data.user;
      usedManualPassword = true;
    } else {
      // Always use the fixed production app URL for the invite email's link — never trust
      // the caller-supplied `origin`. If the admin sends an invite while running the app
      // locally (localhost dev server), a client-derived origin would bake a `localhost`
      // link into the email, which is unreachable for the invited teammate. `origin` is
      // kept as a last-resort fallback only in case APP_BASE_URL is ever unset.
      const redirectTo = `${Deno.env.get('APP_BASE_URL') || origin || Deno.env.get('SUPABASE_URL') || ''}/accept-invite`;

      const { data, error } = await serviceClient.auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName || null },
        redirectTo,
      });
      if (error || !data?.user) {
        return jsonResponse({ error: error?.message || 'שליחת ההזמנה נכשלה' }, { status: 400 });
      }
      newUser = data.user;
    }

    const { error: profileError } = await serviceClient.from('profiles').insert({
      id: newUser.id,
      tenant_id: callerProfile.tenant_id,
      role,
      full_name: fullName || null,
      phone: phone || null,
      is_active: true,
    });

    if (profileError) {
      // Don't leave an orphaned auth user with no profile behind.
      await serviceClient.auth.admin.deleteUser(newUser.id);
      return jsonResponse({ error: profileError.message }, { status: 500 });
    }

    return jsonResponse({ success: true, userId: newUser.id, usedManualPassword });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
