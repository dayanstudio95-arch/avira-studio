// The studio-editable production questionnaire, server side (2026-10-24). Mirrors
// src/lib/questionnaireConfig.js by hand (Deno can't import from src/): the config is
// app_settings.questionnaire_config, the studio's own questions are answered into
// leads.production_extra_answers = [{ id, label, type, section, value }].

export const QUESTIONNAIRE_CONFIG_KEY = 'questionnaire_config';
const MAX_CUSTOM_QUESTIONS = 30;
const MAX_ANSWER_LENGTH = 2000;
const SECTIONS = ['contact', 'logistics', 'family', 'team'];
const TYPES = ['short', 'long', 'yesno'];

// Built-in question → its lead columns (a yes/no group owns its name + phone too). A built-in
// the studio hid is not written on submit, so the answer it already has stays.
export const BUILTIN_COLUMNS: Record<string, string[]> = {
  productionBridePhone: ['production_bride_phone'],
  productionGroomPhone: ['production_groom_phone'],
  productionCompanionName: ['production_companion_name'],
  productionCompanionPhone: ['production_companion_phone'],
  productionBridePrepLocation: ['production_bride_prep_location'],
  productionCheckinTime: ['production_checkin_time'],
  productionChuppahTime: ['production_chuppah_time'],
  productionBrideInstagram: ['production_bride_instagram'],
  productionGroomInstagram: ['production_groom_instagram'],
  productionHasSocialCreator: ['production_has_social_creator', 'production_social_creator_name', 'production_social_creator_phone'],
  productionHasExternalPlanner: ['production_has_external_planner', 'production_external_planner_name', 'production_external_planner_phone'],
  productionFamilyBride: ['production_family_bride'],
  productionFamilyGroom: ['production_family_groom'],
  productionImportantPeople: ['production_important_people'],
  productionFamilySensitivities: ['production_family_sensitivities'],
  productionPlannedSurprises: ['production_planned_surprises'],
  productionSpecialRequests: ['production_special_requests'],
};

export interface CustomQuestion { id: string; section: string; type: string; label: string; placeholder: string; required: boolean; hidden: boolean }
export interface QuestionnaireConfig { builtins: Record<string, { label?: string; placeholder?: string; required?: boolean; hidden?: boolean }>; custom: CustomQuestion[] }
export interface ExtraAnswer { id: string; label: string; type: string; section: string; value: string | boolean }

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function parseQuestionnaireConfig(raw: unknown): QuestionnaireConfig {
  let c: any = raw;
  if (typeof raw === 'string') {
    try { c = JSON.parse(raw); } catch { c = null; }
  }
  if (!c || typeof c !== 'object') c = {};
  const builtins: QuestionnaireConfig['builtins'] = {};
  for (const key of Object.keys(BUILTIN_COLUMNS)) {
    const o = c.builtins?.[key];
    if (!o || typeof o !== 'object') continue;
    const entry: any = {};
    if (str(o.label, 200)) entry.label = str(o.label, 200);
    if (typeof o.placeholder === 'string') entry.placeholder = str(o.placeholder, 300);
    if (typeof o.required === 'boolean') entry.required = o.required;
    if (o.hidden) entry.hidden = true;
    if (Object.keys(entry).length) builtins[key] = entry;
  }
  const seen = new Set<string>();
  const custom: CustomQuestion[] = [];
  for (const q of Array.isArray(c.custom) ? c.custom : []) {
    if (!q || typeof q.id !== 'string' || !/^[a-z0-9_-]{1,40}$/i.test(q.id) || seen.has(q.id)) continue;
    const label = str(q.label, 200);
    if (!label) continue;
    seen.add(q.id);
    custom.push({
      id: q.id,
      section: SECTIONS.includes(q.section) ? q.section : 'team',
      type: TYPES.includes(q.type) ? q.type : 'short',
      label,
      placeholder: str(q.placeholder, 300),
      required: !!q.required,
      hidden: !!q.hidden,
    });
    if (custom.length >= MAX_CUSTOM_QUESTIONS) break;
  }
  return { builtins, custom };
}

export async function loadQuestionnaireConfig(supabase: any, tenantId: string): Promise<QuestionnaireConfig> {
  try {
    const { data } = await supabase.from('app_settings').select('value')
      .eq('tenant_id', tenantId).eq('key', QUESTIONNAIRE_CONFIG_KEY).maybeSingle();
    return parseQuestionnaireConfig(data?.value ?? null);
  } catch {
    return parseQuestionnaireConfig(null);
  }
}

// The answers to keep after a submit: every question shown on the form takes what the couple
// sent now (an empty answer removes it); answers to hidden or deleted questions stay as they
// were. Unknown ids in the request are ignored. Shown questions first, in the studio's order.
export function mergeExtraAnswers(existing: unknown, config: QuestionnaireConfig, submitted: unknown): ExtraAnswer[] {
  const sent = submitted && typeof submitted === 'object' ? submitted as Record<string, unknown> : {};
  const shown = config.custom.filter((q) => !q.hidden);
  const shownIds = new Set(shown.map((q) => q.id));
  const out: ExtraAnswer[] = [];
  for (const q of shown) {
    const raw = sent[q.id];
    let value: string | boolean | null = null;
    if (q.type === 'yesno') value = typeof raw === 'boolean' ? raw : null;
    else if (typeof raw === 'string' || typeof raw === 'number') value = String(raw).trim().slice(0, MAX_ANSWER_LENGTH) || null;
    if (value !== null) out.push({ id: q.id, label: q.label, type: q.type, section: q.section, value });
  }
  for (const a of Array.isArray(existing) ? existing : []) {
    if (a && typeof a.id === 'string' && !shownIds.has(a.id)) out.push(a as ExtraAnswer);
  }
  return out;
}

// "🎵 שיר כניסה לחופה: Perfect" lines for the calendar description and the crew reminder.
export function extraAnswerLines(lead: any): string[] {
  const list = Array.isArray(lead?.production_extra_answers) ? lead.production_extra_answers : [];
  return list
    .filter((a: any) => a && a.label && a.value !== null && a.value !== undefined && String(a.value).trim() !== '')
    .map((a: any) => `${a.label}: ${a.type === 'yesno' || typeof a.value === 'boolean' ? (a.value ? 'כן' : 'לא') : String(a.value)}`);
}
