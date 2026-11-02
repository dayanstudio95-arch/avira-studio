// "לוח עבודות לאנשי צוות" (Avira, 2026-11-02, the owner's request): a manual automation that sends each chosen team
// member every date he works from today on — this year and next, or one year — as one WhatsApp message:
//
//   נובמבר 2026 🗓️
//   24/11/26 טרויה - צלם ראשי
//
//   🎉 2027 🎉                    ← only where a new year starts (the owner's example)
//   ינואר 2027 🗓️
//   21/1/27 דואה - צלם וידאו
//
// Only the roles that work at the wedding (the owner's decision): the editor's assignments are not dates he works.
// Green API takes up to 20,000 characters a message and has no line limit; a message longer than PART_MAX (about
// 100 dates) still goes in parts, cut between months, so it reads well on a phone. Pure: tested in test:whatsapp.

/** The roles that work on the day, in the words of the message. */
export const SCHEDULE_ROLE_WORDS: Record<string, string> = {
  photographer1: 'צלם ראשי',
  photographer2: 'צלם שני',
  videographer: 'צלם וידאו',
  videographer2: 'צלם וידאו שני',
};

/** Characters a part may have before the next month goes into another part. */
export const PART_MAX = 4000;

export const DEFAULT_STAFF_SCHEDULE_TEMPLATE =
  'היי {staff_name} 👋\nאלה כל התאריכים שלך אצלנו מהיום והלאה:\n\n{schedule}\n\nסה״כ {count} תאריכים\nאם משהו לא מסתדר, נשמח לדעת 🙏\nאווירה סטודיו';

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

export interface ScheduleEntry {
  date: string; // YYYY-MM-DD
  venue: string;
  role: string; // the message's words
}

interface EventRow {
  date?: string | null;
  venue?: string | null;
  team?: unknown;
}

const sameName = (a: unknown, b: string) => String(a ?? '').replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

/** Today in Israel, YYYY-MM-DD. */
export function israelToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/**
 * A team member's working dates: from `today` on, in the given years, by date; one line per role he has that day (two
 * roles at one wedding are two lines). The venue is '' when the event has none.
 */
export function staffSchedule(events: EventRow[], staffName: string, today: string, years: string[]): ScheduleEntry[] {
  const out: ScheduleEntry[] = [];
  for (const e of events) {
    const date = String(e.date ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today || !years.includes(date.slice(0, 4))) continue;
    for (const t of Array.isArray(e.team) ? e.team : []) {
      const role = SCHEDULE_ROLE_WORDS[(t as { role?: string })?.role ?? ''];
      if (role && sameName((t as { staffMemberName?: string }).staffMemberName, staffName)) out.push({ date, venue: String(e.venue ?? '').trim(), role });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.role.localeCompare(b.role));
}

/** "2026-11-24" → "24/11/26". */
export const shortDate = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}/${d.slice(2, 4)}`;

/** The dates by month: each block is a month's heading and lines, with the year's banner where a new year starts. */
export function scheduleBlocks(entries: ScheduleEntry[]): string[] {
  const blocks: string[] = [];
  let month = '';
  let year = '';
  for (const e of entries) {
    const y = e.date.slice(0, 4);
    const m = e.date.slice(0, 7);
    if (m !== month) {
      const banner = year && y !== year ? `🎉 ${y} 🎉\n` : '';
      blocks.push(`${banner}${MONTHS[Number(e.date.slice(5, 7)) - 1]} ${y} 🗓️`);
      month = m;
      year = y;
    }
    blocks[blocks.length - 1] += `\n${shortDate(e.date)} ${e.venue || 'אולם לא צוין'} - ${e.role}`;
  }
  return blocks;
}

/**
 * The message, in parts when it is long: the template's text before {schedule} opens the first part, the text after it
 * closes the last; months never split, and each part of several says which it is ("חלק 1 מתוך 2").
 * Variables: {staff_name} / {staffName}, {schedule}, {count}.
 */
export function renderStaffSchedule(template: string | null | undefined, staffName: string, entries: ScheduleEntry[], max = PART_MAX): string[] {
  const t = template?.trim() ? template : DEFAULT_STAFF_SCHEDULE_TEMPLATE;
  // "סה״כ 1 תאריכים" reads "סה״כ תאריך אחד".
  const fill = (s: string) => s.replace(/\{staff_name\}|\{staffName\}/g, staffName).replace(/\{count\}/g, String(entries.length)).replace(/(^|[^\d])1 תאריכים/g, '$1תאריך אחד');
  const [rawHead, rawTail = ''] = t.includes('{schedule}') ? t.split('{schedule}') : [`${t}\n\n`, ''];
  const head = fill(rawHead);
  const tail = fill(rawTail);
  const blocks = scheduleBlocks(entries);
  const parts: string[] = [];
  let cur = head;
  for (const b of blocks) {
    const sep = cur === head || cur === '' ? '' : '\n\n';
    if (cur !== head && cur !== '' && (cur + sep + b).length > max) {
      parts.push(cur);
      cur = b;
    } else cur += sep + b;
  }
  if ((cur + tail).length > max && cur !== head) {
    parts.push(cur);
    cur = tail.replace(/^\s+/, '');
  } else cur += tail;
  parts.push(cur);
  const clean = parts.map((p) => p.trim());
  return clean.length > 1 ? clean.map((p, i) => `(חלק ${i + 1} מתוך ${clean.length})\n${p}`) : clean;
}
