// Shared Google OAuth helpers for the real Google Calendar connection flow —
// replaces the old fake flow (a static access token manually pasted into
// app_settings.google_calendar_access_token, never refreshed, effectively dead).
//
// Used by: google-calendar-oauth-start, google-calendar-oauth-callback,
// google-calendar-oauth-disconnect, and every function that needs a live
// access token to call the Google Calendar API (sync-event-to-calendar via
// googleCalendarSync.ts, delete-event-from-calendar, delete-google-calendar-event,
// reconcile-calendar-sync, send-staff-invite, daily-event-brief,
// submit-production-questionnaire).
//
// One shared Google Cloud OAuth app (client_id/secret) serves every tenant —
// each tenant connects up to 2 of THEIR OWN Google accounts (role 'primary' /
// 'backup') through it; tokens are stored per-tenant in google_calendar_accounts
// (see supabase/migrations/0016_google_calendar_accounts.sql).

const CLIENT_ID = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') ?? '';
const STATE_SECRET = Deno.env.get('GOOGLE_OAUTH_STATE_SECRET') ?? '';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

export type AccountRole = 'primary' | 'backup';

export interface OAuthStatePayload {
  tenantId: string;
  accountRole: AccountRole;
  userId: string;
  exp: number; // epoch ms
}

function toBase64Url(bytes: Uint8Array): string {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  const str = atob(padded);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes;
}

async function hmacSign(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(STATE_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return toBase64Url(new Uint8Array(sig));
}

// Signs a short-lived payload (tenant + which account slot + who clicked
// connect) into the OAuth `state` param. No DB table needed — Google's
// redirect round-trip carries this string back verbatim, and the callback
// (which runs unauthenticated, with no session) verifies + decodes it here.
export async function signState(payload: OAuthStatePayload): Promise<string> {
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacSign(body);
  return `${body}.${sig}`;
}

export async function verifyState(state: string): Promise<OAuthStatePayload> {
  const [body, sig] = (state || '').split('.');
  if (!body || !sig) throw new Error('Invalid OAuth state');
  const expectedSig = await hmacSign(body);
  if (sig !== expectedSig) throw new Error('OAuth state signature mismatch');
  const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as OAuthStatePayload;
  if (!payload.exp || Date.now() > payload.exp) throw new Error('OAuth state expired — please try connecting again');
  return payload;
}

export function getRedirectUri(): string {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  return `${supabaseUrl}/functions/v1/google-calendar-oauth-callback`;
}

// prompt=consent forces Google to reissue a refresh_token on every connect —
// required here since "backup" is deliberately a DIFFERENT Google login than
// "primary" in the same browser, and access_type=offline is what makes
// Google return a refresh_token at all (omitted by default otherwise).
export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email',
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: getRedirectUri(),
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

export async function fetchGoogleUserEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(GOOGLE_USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    const data = await res.json();
    return data.email || null;
  } catch {
    return null;
  }
}

export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: 'POST' });
  } catch (e) {
    console.log('[googleCalendarAuth] revoke failed (best-effort, ignoring):', e.message);
  }
}

// Returns a valid (non-expired) access token for the tenant's account of the
// given role, refreshing it first if it's missing or within 2 minutes of
// expiry. Returns null if the account isn't connected, or if the refresh
// token itself has been revoked (marks the account 'needs_reauth' so the
// dashboard can surface it — never throws, so one dead account never blocks
// sync attempts against the other).
export async function getValidAccessToken(
  supabase: any,
  tenantId: string,
  accountRole: AccountRole,
): Promise<{ accessToken: string; calendarId: string; accountId: string } | null> {
  const { data: account } = await supabase
    .from('google_calendar_accounts')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('account_role', accountRole)
    .maybeSingle();

  if (!account || account.status === 'disconnected' || !account.refresh_token) return null;

  const expiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  const needsRefresh = !account.access_token || expiresAt - Date.now() < 2 * 60 * 1000;

  if (!needsRefresh) {
    return { accessToken: account.access_token, calendarId: account.calendar_id || 'primary', accountId: account.id };
  }

  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: account.refresh_token,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      const needsReauth = res.status === 400 && errText.includes('invalid_grant');
      await supabase
        .from('google_calendar_accounts')
        .update({
          status: needsReauth ? 'needs_reauth' : 'error',
          last_error: errText.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq('id', account.id);
      return null;
    }

    const tokens = await res.json();
    const newExpiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
    await supabase
      .from('google_calendar_accounts')
      .update({
        access_token: tokens.access_token,
        token_expires_at: newExpiresAt,
        status: 'connected',
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', account.id);

    return { accessToken: tokens.access_token, calendarId: account.calendar_id || 'primary', accountId: account.id };
  } catch (err) {
    await supabase
      .from('google_calendar_accounts')
      .update({ status: 'error', last_error: String(err.message || err).slice(0, 500), updated_at: new Date().toISOString() })
      .eq('id', account.id);
    return null;
  }
}

// All accounts for a tenant that are in a state worth attempting sync
// against ('connected' — 'needs_reauth'/'error'/'disconnected' are skipped).
export async function getConnectedAccounts(supabase: any, tenantId: string) {
  const { data } = await supabase
    .from('google_calendar_accounts')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('status', 'connected');
  return data || [];
}
