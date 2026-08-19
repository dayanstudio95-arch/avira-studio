// Resends account-access to an existing teammate who never confirmed their invite (or
// helps a confirmed teammate reset a forgotten password) — added 2026-08-19 after a real
// production failure where Supabase's own invite email never arrived (rate-limited/
// unreliable default mailer, see invite-user/index.ts's header comment).
//
// Uses auth.admin.generateLink({ type: 'recovery' }) rather than re-calling
// inviteUserByEmail: `recovery` works uniformly for both never-confirmed and
// already-confirmed users (inviteUserByEmail errors on an existing user), and — the key
// property this whole function exists for — generateLink does NOT send any email itself;
// it just returns the actual link/tokens, so we get full control over delivery instead of
// depending on Supabase's mailer a second time. The link lands on the same public
// /accept-invite page (src/pages/AcceptInvite.jsx), which is fully generic — it never
// inspects the Auth link `type`, it just waits for any session to appear and then shows a
// "set your password" form, so `recovery` works here exactly like `invite` would.
//
// Two delivery methods, both driven from src/components/settings/UsersTab.jsx:
//  - method: 'whatsapp' — sends the link directly via the existing Green API pipeline
//    (requires `phone`).
//  - method: 'link' — just returns the link so the admin can copy/paste it anywhere
//    themselves (email, SMS, in person).
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, createServiceRoleClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { getCallerProfile, isAdmin } from '../_shared/permissions.ts';
import { sendWhatsApp } from '../_shared/whatsapp.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createUserClient(req);
    const callerProfile = await getCallerProfile(supabase, user.id);

    if (!callerProfile || !isAdmin(callerProfile.role)) {
      return jsonResponse({ error: 'Forbidden — רק בעלים או מנהל יכולים לשלוח הזמנה מחדש' }, { status: 403 });
    }

    const { userId, method, phone } = await req.json();
    if (!userId || typeof userId !== 'string') {
      return jsonResponse({ error: 'חסר מזהה משתמש' }, { status: 400 });
    }
    if (method !== 'whatsapp' && method !== 'link') {
      return jsonResponse({ error: 'שיטת שליחה לא תקינה' }, { status: 400 });
    }

    const serviceClient = createServiceRoleClient();

    // Only allow resending to a teammate inside the caller's own tenant.
    const { data: targetProfile, error: targetError } = await serviceClient
      .from('profiles')
      .select('id, tenant_id, full_name')
      .eq('id', userId)
      .single();

    if (targetError || !targetProfile || targetProfile.tenant_id !== callerProfile.tenant_id) {
      return jsonResponse({ error: 'משתמש לא נמצא' }, { status: 404 });
    }

    const { data: authUser, error: authUserError } = await serviceClient.auth.admin.getUserById(userId);
    if (authUserError || !authUser?.user?.email) {
      return jsonResponse({ error: 'לא נמצא אימייל עבור המשתמש' }, { status: 404 });
    }

    const redirectTo = `${Deno.env.get('APP_BASE_URL') || Deno.env.get('SUPABASE_URL') || ''}/accept-invite`;

    const { data: linkData, error: linkError } = await serviceClient.auth.admin.generateLink({
      type: 'recovery',
      email: authUser.user.email,
      options: { redirectTo },
    });

    if (linkError || !linkData?.properties?.action_link) {
      return jsonResponse({ error: linkError?.message || 'יצירת הקישור נכשלה' }, { status: 500 });
    }

    const actionLink = linkData.properties.action_link;

    if (method === 'link') {
      return jsonResponse({ success: true, actionLink });
    }

    // method === 'whatsapp'
    if (!phone || typeof phone !== 'string') {
      return jsonResponse({ error: 'חסר מספר טלפון לשליחת הוואטסאפ' }, { status: 400 });
    }

    const message = `שלום ${targetProfile.full_name || ''} 😊\nהנה קישור להתחברות למערכת:\n${actionLink}\n\nלחצו על הקישור וקבעו סיסמה כדי להתחבר.`;
    const sendResult = await sendWhatsApp(serviceClient, phone, message, callerProfile.tenant_id);

    if (!sendResult.success) {
      // Still return the link so the admin can fall back to copying it manually.
      return jsonResponse({ error: sendResult.error || 'שליחת הוואטסאפ נכשלה', actionLink }, { status: 502 });
    }

    return jsonResponse({ success: true, actionLink });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
