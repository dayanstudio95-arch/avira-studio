// Ports base44/functions/whatsappManager/entry.ts.
// Backs the WhatsApp connection UI (WhatsAppAutomation.jsx): QR code, connection
// status check, and a manual test-send — all against the same Green API
// gateway_url/api_key stored in app_settings that sendWhatsApp() (in _shared/whatsapp.ts)
// reads for every other function. Kept as its own function (rather than folded into
// send-whatsapp-message) because get_qr/check_status aren't "sends" at all.
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
      .in('key', ['whatsapp_gateway_url', 'whatsapp_api_key']);
    if (settingsErr) return jsonResponse({ error: settingsErr.message }, { status: 500 });

    const getSetting = (key: string) => settingsRows?.find((s) => s.key === key)?.value || '';

    let gatewayUrl = getSetting('whatsapp_gateway_url');
    const apiKey = getSetting('whatsapp_api_key');

    if (!gatewayUrl || !apiKey) {
      return jsonResponse({ error: 'WhatsApp gateway URL and API Key are required' }, { status: 400 });
    }

    gatewayUrl = gatewayUrl.replace(/\/$/, '');
    if (!gatewayUrl.startsWith('http://') && !gatewayUrl.startsWith('https://')) {
      gatewayUrl = 'https://' + gatewayUrl;
    }

    const headers = { 'Content-Type': 'application/json' };

    if (action === 'get_qr') {
      const qrUrl = `${gatewayUrl}/qr?apiKey=${encodeURIComponent(apiKey)}`;
      try {
        const res = await fetch(qrUrl, { headers });
        if (!res.ok) {
          const errText = await res.text();
          return jsonResponse(
            { error: `Green-API Error (${res.status}): ${errText}`, details: { url: qrUrl, statusCode: res.status } },
            { status: 502 }
          );
        }
        const data = await res.json();
        const qrImage = data.qr || data.QR || data.qrcode || null;
        if (!qrImage) {
          return jsonResponse({ error: 'QR code not received. Ensure WhatsApp is not connected yet.', raw: data }, { status: 502 });
        }
        return jsonResponse({ success: true, qr: qrImage, raw: data });
      } catch (e) {
        return jsonResponse({ error: `Network error: ${e.message}` }, { status: 502 });
      }
    }

    if (action === 'check_status') {
      const statusUrl = `${gatewayUrl}/getAccountInfo?apiKey=${encodeURIComponent(apiKey)}`;
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
            error: `Status check failed (HTTP ${res.status}). Verify your Gateway URL and API Key are correct.`,
            statusCode: res.status,
          });
        }

        const connected = !!(data.accountStatus === 'authorized' || data.wid);
        const phone = data.wid || data.phoneNumber || null;

        return jsonResponse({ success: true, connected, phone: phone ? phone.replace('@c.us', '') : null, raw: data });
      } catch (e) {
        return jsonResponse({ connected: false, phone: null, error: `Network error: ${e.message}` });
      }
    }

    if (action === 'send_test') {
      if (!testPhone) return jsonResponse({ error: 'testPhone is required' }, { status: 400 });

      const message = testMessage || 'הודעת ניסיון מ-Avira Studio 🎉 - החיבור עובד!';
      const phone = testPhone.replace(/\D/g, '');
      const sendUrl = `${gatewayUrl}/sendMessage?apiKey=${encodeURIComponent(apiKey)}`;

      try {
        const res = await fetch(sendUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ phone: `${phone}@c.us`, message }),
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
