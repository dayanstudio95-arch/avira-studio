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
