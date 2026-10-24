// The production questionnaire, editable by the studio (2026-10-24, the owner's request).
//
// app_settings.questionnaire_config (JSON):
//   { builtins: { [key]: { label?, placeholder?, required?, hidden? } },
//     custom:   [{ id, section, type: 'short'|'long'|'yesno', label, placeholder, required, hidden }] }
//
// Built-in questions keep their own lead columns (production_*): only their wording, "required"
// and shown/hidden change — they can't be deleted, and a hidden one keeps the answers it already
// has. The studio's own questions are answered into leads.production_extra_answers, an array of
// { id, label, type, section, value } — the label as it was when answered, so a renamed or
// deleted question still shows what the couple wrote. Pure; mirrored by hand on the server in
// supabase/functions/_shared/questionnaireExtras.ts.

export const QUESTIONNAIRE_CONFIG_KEY = "questionnaire_config";
export const MAX_CUSTOM_QUESTIONS = 30;
export const MAX_ANSWER_LENGTH = 2000;

export const SECTIONS = [
  { id: "contact", title: "פרטי קשר ביום האירוע" },
  { id: "logistics", title: "לוגיסטיקה" },
  { id: "family", title: "משפחה ואנשים חשובים" },
  { id: "team", title: "לצוות שלנו" },
];

export const QUESTION_TYPES = [
  { value: "short", label: "תשובה קצרה" },
  { value: "long", label: "טקסט ארוך" },
  { value: "yesno", label: "כן / לא" },
];

// kind: 'text' | 'tel' (left-to-right phone) | 'ltr' | 'long' | 'group' (a yes/no box that opens
// a name + phone pair). The order here is the order on the form.
export const BUILTIN_QUESTIONS = [
  { key: "productionBridePhone", section: "contact", kind: "tel", label: "📱 נייד כלה", placeholder: "050-0000000", required: true },
  { key: "productionGroomPhone", section: "contact", kind: "tel", label: "📱 נייד חתן", placeholder: "050-0000000", required: true },
  { key: "productionCompanionName", section: "contact", kind: "text", label: "🧑‍🤝‍🧑 שם מלווה", placeholder: "מי מלווה אתכם ביום האירוע" },
  { key: "productionCompanionPhone", section: "contact", kind: "tel", label: "📱 נייד מלווה", placeholder: "050-0000000" },
  { key: "productionBridePrepLocation", section: "logistics", kind: "text", label: "📍 מקום התארגנות הכלה", placeholder: "לדוגמה: בית הורים — רחוב הרצל 12, תל אביב", required: true },
  { key: "productionCheckinTime", section: "logistics", kind: "text", label: "🕐 שעת הגעה / קבלת פנים", placeholder: "לדוגמה: 18:00" },
  { key: "productionChuppahTime", section: "logistics", kind: "text", label: "💍 שעת חופה משוערת", placeholder: "לדוגמה: 19:30" },
  { key: "productionBrideInstagram", section: "logistics", kind: "ltr", label: "📸 אינסטגרם כלה", placeholder: "@username או קישור לפרופיל" },
  { key: "productionGroomInstagram", section: "logistics", kind: "ltr", label: "📸 אינסטגרם חתן", placeholder: "@username או קישור לפרופיל" },
  {
    key: "productionHasSocialCreator", section: "logistics", kind: "group", label: "יש סושיאל קריאייטור/צלם/ת סושיאל באירוע",
    nameKey: "productionSocialCreatorName", phoneKey: "productionSocialCreatorPhone", nameLabel: "שם הסושיאל קריאייטור", phoneLabel: "נייד הסושיאל קריאייטור",
  },
  {
    key: "productionHasExternalPlanner", section: "logistics", kind: "group", label: "יש מנהל/ת אירוע חיצוני/ת",
    nameKey: "productionExternalPlannerName", phoneKey: "productionExternalPlannerPhone", nameLabel: "שם מנהל/ת האירוע", phoneLabel: "נייד מנהל/ת האירוע",
  },
  { key: "productionFamilyBride", section: "family", kind: "long", label: "👪 משפחת הכלה", placeholder: "שמות ותפקידים חשובים במשפחת הכלה" },
  { key: "productionFamilyGroom", section: "family", kind: "long", label: "👪 משפחת החתן", placeholder: "שמות ותפקידים חשובים במשפחת החתן" },
  { key: "productionImportantPeople", section: "family", kind: "long", label: "⭐ אנשים חשובים במיוחד לצלם", placeholder: "מי חשוב לכם שנקפיד לתעד" },
  { key: "productionFamilySensitivities", section: "family", kind: "long", label: "⚠️ רגישויות משפחתיות", placeholder: "אנשים שחשוב לדעת לא לצלם ביחד" },
  { key: "productionPlannedSurprises", section: "team", kind: "long", label: "🎁 הפתעות מתוכננות באירוע", placeholder: "לדוגמה: הפתעה לכלה/לחתן, ריקוד מיוחד..." },
  { key: "productionSpecialRequests", section: "team", kind: "long", rows: 4, label: "💬 בקשות מיוחדות מהצוות", placeholder: "לדוגמה: רגעים חשובים שחשוב לכם לתעד, אנשים ספציפיים לצלם, משהו שחשוב לדעת..." },
];

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const TYPES = QUESTION_TYPES.map((t) => t.value);

