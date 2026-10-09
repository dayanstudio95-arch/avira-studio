// The search box on "סטטוס עבודה" (2026-10-09, the owner's request). Pure — tested in
// scripts/test-whatsapp-bot.mjs PART 54. One event matches when the text appears in the
// couple's names, the venue, or the name of anyone on its team, or when the text is a
// date ("24/6/2026", "24/6") — the same date rule as the global search (searchDate.js).
import { dateMatches } from "@/lib/searchDate";

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

export function matchesProgressSearch(event, query, now = new Date()) {
  const q = norm(query);
  if (!q) return true;
  if (dateMatches(event?.date, q, now)) return true;
  const hay = [
    event?.coupleNames,
    event?.venue,
    ...(event?.team || []).map((m) => m?.staffMemberName),
  ].map(norm).join(" | ");
  return q.split(" ").every((word) => hay.includes(word));
}
