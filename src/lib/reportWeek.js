// The weekly report (2026-10-24, the owner's request): an Israeli week, Sunday to Saturday,
// on plain "YYYY-MM-DD" strings (events.date is a date, no time zone to get wrong). Pure.

const toUTC = (s) => {
  const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const toStr = (dt) => dt.toISOString().slice(0, 10);

export function addDays(dateStr, n) {
  const dt = toUTC(dateStr);
  dt.setUTCDate(dt.getUTCDate() + n);
  return toStr(dt);
}

// The Sunday that starts the week of `dateStr`, and its Saturday.
export function weekOf(dateStr) {
  const start = addDays(dateStr, -toUTC(dateStr).getUTCDay());
  return { start, end: addDays(start, 6) };
}

export function inWeek(eventDate, week) {
  const d = String(eventDate || "").slice(0, 10);
  return !!d && d >= week.start && d <= week.end;
}

// "18.10 – 24.10.2026" (or "28.12.2026 – 3.1.2027" across a new year)
export function weekLabel(week) {
  const f = (s, withYear) => {
    const [y, m, d] = s.split("-").map(Number);
    return withYear ? `${d}.${m}.${y}` : `${d}.${m}`;
  };
  const sameYear = week.start.slice(0, 4) === week.end.slice(0, 4);
  return `${f(week.start, !sameYear)} – ${f(week.end, true)}`;
}
