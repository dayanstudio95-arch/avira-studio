import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const [leads, events] = await Promise.all([
      base44.asServiceRole.entities.Lead.list('created_date'),
      base44.asServiceRole.entities.Event.list('date')
    ]);

    // Find current max studio_id across both leads and events
    const allIds = [
      ...leads.map(l => l.studio_id || 0),
      ...events.map(e => e.studio_id || 0)
    ];
    const maxId = Math.max(0, ...allIds);
    let nextId = maxId + 1;

    let assigned = 0;

    // Step 1: Assign unique IDs to leads that don't have one
    for (const lead of leads) {
      if (!lead.studio_id) {
        await base44.asServiceRole.entities.Lead.update(lead.id, { studio_id: nextId });
        lead.studio_id = nextId;
        nextId++;
        assigned++;
      }
    }

    // Step 2: For events — match to lead using reliable unique identifiers only
    for (const event of events) {
      if (!event.studio_id) {
        let matchedLead = null;

        // Priority 1: source_lead_id (most reliable)
        if (event.source_lead_id) {
          matchedLead = leads.find(l => l.id === event.source_lead_id) || null;
        }

        // Priority 2: leadId field (old-style)
        if (!matchedLead && event.leadId) {
          matchedLead = leads.find(l => l.id === event.leadId) || null;
        }

        // Priority 3: exact match on both coupleNames AND date (never name alone)
        if (!matchedLead && event.coupleNames && event.date) {
          const candidates = leads.filter(
            l => l.coupleNames === event.coupleNames && l.eventDate === event.date
          );
          // Only use if exactly one match (no ambiguity)
          if (candidates.length === 1) {
            matchedLead = candidates[0];
          }
        }

        if (matchedLead?.studio_id) {
          const updateData = { studio_id: matchedLead.studio_id };
          if (!event.source_lead_id && matchedLead.id) updateData.source_lead_id = matchedLead.id;
          if (!event.leadId && matchedLead.id) updateData.leadId = matchedLead.id;
          await base44.asServiceRole.entities.Event.update(event.id, updateData);
          assigned++;
        } else {
          // No matching lead — give event its own unique ID
          await base44.asServiceRole.entities.Event.update(event.id, { studio_id: nextId });
          nextId++;
          assigned++;
        }
      }
    }

    return Response.json({ success: true, assigned, nextId });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});