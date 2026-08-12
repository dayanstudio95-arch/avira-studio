import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * fixMissingEventForLead
 * Safely creates missing Events for signed leads that have none.
 * Uses ONLY source_lead_id as the canonical link — never studio_id matching.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ONLY "נסגר/חתימה" is eligible to have an Event
    const ELIGIBLE_STATUS = 'נסגר/חתימה';

    const [signedLeads, allEvents] = await Promise.all([
      base44.asServiceRole.entities.Lead.filter({ status: ELIGIBLE_STATUS }),
      base44.asServiceRole.entities.Event.list()
    ]);

    // Build canonical map: source_lead_id → event (ONLY safe link)
    const eventBySourceLeadId = {};
    for (const ev of allEvents) {
      if (ev.source_lead_id) {
        // If duplicate, keep the first (oldest) one
        if (!eventBySourceLeadId[ev.source_lead_id]) {
          eventBySourceLeadId[ev.source_lead_id] = ev;
        }
      }
    }

    let created = 0;
    let alreadyLinked = 0;
    const createdList = [];
    // Note: the filter above already ensures only "נסגר/חתימה" leads are processed.

    for (const lead of signedLeads) {
      const existingEvent = eventBySourceLeadId[lead.id];

      if (existingEvent) {
        // Event exists — ensure linked_event_id is set correctly on lead
        if (lead.linked_event_id !== existingEvent.id) {
          await base44.asServiceRole.entities.Lead.update(lead.id, { linked_event_id: existingEvent.id });
        }
        alreadyLinked++;
        continue;
      }

      // No event found via source_lead_id — create one safely
      const newEvent = await base44.asServiceRole.entities.Event.create({
        coupleNames: lead.coupleNames,
        date: lead.eventDate || new Date().toISOString().split('T')[0],
        phoneNumber: lead.phoneNumber || '',
        venue: lead.venueName || '',
        totalAmountGross: lead.finalPrice || lead.basePrice || 0,
        clientPaymentStatus: 'Unpaid',
        notes: `הומר מליד | ${lead.notes || ''}`,
        studio_id: lead.studio_id || 0,
        source_lead_id: lead.id,
        packageId: lead.packageId || null,
      });

      // Update lead with the new event id
      await base44.asServiceRole.entities.Lead.update(lead.id, { linked_event_id: newEvent.id });

      created++;
      createdList.push({ leadId: lead.id, coupleNames: lead.coupleNames, eventId: newEvent.id });
    }

    return Response.json({
      total_eligible: signedLeads.length,
      already_linked: alreadyLinked,
      created,
      created_list: createdList,
      message: `יצרו ${created} אירועים חדשים, ${alreadyLinked} כבר מקושרים`
    });
  } catch (error) {
    console.error('Error in fixMissingEventForLead:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});