// The "after signing" wizard (2026-10-07) — pure rules, no React, no network, so they can be
// tested in scripts/test-whatsapp-bot.mjs. The screen is src/components/postSign/PostSignWizard.jsx.
//
// Progress lives on the lead (0074): post_sign_flow = { step, done: { <step>: 'done'|'skipped' },
// startedAt, completedAt } and post_sign_snoozed_until. Both are on the row, so a wizard closed
// on the computer continues on the phone.

export const STEPS = [
  { key: "status", label: "סטטוס" },
  { key: "invoice", label: "חשבונית מקדמה" },
  { key: "schedule", label: "לוז" },
  { key: "availability", label: "זמינות צלמים" },
  { key: "assign", label: "שיבוץ צוות" },
  { key: "finish", label: "סיום" },
];

export const SIGNED_STATUS = "חוזה";
export const CLOSED_STATUS = "נסגר/חתימה";

// "YYYY-MM-DD" of `now` in Israel.
function israelDateStr(now) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

function israelHour(instant) {
  return Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem", hour: "2-digit", hourCycle: "h23",
  }).format(instant));
}

// 08:00 Israel time on the given "YYYY-MM-DD", as a Date. Israel is UTC+2 or UTC+3; the one
// that really lands on 08:00 that day is taken, so it is right on both sides of a DST switch.
export function israelMorningOf(dateStr, hour = 8) {
  const [y, m, d] = dateStr.split("-").map(Number);
  for (const offset of [3, 2]) {
    const candidate = new Date(Date.UTC(y, m - 1, d, hour - offset));
    if (israelHour(candidate) === hour) return candidate;
  }
  return new Date(Date.UTC(y, m - 1, d, hour - 2));
}

function addDaysStr(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export const SNOOZE_OPTIONS = [
  { key: "session", label: "עד הכניסה הבאה" },
  { key: "tomorrow", label: "מחר" },
  { key: "3days", label: "בעוד 3 ימים" },
  { key: "week", label: "בעוד שבוע" },
  { key: "date", label: "עד תאריך שאבחר…" },
];

// When the wizard may pop up again for a lead, as a Date (08:00 Israel time on that day).
// 'session' has no date — it is kept in sessionStorage by the caller — so it returns null.
export function snoozeUntil(option, now = new Date(), pickedDate = null) {
  const today = israelDateStr(now);
  switch (option) {
    case "tomorrow": return israelMorningOf(addDaysStr(today, 1));
    case "3days": return israelMorningOf(addDaysStr(today, 3));
    case "week": return israelMorningOf(addDaysStr(today, 7));
    case "date": return pickedDate ? israelMorningOf(pickedDate) : null;
    default: return null;
  }
}

// The wizard should pop up for this lead (ignoring the per-tab "until next login" snooze,
// which the host checks itself):
//   * a couple who signed and whose wizard never started, or a wizard started and not finished;
//   * the wedding is not in the past;
//   * not snoozed to a later moment.
export function isPostSignPending(lead, now = new Date()) {
  if (!lead) return false;
  const flow = lead.postSignFlow;
  const open = flow ? !flow.completedAt : lead.status === SIGNED_STATUS;
  if (!open) return false;
  if (lead.status === "לא רלוונטי") return false;
  if (lead.eventDate && lead.eventDate < israelDateStr(now)) return false;
  if (lead.postSignSnoozedUntil && new Date(lead.postSignSnoozedUntil) > now) return false;
  return true;
}

// The step to show when (re)opening: the saved one, else the first not yet done/skipped.
export function currentStep(flow) {
  if (flow?.step && STEPS.some((s) => s.key === flow.step)) return flow.step;
  const done = flow?.done || {};
  return (STEPS.find((s) => !done[s.key]) || STEPS[STEPS.length - 1]).key;
}

// The flow after marking `stepKey` as 'done' | 'skipped' and moving to the next step.
export function advance(flow, stepKey, outcome, now = new Date()) {
  const done = { ...(flow?.done || {}), [stepKey]: outcome };
  const idx = STEPS.findIndex((s) => s.key === stepKey);
  const next = STEPS[Math.min(idx + 1, STEPS.length - 1)].key;
  return { ...(flow || {}), startedAt: flow?.startedAt || now.toISOString(), done, step: next };
}

export function finish(flow, now = new Date()) {
  return {
    ...(flow || {}),
    startedAt: flow?.startedAt || now.toISOString(),
    done: { ...(flow?.done || {}), finish: "done" },
    step: "finish",
    completedAt: now.toISOString(),
  };
}

const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

// "יום שישי, 14.8.2026" for a "YYYY-MM-DD" (the date itself, no time-zone shift).
export function formatEventDateHe(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = String(dateStr).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return String(dateStr);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `יום ${weekday}, ${d}.${m}.${y}`;
}
