// Pure part of src/lib/push.js — tested in scripts/test-whatsapp-bot.mjs PART 17.

// Mirror of DEFAULT_PREFS in supabase/functions/_shared/pushPrefs.ts — the server decides.
export const DEFAULT_PREFS = {
  lead: true, hot: true, client: true, staff: true, group: false, other: false, delivery: true,
  muteUntil: null,
  night: { enabled: true, start: "22:00", end: "07:00" },
};

export const PREF_ROWS = [
  ["lead", "ליד או מספר לא מוכר", "כל הודעה ממי שעוד לא לקוח"],
  ["hot", "ליד חם", "כשמישהו רוצה לסגור או לקבוע שיחה"],
  ["client", "לקוחות", "זוגות עם חוזה ולקוחות עבר"],
  ["staff", "צוות", "צלמים, עורכים"],
  ["group", "קבוצות", "כבוי מראש — קבוצות מציפות"],
  ["other", "ספקים ו'לא רלוונטי'", "כבוי מראש"],
  ["delivery", "הודעה שלא נמסרה", "נכשלה, או נשארה על ✓ אחד 24 שעות"],
];

export function mergePrefs(raw) {
  const p = raw && typeof raw === "object" ? raw : {};
  return { ...DEFAULT_PREFS, ...p, night: { ...DEFAULT_PREFS.night, ...(p.night || {}) } };
}

