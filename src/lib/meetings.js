// Sales meetings (2026-10-07) — pure helpers for the screens, tested in
// scripts/test-whatsapp-bot.mjs PART 32. Times are Israel wall-clock in the forms and
// stored as timestamptz (UTC). The reminder rules live on the server
// (supabase/functions/_shared/meetingReminders.ts).

export const KINDS = [
  { key: "call", label: "שיחה" },
  { key: "zoom", label: "זום" },
  { key: "in_person", label: "פגישה" },
];

export function kindLabel(kind) {
  return KINDS.find((k) => k.key === kind)?.label || "פגישה";
}

const TZ = "Asia/Jerusalem";

function israelParts(instant) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instant);
  const g = (t) => f.find((p) => p.type === t)?.value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour")}:${g("minute")}` };
}

// "2026-10-08" + "12:00" (Israel) → Date. Israel is UTC+2 or +3; the offset that really
// lands on that wall-clock time is taken, so both sides of a clock change are right.
export function israelLocalToUtc(dateStr, timeStr) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  const [hh, mm] = String(timeStr).split(":").map(Number);
  if (!y || !m || !d || !Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  for (const off of [3, 2]) {
    const c = new Date(Date.UTC(y, m - 1, d, hh - off, mm));
    const p = israelParts(c);
    if (p.date === dateStr && p.time === timeStr) return c;
  }
  return new Date(Date.UTC(y, m - 1, d, hh - 2, mm));
}

// Date → { date: "YYYY-MM-DD", time: "HH:MM" } in Israel (for editing a meeting).
export function utcToIsraelParts(iso) {
  return israelParts(new Date(iso));
}

export function todayIsrael(now = new Date()) {
  return israelParts(now).date;
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Upcoming scheduled meetings in groups, in time order; done/cancelled and long-past ones go
// to "עברו" (newest first, last 30 days only — the list is for working, not for history).
export function groupMeetings(meetings, now = new Date()) {
  const today = todayIsrael(now);
  const tomorrow = addDays(today, 1);
  const weekEnd = addDays(today, 7);
  const groups = { today: [], tomorrow: [], week: [], later: [], past: [] };
  const nowMs = now.getTime();
  const pastFrom = nowMs - 30 * 86400000;
  for (const m of meetings || []) {
    const start = new Date(m.startsAt).getTime();
    const ended = start + (m.durationMin || 30) * 60000 < nowMs;
    if (m.status !== "scheduled" || ended) {
      if (start >= pastFrom) groups.past.push(m);
      continue;
    }
    const day = israelParts(new Date(m.startsAt)).date;
    if (day <= today) groups.today.push(m);
    else if (day === tomorrow) groups.tomorrow.push(m);
    else if (day < weekEnd) groups.week.push(m);
    else groups.later.push(m);
  }
  const asc = (a, b) => new Date(a.startsAt) - new Date(b.startsAt);
  for (const k of ["today", "tomorrow", "week", "later"]) groups[k].sort(asc);
  groups.past.sort((a, b) => -asc(a, b));
  return groups;
}

export const GROUP_LABELS = { today: "היום", tomorrow: "מחר", week: "השבוע", later: "בהמשך", past: "עברו" };

// "בעוד 25 דק׳" / "בעוד 3 ש׳" / null when more than a day away or already started.
export function startsInLabel(startsAt, now = Date.now()) {
  const mins = Math.round((new Date(startsAt).getTime() - now) / 60000);
  if (mins < 0) return null;
  if (mins < 60) return `בעוד ${mins} דק׳`;
  if (mins < 24 * 60) return `בעוד ${Math.round(mins / 60)} ש׳`;
  return null;
}

// The next meeting starting within `withinMin` minutes (the banner on top of the chat).
export function nextSoon(meetings, withinMin = 60, now = Date.now()) {
  return (meetings || [])
    .filter((m) => m.status === "scheduled")
    .filter((m) => {
      const t = new Date(m.startsAt).getTime();
      return t >= now - 5 * 60000 && t - now <= withinMin * 60000;
    })
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))[0] || null;
}

const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

// "יום שישי, 9.10 בשעה 12:00"
export function formatMeetingWhen(startsAt) {
  const p = israelParts(new Date(startsAt));
  const [y, m, d] = p.date.split("-").map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `יום ${wd}, ${d}.${m} בשעה ${p.time}`;
}

// The WhatsApp text "שלח לזוג את פרטי הפגישה" (sent only by the owner's click).
export function meetingMessageForCouple(m) {
  const lines = [`שלום ${m.title} 😊`, `מאשרים ${kindLabel(m.kind) === "זום" ? "פגישת זום" : kindLabel(m.kind)} ${formatMeetingWhen(m.startsAt)}.`];
  if (m.kind === "zoom" && m.zoomUrl) lines.push(`קישור לזום: ${m.zoomUrl}`);
  if (m.kind === "in_person" && m.location) lines.push(`מיקום: ${m.location}`);
  lines.push("נתראה! 📸");
  return lines.join("\n");
}
