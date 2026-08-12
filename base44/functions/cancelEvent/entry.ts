import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { eventId } = body;

    if (!eventId) {
      return Response.json({ error: 'Missing eventId' }, { status: 400 });
    }

    // Fetch the event to get linked lead ID
    const events = await base44.asServiceRole.entities.Event.list();
    const event = events.find(e => e.id === eventId);

    if (!event) {
      return Response.json({ error: 'Event not found' }, { status: 404 });
    }

    const linkedLeadId = event.source_lead_id || event.leadId;

    // Delete the event
    await base44.asServiceRole.entities.Event.delete(eventId);
    console.log(`[cancelEvent] Event ${eventId} deleted`);

    // Update the linked lead if it exists
    if (linkedLeadId) {
      const leads = await base44.asServiceRole.entities.Lead.list();
      const lead = leads.find(l => l.id === linkedLeadId);

      if (lead) {
        const updatedNotes = lead.notes ? `${lead.notes}\n\nהאירוע בוטל` : 'האירוע בוטל';
        await base44.asServiceRole.entities.Lead.update(linkedLeadId, {
          status: 'לא רלוונטי',
          linked_event_id: null,
          notes: updatedNotes
        });
        console.log(`[cancelEvent] Lead ${linkedLeadId} updated: status=לא רלוונטי, notes appended`);
      }
    }

    return Response.json({
      success: true,
      message: 'Event cancelled successfully',
      eventId,
      linkedLeadId
    });
  } catch (error) {
    console.error('[cancelEvent] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});