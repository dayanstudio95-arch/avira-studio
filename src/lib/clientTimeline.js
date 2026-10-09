// The chat's client card (2026-10-09, the owner's request): a timeline of the event's crew
// roles — צלם 1 → צלם 2 → וידאו 1 → וידאו 2 → עורך — only the roles the couple's package
// has, each with who is booked and whether that person is marked "סיים" on the work-status
// page (events.photographer1_done …). Pure, tested in scripts/test-whatsapp-bot.mjs PART 49.
import { EVENT_TEAM_ROLES } from "./staffRoles";
import { expectedSplit } from "./missingTeam";

const PHOTO = ["photographer1", "photographer2"];
const VIDEO = ["videographer", "videographer2"];
const SHORT_LABEL = { photographer1: "צלם 1", photographer2: "צלם 2", videographer: "וידאו 1", videographer2: "וידאו 2", editor: "עורך" };

const nameOf = (m) => String(m?.staffMemberName || "").trim();
// "אין צלם 2" fills a slot on purpose: the role is not needed at this event.
const isNone = (name) => /^אין(\s|$)/.test(name);

// [{ role, label, name, assigned, done, current }]
export function roleTimeline(event, pkg) {
  if (!event) return [];
  const team = event.team || [];
  const byRole = {};
  for (const m of team) if (m?.role && !byRole[m.role] && nameOf(m)) byRole[m.role] = nameOf(m);

  const want = expectedSplit(event, pkg);
  const wanted = new Set([...PHOTO.slice(0, Math.min(2, want.photo)), ...VIDEO.slice(0, Math.min(2, want.video))]);
  // Someone booked beyond the package (an extra photographer) still shows; so does the editor.
  for (const r of [...PHOTO, ...VIDEO, "editor"]) if (byRole[r]) wanted.add(r);

  const steps = EVENT_TEAM_ROLES
    .filter((r) => wanted.has(r.value) && !isNone(byRole[r.value] || ""))
    .map((r) => {
      const name = byRole[r.value] || null;
      return { role: r.value, label: SHORT_LABEL[r.value] || r.label, name, assigned: !!name, done: !!name && !!event[r.doneField] };
    });
  const firstOpen = steps.findIndex((s) => s.assigned && !s.done);
  return steps.map((s, i) => ({ ...s, current: i === firstOpen }));
}
