import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

// Called by entity automation when a Lead is updated
// Syncs key fields to the linked Event
Deno.serve(async (req) => {
  try {
    const body = await req.json();
    console.log('[syncLeadToEvent] Received payload:', JSON.stringify(body).substring(0, 500));
    const base44 = createClientFromRequest(req);
    
    // Support automation format (body.data) and direct call (body.leadId)
    let leadData = body.data;
    if (!leadData?.id && body.leadId) {
      console.log('[syncLeadToEvent] Fetching lead by leadId:', body.leadId);
      const lead = await base44.asServiceRole.entities.Lead.filter({ id: body.leadId });
      leadData = lead[0] || null;
    }
    if (!leadData?.id) {
      console.log('[syncLeadToEvent] No lead data found. body.data:', body.data, 'body.leadId:', body.leadId);
      return Response.json({ skipped: 'no lead data' });
    }
    console.log('[syncLeadToEvent] Lead found:', leadData.id, 'coupleNames:', leadData.coupleNames, 'status:', leadData.status);

    // GUARD: ONLY "נסגר/חתימה" may create or sync Events.
    // All other statuses — including "חוזה" — are blocked.
    const ELIGIBLE_STATUS = 'נסגר/חתימה';
    if (leadData.status !== ELIGIBLE_STATUS) {
      console.log(`[syncLeadToEvent] Skipping — lead status "${leadData.status}" is not eligible for Event creation/sync. Only "${ELIGIBLE_STATUS}" is allowed.`);
      return Response.json({ skipped: `status_blocked: ${leadData.status}` });
    }
    
    // Find linked event — source_lead_id is the ONLY canonical link field
    const bySourceLeadId = leadData.id
      ? await base44.asServiceRole.entities.Event.filter({ source_lead_id: leadData.id })
      : [];

    // GUARD: if multiple events found for same lead (should never happen), use first and log error
    if (bySourceLeadId.length > 1) {
      console.error(`[syncLeadToEvent] CRITICAL: ${bySourceLeadId.length} events found for lead ${leadData.id}. Using first. Event IDs: ${bySourceLeadId.map(e => e.id).join(', ')}`);
    }

    let linkedEvent = bySourceLeadId[0] || null;

    // If no linked event exists, CREATE ONE
    if (!linkedEvent) {
      console.log(`[syncLeadToEvent] No linked event found. Creating new Event for lead ${leadData.id}`);
      // Look up totalCrewCount from package
      let newRequiredCrew = leadData.requiredCrew || 3;
      if (leadData.packageChoice) {
        try {
          const pkgs = await base44.asServiceRole.entities.Package.list();
          const matchedPkg = pkgs.find(p => p.name === leadData.packageChoice);
          if (matchedPkg?.totalCrewCount) {
            newRequiredCrew = matchedPkg.totalCrewCount;
            console.log('[syncLeadToEvent] Package found:', matchedPkg.name, '-> requiredCrew:', newRequiredCrew);
          }
        } catch (pkgErr) {
          console.log('[syncLeadToEvent] Error fetching packages:', pkgErr.message);
        }
      }
      const newEventData = {
        source_lead_id: leadData.id,
        leadId: leadData.id,
        coupleNames: leadData.coupleNames || 'Unknown',
        date: leadData.eventDate || '2000-01-01',
        studio_id: leadData.studio_id || 0,
        totalAmountGross: leadData.finalPrice || 0,
        venue: leadData.venueName || '',
        phoneNumber: leadData.phoneNumber || '',
        packageId: leadData.packageId || null,
        requiredCrew: newRequiredCrew,
      };
      linkedEvent = await base44.asServiceRole.entities.Event.create(newEventData);
      console.log(`[syncLeadToEvent] Created new event ${linkedEvent.id} for lead ${leadData.id}`);
      // Also update linked_event_id on the lead for consistency
      await base44.asServiceRole.entities.Lead.update(leadData.id, { linked_event_id: linkedEvent.id });
    }

    // Sync key fields from lead to event
    const syncData = {};
    syncData.leadId = leadData.id;
    syncData.source_lead_id = leadData.id;
    if (leadData.coupleNames) syncData.coupleNames = leadData.coupleNames;
    if (leadData.eventDate) syncData.date = leadData.eventDate;
    if (leadData.venueName) syncData.venue = leadData.venueName;
    if (leadData.phoneNumber) syncData.phoneNumber = leadData.phoneNumber;
    if (leadData.finalPrice) syncData.totalAmountGross = leadData.finalPrice;
    if (leadData.studio_id) syncData.studio_id = leadData.studio_id;
    if (leadData.packageId) syncData.packageId = leadData.packageId;

    // Look up the package by name to get totalCrewCount
    let requiredCrew = leadData.requiredCrew || 3;
    if (leadData.packageChoice) {
      try {
        const packages = await base44.asServiceRole.entities.Package.list();
        const matchedPkg = packages.find(p => p.name === leadData.packageChoice);
        if (matchedPkg?.totalCrewCount) {
          requiredCrew = matchedPkg.totalCrewCount;
          console.log('[syncLeadToEvent] Package found:', matchedPkg.name, '-> requiredCrew:', requiredCrew);
        }
      } catch (pkgErr) {
        console.log('[syncLeadToEvent] Error fetching packages:', pkgErr.message);
      }
    }
    syncData.requiredCrew = requiredCrew;

    await base44.asServiceRole.entities.Event.update(linkedEvent.id, syncData);

    return Response.json({ success: true, eventId: linkedEvent.id, synced: Object.keys(syncData) });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});