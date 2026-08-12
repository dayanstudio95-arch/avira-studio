import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  // Optional filters from request body
  let filters = {};
  try { filters = await req.json(); } catch (_) {}
  const filterStaff = filters.staffName?.trim() || null;
  const filterYear  = filters.year  ? String(filters.year)  : null;
  const filterMonth = filters.month ? String(filters.month).padStart(2, '0') : null;

  // Load all data
  const [staffMembers, events] = await Promise.all([
    base44.entities.StaffMember.list(),
    base44.entities.Event.list('-date'),
  ]);

  // Build a lookup map: staffName → StaffMember record
  const staffByName = {};
  for (const s of staffMembers) {
    if (s.name) staffByName[s.name] = s;
  }

  // Helper: get expected rate for a staff member + role
  function getExpectedRate(staffMember, role) {
    if (!staffMember) return null;
    const ratesByRole = staffMember.ratesByRole || [];
    const match = ratesByRole.find(r => r.role === role);
    if (match && match.rate > 0) return { rate: match.rate, source: 'ratesByRole' };
    const def = staffMember.defaultRate || 0;
    if (def > 0) return { rate: def, source: 'defaultRate' };
    return null; // No valid rate defined — skip
  }

  const mismatches = [];

  for (const event of events) {
    // Apply date filters early
    if (filterYear && !(event.date || '').startsWith(filterYear)) continue;
    if (filterMonth && filterYear) {
      const ym = `${filterYear}-${filterMonth}`;
      if (!(event.date || '').startsWith(ym)) continue;
    }

    const team = event.team || [];
    for (const member of team) {
      const name = member.staffMemberName;
      const role = member.role;
      const storedCost = member.cost ?? 0;

      if (!name || !role) continue;
      if (filterStaff && name !== filterStaff) continue;

      const staffMember = staffByName[name];
      if (!staffMember) continue;

      const expected = getExpectedRate(staffMember, role);
      if (!expected) continue;

      if (storedCost === 0) {
        mismatches.push({
          event_id: event.id,
          event_date: event.date,
          couple_names: event.coupleNames,
          staff_name: name,
          role: role,
          stored_cost: 0,
          expected_rate: expected.rate,
          rate_source: expected.source,
          reason: expected.source === 'ratesByRole'
            ? `Role "${role}" has rate ${expected.rate} in ratesByRole but event cost is 0`
            : `defaultRate is ${expected.rate} but event cost is 0`,
        });
      }
    }
  }

  // ── Aggregate statistics ──────────────────────────────────────────────────

  // Affected staff members
  const affectedStaff = {};
  for (const m of mismatches) {
    if (!affectedStaff[m.staff_name]) affectedStaff[m.staff_name] = 0;
    affectedStaff[m.staff_name]++;
  }

  // Affected events
  const affectedEvents = {};
  for (const m of mismatches) {
    if (!affectedEvents[m.event_id]) {
      affectedEvents[m.event_id] = {
        event_id: m.event_id,
        event_date: m.event_date,
        couple_names: m.couple_names,
        mismatch_count: 0,
      };
    }
    affectedEvents[m.event_id].mismatch_count++;
  }

  // Date range analysis
  const dates = mismatches
    .map(m => m.event_date)
    .filter(Boolean)
    .sort();
  const earliest = dates[0] || null;
  const latest = dates[dates.length - 1] || null;

  // Month distribution
  const byMonth = {};
  for (const m of mismatches) {
    if (!m.event_date) continue;
    const month = m.event_date.slice(0, 7);
    if (!byMonth[month]) byMonth[month] = 0;
    byMonth[month]++;
  }

  // Role distribution
  const byRole = {};
  for (const m of mismatches) {
    if (!byRole[m.role]) byRole[m.role] = 0;
    byRole[m.role]++;
  }

  // Pattern analysis
  let patternNote = '';
  const monthKeys = Object.keys(byMonth).sort();
  if (monthKeys.length === 1) {
    patternNote = `All mismatches are concentrated in ${monthKeys[0]}.`;
  } else if (monthKeys.length <= 3) {
    patternNote = `Mismatches span ${monthKeys.length} months: ${monthKeys.join(', ')}.`;
  } else {
    patternNote = `Mismatches are spread across ${monthKeys.length} months from ${earliest} to ${latest}.`;
  }

  const staffNames = Object.keys(affectedStaff);
  if (staffNames.length === 1) {
    patternNote += ` All mismatches belong to a single staff member: ${staffNames[0]}.`;
  }

  return Response.json({
    read_only: true,
    audit_timestamp: new Date().toISOString(),
    summary: {
      total_mismatches: mismatches.length,
      affected_staff_count: staffNames.length,
      affected_event_count: Object.keys(affectedEvents).length,
      date_range: { earliest, latest },
      by_month: byMonth,
      by_role: byRole,
      pattern_note: patternNote,
    },
    affected_staff: affectedStaff,
    affected_events: Object.values(affectedEvents).sort((a, b) => (a.event_date || '').localeCompare(b.event_date || '')),
    mismatches: mismatches.sort((a, b) => (a.event_date || '').localeCompare(b.event_date || '')),
  });
});