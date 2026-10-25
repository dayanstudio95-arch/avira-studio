// The other weddings on the same day and who is booked there (2026-10-25, the owner's request):
// shown wherever crew is assigned or asked about — the post-sign wizard, the availability check,
// the crew pickers — so he sends and books the right people. Pure.
import { eventTeamRoleLabel } from "./staffRoles";

const ROLE_ORDER = ["photographer1", "photographer2", "videographer", "videographer2", "editor"];
const day = (d) => String(d || "").slice(0, 10);
const name = (m) => String(m?.staffMemberName || "").trim();

// The events that day other than this one.
export function sameDayOthers(events, { date, eventId } = {}) {
  const d = day(date);
  if (!d) return [];
  return (events || []).filter((e) => day(e.date) === d && e.id !== eventId);
}

// An event's crew in role order (the editor last), named slots only.
export function crewByRole(event) {
  return (event?.team || [])
    .filter((m) => name(m))
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
}

// name → [{ eventId, couple, role }] for everyone booked on those events (the editor works
// from home, so he is not "busy" that day).
export function bookingsByName(otherEvents) {
  const map = new Map();
  for (const e of otherEvents || []) {
    for (const m of e.team || []) {
      if (!name(m) || m.role === "editor") continue;
      const list = map.get(name(m)) || [];
      list.push({ eventId: e.id, couple: e.coupleNames || e.couple_names || "אירוע", role: m.role });
      map.set(name(m), list);
    }
  }
  return map;
}

// "משובץ: נועה ואיתי · צלם 1" (several: joined with ", "), or null.
export function bookingText(bookings, staffName) {
  const list = bookings?.get(String(staffName || "").trim());
  if (!list?.length) return null;
  return `משובץ: ${list.map((b) => `${b.couple} · ${eventTeamRoleLabel(b.role)}`).join(", ")}`;
}

// The free ones first (in their own order), then the ones booked that day.
export function freeFirst(staffList, bookings) {
  const free = [];
  const busy = [];
  for (const s of staffList || []) (bookings?.has(String(s.name || "").trim()) ? busy : free).push(s);
  return [...free, ...busy];
}
