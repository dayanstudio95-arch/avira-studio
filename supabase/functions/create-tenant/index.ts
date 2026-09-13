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
//
// DELIVERY IS WHATSAPP, NOT EMAIL (2026-09-13, per the owner: "במקום שהוא יקבל דרך המייל
// שזה ישלח בוואטסאפ שלו"). The email path failed three times in a row — first because of
// Supabase Auth's URL Configuration (see DEPLOYMENT.md §2.1), and underneath that because
// Supabase's default mailer is rate-limited and unreliable (see invite-user/index.ts).
// The studio's own Green API line is the channel that demonstrably works, and it is the
// exact mechanism resend-invite/index.ts already uses for teammates:
// auth.admin.generateLink() returns the link WITHOUT sending any email, and we deliver it.
//
// Existing-user recovery: if the email already has an auth user who is the sole owner of
// a tenant nobody else belongs to, that is almost certainly a studio this button created
// earlier whose link died. We reuse that tenant and send a fresh `recovery` link instead
// of failing with "already registered" — same reasoning as invite-user's
// recoveredExistingUser path. A tenant with more than one member is refused: that is a
// live studio, not a dead invite.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, createServiceRoleClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { getCallerProfile, isOwner } from '../_shared/permissions.ts';
import { sendWhatsApp } from '../_shared/whatsapp.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createUserClient(req);
    const callerProfile = await getCallerProfile(supabase, user.id, 'role, tenant_id');

    if (!callerProfile || !isOwner(callerProfile.role)) {
      return jsonResponse({ error: 'Forbidden — רק בעלים יכול ליצור סטודיו חדש' }, { status: 403 });
    }

    const { studioName, email, fullName, phone } = await req.json();

    if (!studioName || typeof studioName !== 'string' || !studioName.trim()) {
      return jsonResponse({ error: 'יש להזין שם סטודיו' }, { status: 400 });
    }
    if (!email || typeof email !== 'string' || !EMAIL_RE.test(email)) {
      return jsonResponse({ error: 'כתובת אימייל לא תקינה' }, { status: 400 });
    }
    if (!phone || typeof phone !== 'string' || !phone.trim()) {
      return jsonResponse({ error: 'יש להזין מספר וואטסאפ של הבעלים' }, { status: 400 });
    }

    const serviceClient = createServiceRoleClient();

    // ⚠️ READ THIS BEFORE TOUCHING THE LINK AGAIN. The "invite link goes to localhost" bug
    // was reported THREE times (Aug 2026 ×2, 2026-09-13). The first two fixes were both in
    // what this function writes into the link — and both were beside the point. The real
    // cause was Supabase Auth's own URL Configuration: Site URL was still the default
    // http://localhost:3000 and the Redirect URLs allow-list was EMPTY, so Supabase ignored
    // whatever redirectTo we sent and fell back to its default. No value in this file can
    // fix that. See DEPLOYMENT.md §2.1. If this recurs, check the dashboard first.
    const redirectTo = `${Deno.env.get('APP_BASE_URL') || Deno.env.get('SUPABASE_URL') || ''}/accept-invite`;

    let tenantId: string;
    let userId: string;
    let actionLink: string;
    let recoveredExistingUser = false;

    // --- Existing-user recovery (a studio created earlier whose link died) ---------------
    const { data: listData, error: listError } = await serviceClient.auth.admin.listUsers({ perPage: 1000 });
    if (listError) {
      return jsonResponse({ error: listError.message }, { status: 500 });
    }
    const existing = (listData?.users || []).find((u) => u.email?.toLowerCase() === email.toLowerCase());

    if (existing) {
      const { data: existingProfile } = await serviceClient
        .from('profiles')
        .select('id, tenant_id, role')
        .eq('id', existing.id)
        .maybeSingle();

      if (!existingProfile || existingProfile.role !== 'owner' || existingProfile.tenant_id === callerProfile.tenant_id) {
        return jsonResponse({ error: 'כתובת אימייל זו כבר שייכת למשתמש קיים במערכת' }, { status: 409 });
      }

      const { count } = await serviceClient
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', existingProfile.tenant_id);
      if ((count ?? 0) > 1) {
        return jsonResponse({ error: 'כתובת אימייל זו כבר שייכת לבעלים של סטודיו פעיל' }, { status: 409 });
      }

      const { data: linkData, error: linkError } = await serviceClient.auth.admin.generateLink({
        type: 'recovery',
        email: existing.email!,
        options: { redirectTo },
      });
      if (linkError || !linkData?.properties?.action_link) {
        return jsonResponse({ error: linkError?.message || 'יצירת הקישור נכשלה' }, { status: 500 });
      }

      // Keep the profile in step with what was typed this time (phone is new information;
      // the name may have been corrected).
      await serviceClient
        .from('profiles')
        .update({ phone: phone.trim(), ...(fullName ? { full_name: fullName } : {}) })
        .eq('id', existing.id);

      tenantId = existingProfile.tenant_id;
      userId = existing.id;
      actionLink = linkData.properties.action_link;
      recoveredExistingUser = true;
    } else {
      // --- Fresh studio ----------------------------------------------------------------
      const { data: newTenant, error: tenantError } = await serviceClient
        .from('tenants')
        .insert({ name: studioName.trim() })
        .select('id')
        .single();

      if (tenantError || !newTenant) {
        return jsonResponse({ error: tenantError?.message || 'יצירת הסטודיו נכשלה' }, { status: 500 });
      }

      // `invite` creates the auth user and returns the link — no email is sent.
      const { data: linkData, error: linkError } = await serviceClient.auth.admin.generateLink({
        type: 'invite',
        email,
        options: { data: { full_name: fullName || null }, redirectTo },
      });

      if (linkError || !linkData?.user || !linkData?.properties?.action_link) {
        // Don't leave an orphaned tenant with no owner behind.
        await serviceClient.from('tenants').delete().eq('id', newTenant.id);
        return jsonResponse({ error: linkError?.message || 'יצירת חשבון הבעלים נכשלה' }, { status: 400 });
      }

      const { error: profileError } = await serviceClient.from('profiles').insert({
        id: linkData.user.id,
        tenant_id: newTenant.id,
        role: 'owner',
        full_name: fullName || null,
        phone: phone.trim(),
        is_active: true,
      });

      if (profileError) {
        await serviceClient.auth.admin.deleteUser(linkData.user.id);
        await serviceClient.from('tenants').delete().eq('id', newTenant.id);
        return jsonResponse({ error: profileError.message }, { status: 500 });
      }

      tenantId = newTenant.id;
      userId = linkData.user.id;
      actionLink = linkData.properties.action_link;
    }

    // --- Deliver over the CALLER's WhatsApp line (the new studio has none yet) ------------
    const message =
      `שלום ${fullName || ''} 😊\n` +
      `נפתח עבורך חשבון במערכת AVIRA לסטודיו "${studioName.trim()}".\n` +
      `הנה קישור להתחברות:\n${actionLink}\n\n` +
      `לחצו על הקישור וקבעו סיסמה. שם המשתמש שלכם הוא ${email}.`;

    const sendResult = await sendWhatsApp(serviceClient, phone, message, callerProfile.tenant_id);

    if (!sendResult.success) {
      // 200 on purpose: the studio and the account DO exist now, and the dialog needs the
      // link to offer a copy-and-send-yourself fallback. A thrown HTTP error would lose it
      // (functions.js surfaces only `error` on non-2xx).
      return jsonResponse({
        success: false,
        error: sendResult.error || 'שליחת הוואטסאפ נכשלה',
        actionLink,
        tenantId,
        userId,
        recoveredExistingUser,
      });
    }

    return jsonResponse({ success: true, tenantId, userId, actionLink, recoveredExistingUser });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
