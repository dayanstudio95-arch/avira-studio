// The crew picker in the events list (2026-10-15, the owner's request): one scroll, a
// search box, a sensible order, and a one-time ("זמני") crew member saved on the event
// only. Pure — PART 61.
import { sameDayOthers, bookingsByName, bookingText, isPlaceholder } from "./sameDayCrew";
import { eventTeamRoleLabel } from "./staffRoles";

// Which staff_members.role fills an event-team slot.
export function jobRoleForSlot(roleKey) {
  if (String(roleKey || "").startsWith("photographer")) return "photographer";
  if (String(roleKey || "").startsWith("videographer")) return "videographer";
  if (roleKey === "editor") return "editor";
  return null;
}

const norm = (s) => String(s || "").trim().toLowerCase();

// Rows to show: filtered by the search, favourites first, then א-ב, and anyone already
// booked that day at the end. `bookedText` (2026-10-25): where the person is booked that day —
// "משובץ: נועה ואיתי · צלם 2" — shown under the name. Since 2026-11-09 (the owner: "אסור שזה
// יקרה") being booked that day in ANY slot blocks picking (isBooked) — before, only the same
// slot did, and a צלם 1 elsewhere could be put in as צלם 2. Not for the editor (works from home).
export function pickerRows({ staffList, event, events, roleKey, member, search, checkBooked = true }) {
  const q = norm(search);
  const bookings = checkBooked ? bookingsByName(sameDayOthers(events, { date: event?.date, eventId: event?.id })) : new Map();
  const rows = (staffList || [])
    .filter((s) => !q || norm(s.name).includes(q))
    .map((s) => {
      const isSelected = member?.staffMemberName === s.name;
      // Already on THIS event in another slot (2026-11-09): one person, one slot — "אין סטילס" aside.
      const here = checkBooked && roleKey !== "editor" && !isPlaceholder(s.name)
        ? (event?.team || []).find((m) => m?.role !== roleKey && m?.role !== "editor" && String(m?.staffMemberName || "").trim() === String(s.name || "").trim())
        : null;
      const isBooked = checkBooked && roleKey !== "editor" && (bookings.has(String(s.name || "").trim()) || !!here);
      const bookedText = isSelected ? null : here ? `כבר משובץ כאן · ${eventTeamRoleLabel(here.role)}` : bookingText(bookings, s.name);
      return { staff: s, isSelected, isBooked: isBooked && !isSelected, bookedText };
    });
  return rows.sort((a, b) =>
    (a.isBooked - b.isBooked) ||
    (Number(!!a.bookedText) - Number(!!b.bookedText)) ||
    (Number(!!b.staff.isFavorite) - Number(!!a.staff.isFavorite)) ||
    String(a.staff.name).localeCompare(String(b.staff.name), "he")
  );
}

// Enter in the search box picks the first row that can be picked.
export function firstPickable(rows) {
  return (rows || []).find((r) => !r.isBooked && !r.isSelected) || null;
}

// A one-time crew member, kept on this event's team only (not in the staff list, so no
// availability requests, monthly summaries or pickers on other events).
export function buildTemporaryMember({ roleKey, name, phone, cost }) {
  return {
    role: roleKey,
    staffMemberName: String(name || "").trim(),
    cost: Math.max(0, Number(cost) || 0),
    isPaid: false,
    progressStatus: "pending",
    isTemporary: true,
    phone: String(phone || "").trim() || null,
  };
}

// A temporary name equal to someone in the staff list is that person — choose them instead.
export function temporaryNameProblem(name, staffList) {
  const n = norm(name);
  if (!n) return "כתבו שם";
  if ((staffList || []).some((s) => norm(s.name) === n)) return "יש כבר איש צוות בשם הזה — בחרו אותו מהרשימה";
  return null;
}
