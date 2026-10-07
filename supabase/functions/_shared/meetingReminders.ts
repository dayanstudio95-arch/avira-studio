// Sales-meeting reminders (2026-10-07) — pure rules, tested in scripts/test-whatsapp-bot.mjs
// PART 32. The runner is supabase/functions/meeting-reminders (every minute, pg_cron).
//
//   first  — 10 minutes before (or at once, for a meeting booked less than 10 minutes ahead)
//   second — 5 minutes after the first, only if the owner didn't tap it ("ראיתי")
// Neither is sent for a meeting that is long over: a reminder about a call that ended is noise.

export const FIRST_BEFORE_MS = 10 * 60 * 1000;
export const SECOND_AFTER_MS = 5 * 60 * 1000;
export const STALE_AFTER_MS = 30 * 60 * 1000; // no reminder for a meeting that started 30+ min ago

export interface MeetingRow {
  id: string;
  title: string;
  phone?: string | null;
  kind: 'call' | 'zoom' | 'in_person';
  starts_at: string;
  status: string;
  zoom_url?: string | null;
  location?: string | null;
  reminder_sent_at?: string | null;
  second_reminder_sent_at?: string | null;
  acknowledged_at?: string | null;
}

const KIND_LABEL: Record<string, string> = { call: 'שיחה', zoom: 'זום', in_person: 'פגישה' };
export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] || 'פגישה';
}

const ms = (iso?: string | null) => (iso ? new Date(iso).getTime() : NaN);

export function isFirstDue(m: MeetingRow, now = Date.now()): boolean {
  if (m.status !== 'scheduled' || m.reminder_sent_at) return false;
  const start = ms(m.starts_at);
  return start - now <= FIRST_BEFORE_MS && now - start < STALE_AFTER_MS;
}

export function isSecondDue(m: MeetingRow, now = Date.now()): boolean {
  if (m.status !== 'scheduled' || !m.reminder_sent_at || m.acknowledged_at || m.second_reminder_sent_at) return false;
  if (now - ms(m.reminder_sent_at) < SECOND_AFTER_MS) return false;
  return now - ms(m.starts_at) < STALE_AFTER_MS;
}

function whenText(start: number, now: number): string {
  const mins = Math.round((start - now) / 60000);
  if (mins > 0) return `בעוד ${mins} דק׳`;
  if (mins === 0) return 'עכשיו';
  return `התחילה לפני ${-mins} דק׳`;
}

// { title, body } of the push.
export function reminderText(m: MeetingRow, which: 'first' | 'second', now = Date.now()): { title: string; body: string } {
  const when = whenText(ms(m.starts_at), now);
  const icon = which === 'first' ? '⏰' : '🔔';
  const title = `${icon} ${when}: ${kindLabel(m.kind)} עם ${m.title}`;
  const extra = m.kind === 'zoom' && m.zoom_url ? m.zoom_url : m.kind === 'in_person' && m.location ? m.location : '';
  const body = [m.phone, extra, which === 'first' ? 'לחיצה = ראיתי' : 'עוד לא אישרת שראית'].filter(Boolean).join(' · ');
  return { title, body };
}
