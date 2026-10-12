// A fixed order for the automation cards (2026-10-12, the owner: "the automations keep
// changing places"). The list came back in whatever order the database happened to keep
// the rows — and a run or a settings save rewrites a row, which moves it. Now: the team's
// messages, then the couples', then any custom ones by when they were made. Pure — PART 56.
export const AUTOMATION_ORDER = [
  // לצוות
  "monthly_staff_summary",
  "daily_event_brief",
  "custom_staff_message",
  // לזוגות
  "questionnaire_send",
  "questionnaire_reminder",
  "payment_reminder",
  "album_reminder",
];

export function sortAutomations(list) {
  const rank = (a) => {
    const i = AUTOMATION_ORDER.indexOf(a?.type);
    return i === -1 ? AUTOMATION_ORDER.length : i;
  };
  const made = (a) => String(a?.created_date || a?.createdAt || a?.created_at || "");
  return [...(list || [])].sort((a, b) => rank(a) - rank(b) || made(a).localeCompare(made(b)) || String(a?.id).localeCompare(String(b?.id)));
}
