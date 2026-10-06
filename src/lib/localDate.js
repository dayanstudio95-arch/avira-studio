// BUG-10 (audit 2026-10-05): "today" as a YYYY-MM-DD string in Israel time.
// `new Date().toISOString().split('T')[0]` is UTC — between midnight and 03:00 Israel time
// it is still yesterday, so an invoice or a staff payment recorded then got yesterday's
// date. Always Asia/Jerusalem, whatever the device's own time zone.
export function todayInIsrael(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
