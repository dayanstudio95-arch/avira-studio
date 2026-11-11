import { teamRoleSlotsForJobRole } from "@/lib/staffRoles";
import { bookedElsewhere } from "@/lib/sameDayCrew";
import { missingRoles, missingSlots, roleGap } from "@/lib/missingTeam";

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
//   busy      — said "פנוי" (or not yet), but is already on ANOTHER event that day (2026-11-09, the owner: Ayalon
//               "פנוי" for שחר ובן while on קמילה ואסף that day) — no "שבץ", not counted in "צריך החלטה" / "ממתינים";
//               `busy` = { eventId, couple, role }. Not for the editor (works from home).
//   not_needed — no answer yet, or "פנוי" not decided, but nothing is missing for it (2026-11-11, the owner: "אירועים
//               שכבר צוות מלא אז אין צורך בתשובה"): the event's team is full, or the role asked about has no gap by the
//               package split (a photographer on a wedding missing only video). Not counted anywhere, no "סגור", no
//               message to anyone; back by itself when someone leaves the team.
//
// Every upcoming event missing crew is a group too, with no rows when nobody was asked yet ("חסר צוות", 2026-11-11):
// `missing` = the words ("צלם", "וידאו"), `missingSlots` = the empty slots behind them ("זימון לצלם 2").
const named = (m) => !!String(m?.staffMemberName || "").trim();
const PHOTO_SLOTS = ["photographer1", "photographer2"];
const VIDEO_SLOTS = ["videographer", "videographer2"];
const jobOf = (r) =>
  PHOTO_SLOTS.includes(r.teamRole) ? "photo" : VIDEO_SLOTS.includes(r.teamRole) ? "video" : r.role === "photographer" ? "photo" : r.role === "videographer" ? "video" : null;
// Nothing missing for this answer: a full team, or no gap in its role (when the split explains the gap at all).
function notNeeded(need, r) {
  if (!need.missing.length) return true;
  const job = jobOf(r);
  return !!job && need.gap.photo + need.gap.video > 0 && need.gap[job] === 0;
}

export function buildAvailabilityInbox({ requests, events, today, packagesById = {} }) {
  const byId = new Map((events || []).map((e) => [e.id, e]));
  const needs = new Map();
  const need = (event) => {
    if (!event) return { missing: [], slots: [], gap: { photo: 0, video: 0 } };
    if (!needs.has(event.id)) {
      const pkg = packagesById[event.packageId];
      needs.set(event.id, { missing: missingRoles(event, pkg), slots: missingSlots(event, pkg), gap: roleGap(event, pkg) });
    }
    return needs.get(event.id);
  };
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
        missing: need(event).missing,
        missingSlots: need(event).slots,
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
    // Already booked that day on another event: nothing to decide (the database refuses it too, 0115).
    let busy = null;
    if (["decide", "full", "pending", "no_event"].includes(state) && r.teamRole !== "editor" && r.role !== "editor") {
      busy = bookedElsewhere(events, { date: groups.get(key).date, eventId: event?.id }, r.staffNameSnapshot);
      if (busy) {
        state = "busy";
        freeSlots = [];
      }
    }
    // Nothing missing for it any more: no waiting, no decision (back by itself when someone leaves the team).
    if (["pending", "decide", "full"].includes(state) && event && notNeeded(need(event), r)) {
      state = "not_needed";
      freeSlots = [];
    }
    const defaultSlot = freeSlots.includes(r.teamRole) ? r.teamRole : freeSlots[0] || null;
    groups.get(key).rows.push({ request: r, state, freeSlots, defaultSlot, assignedSlot: teamEntry?.role || null, busy });
  }

  // Upcoming events missing crew that nobody was asked about yet.
  for (const e of events || []) {
    const day = String(e?.date || "").slice(0, 10);
    if (!day || day < today || groups.has(e.id) || !need(e).missing.length) continue;
    groups.set(e.id, { key: e.id, event: e, leadId: e.sourceLeadId || null, date: day, couple: e.coupleNames || "", venue: e.venue || "", rows: [], missing: need(e).missing, missingSlots: need(e).slots });
  }

  const ORDER = { decide: 0, full: 1, no_event: 2, pending: 3, assigned: 4, busy: 5, declined: 6, not_needed: 7, dismissed: 8, closed: 9 };
  const list = [...groups.values()].map((g) => ({
    ...g,
    rows: g.rows.sort((a, b) => ORDER[a.state] - ORDER[b.state]),
    toDecide: g.rows.filter((x) => x.state === "decide" || x.state === "full").length,
    waiting: g.rows.filter((x) => x.state === "pending").length,
    closed: reopenRows(g.rows).length,
    isMissing: !!g.event && g.missing.length > 0,
  }));
  list.sort((a, b) => a.date.localeCompare(b.date));
  return {
    groups: list,
    toDecide: list.reduce((n, g) => n + g.toDecide, 0),
    waiting: list.reduce((n, g) => n + g.waiting, 0),
    missing: list.filter((g) => g.isMissing).length,
  };
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
