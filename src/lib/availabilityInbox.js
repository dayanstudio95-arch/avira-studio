import { teamRoleSlotsForJobRole } from "@/lib/staffRoles";

// "תשובות זמינות" (2026-10-07): every availability answer for an upcoming event, grouped by
// event, each with what is left to do. Pure — tested in scripts/test-whatsapp-bot.mjs PART 36.
//
// Row states:
//   assigned  — already on that event's team (by name, like everywhere else)
//   decide    — said "פנוי", a slot for their role is still free → assign or "לא צריך"
//   full      — said "פנוי", but their role's slots are taken → "לא צריך"
//   no_event  — said "פנוי", but the lead has no event yet (not signed)
//   dismissed — said "פנוי", owner pressed "לא צריך"
//   closed    — no answer yet, but the owner closed the event ("סגור", 2026-10-09: the team is
//               full, stop waiting) — decision_dismissed_at, plus group_closed_at (0086) so
//               "פתח מחדש" brings back only what "סגור" took out, never a personal "לא צריך"
//   pending / declined — no answer yet / "לא פנוי"
const named = (m) => !!String(m?.staffMemberName || "").trim();

export function buildAvailabilityInbox({ requests, events, today }) {
  const byId = new Map((events || []).map((e) => [e.id, e]));
  const byLead = new Map((events || []).filter((e) => e.sourceLeadId).map((e) => [e.sourceLeadId, e]));
  const sorted = [...(requests || [])]
    .filter((r) => !r.revokedAt && String(r.eventDateSnapshot || "") >= today)
    .sort((a, b) => String(b.requestedAt || b.created_date || "").localeCompare(String(a.requestedAt || a.created_date || "")));

  const groups = new Map();
  const seen = new Set();
  for (const r of sorted) {
    const event = (r.eventId && byId.get(r.eventId)) || (r.leadId && byLead.get(r.leadId)) || null;
    const key = event ? event.id : `lead:${r.leadId || r.id}`;
    const once = `${key}|${r.staffMemberId || r.staffNameSnapshot}`;
    if (seen.has(once)) continue; // the latest answer per person per event
    seen.add(once);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        event,
        leadId: r.leadId || event?.sourceLeadId || null,
        date: String(event?.date || r.eventDateSnapshot || "").slice(0, 10),
        couple: event?.coupleNames || r.coupleNamesSnapshot || "",
        venue: event?.venue || r.venueSnapshot || "",
        rows: [],
      });
    }
    const team = event?.team || [];
    const teamEntry = team.find((m) => named(m) && m.staffMemberName === r.staffNameSnapshot);
    const onTeam = !!teamEntry;
    let state;
    let freeSlots = [];
    if (onTeam) state = "assigned";
    else if (r.status === "declined") state = "declined";
    else if (r.status !== "available") state = r.decisionDismissedAt ? "closed" : "pending";
    else if (r.decisionDismissedAt) state = "dismissed";
    else if (!event) state = "no_event";
    else {
      freeSlots = teamRoleSlotsForJobRole(r.role).filter((slot) => !team.some((m) => m.role === slot && named(m)));
      state = freeSlots.length ? "decide" : "full";
    }
    const defaultSlot = freeSlots.includes(r.teamRole) ? r.teamRole : freeSlots[0] || null;
    groups.get(key).rows.push({ request: r, state, freeSlots, defaultSlot, assignedSlot: teamEntry?.role || null });
  }

  const ORDER = { decide: 0, full: 1, no_event: 2, pending: 3, assigned: 4, declined: 5, dismissed: 6, closed: 7 };
  const list = [...groups.values()].map((g) => ({
    ...g,
    rows: g.rows.sort((a, b) => ORDER[a.state] - ORDER[b.state]),
    toDecide: g.rows.filter((x) => x.state === "decide" || x.state === "full").length,
    waiting: g.rows.filter((x) => x.state === "pending").length,
    closed: reopenRows(g.rows).length,
  }));
  list.sort((a, b) => a.date.localeCompare(b.date));
  return { groups: list, toDecide: list.reduce((n, g) => n + g.toDecide, 0) };
}

// What "פתח מחדש" brings back (2026-10-09): the rows "סגור" closed (group_closed_at). Events
// closed before that column existed have no mark on any row — for them the old rule stays
// (an unanswered row that is dismissed can only come from "סגור"; then every dismissed row).
export function reopenRows(rows) {
  const list = rows || [];
  const marked = list.filter((x) => x.request?.groupClosedAt);
  if (marked.length) return marked;
  if (!list.some((x) => x.state === "closed")) return [];
  return list.filter((x) => (x.state === "closed" || x.state === "dismissed") && !x.request?.groupClosedAt);
}
