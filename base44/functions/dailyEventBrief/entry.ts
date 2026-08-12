import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);


    // Get Google Calendar access if available
    let googleAccessToken = null;
    let calendarId = 'primary';
    try {
      const conn = await base44.asServiceRole.connectors.getConnection('googlecalendar');
      googleAccessToken = conn.accessToken;
      const settingsForCal = await base44.asServiceRole.entities.AppSetting.list();
      const savedCalendarId = settingsForCal.find(s => s.key === 'google_calendar_id')?.value?.trim();
      if (savedCalendarId) calendarId = savedCalendarId;
    } catch (e) {
      console.log('Google Calendar not available, proceeding without it');
    }

    // Get tomorrow's date
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    // Fetch all events
    const allEvents = await base44.entities.Event.filter({});
    const tomorrowEvents = allEvents.filter(event => event.date === tomorrowStr);

    if (tomorrowEvents.length === 0) {
      return Response.json({ success: true, message: 'No events tomorrow' });
    }

    // Get staff members and settings
    const staffMembers = await base44.entities.StaffMember.filter({});
    const leads = await base44.entities.Lead.filter({});
    const settings = await base44.entities.AppSetting.filter({});
    const webhookUrl = settings.find(s => s.key === 'make_webhook_url')?.value;

    if (!webhookUrl) {
      return Response.json({ error: 'Webhook URL not configured' }, { status: 400 });
    }

    const results = [];

    // Process each event
    for (const event of tomorrowEvents) {
      if (!event.team || event.team.length === 0) continue;

      // Find corresponding lead for production details
      const lead = leads.find(l => l.id === event.leadId);

      // Try to fetch the full event description from Google Calendar
      let eventSummary = '';
      if (googleAccessToken && event.googleCalendarEventId) {
        try {
          const gcResponse = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${event.googleCalendarEventId}`,
            { headers: { 'Authorization': `Bearer ${googleAccessToken}` } }
          );
          const gcEvent = await gcResponse.json();
          const description = gcEvent.description || '';
          
          // Use the full description from Google Calendar as-is
          if (description && description.trim()) {
            eventSummary = description.trim();
          }
        } catch (gcErr) {
          console.warn('Could not fetch Google Calendar event:', gcErr.message);
        }
      }
      
      // Fallback if calendar fetch failed or no calendar event
      if (!eventSummary) {
        const technicalSummary = lead?.finalTechnicalSummary || '⚠️ הזוג טרם מילא את השאלון - אין מידע זמין';
        eventSummary = `
🎬 סיכום אירוע - ${new Date(event.date).toLocaleDateString('he-IL')}

👫 הזוג: ${event.coupleNames}
📞 טלפון ראשי: ${lead?.phoneNumber || '—'}
📍 אולם: ${event.venue || '—'}

📋 פרטים טכניים:
${technicalSummary}

👥 צוות הצילום:
${event.team.map(m => `• ${m.staffMemberName} (${m.role})`).join('\n')}
        `.trim();
      }

      // Send brief to photographers only
      const photographerRoles = ['photographer1', 'photographer2'];
      for (const member of event.team) {
        if (!member.staffMemberName) continue;
        if (!photographerRoles.includes(member.role)) continue;

        const staff = staffMembers.find(s => s.name === member.staffMemberName);
        if (!staff || !staff.phoneNumber) continue;

        // Format phone to WhatsApp chatId (same pattern as sendToEditor / sendToCouple)
        const sanitized = staff.phoneNumber.replace(/\D/g, '');
        const normalized = sanitized.startsWith('0') ? '972' + sanitized.substring(1) : sanitized;
        // Validate: Israeli number with country code must be exactly 12 digits (972 + 9 digits)
        if (normalized.length !== 12) {
          console.warn(`[dailyEventBrief] Invalid phone for ${member.staffMemberName}: '${staff.phoneNumber}' -> '${normalized}' (length ${normalized.length}, expected 12). Skipping.`);
          results.push({ eventName: event.coupleNames, crewMember: member.staffMemberName, success: false, error: 'Invalid or missing phone number' });
          continue;
        }
        const whatsappTo = normalized + '@c.us';

        // Build personalized message
        const personalMessage = `היי ${member.staffMemberName},\n\nלהלן פרטי האירוע שלך מחר:\n\n${eventSummary}`;

        // Send to Make webhook
        const payload = {
          to: whatsappTo,
          message: personalMessage,
          action_type: 'daily_event_brief'
        };

        try {
          const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          results.push({
            eventName: event.coupleNames,
            crewMember: member.staffMemberName,
            success: response.ok
          });
        } catch (error) {
          results.push({
            eventName: event.coupleNames,
            crewMember: member.staffMemberName,
            success: false,
            error: error.message
          });
        }
      }
    }

    return Response.json({ success: true, eventsProcessed: tomorrowEvents.length, results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});