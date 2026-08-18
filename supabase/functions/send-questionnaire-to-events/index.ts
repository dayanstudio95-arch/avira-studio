// Ports base44/functions/sendQuestionnaireToEvents/entry.ts.
// Invoked from src/pages/Events.jsx (bulk "send questionnaire" action) with
// { eventIds, month, year, messageTemplate }.
//
// KNOWN PRE-EXISTING BUG, preserved as-is: `debugMode` defaults to `true` in the
// original and the frontend never passes it at all — meaning this feature has
// always only console.log'd what it WOULD send and never actually sent a message
// or set questionnaireSentAt in production. Flipping the default would mean this
// port starts actually sending real WhatsApp messages to real couples the moment
// it's deployed, which is a meaningful behavior change with real-world side effects
// — left as `true` here to avoid an unreviewed change with customer-facing impact.
// To enable real sending, pass `debugMode: false` explicitly in the invoke payload
// (e.g. after adding a toggle to the Events.jsx UI).
//
// Make.com webhook (MAKE_WEBHOOK_URL) replaced with the shared Green API
// sendWhatsApp() helper for the non-debug path, per the site-wide Make.com
// replacement decision.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { sendWhatsApp } from '../_shared/whatsapp.ts';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createUserClient(req);
    const { eventIds, messageTemplate, debugMode = true, testPhone, limit, month, year } = await req.json();

    if (!month || !year) return jsonResponse({ error: 'month and year are required' }, { status: 400 });

    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    let eventsToProcess: string[] = eventIds;
    if (!eventIds || !Array.isArray(eventIds) || eventIds.length === 0) {
      const { data: allEvents, error: evErr } = await supabase.from('events').select('id, date');
      if (evErr) return jsonResponse({ error: evErr.message }, { status: 500 });
      eventsToProcess = (allEvents || []).filter((e) => e.date && e.date >= startDate && e.date <= endDate).map((e) => e.id);
      if (eventsToProcess.length === 0) {
        return jsonResponse({ error: `No events found for ${month}/${year}` }, { status: 400 });
      }
    }

    if (limit && typeof limit === 'number' && limit > 0) {
      eventsToProcess = eventsToProcess.slice(0, limit);
    }

    const template =
      messageTemplate ||
      'היי {coupleNames}, ההתרגשות בשיאה! 🥂\nלקראת האירוע שלכם, אנחנו רוצים לוודא שכל הפרטים מסונכרנים אצלנו במערכת. 📋\nנשמח אם תוכלו למלא את השאלון הקצר בקישור הבא כדי שנוכל לתת לכם את השירות הטוב ביותר ❤️\n{questionnaireUrl}\nתודה! אווירה צלמים 📸';

    const logEntries: Array<Record<string, unknown>> = [];
    let sent = 0;

    for (const eventId of eventsToProcess) {
      try {
        const { data: event } = await supabase.from('events').select('*').eq('id', eventId).maybeSingle();
        if (!event) {
          logEntries.push({ eventId, success: false, reason: 'Event not found' });
          continue;
        }

        const phone = event.phone_number?.trim();
        if (!phone && !testPhone) {
          logEntries.push({ eventId, coupleNames: event.couple_names, success: false, reason: 'No phone number' });
          continue;
        }

        const eventDate = event.date ? new Date(event.date) : null;
        const formattedDate = eventDate ? `${eventDate.getDate()}/${eventDate.getMonth() + 1}/${String(eventDate.getFullYear()).slice(2)}` : '';
        // Was a hardcoded dead domain (avira-studio.com), causing every questionnaire
        // link sent to couples to 404 — fixed 2026-08-18 to use APP_BASE_URL.
        const appBaseUrl = Deno.env.get('APP_BASE_URL') ?? '';
        const questionnaireUrl = `${appBaseUrl}/questionnaire/${event.source_lead_id || eventId}`;

        const message = template
          .replaceAll('{coupleNames}', event.couple_names || '')
          .replaceAll('{venue}', event.venue || '')
          .replaceAll('{date}', formattedDate)
          .replaceAll('{questionnaireUrl}', questionnaireUrl);

        const targetPhone = testPhone || phone;

        const logEntry: Record<string, unknown> = {
          coupleNames: event.couple_names,
          eventId: event.id,
          source_lead_id: event.source_lead_id,
          questionnaireUrl,
          eventDate: event.date,
          phone: testPhone ? `${testPhone} (test)` : phone,
          success: false,
        };

        if (debugMode === true) {
          console.log(`[DEBUG] Would send to ${event.couple_names} (${targetPhone}): ${message}`);
          logEntry.success = true;
          logEntry.debugMode = true;
          logEntries.push(logEntry);
          sent++;
        } else if (debugMode === false) {
          const result = await sendWhatsApp(supabase, targetPhone, message);
          if (!result.success) {
            logEntry.reason = result.error;
            logEntries.push(logEntry);
            continue;
          }

          await supabase.from('events').update({ questionnaire_sent_at: new Date().toISOString() }).eq('id', eventId);
          logEntry.success = true;
          logEntries.push(logEntry);
          sent++;
        }
      } catch (err) {
        logEntries.push({ eventId, success: false, reason: err.message });
      }
      await delay(3000 + Math.floor(Math.random() * 2000));
    }

    const failedList = logEntries
      .filter((e) => !e.success)
      .map((e) => ({ coupleNames: e.coupleNames || 'unknown', eventId: e.eventId, reason: e.reason }));

    return jsonResponse({ success: true, sent, failed: failedList.length, total: eventsToProcess.length, failedList, logs: logEntries });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
