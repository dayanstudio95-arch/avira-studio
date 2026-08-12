import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { action, testPhone, testMessage } = await req.json();

    // Load WhatsApp settings
    const settings = await base44.asServiceRole.entities.AppSetting.list();
    const getSetting = (key) => settings.find((s) => s.key === key)?.value || '';

    let gatewayUrl = getSetting('whatsapp_gateway_url');
    const apiKey = getSetting('whatsapp_api_key');

    if (!gatewayUrl || !apiKey) {
      return Response.json({ error: 'WhatsApp gateway URL and API Key are required' }, { status: 400 });
    }

    // Normalize gateway URL - ensure no trailing slash
    gatewayUrl = gatewayUrl.replace(/\/$/, '');
    
    // Ensure proper URL format (must have https://)
    if (!gatewayUrl.startsWith('http://') && !gatewayUrl.startsWith('https://')) {
      gatewayUrl = 'https://' + gatewayUrl;
    }



    const headers = {
      'Content-Type': 'application/json',
    };

    if (action === 'get_qr') {
      // Green-API endpoint: /waInstance{id}/qr
      const qrUrl = `${gatewayUrl}/qr?apiKey=${encodeURIComponent(apiKey)}`;
      
      try {
        const res = await fetch(qrUrl, { headers });
        if (!res.ok) {
          const errText = await res.text();
          return Response.json({
            error: `Green-API Error (${res.status}): ${errText}`,
            details: { url: qrUrl, statusCode: res.status }
          }, { status: 502 });
        }

        const data = await res.json();
        const qrImage = data.qr || data.QR || data.qrcode || null;

        if (!qrImage) {
          return Response.json({
            error: 'QR code not received. Ensure WhatsApp is not connected yet.',
            raw: data
          }, { status: 502 });
        }

        return Response.json({ success: true, qr: qrImage, raw: data });
      } catch (e) {
        return Response.json({ error: `Network error: ${e.message}` }, { status: 502 });
      }
    }

    if (action === 'check_status') {
      // Green-API endpoint: /waInstance{id}/getAccountInfo
      const statusUrl = `${gatewayUrl}/getAccountInfo?apiKey=${encodeURIComponent(apiKey)}`;
      
      console.log('Checking status...');
      console.log('gatewayUrl:', gatewayUrl);
      console.log('apiKey:', apiKey ? '***' + apiKey.slice(-8) : 'MISSING');
      console.log('statusUrl:', statusUrl);

      try {
        const res = await fetch(statusUrl, { headers });
        const text = await res.text();

        console.log('Response status:', res.status);
        console.log('Response headers:', res.headers);
        console.log('Response text:', text.substring(0, 500));

        let data = {};
        try {
          data = JSON.parse(text);
        } catch (e) {
          console.log('Failed to parse JSON');
        }

        if (!res.ok) {
          return Response.json({
            connected: false,
            phone: null,
            error: `Status check failed (HTTP ${res.status}). Verify your Gateway URL and API Key are correct.`,
            statusCode: res.status
          });
        }

        // Green-API returns status in "accountStatus" or "wid"
        const connected = !!(data.accountStatus === 'authorized' || data.wid);
        const phone = data.wid || data.phoneNumber || null;

        return Response.json({ 
          success: true, 
          connected, 
          phone: phone ? phone.replace('@c.us', '') : null,
          raw: data 
        });
      } catch (e) {
        console.log('Network error:', e.message);
        return Response.json({ 
          connected: false,
          phone: null,
          error: `Network error: ${e.message}` 
        });
      }
    }

    if (action === 'send_test') {
      if (!testPhone) {
        return Response.json({ error: 'testPhone is required' }, { status: 400 });
      }

      const message = testMessage || 'הודעת ניסיון מ-Avira Studio 🎉 - החיבור עובד!';
      const phone = testPhone.replace(/\D/g, '');

      // Green-API endpoint: /waInstance{id}/sendMessage
      const sendUrl = `${gatewayUrl}/sendMessage?apiKey=${encodeURIComponent(apiKey)}`;

      try {
        const res = await fetch(sendUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            phone: `${phone}@c.us`,
            message: message
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          return Response.json({
            error: `Green-API Error (${res.status}): ${errText}`,
            details: { phone, statusCode: res.status }
          }, { status: 502 });
        }

        const data = await res.json();
        return Response.json({ 
          success: true,
          raw: data 
        });
      } catch (e) {
        return Response.json({ error: `Network error: ${e.message}` }, { status: 502 });
      }
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});