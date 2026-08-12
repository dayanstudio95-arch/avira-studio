import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  try {
    let allLeadsRaw = await base44.asServiceRole.entities.Lead.list();
    if (typeof allLeadsRaw === 'string') allLeadsRaw = JSON.parse(allLeadsRaw);
    const allLeads = Array.isArray(allLeadsRaw) ? allLeadsRaw : [];

    let allEventsRaw = await base44.asServiceRole.entities.Event.list();
    if (typeof allEventsRaw === 'string') allEventsRaw = JSON.parse(allEventsRaw);
    const allEvents = Array.isArray(allEventsRaw) ? allEventsRaw : [];

    const testLeads = allLeads.filter(l => {
      const name = (l.coupleNames || '').toLowerCase();
      return name.includes('טסט') || name.includes('test');
    });

    const result = testLeads.map(lead => {
      const linkedEvents = allEvents.filter(e =>
        e.leadId === lead.id || e.source_lead_id === lead.id || e.coupleNames === lead.coupleNames
      );
      return {
        lead_id: lead.id,
        coupleNames: lead.coupleNames,
        status: lead.status,
        created_date: lead.created_date,
        linked_events: linkedEvents.map(e => ({ event_id: e.id, date: e.date, coupleNames: e.coupleNames }))
      };
    });

    return Response.json({ count: result.length, leads: result });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});