import { base44 } from "@/api/base44Client";
import { sendCalendarInviteByName } from "@/lib/calendarInvites";
import { buildTeamWithAssignment } from "@/lib/staffReplacement";
import { bookedElsewhere, doubleBookingText } from "@/lib/sameDayCrew";

// The one write path for "put this staff member in this slot on this event", extracted
// from UnifiedSidePanel's assign-from-pill flow (2026-09-15) so the same behaviour is
// reachable from the event side. Writes events.team (the DB trigger in migration 0017
// syncs the calendar on any team change) and then adds the person as an attendee.
//
// Returns the new team so callers that keep an optimistic local copy can set it.
export async function assignStaffToEventSlot({ event, staffMember, roleSlot, currentTeam }) {
  // Never on two weddings the same day (2026-11-09, the owner: "אסור שזה יקרה"): that day's events read fresh — a list
  // on screen may be old or filtered. The database refuses it too (0115); this says it first, in the same words.
  if (roleSlot !== "editor" && event?.date) {
    const sameDay = await base44.entities.Event.filter({ date: String(event.date).slice(0, 10) });
    const booking = bookedElsewhere(sameDay, { date: event.date, eventId: event.id }, staffMember.name);
    if (booking) throw new Error(doubleBookingText(staffMember.name, event.date, booking));
  }
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
