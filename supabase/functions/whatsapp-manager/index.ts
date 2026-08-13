// Ports base44/functions/whatsappManager/entry.ts.
// Backs the WhatsApp connection UI (Settings -> Integrations -> WhatsAppPanel.jsx): QR
// code, connection status check, and a manual test-send -- all against the same Green
// API gateway_url/instance_id/api_key stored in app_settings that sendWhatsApp() (in
// _shared/whatsapp.ts) reads for every other function. Kept as its own function (rather
// than folded into send-whatsapp-message) because get_qr/check_status aren't "sends" at
// all.
//
// FIXED (2026-08-13): every endpoint here used to be invented (`/qr?apiKey=`,
// `/getAccountInfo?apiKey=`, `/sendMessage?apiKey=` with a `{phone,message}` body) and
// didn't match the real green-api.com REST API, so every action 404'd against a real
// account. Rebuilt against the documented contract:
//   GET  {{apiUrl}}/waInstance{{idInstance}}/qr/{{apiTokenInstance}}
//        -> { type: "qrCode"|"alreadyLogged"|"error"|..., message: "<base64 png>" }
//   GET  {{apiUrl}}/waInstance{{idInstance}}/getWaSettings/{{apiTokenInstance}}
//        -> { stateInstance: "authorized"|"notAuthorized"|..., phone, ... }
//   POST {{apiUrl}}/waInstance{{idInstance}}/sendMessage/{{apiTokenInstance}}
//        body: { chatId: "<digits>@c.us", message }
// idInstance and apiTokenInstance are two separate values shown separately on the
// Green-API dashboard -- hence the new whatsapp_instance_id setting (see IntegrationsTab.jsx).
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, getRequestUser } from '../_shared/supabaseClients.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createUserClient(req);
    const { action, testPhone, testMessage } = await req.json();

    const { data: settingsRows, error: settingsErr } = await supabase
      .from('app_settings')
      .select('key, value')
      .in('key', ['whatsapp_gateway_url', 'whatsapp_instance_id', 'whatsapp_api_key']);
    if (settingsErr) return jsonResponse({ error: settingsErr.message }, { status: 500 });

    const getSetting = (key: string) => settingsRows?.find((s) => s.key === key)?.value || '';

    let apiUrl = getSetting('whatsapp_gateway_url');
    const instanceId = getSetting('whatsapp_instance_id');
    const apiToken = getSetting('whatsapp_api_key');

    if (!apiUrl || !instanceId || !apiToken) {
      return jsonResponse({ error: 'WhatsApp API URL, Instance ID and API Token are required' }, { status: 400 });
    }

    // Normalize: strip trailing slash and any accidental /waInstance... suffix (old UI
    // asked users to paste the full instance URL into one field; new UI has a separate
    // Instance ID field, so tolerate old saved values that still include it).
    apiUrl = apiUrl.replace(/\/$/, '').replace(/\/waInstance\d+.*$/i, '');
    if (!apiUrl.startsWith('http://') && !apiUrl.startsWith('https://')) {
      apiUrl = 'https://' + apiUrl;
    }

    const buildUrl = (method: string) => `${apiUrl}/waInstance${instanceId}/${method}/${apiToken}`;
    const headers = { 'Content-Type': 'application/json' };

    if (action === 'get_qr') {
      const qrUrl = buildUrl('qr');
      try {
        const res = await fetch(qrUrl, { headers });
        const text = await res.text();
        let data: any = {};
        try { data = JSON.parse(text); } catch { /* non-JSON */ }

        if (!res.ok) {
          return jsonResponse(
            { error: `Green-API Error (${res.status}): ${text}`, details: { statusCode: res.status } },
            { status: 502 }
          );
        }
        if (data.type === 'alreadyLogged') {
          return jsonResponse({ error: 'המכשיר כבר מחובר. אין צורך לסרוק QR נוסף.', raw: data }, { status: 200 });
        }
        if (data.type !== 'qrCode' || !data.message) {
          return jsonResponse({ error: `QR code not received (type: ${data.type || 'unknown'}).`, raw: data }, { status: 502 });
        }
        return jsonResponse({ success: true, qr: data.message, raw: data });
      } catch (e) {
        return jsonResponse({ error: `Network error: ${e.message}` }, { status: 502 });
      }
    }

    if (action === 'check_status') {
      const statusUrl = buildUrl('getWaSettings');
      try {
        const res = await fetch(statusUrl, { headers });
        const text = await res.text();

        let data: any = {};
        try {
          data = JSON.parse(text);
        } catch {
          // non-JSON response — fall through with empty data
        }

        if (!res.ok) {
          return jsonResponse({
            connected: false,
            phone: null,
            error: `Status check failed (HTTP ${res.status}). Verify your API URL, Instance ID and API Token are correct.`,
            statusCode: res.status,
          });
        }

        const connected = data.stateInstance === 'authorized';
        const phone = data.phone || null;

        return jsonResponse({ success: true, connected, phone, raw: data });
      } catch (e) {
        return jsonResponse({ connected: false, phone: null, error: `Network error: ${e.message}` });
      }
    }

    if (action === 'send_test') {
      if (!testPhone) return jsonResponse({ error: 'testPhone is required' }, { status: 400 });

      const message = testMessage || 'הודעת ניסיון מ-Avira Studio 🎉 - החיבור עובד!';
      const phone = testPhone.replace(/\D/g, '');
      const sendUrl = buildUrl('sendMessage');

      try {
        const res = await fetch(sendUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ chatId: `${phone}@c.us`, message }),
        });

        if (!res.ok) {
          const errText = await res.text();
          return jsonResponse(
            { error: `Green-API Error (${res.status}): ${errText}`, details: { phone, statusCode: res.status } },
            { status: 502 }
          );
        }

        const data = await res.json();
        return jsonResponse({ success: true, raw: data });
      } catch (e) {
        return jsonResponse({ error: `Network error: ${e.message}` }, { status: 502 });
      }
    }

    return jsonResponse({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
