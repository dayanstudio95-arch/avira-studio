// Single source of truth for resolving a staff member's cost for a specific
// event-team role slot (events.team[].role -- see EVENT_TEAM_ROLES in
// staffRoles.js). Checks the staff member's per-role override
// (staff_members.ratesByRole, e.g. a different rate for photographer2 vs
// photographer1) first, falling back to their defaultRate.
//
// Previously this exact lookup was correctly duplicated ad-hoc in
// EventsTableWithBulkDelete.jsx's StaffPickerCell + editor Popover and
// MobileStaffAssignmentSheet.jsx's editor Popover -- but silently NOT applied
// at all (defaultRate only, ratesByRole ignored) at three other assignment
// sites: StaffScheduling.jsx, EditEvent.jsx and ExpensesStep.jsx. Use this
// helper at every site that snapshots a rate into events.team[].cost instead
// of re-deriving the lookup inline, so they can't drift apart again.
export function getStaffRateForRole(staff, roleKey) {
  if (!staff) return 0;
  if (staff.ratesByRole && staff.ratesByRole.length > 0) {
    const override = staff.ratesByRole.find((r) => r.role === roleKey);
    if (override) return override.rate;
  }
  return staff.defaultRate || 0;
}

// A crew member whose stored cost is ₪0 although it shouldn't be (2026-10-23): the net
// profit counts the stored cost, so a ₪0 makes it look higher (12 events came over from
// Base44 like that). null when 0 is expected — not on the staff list, a staff row with no
// price at all (the owner himself, "אין וידאו"), or a one-time member (the price was typed).
//   { kind: "zero", rate } — the staff list has a price for this slot
//   { kind: "no_rate" }    — he has prices, but not for this slot (e.g. a צלם 2 as צלם 1)
export function crewCostWarning(member, staffList) {
  if (!member?.staffMemberName || member.isTemporary) return null;
  if (Number(member.cost) > 0) return null;
  const name = String(member.staffMemberName).trim();
  const staff = (staffList || []).find((s) => String(s.name || "").trim() === name);
  if (!staff) return null;
  const rate = Number(getStaffRateForRole(staff, member.role)) || 0;
  if (rate > 0) return { kind: "zero", rate };
  const hasAnyRate = Number(staff.defaultRate) > 0 || (staff.ratesByRole || []).some((r) => Number(r.rate) > 0);
  return hasAnyRate ? { kind: "no_rate" } : null;
}
