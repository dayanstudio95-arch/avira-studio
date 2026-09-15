import { getStaffRateForRole } from "@/lib/staffRates";

// "Find a replacement" (2026-09-15): a booked photographer or videographer drops out,
// and one click asks everyone in that role whether they are free on the event's date.
//
// Pure functions, tested in scripts/test-whatsapp-bot.mjs (PART 8). The owner's
// decision: everyone in the role is pre-ticked and he unticks — so the only judgement
// this file makes is WHO NOT TO PRE-TICK, and it says why, because a name that is
// unticked for no visible reason looks like a bug.

// Who is booked on a given date in any slot, by name. events.team has no staff id —
// assignment has always been by name — so this matches the way every picker matches.
export function namesBookedOnDate(events, date, exceptEventId = null) {
  const names = new Set();
  for (const e of events || []) {
    if (!e || e.date !== date) continue;
    if (exceptEventId && e.id === exceptEventId) continue;
    for (const m of e.team || []) {
      if (m?.staffMemberName) names.add(m.staffMemberName);
    }
  }
  return names;
}

// Returns [{ staff, preselected, reason }] for every staff member in `jobRole`
// (photographer | videographer). `reason` is a short Hebrew label for the row, null
// when the person is pre-ticked.
export function pickReplacementCandidates({
  staffMembers,
  jobRole,
  eventTeam,
  eventsOnDate,
  eventId,
  eventDate,
  excludeName,
}) {
  const inThisTeam = new Set((eventTeam || []).map((m) => m?.staffMemberName).filter(Boolean));
  const bookedElsewhere = namesBookedOnDate(eventsOnDate, eventDate, eventId);

  return (staffMembers || [])
    .filter((s) => s && s.role === jobRole)
    .map((staff) => {
      let reason = null;
      if (!staff.phoneNumber) reason = "אין טלפון";
      else if (excludeName && staff.name === excludeName) reason = "זה מי שביטל";
      else if (inThisTeam.has(staff.name)) reason = "כבר משובץ כאן";
      else if (bookedElsewhere.has(staff.name)) reason = "משובץ באירוע אחר באותו יום";
      return { staff, preselected: reason === null, reason };
    });
}

// Puts `staffMember` into `roleSlot` on a copy of `team`, replacing whoever held the
// slot. The cost is snapshotted the same way every other assignment site does it
// (getStaffRateForRole). Other slots are untouched — the same person can legitimately
// hold two slots on two events, and this never reaches across.
export function buildTeamWithAssignment(team, roleSlot, staffMember) {
  const cost = getStaffRateForRole(staffMember, roleSlot);
  const next = (team || []).filter((m) => m?.role !== roleSlot);
  next.push({
    role: roleSlot,
    staffMemberName: staffMember.name,
    cost,
    isPaid: false,
    progressStatus: "pending",
  });
  return next;
}
