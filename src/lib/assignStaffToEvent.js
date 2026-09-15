import { base44 } from "@/api/base44Client";
import { sendCalendarInviteByName } from "@/lib/calendarInvites";
import { buildTeamWithAssignment } from "@/lib/staffReplacement";

// The one write path for "put this staff member in this slot on this event", extracted
// from UnifiedSidePanel's assign-from-pill flow (2026-09-15) so the same behaviour is
// reachable from the event side. Writes events.team (the DB trigger in migration 0017
// syncs the calendar on any team change) and then adds the person as an attendee.
//
// Returns the new team so callers that keep an optimistic local copy can set it.
export async function assignStaffToEventSlot({ event, staffMember, roleSlot, currentTeam }) {
  const team = currentTeam ?? (event.team || []);
  const newTeam = buildTeamWithAssignment(team, roleSlot, staffMember);
  await base44.entities.Event.update(event.id, { team: newTeam });
  try {
    await sendCalendarInviteByName(event.id, staffMember.name);
  } catch (e) {
    // The assignment is saved; only the attendee add failed. The calendar page's
    // reconcile job catches this on its next pass, so don't fail the whole action.
    console.warn("Calendar invite after assignment failed:", e?.message || e);
  }
  return newTeam;
}
