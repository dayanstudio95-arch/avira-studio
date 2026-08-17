// Starts the real Google OAuth connect flow for one account slot ('primary'
// or 'backup') of the calling user's tenant. Called from the new
// GoogleCalendarSync page — the frontend does `window.location.href =
// authorizeUrl` with the result (this function can't redirect the browser
// itself since it's invoked through the normal functions.invoke POST
// wrapper, not a plain browser navigation).
//
// state = signed { tenantId, accountRole, userId, exp } — no DB table
// needed, Google's redirect round-trip carries this string back verbatim
// and google-calendar-oauth-callback (which runs unauthenticated) decodes
// it to recover tenant context.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { signState, buildAuthorizeUrl, type AccountRole } from '../_shared/googleCalendarAuth.ts';

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

    const state = await signState({
      tenantId: profile.tenant_id,
      accountRole: accountRole as AccountRole,
      userId: user.id,
      exp: Date.now() + 10 * 60 * 1000, // 10 minutes to complete the Google consent flow
    });

    const authorizeUrl = buildAuthorizeUrl(state);
    return jsonResponse({ authorizeUrl });
  } catch (error) {
    console.error('[google-calendar-oauth-start] Error:', error);
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
