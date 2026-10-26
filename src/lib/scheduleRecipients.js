// Who a schedule message (לוז קיץ / חורף / שישי) can go to (2026-10-27, the owner's request):
// the bride's and the groom's phones from the production questionnaire, and the lead's own
// phone when it is a different number (the questionnaire may not be filled yet). The same
// number twice shows once. Pure — PART 71.
import { normalizeIsraeliPhone } from "./whatsappLeadParser";

const digits = (raw) => String(raw || "").replace(/\D/g, "");

export function scheduleRecipients(lead) {
  const out = [];
  const seen = new Set();
  const add = (key, label, raw) => {
    const n = normalizeIsraeliPhone(raw) || digits(raw);
    if (!n || seen.has(n)) return;
    seen.add(n);
    out.push({ key, label, phone: String(raw).trim() });
  };
  add("bride", "כלה", lead?.productionBridePhone);
  add("groom", "חתן", lead?.productionGroomPhone);
  add("lead", "הטלפון בליד", lead?.phoneNumber);
  return out;
}
