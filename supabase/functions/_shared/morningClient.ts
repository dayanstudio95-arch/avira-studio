// One place for "talk to Morning as business X" (2026-10-21, the work-order feature). The
// keys per business live in tenant_secrets (admin-only RLS — read through the caller's own
// client, so another studio's keys are never reachable). Login is the OAuth 2.0 flow in
// morningAuth.ts. Endpoints per the official OpenAPI spec ("morning API Documentation"
// 2.0.0, developers.morning.co/docs/openapi.bundled.json, read 2026-10-21).
import { fetchMorningToken } from './morningAuth.ts';

export const MORNING_API = 'https://api.greeninvoice.co.il/api/v1';

export const MORNING_SETTINGS_KEYS: Record<string, { key: string; secret: string }> = {
  sole_prop: { key: 'morning_api_key_sole_prop', secret: 'morning_api_secret_sole_prop' },
  company: { key: 'morning_api_key_company', secret: 'morning_api_secret_company' },
};

export function businessTypeOf(v: unknown): 'sole_prop' | 'company' {
  return v === 'company' ? 'company' : 'sole_prop';
}

export const BUSINESS_LABEL: Record<string, string> = { sole_prop: 'עוסק מורשה', company: 'חברה בע״מ' };

export const MORNING_TIMEOUT_MS = 60_000;

export interface MorningCallResult {
  ok: boolean;
  status: number;
  data: any;
  raw: string;
  // Morning's own error code ({ errorCode, errorMessage }) when it sent one.
  errorCode: number | null;
}

export type MorningSession =
  | { ok: true; call: (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<MorningCallResult> }
  | { ok: false; message: string; status: number };

export async function openMorningSession(userClient: any, businessType: string): Promise<MorningSession> {
  const keys = MORNING_SETTINGS_KEYS[businessTypeOf(businessType)];
  const { data: rows } = await userClient.from('tenant_secrets').select('key, value').in('key', [keys.key, keys.secret]);
  const get = (k: string) => (rows?.find((r: any) => r.key === k)?.value || '').trim();
  const apiKey = get(keys.key);
  const apiSecret = get(keys.secret);
  if (!apiKey || !apiSecret) {
    return { ok: false, status: 400, message: `מפתחות Morning עבור ה${BUSINESS_LABEL[businessTypeOf(businessType)]} לא הוגדרו בהגדרות ← חיבורים.` };
  }
  const login = await fetchMorningToken(apiKey, apiSecret);
  if (!login.ok) return { ok: false, status: 502, message: login.message };
  const token = login.token;

  // Never throws: a connection that failed or broke mid-answer comes back as status 0, so a
  // caller that creates documents can tell "Morning refused" (4xx — nothing was created) from
  // "unknown" (status 0 / 5xx — it may have been created). See isDefiniteRefusal.
  const call = async (method: 'GET' | 'POST', path: string, body?: unknown): Promise<MorningCallResult> => {
    let res: Response;
    let raw = '';
    try {
      res = await fetch(`${MORNING_API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
        // Never wait longer than this: a request still waiting could finish after the owner
        // was told it failed (the order book's "check against Morning" waits much longer).
        signal: AbortSignal.timeout(MORNING_TIMEOUT_MS),
      });
      raw = await res.text();
    } catch (e) {
      return { ok: false, status: 0, data: null, raw: `connection: ${(e as Error).message}`, errorCode: null };
    }
    let data: any = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { /* not JSON */ }
    const errorCode = data && typeof data.errorCode === 'number' ? data.errorCode : null;
    return { ok: res.ok, status: res.status, data, raw, errorCode };
  };
  return { ok: true, call };
}

// "שגיאה מ-Morning (2405): ..." — the owner reads this on screen.
export function morningErrorText(r: MorningCallResult, what: string): string {
  const msg = r.data?.errorMessage || r.raw?.slice(0, 300) || '';
  return `${what} נכשלה ב-Morning (${r.errorCode ?? r.status})${msg ? `: ${msg}` : ''}`;
}

// Morning answered and refused (validation, auth...) — the document was NOT created.
export function isDefiniteRefusal(r: MorningCallResult): boolean {
  return r.status >= 400 && r.status < 500;
}
