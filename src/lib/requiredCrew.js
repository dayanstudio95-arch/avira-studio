// How many crew an event needs (decision D2, UI cleanup U4): the number of its package, copied to
// events.required_crew when the event is made (the lead's package — sync-lead-to-event, the couple's signing —
// or the package picked in the calendar's add / edit dialog). There is no default size any more (it was 3
// everywhere): an event without that number is never "missing crew" — it shows how many are assigned, nothing more.
//
// "חסר צוות" — ONE rule for every screen (work order item 29, Avira §12יט "כלל אחד"): the sidebar, the dashboard
// card, the Events list, the staff scheduling page and the tables all count the crew with `assignedCrewCount`:
// - the shooting crew only: the editor's row (role 'editor') is not crew on the day;
// - a row counts when it has a name; a name like "אין וידאו" is a deliberate "not needed" and fills its slot;
// - the day is Israel's (src/lib/dates.js isUrgentStaffing, today's event included).
// No imports on purpose (src/lib/dates.js imports this file).

/** The event's required crew, or null when it has none. @param {any} event */
export function requiredCrewOf(event) {
  const n = Number(event?.requiredCrew ?? event?.required_crew);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/** A team row with a name (spaces alone are no name). @param {any} m */
export const isNamedCrewRow = (m) => !!m && typeof m === "object" && String(m.staffMemberName ?? "").trim() !== "";

/** The shooting crew on an event: named rows, the editor's left out. @param {any} event */
export function crewRows(event) {
  const team = Array.isArray(event?.team) ? event.team : [];
  return team.filter((m) => isNamedCrewRow(m) && m.role !== "editor");
}

/** How many of the shooting crew are assigned. @param {any} event */
export function assignedCrewCount(event) {
  return crewRows(event).length;
}

/**
 * The crew picture of an event with `assigned` people on it: `required` (null = not set), how many are `missing`
 * and whether it is `full` (an event without a number is never short).
 * @param {any} event @param {number} assigned
 */
export function crewStatus(event, assigned) {
  const required = requiredCrewOf(event);
  const missing = required === null ? 0 : Math.max(0, required - assigned);
  return { required, missing, full: missing === 0 };
}

/** crewStatus with the one count (assignedCrewCount) — what every screen shows. @param {any} event */
export function eventCrewStatus(event) {
  const assigned = assignedCrewCount(event);
  return { ...crewStatus(event, assigned), assigned };
}

const PHOTO_SLOTS = ["photographer1", "photographer2"];
const VIDEO_SLOTS = ["videographer", "videographer2"];

/**
 * Which roles are missing ("צלם", "וידאו", "2 צלמים"…). The split comes ONLY from the event's package
 * (packages.photographers / .videographers) — Studio Plan guesses no split from the crew size (decision D2, U4;
 * Avira's "3 = 2 + 1" is not ported). Without a package split, or when it does not explain the gap, it says how
 * many are missing ("2 אנשי צוות"). Nothing missing → [].
 * @param {any} event @param {{photographers?: number, videographers?: number}|null} [pkg]
 */
export function missingRoles(event, pkg = null) {
  const { missing } = eventCrewStatus(event);
  if (missing <= 0) return [];
  const out = [];
  const photoWant = Number(pkg?.photographers);
  const videoWant = Number(pkg?.videographers);
  if (pkg && (photoWant > 0 || videoWant > 0)) {
    const rows = crewRows(event);
    const p = (Number.isFinite(photoWant) ? photoWant : 0) - rows.filter((m) => PHOTO_SLOTS.includes(m.role)).length;
    const v = (Number.isFinite(videoWant) ? videoWant : 0) - rows.filter((m) => VIDEO_SLOTS.includes(m.role)).length;
    if (p === 1) out.push("צלם");
    if (p > 1) out.push(`${p} צלמים`);
    if (v === 1) out.push("וידאו");
    if (v > 1) out.push(`${v} וידאו`);
  }
  if (!out.length) out.push(missing === 1 ? "איש צוות אחד" : `${missing} אנשי צוות`);
  return out;
}

/**
 * The notes to show on an event while booking crew (work order item 29): the event's own and its lead's — notes are
 * often written only on the lead ("ביקשו את דודו"). The same text once; both when they differ.
 * @param {any} eventNotes @param {any} leadNotes
 */
export function combinedNotes(eventNotes, leadNotes) {
  const a = String(eventNotes || "").trim();
  const b = String(leadNotes || "").trim();
  if (!a) return b;
  if (!b || a.includes(b)) return a;
  if (b.includes(a)) return b;
  return `${a}\n${b}`;
}

/**
 * "שיבוץ צוות"'s three tiles (work order item 30, Avira §12כ): the events from today on (Israel day) — all of them,
 * the ones short of crew, and the ones whose package crew is complete (an event without a crew size is in neither of
 * the last two: nothing says what it needs). The page's own rule (eventCrewStatus). Pure.
 * @param {any[]} events @param {string} today 'YYYY-MM-DD' @param {(v: any) => string|null} [keyOf] an event date → its
 *   'YYYY-MM-DD' (the page passes dates.js dateKey; this file imports nothing)
 */
export function staffingPageStats(events, today, keyOf = (v) => String(v || "").slice(0, 10)) {
  const out = { upcoming: 0, missing: 0, full: 0 };
  for (const e of events || []) {
    const k = String(keyOf(e?.date) || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || k < today) continue;
    out.upcoming += 1;
    const crew = eventCrewStatus(e);
    if (crew.required === null) continue;
    if (crew.full) out.full += 1;
    else out.missing += 1;
  }
  return out;
}
