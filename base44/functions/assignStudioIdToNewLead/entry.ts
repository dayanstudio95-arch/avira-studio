import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { leadId } = await req.json();

    if (!leadId) {
      return Response.json({ error: 'leadId required' }, { status: 400 });
    }

    // Get all leads sorted by studio_id to find the next available ID
    const allLeads = await base44.asServiceRole.entities.Lead.list();
    const maxStudioId = allLeads.reduce((max, lead) => {
      const id = lead.studio_id ? Number(lead.studio_id) : 0;
      return Math.max(max, id);
    }, 0);

    const nextId = maxStudioId + 1;

    // Assign studio_id to the lead
    await base44.asServiceRole.entities.Lead.update(leadId, { studio_id: nextId });

    return Response.json({ studio_id: nextId, leadId });
  } catch (error) {
    console.error('Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});