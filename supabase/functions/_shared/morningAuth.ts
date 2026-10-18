// Morning (חשבונית ירוקה) login — moved to OAuth 2.0 client credentials (2026-10-18).
//
// The old POST https://api.greeninvoice.co.il/api/v1/account/token { id, secret } now
// answers 404 with an empty body (checked 18.10.2026 — the owner's company invoice failed
// with "שגיאת אימות (404)"). Morning's new login, as described by the maintained client
// libraries (pypi green-invoice 2.x, "morning API Documentation 2.0.0") and confirmed by
// probing the endpoint (it answers 401 {"error":"invalid_client"} to fake credentials):
//   POST https://api.morning.co/idp/v1/oauth/token
//   { grant_type: "client_credentials", client_id, client_secret }
// → a bearer token for the unchanged https://api.greeninvoice.co.il/api/v1/* calls.
// The response field name differs between write-ups (accessToken / access_token), so all
// known names are read. Credentials made for the old flow may not work in the new one —
// then Morning answers invalid_client and the owner has to create new API keys there.
export const MORNING_TOKEN_URL = 'https://api.morning.co/idp/v1/oauth/token';

export type MorningTokenResult =
  | { ok: true; token: string }
  | { ok: false; status: number; message: string; raw: string };

// Pure — PART 62.
export function readMorningToken(data: any): string | null {
  if (!data || typeof data !== 'object') return null;
  const t = data.accessToken || data.access_token || data.token || data.jwt || data.id_token || data.data?.accessToken || data.data?.access_token || data.data?.token;
  return typeof t === 'string' && t.trim() ? t.trim() : null;
}

// Pure — PART 62. What the owner reads when the login fails.
export function morningLoginError(status: number, raw: string): string {
  let code = '';
  try { code = String(JSON.parse(raw)?.error || ''); } catch { /* not JSON */ }
  if (status === 401 || code === 'invalid_client') {
    return 'Morning לא מכיר את המפתחות האלה. Morning עברו לשיטת התחברות חדשה — צריך ליצור ב-Morning מפתח API חדש ולהדביק אותו בהגדרות ← חיבורים.';
  }
  return `שגיאת התחברות ל-Morning (${status})${raw ? `: ${raw.slice(0, 200)}` : ''}`;
}

export async function fetchMorningToken(clientId: string, clientSecret: string): Promise<MorningTokenResult> {
  const res = await fetch(MORNING_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
  });
  const raw = await res.text();
  if (!res.ok) return { ok: false, status: res.status, message: morningLoginError(res.status, raw), raw };
  let data: any = null;
  try { data = JSON.parse(raw); } catch { /* handled below */ }
  const token = readMorningToken(data);
  if (!token) {
    const fields = data && typeof data === 'object' ? Object.keys(data).join(', ') : 'לא JSON';
    return { ok: false, status: res.status, message: `Morning לא החזיר טוקן (שדות: ${fields})`, raw };
  }
  return { ok: true, token };
}
