// The crew picker in the events list (2026-10-15, the owner's request): one scroll, a
// search box, a sensible order, and a one-time ("זמני") crew member saved on the event
// only. Pure — PART 61.

// Which staff_members.role fills an event-team slot.
export function jobRoleForSlot(roleKey) {
  if (String(roleKey || "").startsWith("photographer")) return "photographer";
  if (String(roleKey || "").startsWith("videographer")) return "videographer";
  if (roleKey === "editor") return "editor";
  return null;
}

const norm = (s) => String(s || "").trim().toLowerCase();

// Rows to show: filtered by the search, favourites first, then א-ב, and anyone already
// booked that day (for this slot type) at the end.
export function pickerRows({ staffList, event, events, roleKey, member, search, checkBooked = true }) {
  const q = norm(search);
  const rows = (staffList || [])
    .filter((s) => !q || norm(s.name).includes(q))
    .map((s) => {
      const isSelected = member?.staffMemberName === s.name;
      const isBooked = checkBooked && (events || []).some((e) =>
        e.id !== event?.id && e.date === event?.date &&
        (e.team || []).some((m) => m.staffMemberName === s.name && m.role === roleKey)
      );
      return { staff: s, isSelected, isBooked: isBooked && !isSelected };
    });
  return rows.sort((a, b) =>
    (a.isBooked - b.isBooked) ||
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
