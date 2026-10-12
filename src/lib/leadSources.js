// "מקור הליד" (2026-10-13, the owner's request): where a couple came from, so after a few
// months it is clear where advertising pays. Free text in leads.source; the form offers
// these plus every value already used. Pure — PART 57.
export const DEFAULT_LEAD_SOURCES = [
  "אינסטגרם",
  "מודעה בפייסבוק",
  "פייסבוק",
  "גוגל",
  "טיקטוק",
  "המלצה מזוג",
  "המלצה מאולם / ספק",
  "לקוח חוזר",
];
export const AD_SOURCE = "מודעה בפייסבוק";

// The defaults first (in their order), then the studio's own values, without repeats.
export function leadSourceOptions(used = []) {
  const out = [...DEFAULT_LEAD_SOURCES];
  for (const v of used) {
    const s = String(v || "").trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

// The source a lead made from a chat starts with: the ad when the chat came from one.
export function sourceFromConversation(c) {
  return c?.source === "facebook_ad" ? AD_SOURCE : "";
}
