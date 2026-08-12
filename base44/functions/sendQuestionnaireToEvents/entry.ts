import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { eventIds, messageTemplate, debugMode = true, testPhone, limit, month, year } = await req.json();
    
    // Require month and year parameters
    if (!month || !year) {
      return Response.json({ error: 'month and year are required' }, { status: 400 });
    }
    
    // Calculate date range
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
    
    // Fetch events for specified month/year if no eventIds provided
    let eventsToProcess = eventIds;
    if (!eventIds || !Array.isArray(eventIds) || eventIds.length === 0) {
      const allEvents = await base44.entities.Event.list();
      eventsToProcess = allEvents
        .filter(e => e.date && e.date >= startDate && e.date <= endDate)
        .map(e => e.id);
      if (eventsToProcess.length === 0) {
        return Response.json({ error: `No events found for ${month}/${year}` }, { status: 400 });
      }
    }

    // Apply limit if provided
    if (limit && typeof limit === 'number' && limit > 0) {
      eventsToProcess = eventsToProcess.slice(0, limit);
    }

    const template = messageTemplate || 'היי {coupleNames}, ההתרגשות בשיאה! 🥂\nלקראת האירוע שלכם, אנחנו רוצים לוודא שכל הפרטים מסונכרנים אצלנו במערכת. 📋\nנשמח אם תוכלו למלא את השאלון הקצר בקישור הבא כדי שנוכל לתת לכם את השירות הטוב ביותר ❤️\n{questionnaireUrl}\nתודה! אווירה צלמים 📸';
    
    const logEntries = [];
    let sent = 0;
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    for (const eventId of eventsToProcess) {
      try {
        const event = await base44.entities.Event.get(eventId);
        if (!event) {
          logEntries.push({ eventId, success: false, reason: 'Event not found' });
          continue;
        }

        const phone = event.phoneNumber?.trim();
        if (!phone && !testPhone) {
          logEntries.push({ eventId, coupleNames: event.coupleNames, success: false, reason: 'No phone number' });
          continue;
        }

        const eventDate = event.date ? new Date(event.date) : null;
        const formattedDate = eventDate ? `${eventDate.getDate()}/${eventDate.getMonth() + 1}/${String(eventDate.getFullYear()).slice(2)}` : '';
        const questionnaireUrl = `https://www.avira-studio.com/questionnaire/${event.source_lead_id || eventId}`;

        let message = template
          .replaceAll('{coupleNames}', event.coupleNames || '')
          .replaceAll('{venue}', event.venue || '')
          .replaceAll('{date}', formattedDate)
          .replaceAll('{questionnaireUrl}', questionnaireUrl);

        // Determine target phone
        const targetPhone = testPhone || phone;
        const sanitized = targetPhone.replace(/\D/g, '');
        const whatsappNumber = '972' + sanitized.replace(/^0/, '') + '@c.us';

        // Build log entry
        const logEntry = {
          coupleNames: event.coupleNames,
          eventId: event.id,
          source_lead_id: event.source_lead_id,
          questionnaireUrl,
          eventDate: event.date,
          phone: testPhone ? `${testPhone} (test)` : phone,
          success: false
        };

        // If debug mode is enabled (default or explicitly true), don't send webhook
        if (debugMode === true) {
          console.log(`[DEBUG] Would send to ${event.coupleNames} (${targetPhone}): ${message}`);
          logEntry.success = true;
          logEntry.debugMode = true;
          logEntries.push(logEntry);
          sent++;
        } else if (debugMode === false) {
          // Production: send via webhook
          const webhookUrl = Deno.env.get("MAKE_WEBHOOK_URL");
          if (!webhookUrl) {
            logEntry.reason = 'MAKE_WEBHOOK_URL not set';
            logEntries.push(logEntry);
            continue;
          }

          const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action_type: 'questionnaire_send', chatId: whatsappNumber, message_text: message })
          });

          if (!res.ok) {
            logEntry.reason = `Webhook failed with status ${res.status}`;
            logEntries.push(logEntry);
            continue;
          }

          // Update event with questionnaireSentAt timestamp
          await base44.entities.Event.update(eventId, { questionnaireSentAt: new Date().toISOString() });
          logEntry.success = true;
          logEntries.push(logEntry);
          sent++;
        }
      } catch (err) {
        logEntries.push({ eventId, success: false, reason: err.message });
      }
      await delay(3000 + Math.floor(Math.random() * 2000));
    }

    const failedList = logEntries.filter(e => !e.success).map(e => ({ coupleNames: e.coupleNames || 'unknown', eventId: e.eventId, reason: e.reason }));
    return Response.json({ success: true, sent, failed: failedList.length, total: eventsToProcess.length, failedList, logs: logEntries });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});