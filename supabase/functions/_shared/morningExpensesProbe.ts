// A READ-ONLY look at Morning's expenses API for both of the studio's businesses (Avira, 2026-11-02): before sending
// the team's invoices to Morning as expense drafts, the endpoints are confirmed on the owner's real accounts — the
// public docs disagree on the draft-from-file path (CLAUDE.md: Morning's API is verified before it is built on). Nothing
// is created or changed: an expense search, a drafts search, and the file-upload URL request (which only hands out an
// upload address). What is kept: status codes, the answers' field NAMES, and a few fields of the latest 3 expenses (no
// tokens, no signatures, no upload URLs).
import { fetchMorningToken } from './morningAuth.ts';

const API = 'https://api.greeninvoice.co.il/api/v1';
const KEYS: Record<string, { key: string; secret: string }> = {
  sole_prop: { key: 'morning_api_key_sole_prop', secret: 'morning_api_secret_sole_prop' },
  company: { key: 'morning_api_key_company', secret: 'morning_api_secret_company' },
};
export const MORNING_PROBE_KEY = 'morning_expenses_probe';

const keysOf = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v as object).slice(0, 40) : []);
const itemsOf = (d: any): any[] => {
  const list = Array.isArray(d) ? d : d?.items ?? d?.expenses ?? d?.data;
  return Array.isArray(list) ? list : [];
};
/** No answer within this long counts as a failure (a hung call must not keep the probe from being saved). */
const TIMEOUT_MS = 15_000;

function timed<T>(p: Promise<T>, what: string): Promise<T> {
  let timer: number | undefined;
  return Promise.race([p, new Promise<T>((_, reject) => (timer = setTimeout(() => reject(new Error(`${what}: no answer in ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS)))]).finally(() => clearTimeout(timer));
}

async function call(token: string, method: string, url: string, body?: unknown) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      signal: ctl.signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch { /* not JSON */ }
    return { status: res.status, json, error: res.ok ? null : text.slice(0, 200) };
  } catch (e) {
    return { status: 0, json: null, error: (e as Error).message.slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeMorningExpenses(supabase: any, tenantId: string, fromDate: string, toDate: string) {
  const out: Record<string, unknown> = { at: new Date().toISOString(), fromDate, toDate };
  // Saved after every step (2026-11-02: two runs on the live system left nothing behind) — what was reached shows.
  const save = async (step: string) => {
    out.step = step;
    const { error } = await supabase.from('app_settings').upsert({ tenant_id: tenantId, key: MORNING_PROBE_KEY, value: JSON.stringify(out) }, { onConflict: 'tenant_id,key' });
    if (error) console.error('[morning-probe] save', error.message);
    return error?.message ?? null;
  };
  await save('started');
  for (const [entity, k] of Object.entries(KEYS)) {
    try {
      const { data } = await supabase.from('tenant_secrets').select('key, value').eq('tenant_id', tenantId).in('key', [k.key, k.secret]);
      const get = (key: string) => (data?.find((s: any) => s.key === key)?.value || '').trim();
      if (!get(k.key) || !get(k.secret)) {
        out[entity] = { connected: false };
        continue;
      }
      const login = await timed(fetchMorningToken(get(k.key), get(k.secret)), 'login');
      if (!login.ok) {
        out[entity] = { connected: false, login: login.message };
        continue;
      }
      const token = login.token;
      out[entity] = { connected: true };
      await save(`${entity}: logged in`);
      const search = await call(token, 'POST', `${API}/expenses/search`, { page: 1, pageSize: 25, fromDate, toDate });
      const items = itemsOf(search.json);
      const drafts = await call(token, 'POST', `${API}/expenses/drafts/search`, { page: 1, pageSize: 5 });
      const upload1 = await call(token, 'GET', `${API}/expenses/file`);
      const upload2 = await call(token, 'GET', 'https://apigw.greeninvoice.co.il/file-upload/v1/url');
      out[entity] = {
        connected: true,
        search: { status: search.status, error: search.error, keys: keysOf(search.json), total: search.json?.total ?? null, count: items.length, itemKeys: keysOf(items[0]), supplierKeys: keysOf(items[0]?.supplier) },
        latest: items.slice(0, 3).map((e: any) => ({
          date: e?.date ?? e?.documentDate ?? null,
          number: e?.number ?? e?.documentNumber ?? null,
          type: e?.documentType ?? null,
          amount: e?.amount ?? e?.total ?? null,
          vat: e?.vat ?? null,
          supplier: e?.supplier?.name ?? null,
          supplierTaxId: e?.supplier?.taxId ?? null,
          status: e?.status ?? null,
        })),
        drafts: { status: drafts.status, error: drafts.error, keys: keysOf(drafts.json), count: itemsOf(drafts.json).length, itemKeys: keysOf(itemsOf(drafts.json)[0]) },
        uploadUrl: { expensesFile: { status: upload1.status, keys: keysOf(upload1.json), error: upload1.error }, apigw: { status: upload2.status, keys: keysOf(upload2.json), error: upload2.error } },
      };
    } catch (e) {
      out[entity] = { ...((out[entity] as object) || {}), error: (e as Error).message.slice(0, 300) };
    }
    await save(`${entity}: done`);
  }
  const saveError = await save('finished');
  return { ...out, ...(saveError ? { saveError } : {}) };
}
