// Google sends the browser back here after the studio approved its Drive (Avira, 2026-11-03, 0109) — no session on
// this request (verify_jwt = false in config.toml, as google-calendar-oauth-callback): the signed state says which
// studio and who. Saves the account, makes "גלריות אווירה", and sends the browser back to the page it came from.
import { createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { verifyState, fetchGoogleUserEmail } from '../_shared/googleCalendarAuth.ts';
import { DRIVE_SCOPE, ensureRootFolder, exchangeDriveCode } from '../_shared/googleDriveAuth.ts';

const BACK = /^\/[A-Za-z0-9/_-]{0,120}$/;
const redirectTo = (url: string) => new Response(null, { status: 302, headers: { Location: url } });

Deno.serve(async (req) => {
  const app = Deno.env.get('APP_BASE_URL') ?? '';
  let back = '/photos';
  try {
    const url = new URL(req.url);
    const state = url.searchParams.get('state');
    const payload: any = state ? await verifyState(state) : null;
    if (payload && BACK.test(String(payload.back || ''))) back = payload.back;
    const error = url.searchParams.get('error');
    if (error) return redirectTo(`${app}${back}?drive_error=${encodeURIComponent(error)}`);
    const code = url.searchParams.get('code');
    if (!code || !payload) return redirectTo(`${app}${back}?drive_error=${encodeURIComponent('missing_code')}`);

    const tokens = await exchangeDriveCode(code);
    // The consent page lets the studio untick Drive: without it nothing can be uploaded.
    if (!String(tokens.scope || '').split(' ').includes(DRIVE_SCOPE)) return redirectTo(`${app}${back}?drive_error=${encodeURIComponent('no_drive_scope')}`);
    const email = await fetchGoogleUserEmail(tokens.access_token);
    const supabase = createServiceRoleClient();
    const { data: existing } = await supabase.from('google_drive_accounts').select('id, root_folder_id, google_email').eq('tenant_id', payload.tenantId).maybeSingle();
    if (!existing && !tokens.refresh_token) return redirectTo(`${app}${back}?drive_error=${encodeURIComponent('no_refresh_token')}`);
    // Another Google account: its own "גלריות אווירה" (the old folder belongs to the other account).
    const sameAccount = existing && existing.google_email === email;
    const rootFolderId = await ensureRootFolder(tokens.access_token, sameAccount ? existing.root_folder_id : null);
    const row = {
      tenant_id: payload.tenantId,
      google_email: email,
      access_token: tokens.access_token,
      ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
      token_expires_at: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
      scope: tokens.scope,
      root_folder_id: rootFolderId,
      status: 'connected',
      last_error: null,
      connected_by: payload.userId,
      updated_at: new Date().toISOString(),
    };
    if (existing) await supabase.from('google_drive_accounts').update(row).eq('id', existing.id);
    else await supabase.from('google_drive_accounts').insert(row);
    return redirectTo(`${app}${back}?drive=connected`);
  } catch (err) {
    console.error('[google-drive-oauth-callback] Error:', (err as Error).message);
    return redirectTo(`${app}${back}?drive_error=${encodeURIComponent('failed')}`);
  }
});
