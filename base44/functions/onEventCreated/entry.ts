import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// Triggered by entity automation on Event create
// Copies studio_id from the linked Lead to the Event
Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const base44 = createClientFromRequest(req);

    const eventData = body.data;
    if (!eventData?.id) {
      return Response.json({ skipped: 'no event data' });
    }

    // Already has studio_id — nothing to do
    if (eventData.studio_id) {
      return Response.json({ skipped: 'already has studio_id', studio_id: eventData.studio_id });
    }

    // Find the linked lead — source_lead_id is the ONLY link field
    const linkedLeadId = eventData.source_lead_id;

    if (!linkedLeadId) {
      // No lead link — assign a new unique studio_id from counter
      const settings = await base44.asServiceRole.entities.AppSetting.list();
      const counterSetting = settings.find(s => s.key === 'next_studio_id');
      const [leads, events] = await Promise.all([
        base44.asServiceRole.entities.Lead.list(),
        base44.asServiceRole.entities.Event.list()
      ]);
      const maxLeadId = leads.reduce((max, l) => Math.max(max, l.studio_id || 0), 0);
      const maxEventId = events.reduce((max, e) => Math.max(max, e.studio_id || 0), 0);
      let nextId = counterSetting ? parseInt(counterSetting.value, 10) : 1;
      if (isNaN(nextId) || nextId < 1) nextId = 1;
      nextId = Math.max(nextId, maxLeadId + 1, maxEventId + 1);

      await base44.asServiceRole.entities.Event.update(eventData.id, { studio_id: nextId });

      if (counterSetting) {
        await base44.asServiceRole.entities.AppSetting.update(counterSetting.id, { value: String(nextId + 1) });
      } else {
        await base44.asServiceRole.entities.AppSetting.create({ key: 'next_studio_id', value: String(nextId + 1) });
      }

      return Response.json({ success: true, studio_id: nextId, eventId: eventData.id, source: 'new_id' });
    }

    const leads = await base44.asServiceRole.entities.Lead.list();
    const lead = leads.find(l => l.id === linkedLeadId);

    if (!lead?.studio_id) {
      return Response.json({ skipped: 'lead has no studio_id', leadId: linkedLeadId });
    }

    await base44.asServiceRole.entities.Event.update(eventData.id, { studio_id: lead.studio_id });

    return Response.json({ success: true, studio_id: lead.studio_id, eventId: eventData.id });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});