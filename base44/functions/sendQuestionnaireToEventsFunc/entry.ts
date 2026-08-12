import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const DEFAULT_TEMPLATE = `שלום {coupleNames} 💍

ההתרגשות בשיאה! 🥂 לקראת האירוע המיוחד שלכם ב-{date} בוואנו רוצים לוודא שכל הפרטים מסונכרנים.

נשמח אם תמלאו את השאלון הקצר בקישור זה כדי שנוכל להכין הכל בצורה המושלמת ❤️

{questionnaireUrl}

בהצלחה! 
אווירה צלמים 📸`;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { eventIds, messageTemplate } = await req.json();
    
    if (!eventIds || !Array.isArray(eventIds) || eventIds.length === 0) {
      return Response.json({ error: 'eventIds must be a non-empty array' }, { status: 400 });
    }

    const webhookUrl = Deno.env.get("MAKE_WEBHOOK_URL");
    if (!webhookUrl) {
      return Response.json({ error: 'MAKE_WEBHOOK_URL not configured' }, { status: 500 });
    }

    const template = messageTemplate || DEFAULT_TEMPLATE;
    const results = [];
    let sent = 0;

    for (const eventId of eventIds) {
      try {
        const event = await base44.entities.Event.get(eventId);
        
        if (!event) {
          results.push({ eventId, coupleNames: '—', phone: '—', success: false, error: 'Event not found' });
          continue;
        }

        // Skip if questionnaire already sent
        if (event.questionnaireSentAt) {
          results.push({ eventId, coupleNames: event.coupleNames, phone: event.phoneNumber, success: false, error: 'Already sent' });
          continue;
        }

        // Check if phone number exists
        const phone = event.phoneNumber?.trim();
        if (!phone) {
          results.push({ eventId, coupleNames: event.coupleNames, phone: '—', success: false, error: 'No phone number' });
          continue;
        }

        // Format date
        const eventDate = event.date ? new Date(event.date) : null;
        const formattedDate = eventDate 
          ? `${eventDate.getDate()}/${eventDate.getMonth() + 1}/${String(eventDate.getFullYear()).slice(2)}`
          : '—';

        // Build questionnaire URL
        const questionnaireUrl = `https://www.avira-studio.com/questionnaire/${eventId}`;

        // Build message from template
        let message = template;
        message = message.replaceAll('{coupleNames}', event.coupleNames || '');
        message = message.replaceAll('{venue}', event.venue || '');
        message = message.replaceAll('{date}', formattedDate);
        message = message.replaceAll('{questionnaireUrl}', questionnaireUrl);

        // Send WhatsApp
        const sanitizedPhone = phone.replace(/\D/g, '');
        const whatsappRes = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: sanitizedPhone,
            message,
            type: 'questionnaire_send'
          })
        });

        if (!whatsappRes.ok) {
          const errorText = await whatsappRes.text().catch(() => '');
          results.push({ 
            eventId, 
            coupleNames: event.coupleNames, 
            phone, 
            success: false, 
            error: `WhatsApp failed: ${whatsappRes.status}` 
          });
          continue;
        }

        // Update event with timestamp
        await base44.entities.Event.update(eventId, {
          questionnaireSentAt: new Date().toISOString()
        });

        results.push({ 
          eventId, 
          coupleNames: event.coupleNames, 
          phone, 
          success: true 
        });
        sent++;

      } catch (err) {
        console.error(`Error processing event ${eventId}:`, err.message);
        results.push({ 
          eventId, 
          coupleNames: '—', 
          phone: '—', 
          success: false, 
          error: err.message 
        });
      }
    }

    return Response.json({ 
      success: true, 
      sent, 
      total: eventIds.length, 
      results 
    });
  } catch (error) {
    console.error('Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});