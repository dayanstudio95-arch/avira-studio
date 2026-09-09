// Ports base44/functions/sendQuestionnaireToEvents/entry.ts.
// Invoked from src/pages/Events.jsx (bulk "send questionnaire" action) with
// { eventIds, month, year, messageTemplate }.
//
// FIXED 2026-09-09 — this function never sent anything, and said it had.
//
// `debugMode` defaulted to `true` and Events.jsx never passed it, so every "send
// questionnaire" ran the console.log branch. That alone would have been dormant. What
// made it harmful is that the debug branch did `logEntry.success = true; sent++`, so
// the function returned a non-zero `sent` and the UI announced "✅ נשלחו 12 שאלונים
// בהצלחה". The studio believed couples had been asked to fill in the questionnaire
// when nothing had gone out, and `questionnaire_sent_at` stayed null — so the "שאלון
// חסר" flags in the rest of the app quietly agreed with the lie.
//
// The previous author left the default as `true` deliberately, to avoid an unreviewed
// change that starts messaging real couples. That caution was right at the time; the
// user reviewed and approved the change on 2026-09-09, and Events.jsx now confirms
// the recipient count before invoking.
//
// Two things changed, and the second matters more than the first:
//   1. `debugMode` now defaults to false — the function does what its name says.
//   2. The debug branch no longer counts toward `sent`. It reports `wouldSend`
//      instead, and the response carries `debugMode` back, so a caller physically
//      cannot render a dry run as a successful send again.
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
    const { eventIds, messageTemplate, debugMode = false, testPhone, limit, month, year } = await req.json();

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
    let sent = 0;      // real WhatsApp messages delivered
    let wouldSend = 0; // debugMode only — never conflated with `sent`

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
          // Counted separately from `sent`, on purpose. Reporting a dry run as a send
          // is the bug this function is named after.
          console.log(`[DEBUG] Would send to ${event.couple_names} (${targetPhone})`);
          logEntry.debugMode = true;
          logEntries.push(logEntry);
          wouldSend++;
        } else {
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

    // Dry-run entries are neither sent nor failed — excluding them keeps `failed`
    // meaning "we tried and it didn't work", which is what the caller shows the user.
    const failedList = logEntries
      .filter((e) => !e.success && !e.debugMode)
      .map((e) => ({ coupleNames: e.coupleNames || 'unknown', eventId: e.eventId, reason: e.reason }));

    return jsonResponse({
      success: true,
      // Echoed back so the caller can never present a dry run as a real send.
      debugMode: debugMode === true,
      sent,
      wouldSend,
      failed: failedList.length,
      total: eventsToProcess.length,
      failedList,
      logs: logEntries,
    });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
