import { EVENT_TEAM_ROLES } from "@/lib/staffRoles";

// The dot beside a gallery's photo count (2026-11-06, the owner's request): green when every photographer on the event
// uploaded their material, red when one is missing — the work-status squares ("צלם 1" / "צלם 2", photographer1_done /
// photographer2_done). A films gallery looks at the videographers. Pure — tested in scripts/test-whatsapp-bot.mjs.

const ROLES = { photos: ["photographer1", "photographer2"], films: ["videographer", "videographer2"] };
const snake = (k) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** `ev` = an events row (snake_case, with team). null when nobody of that kind is on the event (no dot). */
export function uploadsOf(ev, kind = "photos") {
  const team = Array.isArray(ev?.team) ? ev.team : [];
  const items = EVENT_TEAM_ROLES.filter((r) => (ROLES[kind] || ROLES.photos).includes(r.value))
    .map((r) => {
      const m = team.find((x) => x?.role === r.value);
      return m ? { label: r.label, name: String(m.staffMemberName || "").trim(), done: ev[snake(r.doneField)] === true } : null;
    })
    .filter(Boolean);
  return items.length ? { all: items.every((i) => i.done), items } : null;
}

/** The dot's words: who uploaded / who is missing. */
export function uploadsTitle(up) {
  if (!up) return "";
  const who = (i) => `${i.label}${i.name ? ` (${i.name})` : ""}`;
  return up.all ? `כל הצלמים העלו חומרים: ${up.items.map(who).join(", ")}` : `חסרים חומרים: ${up.items.filter((i) => !i.done).map(who).join(", ")}`;
}
