// Shared Green API WhatsApp sender.
// Replaces the old Base44 Make.com webhook layer (MAKE_WEBHOOK_URL) per explicit
// user decision: every function that used to POST to Make now calls sendWhatsApp()
// directly instead. Gateway URL / API key are per-tenant, stored in app_settings
// (keys: whatsapp_gateway_url, whatsapp_api_key) — same settings whatsappManager
// already reads/tests, so the "Test connection" flow and real sends share one source
// of truth.

interface WhatsAppSettings {
  gatewayUrl: string;
  apiKey: string;
}

// `supabase` should already be scoped to the right tenant:
//  - a user-scoped client (RLS handles tenant scoping automatically), or
//  - a service-role client + explicit tenantId (e.g. automationEngine's scheduler runs).
async function loadWhatsAppSettings(supabase: any, tenantId?: string): Promise<WhatsAppSettings | null> {
  let query = supabase
    .from('app_settings')
    .select('key, value')
    .in('key', ['whatsapp_gateway_url', 'whatsapp_api_key']);

  if (tenantId) query = query.eq('tenant_id', tenantId);

  const { data, error } = await query;
  if (error || !data) return null;

  const get = (key: string) => data.find((s: any) => s.key === key)?.value || '';
  let gatewayUrl = get('whatsapp_gateway_url');
  const apiKey = get('whatsapp_api_key');
  if (!gatewayUrl || !apiKey) return null;

  // Normalize gateway URL exactly like the original whatsappManager did.
  gatewayUrl = gatewayUrl.replace(/\/$/, '');
  if (!gatewayUrl.startsWith('http://') && !gatewayUrl.startsWith('https://')) {
    gatewayUrl = 'https://' + gatewayUrl;
  }

  return { gatewayUrl, apiKey };
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
    return { success: false, error: 'WhatsApp gateway URL and API Key are required (set them in Settings)' };
  }

  const digitsOnly = (phone || '').replace(/\D/g, '');
  if (!digitsOnly) {
    return { success: false, error: 'Invalid phone number' };
  }

  const sendUrl = `${settings.gatewayUrl}/sendMessage?apiKey=${encodeURIComponent(settings.apiKey)}`;

  try {
    const res = await fetch(sendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: `${digitsOnly}@c.us`, message }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `Green-API Error (${res.status}): ${errText}` };
    }

    const data = await res.json();
    return { success: true, raw: data };
  } catch (e) {
    return { success: false, error: `Network error: ${e.message}` };
  }
}
