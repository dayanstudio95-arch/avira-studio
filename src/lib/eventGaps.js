import { missingCount, eventDay } from "@/lib/missingTeam";

// "חורים השנה" on the dashboard (2026-10-09, the owner's design, approved with these rules):
// an event of the selected year is listed when at least one of these is open.
//   team          — fewer named shooters than needed (the shared rule), today or later
//   calendar      — not on Google Calendar, today or later
//   progress      — work status "בתהליך" (1–99%); "ממתין" and "הושלם" are not holes
//   payment       — already held (before today) and not "שולם" (partial counts too)
//   questionnaire — not filled, and the wedding is within the next 30 days
// Pure — tested in scripts/test-whatsapp-bot.mjs PART 44.
export const GAP_TYPES = [
  { key: "team", label: "חסר צוות", tone: "red" },
  { key: "calendar", label: "לא סונכרן ליומן", tone: "blue" },
  { key: "progress", label: "התקדמות בתהליך", tone: "amber" },
  { key: "payment", label: "לא שולם", tone: "red" },
  { key: "questionnaire", label: "שאלון לא מולא", tone: "orange" },
];

const DONE_FIELDS = {
  photographer1: "photographer1Done",
  photographer2: "photographer2Done",
  videographer: "video1Done",
  videographer2: "video2Done",
  editor: "editorDone",
};

// Same calculation as the dashboard's "סטטוס התקדמות" column and the work-status page.
export function progressPercent(e) {
  const items = [];
  for (const m of e?.team || []) {
    const f = DONE_FIELDS[m?.role];
    if (f) items.push(!!e[f]);
  }
  items.push(!!(e?.rawLink || e?.rawDoneManual));
  items.push(!!(e?.finalLink || e?.finalDoneManual));
  return Math.round((items.filter(Boolean).length / items.length) * 100);
}

const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// → the hole keys of one event ([] = nothing open). `questionnaireFilled`: true / false /
// null (unknown — no lead, or leads not loaded yet → not counted).
export function eventGaps(e, { today, questionnaireFilled = null }) {
  const day = eventDay(e);
  if (!day) return [];
  const out = [];
  const upcoming = day >= today;
  if (upcoming && missingCount(e) > 0) out.push("team");
  if (upcoming && !e.googleCalendarEventId) out.push("calendar");
  const pct = progressPercent(e);
  if (pct > 0 && pct < 100) out.push("progress");
  if (day < today && e.clientPaymentStatus !== "Paid") out.push("payment");
  if (upcoming && day <= addDays(today, 30) && questionnaireFilled === false) out.push("questionnaire");
  return out;
}

// { [eventId]: keys } for the events of `year` that have a hole.
export function yearGaps(events, { today, year, questionnaireFilledFor = () => null }) {
  const out = {};
  for (const e of events || []) {
    if (!eventDay(e).startsWith(String(year))) continue;
    const g = eventGaps(e, { today, questionnaireFilled: questionnaireFilledFor(e) });
    if (g.length) out[e.id] = g;
  }
  return out;
}
