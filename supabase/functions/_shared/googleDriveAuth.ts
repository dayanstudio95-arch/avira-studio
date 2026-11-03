// The studio's Google Drive, for photos uploaded from the gallery page (Avira, 2026-11-03, 0109). The same Google OAuth
// app as the calendar (googleCalendarAuth.ts: client, signed state), its own redirect and one scope: drive.file — the
// system sees and changes only the folders and files it made itself, never the rest of the studio's Drive (a
// non-sensitive scope: no Google verification). One account per studio (google_drive_accounts); the refresh token stays
// in the database, the browser gets short-lived access tokens from the google-drive function and uploads straight to
// Drive (nothing passes through our servers).

const CLIENT_ID = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') ?? '';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
/** The folder every uploaded gallery goes in (the owner's decision: a new folder the system makes). */
export const ROOT_FOLDER_NAME = 'גלריות אווירה';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export function getDriveRedirectUri(): string {
  return `${Deno.env.get('SUPABASE_URL')!}/functions/v1/google-drive-oauth-callback`;
}

export function buildDriveAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: getDriveRedirectUri(),
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: `${DRIVE_SCOPE} https://www.googleapis.com/auth/userinfo.email`,
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeDriveCode(code: string): Promise<{ access_token: string; refresh_token?: string; expires_in: number; scope: string }> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: getDriveRedirectUri(), grant_type: 'authorization_code' }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status}`);
  return await res.json();
}

/** The studio's folder "גלריות אווירה" (made by the system, so drive.file reaches it): the saved one while it is still there, else a new one. */
export async function ensureRootFolder(accessToken: string, savedId: string | null): Promise<string> {
  if (savedId) {
    const res = await fetch(`${DRIVE_FILES}/${encodeURIComponent(savedId)}?fields=id,trashed`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.ok) {
      const f = await res.json();
      if (f?.id && !f.trashed) return f.id;
    }
  }
  const res = await fetch(`${DRIVE_FILES}?fields=id`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: ROOT_FOLDER_NAME, mimeType: FOLDER_MIME }),
  });
  if (!res.ok) throw new Error(`Drive folder create failed: ${res.status}`);
  return (await res.json()).id;
}

/**
 * A live access token for the studio's Drive (refreshed when it has under 5 minutes left) and its root folder.
 * null when the studio never connected. Throws with a Hebrew message when Google refused the refresh (disconnected
 * from Google's side) — the row is marked 'error' so the screen offers "חיבור מחדש".
 */
export async function getDriveAccess(supabase: any, tenantId: string): Promise<{ accessToken: string; expiresAt: string; rootFolderId: string; email: string | null } | null> {
  const { data: account } = await supabase.from('google_drive_accounts').select('*').eq('tenant_id', tenantId).maybeSingle();
  if (!account?.refresh_token) return null;
  let accessToken = account.access_token as string | null;
  let expiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  if (!accessToken || expiresAt - Date.now() < 5 * 60 * 1000) {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: account.refresh_token, grant_type: 'refresh_token' }),
    });
    if (!res.ok) {
      await supabase.from('google_drive_accounts').update({ status: 'error', last_error: `refresh ${res.status}`, updated_at: new Date().toISOString() }).eq('id', account.id);
      throw new Error('החיבור לגוגל דרייב נותק. מתחברים מחדש בעמוד הגלריה.');
    }
    const t = await res.json();
    accessToken = t.access_token;
    expiresAt = Date.now() + (t.expires_in || 3600) * 1000;
    await supabase.from('google_drive_accounts').update({ access_token: accessToken, token_expires_at: new Date(expiresAt).toISOString(), status: 'connected', last_error: null, updated_at: new Date().toISOString() }).eq('id', account.id);
  }
  const rootFolderId = await ensureRootFolder(accessToken!, account.root_folder_id);
  if (rootFolderId !== account.root_folder_id) {
    await supabase.from('google_drive_accounts').update({ root_folder_id: rootFolderId, updated_at: new Date().toISOString() }).eq('id', account.id);
  }
  return { accessToken: accessToken!, expiresAt: new Date(expiresAt).toISOString(), rootFolderId, email: account.google_email };
}
