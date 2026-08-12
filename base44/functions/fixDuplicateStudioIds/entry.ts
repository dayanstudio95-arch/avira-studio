import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dryRun !== false; // default: dry run

    const leads = await base44.asServiceRole.entities.Lead.list('created_date');
    let events = await base44.asServiceRole.entities.Event.list();

    // Group leads by studio_id — find duplicates
    const byStudioId = {};
    for (const lead of leads) {
      if (!lead.studio_id) continue;
      if (!byStudioId[lead.studio_id]) byStudioId[lead.studio_id] = [];
      byStudioId[lead.studio_id].push(lead);
    }

    const duplicateGroups = Object.entries(byStudioId)
      .filter(([, group]) => group.length > 1);

    const report = [];
    let fixed = 0;
    let nextId = Math.max(0, ...leads.map(l => l.studio_id || 0), ...events.map(e => e.studio_id || 0)) + 1;

    for (const [studioId, group] of duplicateGroups) {
      // Sort by created_date ascending — keep oldest as "primary"
      group.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
      const duplicates = group.slice(1); // skip first (primary)

      for (const dup of duplicates) {
        const action = {
          studioId,
          newStudioId: nextId,
          leadId: dup.id,
          coupleNames: dup.coupleNames,
          currentLinkedEventId: dup.linked_event_id || null,
          status: dryRun ? 'dry_run' : 'pending',
        };

        if (!dryRun) {
          // Step 1: Assign new unique studio_id and reset calendar/event links
          await base44.asServiceRole.entities.Lead.update(dup.id, {
            studio_id: nextId,
            linked_event_id: null,
            googleCalendarEventId: null,
            googleCalendarStatus: null,
          });

          // Step 2: Re-fetch fresh events list
          events = await base44.asServiceRole.entities.Event.list();

          // Step 3: Find or create event for this lead using reliable unique IDs only
          let eventEntity = events.find(e => e.source_lead_id === dup.id)
            || events.find(e => e.leadId === dup.id);

          // Match by coupleNames + date only if exactly one result
          if (!eventEntity && dup.coupleNames && dup.eventDate) {
            const candidates = events.filter(
              e => e.coupleNames === dup.coupleNames && e.date === dup.eventDate
                && e.source_lead_id !== group[0].id // don't steal primary's event
            );
            if (candidates.length === 1) eventEntity = candidates[0];
          }

          if (!eventEntity) {
            eventEntity = await base44.asServiceRole.entities.Event.create({
              coupleNames: dup.coupleNames,
              date: dup.eventDate || new Date().toISOString().split("T")[0],
              phoneNumber: dup.phoneNumber,
              venue: dup.venueName || "",
              totalAmountGross: dup.finalPrice || dup.basePrice || 0,
              clientPaymentStatus: "Unpaid",
              notes: `הומר מליד (תוקן כפילות) | ${dup.notes || ""}`,
              studio_id: nextId,
              source_lead_id: dup.id,
            });
            action.eventCreated = true;
          } else {
            action.eventCreated = false;
          }

          // Step 4: Link lead to event
          await base44.asServiceRole.entities.Lead.update(dup.id, {
            linked_event_id: eventEntity.id,
          });

          // Step 5: Sync to Google Calendar via syncEventToCalendar
          try {
            await base44.asServiceRole.functions.invoke('syncEventToCalendar', { eventId: eventEntity.id });
            action.calendarSynced = true;
          } catch (calErr) {
            action.calendarSynced = false;
            action.calendarError = calErr.message;
          }

          action.status = 'fixed';
          fixed++;
          nextId++;
        } else {
          nextId++;
        }

        report.push(action);
      }
    }

    return Response.json({
      success: true,
      dryRun,
      duplicateGroupsFound: duplicateGroups.length,
      leadsAffected: report.length,
      fixed,
      report,
    });

  } catch (error) {
    console.error('[fixDuplicateStudioIds] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});