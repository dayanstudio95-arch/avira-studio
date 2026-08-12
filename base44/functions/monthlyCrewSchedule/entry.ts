import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Get current date and next month
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const nextMonthStart = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), 1);
    const nextMonthEnd = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0);

    // Fetch all events for next month
    const allEvents = await base44.entities.Event.list();
    const nextMonthEvents = allEvents.filter(event => {
      const eventDate = new Date(event.date);
      return eventDate >= nextMonthStart && eventDate <= nextMonthEnd;
    });

    if (nextMonthEvents.length === 0) {
      return Response.json({ success: true, message: 'No events for next month' });
    }

    // Get staff members
    const staffMembers = await base44.entities.StaffMember.list();
    
    // Get app settings for webhook URL
    const settings = await base44.entities.AppSetting.list();
    const webhookUrl = settings.find(s => s.key === 'make_webhook_url')?.value;

    if (!webhookUrl) {
      return Response.json({ error: 'Webhook URL not configured' }, { status: 400 });
    }

    // Group events by crew members
    const crewSchedules = {};
    
    nextMonthEvents.forEach(event => {
      if (!event.team || event.team.length === 0) return;
      
      event.team.forEach(member => {
        if (!member.staffMemberName) return;
        
        if (!crewSchedules[member.staffMemberName]) {
          crewSchedules[member.staffMemberName] = [];
        }
        
        crewSchedules[member.staffMemberName].push({
          date: event.date,
          coupleNames: event.coupleNames,
          venue: event.venue
        });
      });
    });

    // Send schedule to each crew member via Make webhook
    const results = [];
    
    for (const [crewName, events] of Object.entries(crewSchedules)) {
      const staff = staffMembers.find(s => s.name === crewName);
      if (!staff || !staff.phoneNumber) continue;

      // Build message
      const eventsList = events
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .map(e => {
          const dateStr = new Date(e.date).toLocaleDateString('he-IL');
          return `${dateStr} - ${e.coupleNames} - ${e.venue || 'בחזקה'}`;
        })
        .join('\n');

      const messageText = `היי ${crewName}, הנה לו"ז האירועים שלך לחודש הקרוב:\n\n${eventsList}`;

      // Format phone for WhatsApp
      const cleaned = staff.phoneNumber.replace(/[-\s()]/g, '');
      const intl = cleaned.startsWith('0') ? '972' + cleaned.substring(1) : cleaned;
      const whatsapp_id = `${intl}@c.us`;

      // Send to Make webhook
      const payload = {
        action_type: 'monthly_crew_schedule',
        whatsapp_id,
        message_text: messageText
      };

      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        results.push({
          crewName,
          success: response.ok,
          eventsCount: events.length
        });
      } catch (error) {
        results.push({
          crewName,
          success: false,
          error: error.message
        });
      }
    }

    return Response.json({ success: true, results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});