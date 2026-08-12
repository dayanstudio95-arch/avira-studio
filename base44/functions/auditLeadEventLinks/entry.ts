import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * auditLeadEventLinks
 * Performs a full audit of Lead <-> Event data integrity.
 * Returns a structured report of all mismatches and anomalies.
 * READ-ONLY — does not modify any data.
 */
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (user?.role !== 'admin') {
    return Response.json({ error: 'Admin only' }, { status: 403 });
  }

  const [allLeads, allEvents] = await Promise.all([
    base44.asServiceRole.entities.Lead.list(),
    base44.asServiceRole.entities.Event.list(),
  ]);

  const report = {
    summary: {},
    issues: [],
  };

  // Build lookup maps
  const eventById = {};
  const eventsBySourceLeadId = {};
  const eventsByStudioId = {};

  for (const ev of allEvents) {
    eventById[ev.id] = ev;
    if (ev.source_lead_id) {
      if (!eventsBySourceLeadId[ev.source_lead_id]) eventsBySourceLeadId[ev.source_lead_id] = [];
      eventsBySourceLeadId[ev.source_lead_id].push(ev);
    }
    if (ev.studio_id) {
      if (!eventsByStudioId[ev.studio_id]) eventsByStudioId[ev.studio_id] = [];
      eventsByStudioId[ev.studio_id].push(ev);
    }
  }

  const leadById = {};
  const leadsByLinkedEventId = {};
  for (const lead of allLeads) {
    leadById[lead.id] = lead;
    if (lead.linked_event_id) {
      if (!leadsByLinkedEventId[lead.linked_event_id]) leadsByLinkedEventId[lead.linked_event_id] = [];
      leadsByLinkedEventId[lead.linked_event_id].push(lead);
    }
  }

  const signedLeads = allLeads.filter(l => l.status === 'נסגר/חתימה');

  // ── Issue 1: Signed lead with no Event ──
  const signedNoEvent = [];
  for (const lead of signedLeads) {
    const linkedEvents = eventsBySourceLeadId[lead.id] || [];
    if (linkedEvents.length === 0) {
      signedNoEvent.push({ leadId: lead.id, coupleNames: lead.coupleNames, eventDate: lead.eventDate });
    }
  }
  report.summary.signed_leads_with_no_event = signedNoEvent.length;
  if (signedNoEvent.length > 0) {
    report.issues.push({ type: 'signed_lead_no_event', severity: 'CRITICAL', items: signedNoEvent });
  }

  // ── Issue 2: Events with no source_lead_id ──
  const eventsNoLead = allEvents
    .filter(ev => !ev.source_lead_id)
    .map(ev => ({ eventId: ev.id, coupleNames: ev.coupleNames, date: ev.date }));
  report.summary.events_with_no_source_lead_id = eventsNoLead.length;
  if (eventsNoLead.length > 0) {
    report.issues.push({ type: 'event_no_source_lead', severity: 'WARNING', items: eventsNoLead });
  }

  // ── Issue 3: Multiple Events pointing to same source_lead_id (duplicates) ──
  const duplicateEvents = [];
  for (const [leadId, evts] of Object.entries(eventsBySourceLeadId)) {
    if (evts.length > 1) {
      const lead = leadById[leadId];
      duplicateEvents.push({
        leadId,
        coupleNames: lead?.coupleNames || '?',
        eventCount: evts.length,
        eventIds: evts.map(e => ({ id: e.id, date: e.date, coupleNames: e.coupleNames })),
      });
    }
  }
  report.summary.leads_with_duplicate_events = duplicateEvents.length;
  if (duplicateEvents.length > 0) {
    report.issues.push({ type: 'duplicate_events_for_lead', severity: 'CRITICAL', items: duplicateEvents });
  }

  // ── Issue 4: Multiple Leads pointing to same Event via linked_event_id ──
  const multiLeadPerEvent = [];
  for (const [eventId, leads] of Object.entries(leadsByLinkedEventId)) {
    if (leads.length > 1) {
      const ev = eventById[eventId];
      multiLeadPerEvent.push({
        eventId,
        eventCoupleNames: ev?.coupleNames || '?',
        leadCount: leads.length,
        leads: leads.map(l => ({ id: l.id, coupleNames: l.coupleNames, status: l.status })),
      });
    }
  }
  report.summary.events_shared_by_multiple_leads = multiLeadPerEvent.length;
  if (multiLeadPerEvent.length > 0) {
    report.issues.push({ type: 'multiple_leads_same_event', severity: 'CRITICAL', items: multiLeadPerEvent });
  }

  // ── Issue 5: linked_event_id on Lead points to Event whose source_lead_id ≠ this lead ──
  const linkedEventMismatch = [];
  for (const lead of allLeads) {
    if (!lead.linked_event_id) continue;
    const ev = eventById[lead.linked_event_id];
    if (!ev) {
      linkedEventMismatch.push({
        leadId: lead.id,
        coupleNames: lead.coupleNames,
        linked_event_id: lead.linked_event_id,
        issue: 'linked event does not exist',
      });
    } else if (ev.source_lead_id && ev.source_lead_id !== lead.id) {
      linkedEventMismatch.push({
        leadId: lead.id,
        leadCoupleNames: lead.coupleNames,
        linked_event_id: lead.linked_event_id,
        eventCoupleNames: ev.coupleNames,
        eventSourceLeadId: ev.source_lead_id,
        issue: 'linked_event_id points to event owned by a different lead',
      });
    }
  }
  report.summary.linked_event_id_mismatches = linkedEventMismatch.length;
  if (linkedEventMismatch.length > 0) {
    report.issues.push({ type: 'linked_event_id_mismatch', severity: 'CRITICAL', items: linkedEventMismatch });
  }

  // ── Issue 6: coupleNames mismatch between Lead and its Event ──
  const nameMismatches = [];
  for (const lead of allLeads) {
    const evts = eventsBySourceLeadId[lead.id] || [];
    for (const ev of evts) {
      const leadName = (lead.coupleNames || '').trim().toLowerCase();
      const evName = (ev.coupleNames || '').trim().toLowerCase();
      if (leadName && evName && leadName !== evName) {
        nameMismatches.push({
          leadId: lead.id,
          leadName: lead.coupleNames,
          eventId: ev.id,
          eventName: ev.coupleNames,
        });
      }
    }
  }
  report.summary.name_mismatches = nameMismatches.length;
  if (nameMismatches.length > 0) {
    report.issues.push({ type: 'name_mismatch', severity: 'WARNING', items: nameMismatches });
  }

  // ── Issue 7: eventDate mismatch between Lead and Event ──
  const dateMismatches = [];
  for (const lead of allLeads) {
    const evts = eventsBySourceLeadId[lead.id] || [];
    for (const ev of evts) {
      if (lead.eventDate && ev.date && lead.eventDate !== ev.date) {
        dateMismatches.push({
          leadId: lead.id,
          coupleNames: lead.coupleNames,
          leadDate: lead.eventDate,
          eventDate: ev.date,
        });
      }
    }
  }
  report.summary.date_mismatches = dateMismatches.length;
  if (dateMismatches.length > 0) {
    report.issues.push({ type: 'date_mismatch', severity: 'INFO', items: dateMismatches });
  }

  report.summary.total_leads = allLeads.length;
  report.summary.total_events = allEvents.length;
  report.summary.total_signed_leads = signedLeads.length;
  report.summary.total_issues = report.issues.length;
  report.summary.has_critical_issues = report.issues.some(i => i.severity === 'CRITICAL');

  return Response.json(report);
});