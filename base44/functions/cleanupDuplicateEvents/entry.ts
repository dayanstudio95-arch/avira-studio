import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const allEvents = await base44.asServiceRole.entities.Event.list();

    // Cutoff date: 27/3/2026
    const cutoffDate = new Date('2026-03-27T00:00:00Z').getTime();

    let deletedCount = 0;
    const deletedIds = [];

    for (const event of allEvents) {
      // Only target events with no source_lead_id
      if (event.source_lead_id) continue;

      // Keep events created on or after 27/3/2026
      const createdTime = event.created_date ? new Date(event.created_date).getTime() : 0;
      if (createdTime >= cutoffDate) continue;

      // Delete this old event
      console.log(`[cleanup] deleting event ${event.id} (created: ${event.created_date || 'unknown'})`);
      await base44.asServiceRole.entities.Event.delete(event.id);
      deletedIds.push(event.id);
      deletedCount++;
      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`[cleanup] Done. Deleted ${deletedCount} old events without source_lead_id.`);

    return Response.json({
      success: true,
      deletedCount,
      deletedIds,
    });
  } catch (error) {
    console.error('[cleanupDuplicateEvents] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});