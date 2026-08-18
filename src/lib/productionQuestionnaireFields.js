// Canonical list of every production-questionnaire field a couple can fill in via
// EventQuestionnaire.jsx, used to render a consistent, complete "פרטי הפקה" view
// across every surface that shows it (UnifiedSidePanel.jsx's two questionnaire
// sections, and the Leads-page QuestionnaireAnswersDialog). Previously each surface
// only showed 4-5 hardcoded fields out of ~19 — this is the single frontend source
// of truth for the full set, so future additions only need to happen here.
//
// Keep in sync with the server-side mirror of this same field set in
// supabase/functions/_shared/googleCalendarSync.ts's buildEventPayload() /
// leadDetails block (Deno code — can't share a module across the frontend/edge
// function boundary, so the two lists are maintained in parallel by hand).

// Short fields — rendered as a single "label: value" row.
export const PRODUCTION_QUESTIONNAIRE_FIELDS = [
  { key: "productionBridePhone", label: "נייד כלה", icon: "📱" },
  { key: "productionGroomPhone", label: "נייד חתן", icon: "📱" },
  { key: "productionCompanionName", label: "שם מלווה", icon: "🧑‍🤝‍🧑" },
  { key: "productionCompanionPhone", label: "נייד מלווה", icon: "📱" },
  { key: "productionBridePrepLocation", label: "מקום התארגנות הכלה", icon: "📍" },
  { key: "productionCheckinTime", label: "שעת הגעה / קבלת פנים", icon: "🕐" },
  { key: "productionChuppahTime", label: "שעת חופה משוערת", icon: "💍" },
  { key: "productionBrideInstagram", label: "אינסטגרם כלה", icon: "📸" },
  { key: "productionGroomInstagram", label: "אינסטגרם חתן", icon: "📸" },
  { key: "productionFamilyBride", label: "משפחת הכלה", icon: "👪" },
  { key: "productionFamilyGroom", label: "משפחת החתן", icon: "👪" },
];

// Long free-text fields — rendered as a label followed by a wrapped paragraph,
// since these tend to be full sentences rather than short values.
export const PRODUCTION_QUESTIONNAIRE_LONG_TEXT_FIELDS = [
  { key: "productionImportantPeople", label: "אנשים חשובים במיוחד לצלם", icon: "⭐" },
  { key: "productionFamilySensitivities", label: "רגישויות משפחתיות", icon: "⚠️" },
  { key: "productionPlannedSurprises", label: "הפתעות מתוכננות באירוע", icon: "🎁" },
  { key: "productionSpecialRequests", label: "בקשות מיוחדות", icon: "💬" },
];

// The two yes/no checkbox fields on the questionnaire — shown only when true (they're
// booleans, not text, so showing "לא" for every lead with no social creator would be
// noise), each pairing with its own name+phone sub-fields.
export const PRODUCTION_QUESTIONNAIRE_BOOLEAN_FIELDS = [
  {
    flagKey: "productionHasSocialCreator",
    label: "יש סושיאל קריאייטור באירוע",
    icon: "📷",
    nameKey: "productionSocialCreatorName",
    phoneKey: "productionSocialCreatorPhone",
  },
  {
    flagKey: "productionHasExternalPlanner",
    label: "יש מנהל/ת אירוע חיצוני/ת",
    icon: "🗂️",
    nameKey: "productionExternalPlannerName",
    phoneKey: "productionExternalPlannerPhone",
  },
];

// True if the lead has at least one filled-in questionnaire field (used to decide
// whether to show a "no answers yet" empty state).
export function hasAnyProductionQuestionnaireAnswer(lead) {
  if (!lead) return false;
  return (
    PRODUCTION_QUESTIONNAIRE_FIELDS.some(({ key }) => !!lead[key]) ||
    PRODUCTION_QUESTIONNAIRE_LONG_TEXT_FIELDS.some(({ key }) => !!lead[key]) ||
    PRODUCTION_QUESTIONNAIRE_BOOLEAN_FIELDS.some(({ flagKey }) => !!lead[flagKey])
  );
}
