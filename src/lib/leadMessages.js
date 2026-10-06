// Message helpers shared by the side panel (UnifiedSidePanel) and the post-sign wizard
// (PostSignWizard), extracted 2026-10-07 so both send the exact same schedule text.
import { format } from "date-fns";
import { base44 } from "@/api/base44Client";

export const SCHEDULE_OPTIONS = [
  { key: "summer", label: "לוז קיץ", templateKey: "template_schedule_summer" },
  { key: "winter", label: "לוז חורף", templateKey: "template_schedule_winter" },
  { key: "friday", label: "לוז שישי", templateKey: "template_schedule_friday" },
];

// window.location.origin, not a hardcoded domain — the link must point wherever the app
// actually runs.
export function questionnaireLinkFor(leadId) {
  const baseUrl = window.location.origin;
  return leadId ? `${baseUrl}/questionnaire/${leadId}` : `${baseUrl}/questionnaire`;
}

// {{names}} / {{event_date}} / {{contract_link}} / {{questionnaire_link}}; any other
// {{x}} is taken from extraVars or left as is.
export function applyLeadTemplateVariables(template, lead, { eventDate, extraVars = {} } = {}) {
  const baseUrl = window.location.origin;
  const contractLink = `${baseUrl}/contract/${lead?.id}`;
  const eventDateFormatted = eventDate ? format(new Date(eventDate), "d/M/yyyy") : "";
  return template
    .replace(/\{\{names\}\}/g, lead?.coupleNames || "")
    .replace(/\{\{event_date\}\}/g, eventDateFormatted)
    .replace(/\{\{contract_link\}\}/g, contractLink)
    .replace(/\{\{questionnaire_link\}\}/g, questionnaireLinkFor(lead?.id))
    .replace(/\{\{[^}]+\}\}/g, (m) => extraVars[m] || m);
}

// { summer, winter, friday } → the saved template text ('' when not set).
export async function loadScheduleTemplates() {
  const all = await base44.entities.AppSetting.list();
  const out = {};
  for (const opt of SCHEDULE_OPTIONS) {
    out[opt.key] = all.find((s) => s.key === opt.templateKey)?.value || "";
  }
  return out;
}
