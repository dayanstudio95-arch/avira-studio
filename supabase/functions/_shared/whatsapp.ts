// Shared Green API WhatsApp sender.
// Replaces the old Base44 Make.com webhook layer (MAKE_WEBHOOK_URL) per explicit
// user decision: every function that used to POST to Make now calls sendWhatsApp()
// directly instead. Gateway URL / instance ID / API token are per-tenant, stored in
// app_settings (keys: whatsapp_gateway_url, whatsapp_instance_id, whatsapp_api_key) --
// same settings whatsappManager already reads/tests, so the "Test connection" flow
// and real sends share one source of truth.
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
  let query = supabase
    .from('app_settings')
    .select('key, value')
    .in('key', ['whatsapp_gateway_url', 'whatsapp_instance_id', 'whatsapp_api_key']);

  if (tenantId) query = query.eq('tenant_id', tenantId);

  const { data, error } = await query;
  if (error || !data) return null;

  const get = (key: string) => data.find((s: any) => s.key === key)?.value || '';
  let apiUrl = get('whatsapp_gateway_url');
  const instanceId = get('whatsapp_instance_id');
  const apiToken = get('whatsapp_api_key');
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

  const digitsOnly = (phone || '').replace(/\D/g, '');
  if (!digitsOnly) {
    return { success: false, error: 'Invalid phone number' };
  }

  const sendUrl = buildUrl(settings, 'sendMessage');

  try {
    const res = await fetch(sendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: `${digitsOnly}@c.us`, message }),
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
