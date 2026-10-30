// When a gallery closes, in words (P72). Counted in calendar days in Israel, so on the last day it
// says "today", never "tomorrow"; galleries close at 23:59 Israel time (older ones at the hour they were made).
import { israelDaysBetween } from '../../shared/day';

const clock = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** "היום ב-23:59", "מחר ב-23:59", "בעוד 5 ימים" (after "הגלריה נסגרת"). */
export function closingLabel(expiresAt: string, now = Date.now()): string {
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return '';
  const days = israelDaysBetween(now, t);
  const at = clock.format(new Date(t));
  if (days <= 0) return `היום ב-${at}`;
  if (days === 1) return `מחר ב-${at}`;
  return `בעוד ${days} ימים`;
}

/** The availability line under the couple's names: "זמין לעוד 12 ימים", "זמין עד היום ב-23:59". */
export function availabilityText(expiresAt: string, expired: boolean, now = Date.now()): string {
  const t = Date.parse(expiresAt);
  if (expired || !Number.isFinite(t) || t <= now) return 'הגלריה נסגרה';
  const days = israelDaysBetween(now, t);
  if (days <= 1) return `זמין עד ${closingLabel(expiresAt, now)}`;
  if (days === 2) return 'זמין ליומיים נוספים';
  return `זמין לעוד ${days} ימים`;
}
