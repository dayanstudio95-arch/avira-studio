// Pure helpers for the bot control centre (2026-09-24).
//
// The bot's word lists live in supabase/functions/_shared/whatsappIntent.ts and the
// studio's additions in app_settings as JSON arrays (parsed there by
// whatsappBotSend.ts). This file mirrors the parts of that logic the SCREEN needs —
// how a term is normalised, how the question template renders — under the documented
// "manually synced copy" pattern (see _shared/phone.ts). If the two ever disagree the
// server wins; scripts/test-whatsapp-bot.mjs PART 14 keeps them together.

const BIDI_AND_INVISIBLES = /[​-‏‪-‮⁠-⁩﻿]/g;
const NIQQUD = /[֑-ׇ]/g;
const HEBREW_FINALS = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };
const HEBREW_FINALS_RE = /[ךםןףץ]/g;

// Same folding the gate applies to both the message and every term.
export function normalizeTerm(text) {
  return String(text ?? "")
    .replace(BIDI_AND_INVISIBLES, "")
    .replace(NIQQUD, "")
    .replace(HEBREW_FINALS_RE, (ch) => HEBREW_FINALS[ch] || ch)
    .replace(/[  ]/g, " ")
    .toLowerCase()
    .trim();
}

// app_settings text → array. Lenient like the server: broken JSON is "nothing".
export function parseTermList(value) {
  if (Array.isArray(value)) return dedupe(value);
  const t = String(value ?? "").trim();
  if (!t) return [];
  try {
    const parsed = JSON.parse(t);
    return Array.isArray(parsed) ? dedupe(parsed) : [];
  } catch {
    return [];
  }
}

function dedupe(arr) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const s = String(item ?? "").trim();
    const n = normalizeTerm(s);
    if (!s || seen.has(n)) continue;
    seen.add(n);
    out.push(s);
  }
  return out;
}

export function serializeTermList(arr) {
  return JSON.stringify(dedupe(arr || []));
}

// Hebrew names for the four lists, in the order the gate reads them.
export const TERM_LISTS = [
  { key: "service", settingKey: "whatsapp_terms_service_extra", label: "מילות שירות / אירוע", hint: "חתונה, צילום, בר מצווה… — מה מצלמים" },
  { key: "inquiry", settingKey: "whatsapp_terms_inquiry_extra", label: "מילות מחיר / זמינות", hint: "מחיר, כמה, פנוי… — השאלה המסחרית" },
  { key: "selfEvent", settingKey: "whatsapp_terms_self_event_extra", label: "\"האירוע שלי\" — מספיק לבד", hint: "מתחתן, מתחתנים — מי שאומר את זה על עצמו הוא לקוח" },
  { key: "vendor", settingKey: "whatsapp_terms_vendor_extra", label: "⛔ מילות ספק — משתיקות תמיד", hint: "אני צלם, שיתוף פעולה… — מי שמוכר לסטודיו, לא קונה ממנו" },
];

// What can go wrong with a word the studio is about to add. Returned as Hebrew
// sentences; empty = nothing to say. `lists` is the effective lists from the server
// ({ service, inquiry, selfEvent, vendor }).
export function termWarnings(term, listKey, lists) {
  const warnings = [];
  const n = normalizeTerm(term);
  if (!n) return warnings;
  if (n.length < 3) {
    warnings.push("מילה קצרה מאוד — תתפוס גם בתוך מילים אחרות (למשל \"כל\" בתוך \"כלה\").");
  }
  const inList = (k) => (lists?.[k] || []).some((t) => normalizeTerm(t) === n);
  if (listKey === "vendor") {
    if (inList("service") || inList("inquiry") || inList("selfEvent")) {
      warnings.push("המילה הזו כבר ברשימת פנייה. כמילת ספק היא תשתיק כל פנייה שמכילה אותה.");
    }
  } else if (inList("vendor")) {
    warnings.push("המילה הזו ברשימת הספקים — ספק גובר, אז היא לעולם לא תפתח את השער.");
  }
  if (listKey === "selfEvent") {
    warnings.push("מילה כאן פותחת את השער לבד, בלי סימן שני. רק ביטויים שלקוח אומר על עצמו.");
  }
  return warnings;
}

// Mirror of renderQuestion in whatsappBotSend.ts, for the live preview.
export const DEFAULT_QUESTION_TEXT_ONE = "תודה! רק עוד פרט אחד ונוכל לחזור אליכם עם הצעת מחיר — {{missing}}?";
export const DEFAULT_QUESTION_TEXT_MANY = "תודה! רק עוד כמה פרטים ונוכל לחזור אליכם עם הצעת מחיר:\n{{missing_list}}";

export function renderQuestionPreview(missingLabels, { questionTextOne, questionTextMany }) {
  const labels = missingLabels || [];
  if (labels.length === 1) {
    const tpl = (questionTextOne || "").includes("{{missing}}") ? questionTextOne : DEFAULT_QUESTION_TEXT_ONE;
    return tpl.replace(/\{\{missing\}\}/g, labels[0]);
  }
  const tpl = (questionTextMany || "").includes("{{missing_list}}") ? questionTextMany : DEFAULT_QUESTION_TEXT_MANY;
  return tpl.replace(/\{\{missing_list\}\}/g, labels.map((f) => `• ${f}`).join("\n"));
}

// The four details, in the fixed order the server uses.
export const LEAD_FIELDS = [
  { key: "coupleNames", label: "השמות שלכם" },
  { key: "eventDate", label: "תאריך האירוע" },
  { key: "venue", label: "איפה האירוע מתקיים" },
  { key: "guestCount", label: "כמה מוזמנים" },
];
export const ALL_FIELD_KEYS = LEAD_FIELDS.map((f) => f.key);

// Same rule as the server's parseRequiredFields: unknown ignored, empty → all four.
export function parseRequiredFields(value) {
  const wanted = parseTermList(value).filter((k) => ALL_FIELD_KEYS.includes(k));
  return wanted.length > 0 ? ALL_FIELD_KEYS.filter((k) => wanted.includes(k)) : [...ALL_FIELD_KEYS];
}
