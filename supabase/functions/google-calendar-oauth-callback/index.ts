// Google redirects the browser here after the user approves (or denies) the
// OAuth consent screen. This request carries NO Authorization header at all
// (it's a plain browser GET from Google, not an authenticated app call) —
// MUST be deployed with verify_jwt=false (see supabase/config.toml) or
// Supabase's platform-level JWT check would 401 it before this code ever runs.
//
// Recovers tenant context purely from the signed `state` param (see
// _shared/googleCalendarAuth.ts signState/verifyState), exchanges the code
// for tokens, fetches the connected email, upserts google_calendar_accounts
// via the service-role client (no user session exists on this request), then
// 302-redirects the browser back into the app.
import { createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { verifyState, exchangeCodeForTokens, fetchGoogleUserEmail } from '../_shared/googleCalendarAuth.ts';

function redirectTo(url: string): Response {
  return new Response(null, { status: 302, headers: { Location: url } });
}

Deno.serve(async (req) => {
  const appBaseUrl = Deno.env.get('APP_BASE_URL') ?? '';
  const returnUrl = `${appBaseUrl}/GoogleCalendarSync`;

  try {
    const url = new URL(req.url);
    const error = url.searchParams.get('error');
    if (error) {
      console.log('[google-calendar-oauth-callback] Google returned an error:', error);
      return redirectTo(`${returnUrl}?error=${encodeURIComponent(error)}`);
    }

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) {
      return redirectTo(`${returnUrl}?error=${encodeURIComponent('Missing code or state from Google')}`);
    }

    const payload = await verifyState(state);
    const tokens = await exchangeCodeForTokens(code);
    const email = await fetchGoogleUserEmail(tokens.access_token);

    const supabase = createServiceRoleClient();
    const tokenExpiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();

    // upsert on (tenant_id, account_role) — reconnecting the same slot
    // overwrites the previous tokens rather than erroring on the unique constraint.
    const { data: existing } = await supabase
      .from('google_calendar_accounts')
      .select('id')
      .eq('tenant_id', payload.tenantId)
      .eq('account_role', payload.accountRole)
      .maybeSingle();

    const row = {
      tenant_id: payload.tenantId,
      account_role: payload.accountRole,
      google_email: email,
      access_token: tokens.access_token,
      // Google only returns a refresh_token on the FIRST consent (or when
      // prompt=consent forces re-issue, which buildAuthorizeUrl always
      // sets) — but guard anyway so a token-only response never wipes out
      // a previously stored refresh_token.
      ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
      token_expires_at: tokenExpiresAt,
      scope: tokens.scope,
      status: 'connected',
      last_error: null,
      connected_by: payload.userId,
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      await supabase.from('google_calendar_accounts').update(row).eq('id', existing.id);
    } else {
      if (!tokens.refresh_token) {
        return redirectTo(
          `${returnUrl}?error=${encodeURIComponent('Google did not return a refresh token — please try connecting again')}`,
        );
      }
      await supabase.from('google_calendar_accounts').insert(row);
    }

    console.log(`[google-calendar-oauth-callback] Connected ${payload.accountRole} account (${email}) for tenant ${payload.tenantId}`);
    return redirectTo(`${returnUrl}?connected=${payload.accountRole}`);
  } catch (err) {
    console.error('[google-calendar-oauth-callback] Error:', err);
    return redirectTo(`${returnUrl}?error=${encodeURIComponent(String(err.message || err))}`);
  }
});