// Whatever is stored (a JSON string, an object, nothing, rubbish) → a clean config.
export function parseQuestionnaireConfig(raw) {
  let c = raw;
  if (typeof raw === "string") {
    try { c = JSON.parse(raw); } catch { c = null; }
  }
  if (!c || typeof c !== "object") c = {};
  const builtins = {};
  for (const q of BUILTIN_QUESTIONS) {
    const o = c.builtins?.[q.key];
    if (!o || typeof o !== "object") continue;
    const entry = {};
    if (str(o.label, 200)) entry.label = str(o.label, 200);
    if (typeof o.placeholder === "string") entry.placeholder = str(o.placeholder, 300);
    if (typeof o.required === "boolean" && q.kind !== "group") entry.required = o.required;
    if (o.hidden) entry.hidden = true;
    if (Object.keys(entry).length) builtins[q.key] = entry;
  }
  const seen = new Set();
  const custom = [];
  for (const q of Array.isArray(c.custom) ? c.custom : []) {
    if (!q || typeof q.id !== "string" || !/^[a-z0-9_-]{1,40}$/i.test(q.id) || seen.has(q.id)) continue;
    const label = str(q.label, 200);
    if (!label) continue;
    seen.add(q.id);
    custom.push({
      id: q.id,
      section: SECTIONS.some((s) => s.id === q.section) ? q.section : "team",
      type: TYPES.includes(q.type) ? q.type : "short",
      label,
      placeholder: str(q.placeholder, 300),
      required: !!q.required,
      hidden: !!q.hidden,
    });
    if (custom.length >= MAX_CUSTOM_QUESTIONS) break;
  }
  return { builtins, custom };
}

// The form, section by section: built-in questions in their own order with the studio's
// wording, then the studio's questions in the order it set. `includeHidden` for the editor.
export function questionnaireSections(config, { includeHidden = false } = {}) {
  const c = parseQuestionnaireConfig(config);
  return SECTIONS.map((s) => ({
    ...s,
    items: [
      ...BUILTIN_QUESTIONS.filter((q) => q.section === s.id).map((q) => {
        const o = c.builtins[q.key] || {};
        return {
          ...q,
          builtin: true,
          defaultLabel: q.label,
          defaultPlaceholder: q.placeholder || "",
          defaultRequired: !!q.required,
          label: o.label || q.label,
          placeholder: o.placeholder !== undefined ? o.placeholder : q.placeholder || "",
          required: q.kind === "group" ? false : o.required !== undefined ? o.required : !!q.required,
          hidden: !!o.hidden,
        };
      }),
      ...c.custom.filter((q) => q.section === s.id).map((q) => ({ ...q, builtin: false, key: q.id, kind: q.type === "short" ? "text" : q.type })),
    ].filter((q) => includeHidden || !q.hidden),
  }));
}

// "📍 מקום התארגנות הכלה *" / "… (אופציונלי)" — the box itself carries no suffix.
export function questionLabel(q) {
  if (q.kind === "group") return q.label;
  return `${q.label}${q.required ? " *" : " (אופציונלי)"}`;
}

// The studio's questions the couple left empty although they are required (the browser checks
// the text boxes itself; a yes/no must be answered by hand).
export function missingRequiredAnswers(config, extraAnswers) {
  return parseQuestionnaireConfig(config).custom
    .filter((q) => !q.hidden && q.required)
    .filter((q) => {
      const v = extraAnswers?.[q.id];
      return q.type === "yesno" ? typeof v !== "boolean" : !String(v ?? "").trim();
    })
    .map((q) => q.label);
}

// production_extra_answers as { id → value } for the form (yes/no stays a boolean).
export function extraAnswersById(answers) {
  const out = {};
  for (const a of Array.isArray(answers) ? answers : []) if (a?.id) out[a.id] = a.value;
  return out;
}

// For display (the lead panel, the answers dialog): [{ id, label, text }] — answered ones only.
export function extraAnswerEntries(answers) {
  return (Array.isArray(answers) ? answers : [])
    .filter((a) => a && a.label && a.value !== null && a.value !== undefined && String(a.value).trim() !== "")
    .map((a) => ({ id: a.id, label: a.label, text: a.type === "yesno" || typeof a.value === "boolean" ? (a.value ? "כן" : "לא") : String(a.value) }));
}

// A new question's id — short and unique within the config.
export function newQuestionId(existing) {
  const ids = new Set((existing || []).map((q) => q.id));
  for (let n = ids.size + 1; ; n++) {
    const id = `q${n}`;
    if (!ids.has(id)) return id;
  }
}
