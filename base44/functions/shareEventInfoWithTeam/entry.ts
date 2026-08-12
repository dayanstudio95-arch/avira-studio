import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { eventId } = await req.json();

    if (!eventId) {
      return Response.json({ error: 'Missing eventId' }, { status: 400 });
    }

    const event = await base44.asServiceRole.entities.Event.get(eventId);
    if (!event) {
      return Response.json({ error: 'Event not found' }, { status: 404 });
    }

    // Get team members with phone
    const teamMembers = event.team || [];
    const staffWithPhone = [];

    const allStaff = await base44.asServiceRole.entities.StaffMember.list();

    for (const member of teamMembers) {
      const staff = allStaff.find(s => s.name === member.staffMemberName);
      if (staff && staff.phoneNumber) {
        staffWithPhone.push({
          name: member.staffMemberName,
          phone: staff.phoneNumber,
          id: staff.id
        });
      }
    }

    if (staffWithPhone.length === 0) {
      return Response.json({ 
        success: false,
        error: 'אין אנשי צוות עם מספרי טלפון' 
      }, { status: 400 });
    }

    // Get questionnaire data from Lead
    let lead = null;
    try {
      const leads = await base44.asServiceRole.entities.Lead.filter({ coupleNames: event.coupleNames });
      if (leads.length > 0) lead = leads[0];
    } catch (e) {
      console.log('No lead found');
    }

    // Build WhatsApp message
    let messageText = `🎬 *פרטי אירוע: ${event.coupleNames}*\n\n`;
    messageText += `📅 *תאריך:* ${new Date(event.date).toLocaleDateString('he-IL')}\n`;
    messageText += `📍 *אולם:* ${event.venue || 'לא צוין'}\n\n`;

    if (lead?.productionBridePrepLocation) {
      messageText += `👰 *התארגנות כלה:* ${lead.productionBridePrepLocation}\n`;
    }
    if (lead?.productionSpecialRequests) {
      messageText += `⭐ *בקשות מיוחדות:* ${lead.productionSpecialRequests}\n`;
    }
    if (lead?.productionInstagram) {
      messageText += `📱 *Instagram:* ${lead.productionInstagram}\n`;
    }

    messageText += `\n⏰ *הזמן להכנה:* 08:00\nתודה רבה! 🙏`;

    // Create WhatsApp links for sharing
    const results = [];
    for (const staff of staffWithPhone) {
      try {
        const cleanedPhone = staff.phone.replace(/[-\s()]/g, '');
        const phoneWithCountry = cleanedPhone.startsWith('0') ? '972' + cleanedPhone.substring(1) : cleanedPhone;
        
        // Generate WhatsApp link (opens in user's WhatsApp)
        const encodedMessage = encodeURIComponent(messageText);
        const whatsappLink = `https://wa.me/${phoneWithCountry}?text=${encodedMessage}`;

        results.push({
          staffName: staff.name,
          phone: staff.phone,
          whatsappLink,
          sent: true
        });
      } catch (error) {
        results.push({
          staffName: staff.name,
          phone: staff.phone,
          sent: false,
          error: error.message
        });
      }
    }

    return Response.json({
      success: true,
      totalSent: results.filter(r => r.sent).length,
      totalTeamMembers: staffWithPhone.length,
      results
    });
  } catch (error) {
    console.error('Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});