import { EVENT_TEAM_ROLES } from "@/lib/staffRoles";

// Who uploaded the material (2026-11-06, the owner's request) — the work-status squares ("צלם 1" / "צלם 2",
// photographer1_done / photographer2_done): since 2026-11-09 a dot beside each photographer's name in the galleries list
// (green = uploaded, red = not yet; no dot beside the photo count any more). A films gallery looks at the videographers.
// Pure — tested in scripts/test-whatsapp-bot.mjs.

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

/** "סלבה" / "יריב ויונתן". */
const bothNames = (names) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} ו${names[names.length - 1]}` : names[0] || "");

/**
 * Why a photo gallery's row is red (2026-11-09, the owner's request: "ככה זה יהיה ברור לי"): not sent to the couple yet
 * (work status "→ זוג") and / or a photographer who did not upload. `sent` from the linked event, `up` = uploadsOf(...).
 * null when there is nothing to do.
 */
export function galleryAlert(sent, up) {
  const missing = (up?.items || []).filter((i) => !i.done).map((i) => i.name || i.label);
  const parts = [];
  if (!sent) parts.push("לא נשלח לזוג");
  if (missing.length) parts.push(`${bothNames(missing)} עוד לא ${missing.length === 1 ? "העלה" : "העלו"}`);
  return parts.length ? parts.join(" · ") : null;
}
