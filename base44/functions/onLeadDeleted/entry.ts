import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// Triggered by entity automation on Lead delete
// Deletes the linked Event (matched by leadId or studio_id)
Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const base44 = createClientFromRequest(req);

    const leadData = body.data;
    const leadId = leadData?.id || body.event?.entity_id;
    const studioId = leadData?.studio_id;

    if (!leadId && !studioId) {
      return Response.json({ skipped: 'no lead identifier' });
    }

    const events = await base44.asServiceRole.entities.Event.list();

    // CANONICAL LINK: use source_lead_id only (leadId is deprecated)
    let linkedEvent = null;
    if (leadId) linkedEvent = events.find(e => e.source_lead_id === leadId);
    // Fallback: old leadId field (legacy records only)
    if (!linkedEvent && leadId) linkedEvent = events.find(e => e.leadId === leadId);

    if (!linkedEvent) {
      console.log(`[onLeadDeleted] No linked event found for lead ${leadId} — nothing to delete`);
      return Response.json({ skipped: 'no linked event found' });
    }

    console.log(`[onLeadDeleted] Deleting event ${linkedEvent.id} (source_lead_id: ${linkedEvent.source_lead_id}) for lead ${leadId}`);
    await base44.asServiceRole.entities.Event.delete(linkedEvent.id);

    return Response.json({ success: true, deletedEventId: linkedEvent.id });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});