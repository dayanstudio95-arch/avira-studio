// Dates in the hub (fix plan P28). Only one import (./requiredCrew.js, itself import-free), so any file (and a plain
// `node` script) can use it.
//
// A studio works on Israel's calendar. An event's date is a plain 'YYYY-MM-DD' day, and every rule
// here compares those strings. `new Date('2026-10-31')` is midnight UTC — 02:00/03:00 in Israel — so
// comparing it with a local "end of month" at 00:00 dropped the 31st from "החודש", a Sunday from
// "השבוע", and today's wedding from "חסר צוות" after 03:00. "Today" is Israel's today, not UTC's
// (toISOString() said yesterday until 03:00) and not the browser's (a laptop abroad).
//
//   israelToday()                      → '2026-10-31' (Asia/Jerusalem)
//   dateKey(value)                     → the Israel day of a 'YYYY-MM-DD', a timestamp or a Date; '' if none
//   addDays(key, n), weekRange(key), monthRange(key, offset), inRange(value, range), yearOf(value)
//   isUrgentStaffing(event, today, 30) → the "חסר צוות" rule, for the sidebar and the list alike
//   formatDateShort / formatDateLong / formatDateTime → '' for a missing or broken date, never 'Invalid Date'

import { assignedCrewCount, requiredCrewOf } from "./requiredCrew.js";

const TZ = "Asia/Jerusalem";
const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
// A date with a time: the day part is taken as is unless the value names its zone (Z or ±hh:mm).
const STAMP_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}(?::?\d{2})?)?$/;

const pad = (n) => String(n).padStart(2, "0");

/** @param {number} y @param {number} m 1-12 @param {number} d */
const keyOf = (y, m, d) => `${String(y).padStart(4, "0")}-${pad(m)}-${pad(d)}`;

/** The calendar day of a UTC-midnight Date made by Date.UTC. @param {Date} d */
const utcKey = (d) => keyOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());

/** 'YYYY-MM-DD' → a UTC-midnight Date, or null for anything that is not a real calendar day (31/02). @param {string} key */
function keyToUtc(key) {
  const m = KEY_RE.exec(String(key || ""));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return utcKey(d) === key ? d : null;
}

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/** Israel wall-clock parts of an instant, or null for an invalid Date. @param {Date} date */
function israelParts(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  /** @type {Record<string, string>} */
  const p = {};
  for (const part of partsFormatter.formatToParts(date)) p[part.type] = part.value;
  return { key: `${p.year}-${p.month}-${p.day}`, time: `${pad(Number(p.hour) % 24)}:${p.minute}` };
}

/** @param {any} value */
function toInstant(value) {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  return null;
}

/**
 * Today in Israel as 'YYYY-MM-DD'.
 * @param {Date|number|string} [now] the moment (default: now)
 */
export function israelToday(now = new Date()) {
  const instant = typeof now === "string" ? new Date(now) : toInstant(now);
  return israelParts(instant || new Date())?.key || israelParts(new Date())?.key || "";
}

/**
 * Israel's midnight of the day `now` is in, as an instant (a Date) — "since this morning" for a database filter
 * (the follow-up pulses' "sent today", work order item 38). Right on both sides of a clock change (the offset is
 * read at the midnight itself). Server twin: israelDayStart in supabase/functions/_shared/whatsappFollowUp.ts.
 * @param {Date|number} [now]
 */
export function israelDayStart(now = new Date()) {
  const key = israelToday(now);
  const [y, m, d] = key.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  const offsetAt = (ms) => {
    const p = israelParts(new Date(ms));
    if (!p) return 0;
    const [py, pm, pd] = p.key.split("-").map(Number);
    const [hh, mm] = p.time.split(":").map(Number);
    return (Date.UTC(py, pm - 1, pd, hh, mm) - ms) / 60000;
  };
  const first = guess - offsetAt(guess) * 60000;
  return new Date(guess - offsetAt(first) * 60000);
}

/**
 * The Israel calendar day of a value as 'YYYY-MM-DD', or '' when there is none.
 * 'YYYY-MM-DD' stays as it is (checked: '2026-02-31' is ''); a timestamp with a zone ('…Z', '…+00:00')
 * becomes Israel's day (21:30Z on the 15th is the 16th); a Date or epoch number likewise.
 * @param {any} value
 */
export function dateKey(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") {
    const s = value.trim();
    if (KEY_RE.test(s)) return keyToUtc(s) ? s : "";
    const m = STAMP_RE.exec(s);
    if (!m) return "";
    if (!keyToUtc(m[1])) return "";
    if (!m[4]) return m[1];
    return israelParts(new Date(s.replace(" ", "T")))?.key || "";
  }
  return israelParts(toInstant(value) || new Date(NaN))?.key || "";
}

/** A day plus n days ('' for a broken day). @param {string} key @param {number} n */
export function addDays(key, n) {
  const d = keyToUtc(key);
  if (!d) return "";
  d.setUTCDate(d.getUTCDate() + (Number(n) || 0));
  return utcKey(d);
}

/** Sunday to Saturday of the week holding `key` (Israel's week). @param {string} [key] */
export function weekRange(key = israelToday()) {
  const d = keyToUtc(key);
  if (!d) return { start: "", end: "" };
  const start = addDays(key, -d.getUTCDay());
  return { start, end: addDays(start, 6) };
}

