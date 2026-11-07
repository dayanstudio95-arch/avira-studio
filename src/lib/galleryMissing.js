import { coupleMatches, withAmpersand } from "@films-shared/names";
import { dateKey } from "@/lib/dates";
import { uploadsOf } from "@/lib/galleryUploads";

// "אירועים שעברו ועדיין אין להם גלריה" (Avira, 2026-11-07, the owner's request): on the galleries page, under Google
// Drive — the weddings that already happened (before today, Israel time) with a photographer on the team, not sent to
// the couple yet (work status "→ זוג", e.g. a Pixieset link) and with no photo gallery: none linked to the event, and no
// unlinked one with the couple's names on that day. A gallery in the trash does not count. Only from November 2026:
// before it the galleries went out on Pixieset. Pure — tested in scripts/test-whatsapp-bot.mjs.

export const MISSING_FROM = "2026-11-01";

/** The events columns the list needs. */
export const MISSING_EVENT_FIELDS = "id, date, couple_names, venue, team, photographer1_done, photographer2_done, final_done_manual";

const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

/**
 * `events`: rows with MISSING_EVENT_FIELDS; `galleries`: the galleries list (kind, eventId, coupleName, date, deletedAt);
 * `today`: Israel's day ('YYYY-MM-DD'). Oldest first: { id, date, names, venue, daysAgo, uploads }.
 */
export function missingGalleries(events, galleries, today, from = MISSING_FROM) {
  const photos = (galleries || []).filter((g) => g?.kind === "photos" && !g.deletedAt);
  const linked = new Set(photos.map((g) => g.eventId).filter(Boolean));
  const unlinked = photos.filter((g) => !g.eventId);
  return (events || [])
    .map((ev) => ({ ev, day: dateKey(ev?.date) }))
    .filter(({ ev, day }) => {
      if (!day || day < from || day >= today) return false;
      if (ev.final_done_manual === true || linked.has(ev.id) || !uploadsOf(ev, "photos")) return false;
      return !unlinked.some((g) => dateKey(g.date) === day && coupleMatches(ev.couple_names || "", g.coupleName || ""));
    })
    .map(({ ev, day }) => ({
      id: ev.id,
      date: day,
      names: withAmpersand(String(ev.couple_names || "")),
      venue: String(ev.venue || "").trim(),
      daysAgo: daysBetween(day, today),
      uploads: uploadsOf(ev, "photos"),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.names.localeCompare(b.names));
}

/** "אתמול" / "לפני יומיים" / "לפני 5 ימים". */
export function agoText(days) {
  if (days <= 1) return "אתמול";
  if (days === 2) return "לפני יומיים";
  return `לפני ${days} ימים`;
}
