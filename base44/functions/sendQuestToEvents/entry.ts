import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { eventIds, messageTemplate } = body;
    
    if (!eventIds || !Array.isArray(eventIds) || eventIds.length === 0) {
      return Response.json({ error: 'eventIds required' }, { status: 400 });
    }

    const webhookUrl = Deno.env.get("MAKE_WEBHOOK_URL");
    if (!webhookUrl) {
      return Response.json({ error: 'MAKE_WEBHOOK_URL not configured' }, { status: 500 });
    }

    const DEFAULT_TEMPLATE = 'שלום {coupleNames} 💍\n\nההתרגשות בשיאה! לקראת האירוע ב-{date} בוואנו רוצים לוודא שכל הפרטים מסונכרנים.\n\nנשמח אם תמלאו את השאלון הקצר:\n{questionnaireUrl}\n\nבהצלחה! אווירה צלמים';
    
    const template = messageTemplate || DEFAULT_TEMPLATE;
    const results = [];
    let sent = 0;

    for (const eventId of eventIds) {
      try {
        const event = await base44.entities.Event.get(eventId);
        
        if (!event) {
          results.push({ eventId, success: false });
          continue;
        }

        if (event.questionnaireSentAt) {
          results.push({ eventId, coupleNames: event.coupleNames, success: false });
          continue;
        }

        const phone = event.phoneNumber?.trim();
        if (!phone) {
          results.push({ eventId, coupleNames: event.coupleNames, success: false });
          continue;
        }

        const eventDate = event.date ? new Date(event.date) : null;
        const formattedDate = eventDate 
          ? `${eventDate.getDate()}/${eventDate.getMonth() + 1}/${String(eventDate.getFullYear()).slice(2)}`
          : '';

        const questionnaireUrl = `https://www.avira-studio.com/questionnaire/${eventId}`;

        let message = template
          .replaceAll('{coupleNames}', event.coupleNames || '')
          .replaceAll('{venue}', event.venue || '')
          .replaceAll('{date}', formattedDate)
          .replaceAll('{questionnaireUrl}', questionnaireUrl);

        const sanitizedPhone = phone.replace(/\D/g, '');
        const whatsappRes = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: sanitizedPhone, message, type: 'questionnaire_send' })
        });

        if (!whatsappRes.ok) {
          results.push({ eventId, coupleNames: event.coupleNames, success: false });
          continue;
        }

        await base44.entities.Event.update(eventId, {
          questionnaireSentAt: new Date().toISOString()
        });

        results.push({ eventId, coupleNames: event.coupleNames, success: true });
        sent++;

      } catch (err) {
        results.push({ eventId, success: false });
      }
    }

    return Response.json({ success: true, sent, total: eventIds.length, results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});