/** The first and last day of the month of `key`, `offset` months on (1 = next month). @param {string} [key] @param {number} [offset] */
export function monthRange(key = israelToday(), offset = 0) {
  const d = keyToUtc(key);
  if (!d) return { start: "", end: "" };
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + (Number(offset) || 0), 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  return { start: utcKey(first), end: utcKey(last) };
}

/** 1 January to 31 December of a year. @param {number} year */
export function yearRange(year) {
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

/** Whether a value's day is inside { start, end } (both inclusive). @param {any} value @param {{start: string, end: string}} range */
export function inRange(value, range) {
  const k = dateKey(value);
  return !!k && !!range?.start && !!range?.end && k >= range.start && k <= range.end;
}

/** The year of a value's day, or null. @param {any} value */
export function yearOf(value) {
  const k = dateKey(value);
  return k ? Number(k.slice(0, 4)) : null;
}

/** The month of a value's day, 0 (January) to 11 like Date#getMonth, or null. @param {any} value */
export function monthIndexOf(value) {
  const k = dateKey(value);
  return k ? Number(k.slice(5, 7)) - 1 : null;
}

/** An event is past from the day after it (today's event is not past). @param {any} event @param {string} [today] */
export function isPastEvent(event, today = israelToday()) {
  const k = dateKey(event?.date);
  return !!k && k < today;
}

/**
 * "חסר צוות": an event from today to `horizonDays` days on (across the new year too) with fewer of the shooting crew
 * than it needs. The sidebar count and the list it opens both use this. What it needs is its package's number
 * (requiredCrew); an event without one is not counted — there is no default of 3 (decision D2, U4). Who counts is
 * the ONE crew rule of src/lib/requiredCrew.js (work order item 29): named rows, the editor left out, "אין …" fills
 * its slot.
 * @param {any} event @param {string} [today] @param {number} [horizonDays]
 */
export function isUrgentStaffing(event, today = israelToday(), horizonDays = 30) {
  const k = dateKey(event?.date);
  if (!k || k < today || k > addDays(today, horizonDays)) return false;
  const requiredCrew = requiredCrewOf(event);
  if (requiredCrew === null) return false;
  return assignedCrewCount(event) < requiredCrew;
}

const HE_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

/** '15/10/2026' (Israel's day of a timestamp); '' when there is no real date. @param {any} value */
export function formatDateShort(value) {
  const k = dateKey(value);
  if (!k) return "";
  const [y, m, d] = k.split("-").map(Number);
  return `${d}/${m}/${y}`;
}

/** '15 באוקטובר 2026'; '' when there is no real date. @param {any} value */
export function formatDateLong(value) {
  const k = dateKey(value);
  if (!k) return "";
  const [y, m, d] = k.split("-").map(Number);
  return `${d} ב${HE_MONTHS[m - 1]} ${y}`;
}

/**
 * '15/10/2026 21:30' in Israel time; a plain day ('YYYY-MM-DD') has no time and shows the date only;
 * '' when there is no real date.
 * @param {any} value
 */
export function formatDateTime(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") {
    const s = value.trim();
    if (KEY_RE.test(s)) return formatDateShort(s);
    const m = STAMP_RE.exec(s);
    if (!m || !keyToUtc(m[1])) return "";
    if (!m[4]) return `${formatDateShort(m[1])} ${m[2]}:${m[3]}`;
    const p = israelParts(new Date(s.replace(" ", "T")));
    return p ? `${formatDateShort(p.key)} ${p.time}` : "";
  }
  const p = israelParts(toInstant(value) || new Date(NaN));
  return p ? `${formatDateShort(p.key)} ${p.time}` : "";
}

/**
 * The days a typed search means (work order item 29, Avira's searchDate): "16/9/26", "16.9.2026", "16-09-2026",
 * "2026-09-16" → that day; a day and month without a year ("16/9", "16.9") → that day in each of the years around
 * `today` (two back, two on — past events are searched too). Not a date → null.
 * @param {string} term @param {string} [today]
 */
export function searchDates(term, today = israelToday()) {
  const s = String(term || "").trim();
  if (!/\d/.test(s)) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) {
    const k = keyOf(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return keyToUtc(k) ? [k] : null;
  }
  const m = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2}|\d{4}))?$/.exec(s);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (m[3]) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const k = keyOf(y, mo, d);
    return keyToUtc(k) ? [k] : null;
  }
  const year = Number(String(today).slice(0, 4)) || new Date().getUTCFullYear();
  const out = [];
  for (let y = year - 2; y <= year + 2; y++) {
    const k = keyOf(y, mo, d);
    if (keyToUtc(k)) out.push(k);
  }
  return out.length ? out : null;
}

/**
 * Whether a typed search matches a day the way the lists always matched it: '5/10/2026', '05/10/2026',
 * '2026' or '10/2026' contain it; since work order item 29 also a short date ('5/10/26', '5.10', '5.10.26') that
 * searchDates reads as that day. A date-less row never matches.
 * @param {any} value @param {string} term @param {string} [today]
 */
export function matchesDateSearch(value, term, today = israelToday()) {
  const k = dateKey(value);
  const t = String(term || "").trim();
  if (!k || !t) return false;
  const [y, m, d] = k.split("-");
  const texts = [`${Number(d)}/${Number(m)}/${y}`, `${d}/${m}/${y}`, y, `${Number(m)}/${y}`];
  if (texts.some((s) => s.includes(t))) return true;
  const days = searchDates(t, today);
  return !!days && days.includes(k);
}
