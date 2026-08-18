// Shared Green API WhatsApp sender.
// Replaces the old Base44 Make.com webhook layer (MAKE_WEBHOOK_URL) per explicit
// user decision: every function that used to POST to Make now calls sendWhatsApp()
// directly instead. Gateway URL / instance ID are per-tenant, stored in app_settings
// (keys: whatsapp_gateway_url, whatsapp_instance_id) -- same settings whatsappManager
// already reads/tests, so the "Test connection" flow and real sends share one source
// of truth.
//
// CHANGED (2026-08-17 security audit, Step 4): the API token itself
// (whatsapp_api_key) moved out of app_settings into the dedicated tenant_secrets
// table (migration 0019_tenant_secrets.sql) -- app_settings' RLS is tenant-only with
// no role check, so any tenant member could previously read the raw token directly;
// tenant_secrets is admin-only at the RLS layer, covering select too.
//
// FIXED (2026-08-13): this used to build URLs like `${gatewayUrl}/sendMessage?apiKey=...`
// with `{ phone, message }` as the body -- a made-up contract that doesn't match the
// real green-api.com REST API at all, so every send silently 404'd in production.
// Green-API's actual contract (verified against https://green-api.com/en/docs/api/):
//   POST {{apiUrl}}/waInstance{{idInstance}}/sendMessage/{{apiTokenInstance}}
//   body: { "chatId": "<digits>@c.us", "message": "..." }
// idInstance and apiTokenInstance are two separate values (shown separately on the
// Green-API dashboard) -- apiUrl alone is not enough, hence the new whatsapp_instance_id
// setting.

interface WhatsAppSettings {
  apiUrl: string;
  instanceId: string;
  apiToken: string;
}

// `supabase` should already be scoped to the right tenant:
//  - a user-scoped client (RLS handles tenant scoping automatically), or
//  - a service-role client + explicit tenantId (e.g. automationEngine's scheduler runs).
async function loadWhatsAppSettings(supabase: any, tenantId?: string): Promise<WhatsAppSettings | null> {
  let settingsQuery = supabase
    .from('app_settings')
    .select('key, value')
    .in('key', ['whatsapp_gateway_url', 'whatsapp_instance_id']);
  let secretsQuery = supabase
    .from('tenant_secrets')
    .select('key, value')
    .eq('key', 'whatsapp_api_key');

  if (tenantId) {
    settingsQuery = settingsQuery.eq('tenant_id', tenantId);
    secretsQuery = secretsQuery.eq('tenant_id', tenantId);
  }

  const [{ data: settingsData, error: settingsError }, { data: secretsData, error: secretsError }] =
    await Promise.all([settingsQuery, secretsQuery]);
  if (settingsError || !settingsData || secretsError || !secretsData) return null;

  const get = (key: string) => settingsData.find((s: any) => s.key === key)?.value || '';
  let apiUrl = get('whatsapp_gateway_url');
  const instanceId = get('whatsapp_instance_id');
  const apiToken = secretsData.find((s: any) => s.key === 'whatsapp_api_key')?.value || '';
  if (!apiUrl || !instanceId || !apiToken) return null;

  // Normalize: strip trailing slash and any accidental /waInstance... suffix the user
  // might have pasted in (old UI asked for the full instance URL; new UI asks for just
  // the base apiUrl and a separate instance ID field).
  apiUrl = apiUrl.replace(/\/$/, '').replace(/\/waInstance\d+.*$/i, '');
  if (!apiUrl.startsWith('http://') && !apiUrl.startsWith('https://')) {
    apiUrl = 'https://' + apiUrl;
  }

  return { apiUrl, instanceId, apiToken };
}

function buildUrl(settings: WhatsAppSettings, method: string): string {
  return `${settings.apiUrl}/waInstance${settings.instanceId}/${method}/${settings.apiToken}`;
}

export interface SendWhatsAppResult {
  success: boolean;
  error?: string;
  raw?: unknown;
}

// Leads/staff records store Israeli phone numbers in local format (e.g. "050-1234567"),
// but Green-API chat IDs need the full international number (972501234567@c.us). This
// was previously left to each caller to handle -- UnifiedSidePanel.jsx even had a
// correct formatPhoneForWhatsApp() helper for it, but it was dead code, never actually
// called, so contract/payment/questionnaire sends from the lead panel sent a chatId
// like "0501234567@c.us" (invalid) and Green-API rejected it. Centralized here so every
// caller (test-send, contract, payment, questionnaire, staff schedule, automation
// engine, ...) gets correct normalization for free.
export function toInternationalIsraeliChatId(phone: string): string | null {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits) return null;
  let intl = digits;
  if (digits.startsWith('0')) {
    intl = '972' + digits.substring(1);
  } else if (!digits.startsWith('972')) {
    // Already has some other country code, or a bare local number missing the
    // leading 0 -- assume Israeli local number either way if it's not already
    // prefixed with 972.
    intl = '972' + digits;
  }
  return `${intl}@c.us`;
}

export async function sendWhatsApp(
  supabase: any,
  phone: string,
  message: string,
  tenantId?: string
): Promise<SendWhatsAppResult> {
  const settings = await loadWhatsAppSettings(supabase, tenantId);
  if (!settings) {
    return { success: false, error: 'WhatsApp gateway URL, instance ID and API token are required (set them in Settings)' };
  }

  const chatId = toInternationalIsraeliChatId(phone);
  if (!chatId) {
    return { success: false, error: 'Invalid phone number' };
  }

  const sendUrl = buildUrl(settings, 'sendMessage');

  try {
    const res = await fetch(sendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, message }),
    });

    const text = await res.text();
    let data: any = {};
    try { data = JSON.parse(text); } catch { /* non-JSON */ }

    if (!res.ok) {
      return { success: false, error: `Green-API Error (${res.status}): ${text}` };
    }

    return { success: true, raw: data };
  } catch (e) {
    return { success: false, error: `Network error: ${e.message}` };
  }
}
