// Work progress of an event (raw/final links + each team member's done flag), shared by
// the dashboard, the sidebar and the work-status page (2026-10-07; was copied three times).
// Pure — tested in scripts/test-whatsapp-bot.mjs PART 33.

export const ROLE_DONE_FIELDS = {
  photographer1: "photographer1Done",
  photographer2: "photographer2Done",
  videographer: "video1Done",
  videographer2: "video2Done",
  editor: "editorDone",
};

export function progressPct(event) {
  const items = [];
  (event?.team || []).forEach((m) => {
    const field = ROLE_DONE_FIELDS[m?.role];
    if (field) items.push(!!event[field]);
  });
  items.push(!!(event?.rawLink || event?.rawDoneManual));
  items.push(!!(event?.finalLink || event?.finalDoneManual));
  const done = items.filter(Boolean).length;
  return items.length ? Math.round((done / items.length) * 100) : 0;
}
