// "שילמתי" and the invoice request on the payments page (2026-11-02, the owner's request; 0108): the totals and the
// WhatsApp texts. The owner's own wording is the default; each part is a template he can change in "תבניות הודעות"
// (src/components/settings/MessageTemplatesTab.jsx). A line whose variable comes out empty is left out (no email
// saved, a payment under the allocation threshold). Pure.

export const CONFIRM_TEMPLATE_KEY = "template_staff_payment_confirm";
export const INVOICE_AFTER_KEY = "template_staff_invoice_after";
export const INVOICE_BEFORE_KEY = "template_staff_invoice_before";

const KEEP_IT_ON_WHATSAPP = "(אני אשמח שתשלח לי לפה לוואטסאפ שזה לא יתפספס לי במייל)\nתודה רבה 🙏🏻♥️";

/** After paying ("שילמתי"): the events, the total, the screenshot above it, and what the invoice must say. */
export const DEFAULT_CONFIRM_TEMPLATE =
  "היי {{name}} 😊\nהעברתי לך עכשיו את התשלום על האירועים האלה:\n{{events_list}}\nסה״כ: {{total_line}}\nצילום ההעברה מצורף 👆\n\n{{invoice_request}}";
/** The invoice details in the message after paying. */
export const DEFAULT_INVOICE_AFTER = `{{doc}}:\n{{business_name}}\n{{business_id}}\n{{business_email}}\n${KEEP_IT_ON_WHATSAPP}\n{{allocation_line}}`;
/** Added to "שלח פירוט" when the invoice is asked for before paying. */
export const DEFAULT_INVOICE_BEFORE = `נא להוציא {{doc}} כדי שנעביר לך את התשלום\nעם הפרטים הבאים:\n{{business_name}}\n{{business_id}}\n{{business_email}}\n${KEEP_IT_ON_WHATSAPP}\n{{allocation_line}}`;
/** In place of the details when the invoice asked for before paying already came. */
export const INVOICE_THANKS = "תודה על החשבונית 🙏🏻♥️";

/** Before VAT; above it a tax invoice needs an allocation number (as the scan's ALLOCATION_THRESHOLD). */
export const ALLOCATION_THRESHOLD = 5000;
export const ALLOCATION_LINE = "*סכום מעל 5 אלף חייב במספר הקצאה*";
const VAT_RATE = 0.18;

const round2 = (n) => Math.round(n * 100) / 100;
export const fmt = (n) => Number(n || 0).toLocaleString("he-IL", { maximumFractionDigits: 2 });

/** An exempt dealer (Settings → the team member's invoice type) is paid without VAT and gives a receipt. */
export const addsVat = (type) => type !== "exempt" && type !== "none";
export const docWord = (type) => (type === "exempt" ? "קבלה" : "חשבונית מס");

/** The events' cost, the VAT on it (none for an exempt dealer), and what is actually transferred. */
export function paymentTotals(events, type) {
  const net = round2((events || []).reduce((s, e) => s + (Number(e.cost) || 0), 0));
  const vat = addsVat(type) ? round2(net * VAT_RATE) : 0;
  return { net, vat, gross: round2(net + vat) };
}

/** "20,000 ₪ + מע״מ = 23,600 ₪", or "20,000 ₪" without VAT. */
export const totalLine = ({ net, vat, gross }) => (vat ? `${fmt(net)} ₪ + מע״מ = ${fmt(gross)} ₪` : `${fmt(net)} ₪`);

/** "2026-10-03" → "3/10/26". */
const shortDate = (d) => {
  const s = String(d || "").slice(0, 10);
  return s.length === 10 ? `${Number(s.slice(8, 10))}/${Number(s.slice(5, 7))}/${s.slice(2, 4)}` : "";
};

/** One line per event, as "שלח פירוט" lists them — by date (the payments page lists the newest first). */
export const eventsList = (events) =>
  [...(events || [])]
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
    .map((e) => `• ${shortDate(e.date)} - ${e.venue || "ללא מיקום"} - ₪${fmt(e.cost)}`)
    .join("\n");

/** The template with its variables; a line that only held variables which came out empty is left out. */
export function fill(template, vars) {
  return String(template || "")
    .split("\n")
    .flatMap((line) => {
      const names = [...line.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
      const out = line.replace(/\{\{(\w+)\}\}/g, (all, k) => (k in vars ? String(vars[k] ?? "") : all));
      return names.length && !out.trim() ? [] : [out];
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * What the invoice must say, for the business the money leaves from (payers[entity], saved on "חשבוניות מהצוות").
 * Nothing for a team member who issues no documents (by agreement).
 */
export function invoiceRequest(template, { type, payer, net }) {
  if (type === "none") return "";
  return fill(template, {
    doc: docWord(type),
    business_name: payer?.name || "",
    business_id: payer?.id || "",
    business_email: payer?.email || "",
    allocation_line: type !== "exempt" && net > ALLOCATION_THRESHOLD ? ALLOCATION_LINE : "",
  });
}

/** The message after paying. `invoiceArrived`: the invoice asked for before paying is already here — a thank-you instead. */
export function confirmMessage({ template, afterTemplate, name, events, type, payer, invoiceArrived }) {
  const totals = paymentTotals(events, type);
  const request = type === "none" ? "" : invoiceArrived ? INVOICE_THANKS : invoiceRequest(afterTemplate || DEFAULT_INVOICE_AFTER, { type, payer, net: totals.net });
  return fill(template || DEFAULT_CONFIRM_TEMPLATE, {
    name: String(name || "").trim().split(/\s+/)[0],
    events_list: eventsList(events),
    total_line: totalLine(totals),
    invoice_request: request,
  });
}

/** The works a transfer row keeps (as the scan's "שולם" marks), so the scan knows they are paid already. */
export const transferEvents = (events) =>
  (events || []).map((e) => ({ eventId: e.eventId, role: String(e.role ?? ""), date: String(e.date || "").slice(0, 10), venue: e.venue || "", amount: Number(e.cost) || 0 }));

/** Invoice tracking starts here — the same day as TRACK_SINCE in supabase/functions/_shared/staffInvoices.ts. */
export const STAFF_TRACK_SINCE = "2026-10-01";

/** Israel's calendar day of an instant ("2026-11-05T22:30Z" → "2026-11-06"); "" when it isn't a date. */
export function israelDayOf(iso) {
  const d = new Date(String(iso ?? ""));
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** The open invoice request ("requested") this payment settles: the team member's own, sharing a work with it. */
export function requestFor(requests, staffName, events) {
  const keys = new Set((events || []).map((e) => `${e.eventId}|${e.role ?? ""}`));
  return (requests || []).find((r) => r.staff_member_name === staffName && (r.events || []).some((w) => keys.has(`${w.eventId}|${w.role ?? ""}`))) || null;
}
