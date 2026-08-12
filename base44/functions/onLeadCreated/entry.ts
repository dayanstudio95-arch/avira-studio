import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// Triggered by entity automation on Lead create
// Assigns the next unique studio_id using an AppSetting counter
Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const base44 = createClientFromRequest(req);

    const leadData = body.data;
    if (!leadData?.id) {
      return Response.json({ skipped: 'no lead data' });
    }

    // Skip if already has studio_id
    if (leadData.studio_id) {
      return Response.json({ skipped: 'already has studio_id', studio_id: leadData.studio_id });
    }

    // Get or init the counter from AppSetting
    const settings = await base44.asServiceRole.entities.AppSetting.list();
    const counterSetting = settings.find(s => s.key === 'next_studio_id');

    let nextId = counterSetting ? parseInt(counterSetting.value, 10) : 1;
    if (isNaN(nextId) || nextId < 1) nextId = 1;

    // Also verify against all existing leads/events to never go below max
    const [leads, events] = await Promise.all([
      base44.asServiceRole.entities.Lead.list(),
      base44.asServiceRole.entities.Event.list()
    ]);
    const maxLeadId = leads.reduce((max, l) => Math.max(max, l.studio_id || 0), 0);
    const maxEventId = events.reduce((max, e) => Math.max(max, e.studio_id || 0), 0);
    nextId = Math.max(nextId, maxLeadId + 1, maxEventId + 1);

    // Assign studio_id to the new lead
    await base44.asServiceRole.entities.Lead.update(leadData.id, { studio_id: nextId });

    // Persist the incremented counter
    if (counterSetting) {
      await base44.asServiceRole.entities.AppSetting.update(counterSetting.id, { value: String(nextId + 1) });
    } else {
      await base44.asServiceRole.entities.AppSetting.create({ key: 'next_studio_id', value: String(nextId + 1) });
    }

    return Response.json({ success: true, studio_id: nextId, leadId: leadData.id });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});