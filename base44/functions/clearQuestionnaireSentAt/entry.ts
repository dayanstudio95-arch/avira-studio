import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const allEvents = await base44.asServiceRole.entities.Event.list();
    const aprilEvents = allEvents.filter(e => e.date && e.date >= '2026-04-01' && e.date <= '2026-04-30');

    let cleared = 0;
    for (const event of aprilEvents) {
      if (event.questionnaireSentAt) {
        await base44.asServiceRole.entities.Event.update(event.id, { questionnaireSentAt: null });
        cleared++;
      }
    }

    return Response.json({ success: true, total: aprilEvents.length, cleared });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});