// Disconnects one Google account slot ('primary'/'backup') for the calling
// user's tenant. Best-effort revokes the token at Google, then clears the
// stored tokens and flips status to 'disconnected' — the row itself is kept
// (not deleted) so the (tenant_id, account_role) unique slot + audit trail
// (google_email, connected_by) survive for the next reconnect / for display.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { revokeToken } from '../_shared/googleCalendarAuth.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createUserClient(req);
    const { accountRole } = await req.json();
    if (accountRole !== 'primary' && accountRole !== 'backup') {
      return jsonResponse({ error: 'accountRole must be "primary" or "backup"' }, { status: 400 });
    }

    const { data: profile } = await supabase.from('profiles').select('tenant_id').eq('id', user.id).maybeSingle();
    if (!profile) return jsonResponse({ error: 'Profile not found for user' }, { status: 403 });

    const { data: account } = await supabase
      .from('google_calendar_accounts')
      .select('*')
      .eq('tenant_id', profile.tenant_id)
      .eq('account_role', accountRole)
      .maybeSingle();

    if (!account) return jsonResponse({ success: true, message: 'Already disconnected' });

    if (account.refresh_token) await revokeToken(account.refresh_token);
    else if (account.access_token) await revokeToken(account.access_token);

    await supabase
      .from('google_calendar_accounts')
      .update({
        status: 'disconnected',
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', account.id);

    return jsonResponse({ success: true });
  } catch (error) {
    console.error('[google-calendar-oauth-disconnect] Error:', error);
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
