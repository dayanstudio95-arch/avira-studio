// The other weddings on the same day and who is booked there (2026-10-25, the owner's request):
// shown wherever crew is assigned or asked about — the post-sign wizard, the availability check,
// the crew pickers — so he sends and books the right people. Pure.
import { eventTeamRoleLabel } from "./staffRoles";

const ROLE_ORDER = ["photographer1", "photographer2", "videographer", "videographer2", "editor"];
const day = (d) => String(d || "").slice(0, 10);
const name = (m) => String(m?.staffMemberName || "").trim();

/**
 * "אין סטילס" / "אין וידאו" (2026-11-09): on the staff list, but a mark that the couple has no stills / video, not a
 * person — never "busy", may be on several events a day and in two slots. The database says the same (0115).
 */
export const isPlaceholder = (n) => /^אין\s/.test(String(n || "").trim());

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
      if (!name(m) || m.role === "editor" || isPlaceholder(name(m))) continue;
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

// ── No one on two weddings the same day (2026-11-09, the owner: "אסור שזה יקרה") ──────────────────────────────────
// A photographer or videographer on another event that day can't be put on this one, in any slot — every screen shows
// it first, and the database refuses it too (0115_no_same_day_double_booking.sql, the same words). The editor works
// from home: never "busy".

const dayText = (d) => {
  const [y, m, dd] = day(d).split("-");
  return y ? `${Number(dd)}.${Number(m)}.${y}` : "";
};

/** Where this person is already booked that day, other than this event ({ eventId, couple, role }), or null. */
export function bookedElsewhere(events, { date, eventId } = {}, staffName) {
  const list = bookingsByName(sameDayOthers(events, { date, eventId })).get(String(staffName || "").trim());
  return list?.[0] || null;
}

/** The words when it is refused — the database says the same (0115). */
export function doubleBookingText(staffName, date, booking) {
  return `${String(staffName || "").trim()} כבר משובץ/ת ב-${dayText(date)} אצל ${booking?.couple || "אירוע אחר"} (${eventTeamRoleLabel(booking?.role)}). קודם מוציאים אותו משם.`;
}

/**
 * The double bookings already saved (the banner on "שיבוץ צוות"): the same person on two events the same day, not as
 * editor, from `from` ('YYYY-MM-DD') on. [{ date, name, items: [{ eventId, couple, role }] }], by date.
 */
export function sameDayClashes(events, { from = "" } = {}) {
  const byKey = new Map();
  for (const e of events || []) {
    const d = day(e.date);
    if (!d || d < from) continue;
    const seen = new Set();
    for (const m of e.team || []) {
      const n = name(m);
      if (!n || m.role === "editor" || isPlaceholder(n) || seen.has(n)) continue;
      seen.add(n);
      const key = `${d}|${n}`;
      const list = byKey.get(key) || [];
      list.push({ eventId: e.id, couple: e.coupleNames || e.couple_names || "אירוע", role: m.role });
      byKey.set(key, list);
    }
  }
  return [...byKey.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([key, items]) => ({ date: key.split("|")[0], name: key.split("|")[1], items }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, "he"));
}
