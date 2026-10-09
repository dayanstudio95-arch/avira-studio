import { expectedSplit, eventDay } from "@/lib/missingTeam";
import { formatDateWithWeekday } from "@/lib/chatModel";

// Staff in the chat app (2026-10-09, the owner's design, approved with these rules):
// a crew member's slots, "which events are missing my slot", one availability link for
// several events, and the history to assign from. Pure — tested in PART 47.

export const SLOT_OPTIONS = [
  { value: "photographer1", label: "צלם 1 · ראשי", jobRole: "photographer", messageLabel: "צלם ראשי (צלם 1)" },
  { value: "photographer2", label: "צלם 2 · ערב", jobRole: "photographer", messageLabel: "צלם ערב (צלם 2)" },
  { value: "videographer", label: "וידאו 1 · יום מלא", jobRole: "videographer", messageLabel: "צלם וידאו יום מלא (וידאו 1)" },
  { value: "videographer2", label: "וידאו 2 · ערב", jobRole: "videographer", messageLabel: "צלם וידאו ערב (וידאו 2)" },
];
export const slotOption = (slot) => SLOT_OPTIONS.find((s) => s.value === slot) || null;

const named = (m) => !!String(m?.staffMemberName || "").trim();

// Does this event's package need this slot at all? (a one-photographer package never needs
// a צלם 2) — the same split the rest of the system uses (expectedSplit).
export function slotNeeded(event, slot, pkg) {
  const want = expectedSplit(event, pkg);
  if (slot === "photographer1") return want.photo >= 1;
  if (slot === "photographer2") return want.photo >= 2;
  if (slot === "videographer") return want.video >= 1;
  if (slot === "videographer2") return want.video >= 2;
  return false;
}

export function slotFilled(event, slot) {
  return (event?.team || []).some((m) => m?.role === slot && named(m));
}

// Upcoming events whose package needs `slot` and nobody holds it, oldest first. Events this
// person is already on are left out; a day he works another wedding is flagged (busyThatDay).
export function eventsMissingSlot({ events, slot, today, packagesById = {}, staffName = "" }) {
  const name = String(staffName || "").trim();
  const busyDays = new Set(
    (events || []).filter((e) => (e.team || []).some((m) => named(m) && m.staffMemberName === name)).map(eventDay)
  );
  return (events || [])
    .filter((e) => eventDay(e) && eventDay(e) >= today)
    .filter((e) => slotNeeded(e, slot, packagesById[e.packageId]) && !slotFilled(e, slot))
    .filter((e) => !(e.team || []).some((m) => named(m) && m.staffMemberName === name))
    .map((e) => ({ event: e, busyThatDay: !!name && busyDays.has(eventDay(e)) }))
    .sort((a, b) => eventDay(a.event).localeCompare(eventDay(b.event)));
}

const line = (e) =>
  `• ${formatDateWithWeekday(eventDay(e))}${e.venue ? ` · ${e.venue}` : ""}${e.coupleNames ? ` · ${e.coupleNames}` : ""}`;

// The availability request for several events: one message, one link.
export function batchAvailabilityMessage({ name, slot, events, link }) {
  const first = String(name || "").split(" ")[0];
  const who = slotOption(slot)?.messageLabel || "צלם";
  return [
    `היי${first ? ` ${first}` : ""}! רציתי לבדוק זמינות שלך בתור ${who} לאירועים הבאים:`,
    ...(events || []).map(line),
    "",
    "אפשר לסמן לכל אירוע פנוי / לא פנוי כאן:",
    link || "{{link}}",
  ].join("\n");
}

// "You're booked" for several events in one message.
export function combinedBookingMessage({ name, items }) {
  const first = String(name || "").split(" ")[0];
  return [
    `היי${first ? ` ${first}` : ""} 👋 שובצת לאירועים הבאים:`,
    ...(items || []).map(({ event, slot }) => `${line(event)} — ${slotOption(slot)?.label || slot}`),
    "",
    "תאשר/י ב-👍 בבקשה",
  ].join("\n");
}

// Every availability request to this person, the latest per wedding, with what it means now:
// assigned (on that event's team) / available / declined / pending. `unnotified` = assigned
// from here but the "you're booked" message has not been sent yet.
export function availabilityHistory({ requests, eventsById = {}, eventsByLead = {}, staffName = "" }) {
  const name = String(staffName || "").trim();
  const sorted = [...(requests || [])]
    .filter((r) => !r.revokedAt)
    .sort((a, b) => String(b.requestedAt || "").localeCompare(String(a.requestedAt || "")));
  const seen = new Set();
  const rows = [];
  for (const r of sorted) {
    const event = (r.eventId && eventsById[r.eventId]) || (r.leadId && eventsByLead[r.leadId]) || null;
    const key = event?.id || `lead:${r.leadId || r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const onTeam = event ? (event.team || []).find((m) => named(m) && m.staffMemberName === name) : null;
    const state = onTeam ? "assigned" : r.status === "available" ? "available" : r.status === "declined" ? "declined" : "pending";
    rows.push({
      request: r,
      event,
      date: String(event?.date || r.eventDateSnapshot || "").slice(0, 10),
      state,
      assignedSlot: onTeam?.role || null,
      unnotified: state === "assigned" && !!r.assignedAt && !r.bookingNotifiedAt,
    });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}
