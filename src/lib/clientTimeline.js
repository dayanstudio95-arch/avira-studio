// The couple's journey after signing, for the chat's "פעולות ללקוח" card (2026-10-09, the
// owner's request) — pure, tested in scripts/test-whatsapp-bot.mjs PART 49. Reads the same
// fields as the work-status page (ProgressStatus / progressPercent); there are no
// per-step timestamps for most steps, so a date is shown only where one exists.
import { EVENT_TEAM_ROLES } from "./staffRoles";

const SHOOTER_ROLES = ["photographer1", "photographer2", "videographer", "videographer2"];
const ROLE = Object.fromEntries(EVENT_TEAM_ROLES.map((r) => [r.value, r]));

const named = (m) => m && ROLE[m.role] && String(m.staffMemberName || "").trim() && !/^אין(\s|$)/.test(String(m.staffMemberName).trim());

// [{ role, label, icon, name, done }] in the fixed role order.
export function eventTeamList(event) {
  const team = (event?.team || []).filter(named);
  return EVENT_TEAM_ROLES.flatMap((r) =>
    team.filter((m) => m.role === r.value).map((m) => ({
      role: r.value, label: r.label, icon: r.icon, name: String(m.staffMemberName).trim(), done: !!event?.[r.doneField],
    }))
  );
}

// [{ key, label, done, date?, detail? }] — `current` marks the first step not done.
export function clientTimeline(event, lead, today) {
  const steps = [];
  steps.push({ key: "signed", label: "חתמו על החוזה", done: !!lead?.signedAt, date: lead?.signedAt || null });

  const filled = lead?.productionFormFilledAt;
  steps.push({
    key: "questionnaire",
    label: "שאלון הפקה",
    done: !!filled,
    date: filled || null,
    detail: filled ? "מולא" : event?.questionnaireSentAt ? "נשלח, עוד לא מולא" : "עוד לא נשלח",
  });

  const day = event?.date ? String(event.date).slice(0, 10) : null;
  steps.push({ key: "event", label: "יום האירוע", done: !!day && day < today, date: day, detail: day === today ? "היום" : undefined });

  if (event) {
    const team = eventTeamList(event);
    const shooters = team.filter((m) => SHOOTER_ROLES.includes(m.role));
    if (shooters.length) {
      const doneCount = shooters.filter((m) => m.done).length;
      steps.push({
        key: "shoot",
        label: "הצלמים סימנו סיום",
        done: doneCount === shooters.length,
        detail: `${doneCount}/${shooters.length}`,
      });
    }
    const raw = !!(event.rawLink || event.rawDoneManual);
    steps.push({
      key: "raw",
      label: "גלם מוכן",
      done: raw,
      date: event.rawSentAt || null,
      detail: event.rawSentToEditor ? "נשלח לעורך" : undefined,
    });
    if (team.some((m) => m.role === "editor")) {
      steps.push({ key: "edit", label: "עריכה הסתיימה", done: !!event.editorDone });
    }
    steps.push({ key: "final", label: "נמסר לזוג (סופי)", done: !!(event.finalLink || event.finalDoneManual) });
    if (event.albumSketchLink) {
      steps.push({ key: "album", label: "סקיצת אלבום", done: !!event.albumSketchCoupleNotified, detail: event.albumSketchCoupleNotified ? "נשלחה לזוג" : "מוכנה, עוד לא נשלחה" });
    }
  }

  const firstOpen = steps.findIndex((s) => !s.done);
  return steps.map((s, i) => ({ ...s, current: i === firstOpen }));
}
