import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Load Green-API settings
    const settings = await base44.asServiceRole.entities.AppSetting.list();
    const getSetting = (key) => settings.find(s => s.key === key)?.value || '';

    let gatewayUrl = getSetting('whatsapp_gateway_url');
    const apiKey = getSetting('whatsapp_api_key');

    if (!gatewayUrl || !apiKey) {
      return Response.json({ error: 'WhatsApp gateway not configured.' }, { status: 400 });
    }

    gatewayUrl = gatewayUrl.replace(/\/$/, '');
    // Green-API correct format: /sendMessage/{apiToken} in path
    const sendUrl = `${gatewayUrl}/sendMessage/${apiKey}`;
    console.log('Send URL:', sendUrl);

    // Get target month range based on monthOffset param (default: 1 = next month)
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const monthOffset = body.monthOffset ?? 1;
    const now = new Date();
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    const nextMonthEnd = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0);
    console.log(`Month offset: ${monthOffset}, searching ${nextMonthStart.toISOString().slice(0,7)}`);

    const templateSetting = getSetting('template_questionnaire_reminder');
    const messageTemplate = templateSetting || 'היי $couple_names, החודש שלכם כבר כמעט כאן! 🎊 נשמח אם תמלאו את השאלון: $questionnaire_link';

    const allLeads = await base44.asServiceRole.entities.Lead.list();
    const targetLeads = allLeads.filter(lead => {
      if (!lead.eventDate || !lead.phoneNumber) return false;
      const d = new Date(lead.eventDate);
      return d >= nextMonthStart && d <= nextMonthEnd;
    });

    console.log('Target leads:', targetLeads.length);

    if (targetLeads.length === 0) {
      return Response.json({ success: true, message: 'No leads with events next month', results: [] });
    }

    const baseUrl = 'https://www.avira-studio.com';
    const results = [];

    for (const lead of targetLeads) {
      const questionnaireLink = `${baseUrl}/questionnaire/${lead.id}`;
      const eventDateStr = lead.eventDate ? new Date(lead.eventDate).toLocaleDateString('he-IL') : '';

      const messageText = messageTemplate
        .replace(/\$couple_names/g, lead.coupleNames || '')
        .replace(/\$questionnaire_link/g, questionnaireLink)
        .replace(/\$event_date/g, eventDateStr)
        .replace(/\$venue/g, lead.venueName || '');

      // Green-API: digits only, starts with country code, ends with @c.us
      const cleaned = lead.phoneNumber.replace(/\D/g, '');
      const intl = cleaned.startsWith('0') ? '972' + cleaned.substring(1) : cleaned;
      const chatId = `${intl}@c.us`;

      console.log(`Sending to ${lead.coupleNames} → chatId: ${chatId}`);

      try {
        const res = await fetch(sendUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId, message: messageText })
        });

        const responseText = await res.text();
        console.log(`Response: status=${res.status}, body=${responseText}`);

        let raw = {};
        try { raw = JSON.parse(responseText); } catch {}

        results.push({ leadName: lead.coupleNames, chatId, success: res.ok, status: res.status, raw });
      } catch (err) {
        console.log(`Error:`, err.message);
        results.push({ leadName: lead.coupleNames, success: false, error: err.message });
      }
    }

    return Response.json({ success: true, total: results.length, sent: results.filter(r => r.success).length, results });
  } catch (error) {
    console.log('FATAL:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});