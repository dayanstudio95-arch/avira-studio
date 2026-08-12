import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { automationId, dryRun } = await req.json();
    if (!automationId) {
      return Response.json({ error: 'automationId is required' }, { status: 400 });
    }

    // Fetch automation record
    const automations = await base44.asServiceRole.entities.Automation.list();
    const automation = automations.find(a => a.id === automationId);
    if (!automation) {
      return Response.json({ error: 'Automation not found' }, { status: 404 });
    }

    // Load Green-API settings
    const settings = await base44.asServiceRole.entities.AppSetting.list();
    const getSetting = (key) => settings.find(s => s.key === key)?.value || '';

    let gatewayUrl = getSetting('whatsapp_gateway_url');
    const apiKey = getSetting('whatsapp_api_key');

    if (!gatewayUrl || !apiKey) {
      return Response.json({ error: 'WhatsApp gateway not configured. Set whatsapp_gateway_url and whatsapp_api_key in AppSetting.' }, { status: 400 });
    }

    gatewayUrl = gatewayUrl.replace(/\/$/, '');
    const sendTextUrl = `${gatewayUrl}/sendMessage/${apiKey}`;
    const sendFileUrl = `${gatewayUrl}/sendFileByUrl/${apiKey}`;
    const hasMedia = !!(automation.mediaFileUrl);

    // Fetch all leads + events
    const allLeads = await base44.asServiceRole.entities.Lead.list();
    const allEvents = await base44.asServiceRole.entities.Event.list();

    // Build a map: leadId -> event
    const eventByLeadId = {};
    for (const ev of allEvents) {
      if (ev.leadId) eventByLeadId[ev.leadId] = ev;
    }

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    let rangeStart, rangeEnd, rangeLabel;

    if (automation.timeDirection === 'past') {
      // Past mode: find events that happened exactly daysOffset days ago (±1 day window)
      const daysOffset = automation.daysOffset ?? 30;
      const targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() - daysOffset);
      rangeStart = new Date(targetDate); rangeStart.setHours(0,0,0,0);
      rangeEnd = new Date(targetDate); rangeEnd.setHours(23,59,59,999);
      rangeLabel = `${daysOffset} days ago (${targetDate.toISOString().split('T')[0]})`;
    } else {
      // Future mode: find events in target month
      const monthOffset = automation.monthOffset ?? 1;
      rangeStart = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
      rangeEnd = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0);
      rangeLabel = `month offset +${monthOffset}`;
    }
    console.log('Date range:', rangeLabel, rangeStart.toISOString(), '-', rangeEnd.toISOString());

    const leadsContext = allLeads.slice(0, 150).map(l => {
      const ev = eventByLeadId[l.id];
      return {
        id: l.id,
        coupleNames: l.coupleNames,
        eventDate: l.eventDate,
        phoneNumber: l.phoneNumber,
        status: l.status,
        venueName: l.venueName,
        productionFormFilledAt: l.productionFormFilledAt,
        albumStatus: ev?.albumStatus || null,
        hasEvent: !!ev
      };
    });

    const aiPrompt = `
You are an automation engine for a wedding photography CRM.
Today's date: ${todayStr}
Date range to search: ${rangeStart.toISOString().split('T')[0]} to ${rangeEnd.toISOString().split('T')[0]}
Time direction: ${automation.timeDirection === 'past' ? 'PAST events' : 'FUTURE events'}

Filter logic instruction: "${automation.filterLogic || 'all leads with a phone number and eventDate in the given date range'}"

Match leads whose eventDate falls within the date range above, plus any additional filter logic.

Here is the list of leads (JSON):
${JSON.stringify(leadsContext)}

Based on the filter logic and date range, return ONLY a JSON object: {"matchedIds": ["id1", "id2"]}
Return only valid JSON, no extra text.
`;

    const aiResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: aiPrompt,
      response_json_schema: {
        type: "object",
        properties: {
          matchedIds: { type: "array", items: { type: "string" } }
        }
      }
    });

    const matchedIds = aiResult?.matchedIds || [];
    const targetLeads = allLeads.filter(l => matchedIds.includes(l.id) && l.phoneNumber);

    const baseUrl = 'https://www.avira-studio.com';
    const results = [];

    for (const lead of targetLeads) {
      const questionnaireLink = `${baseUrl}/questionnaire/${lead.id}`;
      const contractLink = `${baseUrl}/contract/${lead.id}`;
      const eventDateStr = lead.eventDate ? new Date(lead.eventDate).toLocaleDateString('he-IL') : '';

      const messageText = (automation.messageTemplate || '')
        .replace(/\$couple_names/g, lead.coupleNames || '')
        .replace(/\$questionnaire_link/g, questionnaireLink)
        .replace(/\$contract_link/g, contractLink)
        .replace(/\$event_date/g, eventDateStr)
        .replace(/\$venue/g, lead.venueName || '');

      if (dryRun) {
        results.push({ leadName: lead.coupleNames, eventDate: lead.eventDate, phone: lead.phoneNumber, success: true, dryRun: true });
        continue;
      }

      // Format phone for Green-API
      const cleaned = lead.phoneNumber.replace(/\D/g, '');
      const intl = cleaned.startsWith('0') ? '972' + cleaned.substring(1) : cleaned;
      const chatId = `${intl}@c.us`;

      try {
        let fetchUrl, bodyPayload;
        if (hasMedia) {
          fetchUrl = sendFileUrl;
          bodyPayload = {
            chatId,
            urlFile: automation.mediaFileUrl,
            fileName: 'media',
            caption: messageText
          };
        } else {
          fetchUrl = sendTextUrl;
          bodyPayload = { chatId, message: messageText };
        }
        const res = await fetch(fetchUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyPayload)
        });
        const raw = await res.json().catch(() => ({}));
        results.push({ leadName: lead.coupleNames, success: res.ok, raw });
      } catch (err) {
        results.push({ leadName: lead.coupleNames, success: false, error: err.message });
      }
    }

    // Update lastRunAt
    await base44.asServiceRole.entities.Automation.update(automationId, {
      lastRunAt: new Date().toISOString(),
      lastRunResults: JSON.stringify({ total: results.length, sent: results.filter(r => r.success).length, results })
    });

    return Response.json({ success: true, total: results.length, sent: results.filter(r => r.success).length, results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});