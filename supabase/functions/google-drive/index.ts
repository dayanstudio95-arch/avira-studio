// The studio's Google Drive for gallery uploads (Avira, 2026-11-03, 0109; _shared/googleDriveAuth.ts). For the studio's
// admins only (owner / admin / studio_manager, as the galleries):
//   status     → { connected, email, error }
//   start      → { authorizeUrl } — Google's consent page; `back` = the app page to come back to
//   token      → { accessToken, expiresAt, rootFolderId } — short-lived, for the browser's uploads straight to Drive
//   disconnect → forgets the account (and revokes the refresh token at Google)
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createServiceRoleClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { signState, revokeToken } from '../_shared/googleCalendarAuth.ts';
import { appOrigin, buildDriveAuthorizeUrl, getDriveAccess } from '../_shared/googleDriveAuth.ts';

const ROLES = ['owner', 'admin', 'studio_manager'];
const BACK = /^\/[A-Za-z0-9/_-]{0,120}$/;

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
    const supabase = createServiceRoleClient();
    const { data: profile } = await supabase.from('profiles').select('tenant_id, role').eq('id', user.id).maybeSingle();
    if (!profile?.tenant_id || !ROLES.includes(profile.role)) return jsonResponse({ error: 'אין הרשאה' }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || 'status');

    if (action === 'start') {
      const back = BACK.test(String(body?.back || '')) ? String(body.back) : '/photos';
      // accountRole is the calendar's field; `back` and the app's address ride along in the signed state.
      const app = appOrigin(req.headers.get('origin'));
      const state = await signState({ tenantId: profile.tenant_id, accountRole: 'primary', userId: user.id, exp: Date.now() + 10 * 60 * 1000, back, app } as any);
      return jsonResponse({ authorizeUrl: buildDriveAuthorizeUrl(state) });
    }

    if (action === 'status') {
      const { data } = await supabase.from('google_drive_accounts').select('google_email, status, refresh_token').eq('tenant_id', profile.tenant_id).maybeSingle();
      return jsonResponse({ connected: Boolean(data?.refresh_token) && data?.status === 'connected', email: data?.google_email || null, error: data?.status === 'error' });
    }

    if (action === 'token') {
      try {
        const access = await getDriveAccess(supabase, profile.tenant_id);
        if (!access) return jsonResponse({ error: 'לא מחובר לגוגל דרייב', notConnected: true });
        return jsonResponse(access);
      } catch (e) {
        return jsonResponse({ error: String((e as Error).message || e), notConnected: true });
      }
    }

    if (action === 'disconnect') {
      const { data } = await supabase.from('google_drive_accounts').select('id, refresh_token').eq('tenant_id', profile.tenant_id).maybeSingle();
      if (data?.refresh_token) await revokeToken(data.refresh_token);
      if (data?.id) await supabase.from('google_drive_accounts').delete().eq('id', data.id);
      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: 'פעולה לא מוכרת' }, { status: 400 });
  } catch (error) {
    console.error('[google-drive] Error:', (error as Error).message);
    return jsonResponse({ error: 'שגיאה בחיבור לגוגל דרייב' }, { status: 500 });
  }
});
