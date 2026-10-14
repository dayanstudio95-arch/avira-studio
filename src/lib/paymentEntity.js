// The studio's two businesses (2026-10-14, the owner's request): a couple pays either the
// עוסק מורשה or the חברה בע״מ. Payment requests have a template per business, and the lead
// remembers which business the couple pays (leads.payment_entity). Pure — PART 60.
export const ENTITIES = {
  sole_prop: { key: "sole_prop", label: "עוסק מורשה", short: "מורשה", templateKey: "template_payment_request", tone: "emerald" },
  company: { key: "company", label: "חברה בע״מ", short: "חברה", templateKey: "template_payment_request_company", tone: "purple" },
};
export const ENTITY_KEYS = ["sole_prop", "company"];

export const DEFAULT_PAYMENT_MESSAGE = 'היי {{names}}, מזל טוב! 🥂\nנשארה יתרה לתשלום על סך {{balance}} ש"ח.';

export const isEntity = (v) => ENTITY_KEYS.includes(v);
export const entityLabel = (v) => (isEntity(v) ? ENTITIES[v].label : "");

// Which business to pre-select: the couple's remembered one, else the business of the last
// payment request. null = not known yet — the owner chooses.
export function defaultEntity(lead) {
  if (isEntity(lead?.paymentEntity)) return lead.paymentEntity;
  if (isEntity(lead?.paymentRequestEntity)) return lead.paymentRequestEntity;
  return null;
}

// The message for a business: its template, or the plain default when that template is
// still empty. `missingTemplate` tells the screen to say so (the company's bank details
// live only in its template).
export function paymentMessageFor(entity, templates, { names, balance }) {
  const tpl = String(templates?.[ENTITIES[entity]?.templateKey] || "").trim();
  const text = (tpl || DEFAULT_PAYMENT_MESSAGE)
    .replace(/\{\{names\}\}/g, names || "")
    .replace(/\{\{balance\}\}/g, Number(balance || 0).toLocaleString("he-IL"))
    .replace(/\{\{payment_link\}\}/g, ""); // there is no payment link in the system
  // The company template ships with empty "בנק: / סניף: / מספר חשבון:" lines to fill in.
  const incomplete = /^\s*(שם החברה|בנק|סניף|מספר חשבון)\s*:\s*$/m.test(text);
  return { text, missingTemplate: !tpl, incomplete };
}

// Before issuing an invoice from business X: is that not the couple's business? Returns
// the couple's business (to warn about) or null.
export function invoiceEntityConflict(lead, chosen) {
  const expected = defaultEntity(lead);
  return expected && isEntity(chosen) && expected !== chosen ? expected : null;
}

// "💳 דרישת תשלום: חברה בע״מ · 12.10"
export function paymentRequestLine(lead) {
  if (!isEntity(lead?.paymentRequestEntity) || !lead?.paymentRequestSentAt) return null;
  const d = new Date(lead.paymentRequestSentAt).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric" });
  return `💳 דרישת תשלום: ${ENTITIES[lead.paymentRequestEntity].label} · ${d}`;
}
