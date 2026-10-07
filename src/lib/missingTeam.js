// "חסר צוות" — one rule for every screen (2026-10-07). It used to be computed four ways
// (dashboard card, sidebar, staff scheduling, events page), so the numbers disagreed:
// the sidebar stopped at Dec 31, the card compared team.length (editors and empty rows
// included) to requiredCrew||0, staff scheduling counted the editor, and "future" was
// `new Date(date) < now`, which drops today's events from 03:00 Israel time.
//
// Verified on the real data (read-only, 2026-10-07): requiredCrew is the shooting crew
// only — 152 of 160 past events have 3 shooters + 1 editor with requiredCrew 3. A name
// starting with "אין" ("אין וידאו") is a deliberate "not needed" and fills its slot.
// Pure — tested in scripts/test-whatsapp-bot.mjs PART 33.

const pad = (n) => String(n).padStart(2, "0");

// Today in Israel as "YYYY-MM-DD" (events.date is a calendar date, compared as text).
export function israelToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function eventDay(e) {
  return String(e?.date || "").slice(0, 10);
}

export function assignedShooters(e) {
  return (e?.team || []).filter((m) => m && m.role !== "editor" && String(m.staffMemberName || "").trim()).length;
}

export function requiredShooters(e) {
  return Number(e?.requiredCrew) || 3;
}

export function missingCount(e) {
  return Math.max(0, requiredShooters(e) - assignedShooters(e));
}

// Today or later, and fewer named shooters than the package needs.
export function isMissingTeam(e, today = israelToday()) {
  const day = eventDay(e);
  return !!day && day >= today && missingCount(e) > 0;
}

// "X מתוך Y" for the sidebar: events of this (Israel) year already held, out of all of them.
export function yearProgress(events, now = new Date()) {
  const today = israelToday(now);
  const year = today.slice(0, 4);
  const inYear = (events || []).filter((e) => eventDay(e).startsWith(year));
  return { done: inYear.filter((e) => eventDay(e) < today).length, total: inYear.length };
}

export { pad };

// The notes to show on an event (2026-10-07): the event's own and its lead's — on the real
// data 32 of 106 upcoming events had notes only on the lead ("ביקשו את דודו"), so the staff
// page never showed them. Same text once; both when they differ.
export function combinedNotes(eventNotes, leadNotes) {
  const a = String(eventNotes || "").trim();
  const b = String(leadNotes || "").trim();
  if (!a) return b;
  if (!b || a.includes(b)) return a;
  if (b.includes(a)) return b;
  return `${a}\n${b}`;
}

// Which roles are missing (2026-10-07: "חסר וידאו", "חסר וידאו + צלם 2"). The package says how
// many photographers / videographers (packages.photographers / .videographers — 61 of 106
// upcoming events have one); without a package the split follows requiredCrew the way the
// studio actually staffs (verified on past events): 1 → 1 photo, 2 → 1+1, 3 → 2 photo + 1
// video, 4 → 2+2. A "אין …" name fills its slot.
const PHOTO_ROLES = ["photographer1", "photographer2"];
const VIDEO_ROLES = ["videographer", "videographer2"];

export function expectedSplit(e, pkg) {
  if (pkg && (Number(pkg.photographers) || Number(pkg.videographers))) {
    return { photo: Number(pkg.photographers) || 0, video: Number(pkg.videographers) || 0 };
  }
  const n = requiredShooters(e);
  if (n <= 1) return { photo: 1, video: 0 };
  if (n === 2) return { photo: 1, video: 1 };
  if (n === 3) return { photo: 2, video: 1 };
  return { photo: 2, video: n - 2 };
}

export function missingRoles(e, pkg) {
  const named = (e?.team || []).filter((m) => m && String(m.staffMemberName || "").trim());
  const photo = named.filter((m) => PHOTO_ROLES.includes(m.role)).length;
  const video = named.filter((m) => VIDEO_ROLES.includes(m.role)).length;
  const want = expectedSplit(e, pkg);
  const out = [];
  const p = want.photo - photo;
  const v = want.video - video;
  if (p === 1) out.push("צלם");
  if (p > 1) out.push(`${p} צלמים`);
  if (v === 1) out.push("וידאו");
  if (v > 1) out.push(`${v} וידאו`);
  // The package split may not explain the gap (e.g. an extra role booked) — still say how many.
  if (!out.length && missingCount(e) > 0) out.push(`${missingCount(e)} אנשי צוות`);
  return out;
}
