import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Fetch all active automations
    const automations = await base44.asServiceRole.entities.EventAutomation.filter({ isActive: true });
    const leads = await base44.asServiceRole.entities.Lead.list();
    const events = await base44.asServiceRole.entities.Event.list();

    const processedCount = {};

    for (const automation of automations) {
      const targetLeads = [];
      const now = new Date();

      // Check each lead/event against the automation trigger
      for (const lead of leads) {
        let shouldSend = false;
        let recipientPhone = null;

        // days_after_proposal: Check if proposal was sent N days ago
        if (automation.triggerType === 'days_after_proposal' && lead.signedAt) {
          const proposalDate = new Date(lead.signedAt);
          const daysSince = Math.floor((now - proposalDate) / (1000 * 60 * 60 * 24));
          if (daysSince === automation.triggerDays) {
            shouldSend = true;
            recipientPhone = lead.phoneNumber;
          }
        }

        // days_after_event: Check if event was N days ago
        if (automation.triggerType === 'days_after_event') {
          const matchingEvent = events.find(e => e.coupleNames === lead.coupleNames);
          if (matchingEvent && matchingEvent.date) {
            const eventDate = new Date(matchingEvent.date);
            const daysSince = Math.floor((now - eventDate) / (1000 * 60 * 60 * 24));
            if (daysSince === automation.triggerDays) {
              shouldSend = true;
              recipientPhone = lead.phoneNumber;
            }
          }
        }

        if (shouldSend && recipientPhone) {
          targetLeads.push({
            name: lead.coupleNames,
            phone: recipientPhone,
            email: lead.email,
            lead: lead,
          });
        }
      }

      // Send messages to target leads
      for (const targetLead of targetLeads) {
        const message = interpolateMessage(automation.messageTemplate, targetLead.lead);
        
        try {
          // Here you would integrate with WhatsApp API (Evolution, Twilio, etc.)
          // For now, we'll log it and store the execution
          console.log(`Sending automation "${automation.name}" to ${targetLead.phone}: ${message}`);
          
          // Update automation last executed
          await base44.asServiceRole.entities.EventAutomation.update(automation.id, {
            lastExecuted: now.toISOString(),
            targetCount: (automation.targetCount || 0) + 1,
          });
        } catch (error) {
          console.error(`Failed to send automation to ${targetLead.phone}:`, error);
        }
      }

      processedCount[automation.name] = targetLeads.length;
    }

    return Response.json({
      success: true,
      processed: processedCount,
      message: 'Automations checked and processed',
    });
  } catch (error) {
    console.error('Error in checkAutomations:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function interpolateMessage(template, lead) {
  let message = template;
  const eventDate = lead.eventDate ? new Date(lead.eventDate).toLocaleDateString('he-IL') : 'N/A';
  const appBaseUrl = 'https://www.avira-studio.com';
  
  message = message.replace(/\[שם_לקוח\]/g, lead.coupleNames || 'לקוח יקר');
  message = message.replace(/\[תאריך_אירוע\]/g, eventDate);
  message = message.replace(/\[אולם\]/g, lead.venueName || 'N/A');
  message = message.replace(/\[לינק_שאלון\]/g, appBaseUrl + '/questionnaire/' + lead.id);
  message = message.replace(/\[לינק_אלבום\]/g, lead.lastInvoiceUrl || appBaseUrl + '/album');
  
  return message;
}