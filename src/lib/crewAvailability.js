// "+ → זמינות צוות" (2026-10-27, the owner's design): pick a role, see every upcoming event
// that is missing it, tick several, pick who to ask — each person gets ONE message with his
// dates and one link (the batch link of 0082). A date he already works another wedding is left
// out of his message. Pure — PART 71.
import { SLOT_OPTIONS, slotOption, eventsMissingSlot } from "./staffAvailabilityBatch";
import { eventDay } from "./missingTeam";

const nm = (s) => String(s || "").trim();
const named = (m) => !!nm(m?.staffMemberName);

// slot → the upcoming events missing it (oldest first), for the role chips and their counts.
export function missingBySlot({ events, today, packagesById = {} }) {
  return Object.fromEntries(
    SLOT_OPTIONS.map((o) => [o.value, eventsMissingSlot({ events, slot: o.value, today, packagesById }).map((r) => r.event)])
  );
}

// The people who can be asked for this slot: his job matches; those who marked this slot as
// theirs (team_slots) first, then the studio's own order.
export function staffForSlot(staffMembers, slot) {
  const job = slotOption(slot)?.jobRole;
  const mine = (s) => (s.teamSlots || []).includes(slot);
  return (staffMembers || [])
    .filter((s) => s.role === job)
    .sort((a, b) => (mine(b) ? 1 : 0) - (mine(a) ? 1 : 0) || (a.orderIndex ?? 999) - (b.orderIndex ?? 999));
}

// For one person and the ticked events: what goes in his message, what is left out (he works
// another wedding that day, or is already on this one), and what he was already asked about.
//   { send: [event], busy: [{ event, where }], asked: [{ event, status }] }
export function planForStaff({ staff, selected, allEvents, requests = [] }) {
  const name = nm(staff?.name);
  const send = [];
  const busy = [];
  const asked = [];
  for (const e of selected || []) {
    const day = eventDay(e);
    const elsewhere = (allEvents || []).find(
      (o) => eventDay(o) === day && (o.team || []).some((m) => named(m) && nm(m.staffMemberName) === name)
    );
    if (elsewhere) {
      busy.push({ event: e, where: elsewhere.id === e.id ? "באירוע הזה" : elsewhere.coupleNames || "אירוע אחר" });
      continue;
    }
    send.push(e);
    const prior = (requests || [])
      .filter((r) => !r.revokedAt && r.staffMemberId === staff.id && r.eventId === e.id && r.status !== "declined")
      .sort((a, b) => String(b.requestedAt || "").localeCompare(String(a.requestedAt || "")))[0];
    if (prior) asked.push({ event: e, status: prior.status });
  }
  return { send, busy, asked };
}

// Who was already asked about this event for this slot (latest answer per person): shown on the
// event row so he doesn't ask the same person twice.
export function askedForEvent(requests, eventId, slot) {
  const latest = new Map();
  for (const r of requests || []) {
    if (r.revokedAt || r.eventId !== eventId || (slot && r.teamRole && r.teamRole !== slot)) continue;
    const cur = latest.get(r.staffMemberId);
    if (!cur || String(r.requestedAt || "") > String(cur.requestedAt || "")) latest.set(r.staffMemberId, r);
  }
  return [...latest.values()].map((r) => ({ name: r.staffNameSnapshot, status: r.status }));
}
