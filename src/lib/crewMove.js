// Moving a crew member between two weddings on the same day (2026-10-25, the owner's request):
// from a name in "באותו יום" to a slot on the event being edited. A slot held by someone else is
// a swap — that person takes the mover's old slot (the owner's choice). Pure; PART 70.
import { getStaffRateForRole } from "./staffRates";
import { teamRoleSlotsForJobRole, eventTeamRoleLabel } from "./staffRoles";
import { formatDateWithWeekday } from "./chatModel";
import { renderBookingMessage } from "./staffBooking";

export const MOVE_TEMPLATE_KEY = "template_staff_moved";
export const DEFAULT_MOVE_TEMPLATE = `היי {{name}} 👋
עדכון שיבוץ ל{{event_date}}:
עברת מהאירוע של {{from_names}} ({{from_role}})
לאירוע של {{names}} — {{role}}
📍 {{venue}}
💄 התארגנות: {{prep_location}}
🕐 קבלת פנים: {{checkin_time}}
💍 חופה: {{chuppah_time}}
תאשר/י ב-👍 בבקשה`;

const nm = (s) => String(s || "").trim();
const jobOf = (slot) => (String(slot).startsWith("photographer") ? "photographer" : String(slot).startsWith("videographer") ? "videographer" : slot === "editor" ? "editor" : null);
const slotEntry = (team, slot) => (team || []).find((m) => m?.role === slot && nm(m.staffMemberName));

// The slots on `target` the person in `fromSlot` on `source` could go to, each with:
//   { slot, label, occupant (name|null), canMove, reason, swap (bool) }
export function moveOptions({ source, fromSlot, target, staffMembers }) {
  const mover = slotEntry(source?.team, fromSlot);
  if (!mover) return [];
  const staff = (staffMembers || []).find((s) => nm(s.name) === nm(mover.staffMemberName));
  const job = staff?.role || jobOf(fromSlot);
  const onTargetAlready = (target?.team || []).some((m) => nm(m.staffMemberName) === nm(mover.staffMemberName));
  return teamRoleSlotsForJobRole(job).map((slot) => {
    const occ = slotEntry(target?.team, slot);
    let reason = null;
    if (onTargetAlready) reason = "כבר משובץ באירוע הזה";
    else if (occ) {
      // a swap sends the occupant to the mover's old slot — only if that slot is his kind of job
      // and he isn't on that event already (in another slot)
      const occStaff = (staffMembers || []).find((s) => nm(s.name) === nm(occ.staffMemberName));
      const occJob = occStaff?.role || jobOf(slot);
      if (!teamRoleSlotsForJobRole(occJob).includes(fromSlot)) reason = `${nm(occ.staffMemberName)} לא יכול להיות ${eventTeamRoleLabel(fromSlot)}`;
      else if ((source.team || []).some((m) => nm(m.staffMemberName) === nm(occ.staffMemberName))) reason = `${nm(occ.staffMemberName)} כבר משובץ באירוע של ${source.coupleNames || "האירוע השני"}`;
    }
    return { slot, label: eventTeamRoleLabel(slot), occupant: occ ? nm(occ.staffMemberName) : null, canMove: !reason, reason, swap: !!occ && !reason };
  });
}

const placed = (entry, slot, staff) => ({
  role: slot,
  staffMemberName: nm(entry.staffMemberName),
  // the price is the person's own for the new slot (a one-time member keeps what was typed)
  cost: entry.isTemporary || !staff ? Number(entry.cost) || 0 : getStaffRateForRole(staff, slot),
  isPaid: false,
  progressStatus: "pending",
  ...(entry.isTemporary ? { isTemporary: true, phone: entry.phone || null } : {}),
});

// The two new teams. Throws (Hebrew) when the move no longer fits the events as they are now
// — the caller re-reads both events right before planning.
export function planCrewMove({ source, fromSlot, target, toSlot, staffMembers }) {
  if (!source || !target || source.id === target.id) throw new Error("צריך שני אירועים שונים");
  if (String(source.date).slice(0, 10) !== String(target.date).slice(0, 10)) throw new Error("האירועים לא באותו יום");
  const option = moveOptions({ source, fromSlot, target, staffMembers }).find((o) => o.slot === toSlot);
  if (!option) throw new Error("התפקיד לא מתאים לאיש הצוות");
  if (!option.canMove) throw new Error(option.reason);
  const mover = slotEntry(source.team, fromSlot);
  const occupant = slotEntry(target.team, toSlot);
  const staffOf = (e) => (staffMembers || []).find((s) => nm(s.name) === nm(e?.staffMemberName));

  const targetTeam = (target.team || []).filter((m) => m?.role !== toSlot);
  targetTeam.push(placed(mover, toSlot, staffOf(mover)));
  const sourceTeam = (source.team || []).filter((m) => m?.role !== fromSlot);
  if (occupant) sourceTeam.push(placed(occupant, fromSlot, staffOf(occupant)));

  return {
    sourceTeam,
    targetTeam,
    moved: { name: nm(mover.staffMemberName), staff: staffOf(mover) || null, fromEvent: source, fromSlot, toEvent: target, toSlot },
    swapped: occupant ? { name: nm(occupant.staffMemberName), staff: staffOf(occupant) || null, fromEvent: target, fromSlot: toSlot, toEvent: source, toSlot: fromSlot } : null,
  };
}

// The "you were moved" message for one person (moved or swapped). `lead`: the new event's lead.
export function moveMessage(template, move, lead) {
  const day = String(move.toEvent?.date || "").slice(0, 10);
  const tpl = String(template || "").trim() ? template : DEFAULT_MOVE_TEMPLATE;
  return renderBookingMessage(tpl, {
    name: nm(move.name).split(" ")[0],
    role: eventTeamRoleLabel(move.toSlot),
    names: move.toEvent?.coupleNames || "",
    from_names: move.fromEvent?.coupleNames || "",
    from_role: eventTeamRoleLabel(move.fromSlot),
    event_date: day ? formatDateWithWeekday(day) : "",
    venue: move.toEvent?.venue || lead?.venueName || "",
    prep_location: lead?.productionBridePrepLocation || "",
    checkin_time: lead?.productionCheckinTime || "",
    chuppah_time: lead?.productionChuppahTime || "",
  });
}

// What the person sees when the WhatsApp send fails — never the raw gateway error, which
// carries the Green API URL with the token in it. Mirrors send-event-crew-brief's mapping.
export function friendlySendError(raw) {
  const t = String(raw || "");
  if (/network error|dns|connect|timed? ?out/i.test(t)) return "אין חיבור לשירות הוואטסאפ — נסו שוב בעוד רגע";
  if (/required|settings/i.test(t)) return "הוואטסאפ לא מחובר בהגדרות";
  if (/https?:|waInstance|api\.green-api/i.test(t) || !t) return "שליחת הוואטסאפ נכשלה";
  return t;
}
