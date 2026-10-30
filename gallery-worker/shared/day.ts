// Days as couples in Israel live them (P72, D15): a gallery closes at the end of its last day,
// 23:59 Israel time, and "today" / "tomorrow" are calendar days there, whatever the server's clock.

const ZONE = 'Asia/Jerusalem';
const DAY = 86_400_000;
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

/** The wall clock in Israel at `ms`, read as if it were UTC (so plain date maths works on it). */
function wall(ms: number): number {
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(new Date(ms))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/** "2026-09-30": the calendar day in Israel at `ms`. */
export function israelDay(ms: number): string {
  return new Date(wall(ms)).toISOString().slice(0, 10);
}

/** 23:59:59 in Israel on `day` (yyyy-mm-dd), as a moment (ms). Summer time is taken into account. */
export function endOfIsraelDay(day: string): number {
  const target = Date.parse(`${day}T23:59:59Z`);
  // The offset at that moment (+2 or +3); a second pass settles a guess that fell across a switch.
  let ms = target - (wall(target) - target);
  ms = target - (wall(ms) - ms);
  return ms;
}

/** The end of the Israel day that `ms` falls on. */
export const closeOfDay = (ms: number): number => endOfIsraelDay(israelDay(ms));

/**
 * The end of the Israel day `days` calendar days after the day of `ms` (P71): counted in days, not in 24-hour
 * steps, so a gallery made just after midnight in the month before winter time still gets all its days.
 */
export function closeAfterDays(ms: number, days: number): number {
  const day = new Date(Date.parse(`${israelDay(ms)}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
  return endOfIsraelDay(day);
}

/** Calendar days in Israel from `from` to `to` (0 = the same day, 1 = the next day). */
export function israelDaysBetween(from: number, to: number): number {
  return Math.round((Date.parse(israelDay(to)) - Date.parse(israelDay(from))) / DAY);
}
