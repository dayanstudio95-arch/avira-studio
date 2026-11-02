// "חשבוניות מהצוות" on the screen (2026-11-02; 0106): the summary, the reminder text, file names for the Morning ZIP.
// The scan's own rules are in supabase/functions/_shared/staffInvoices.ts; the reminder here mirrors
// DEFAULT_REMINDER_TEMPLATE there. Pure.
export const STAFF_PAYERS_KEY = "staff_invoice_payers";
/** A transfer the owner closed though its documents are short (the scan leaves it; supabase/functions/_shared/staffInvoicesScan.ts). */
export const MANUAL_CLOSE = "נסגר ידנית";
/** A "שולם" transfer removed as a duplicate stays as "not needed" — deleted, the scan would make it again from the marks. */
export const DUPLICATE_NOTE = "כפילות — נמחק";
/**
 * Link documents the system keeps as PDF by itself (2026-11-02): Paperless's through the scan, Invoice4U's through the
 * gallery Worker every hour. Any other page, or one that failed (a note on the row), waits for the owner.
 */
export const AUTO_PDF = { paperless: "Paperless", invoice4u: "Invoice4U" };
/** A link document still without its PDF that needs the owner (not one the system is about to keep). */
export const needsOwner = (inv) => !!inv.note || !AUTO_PDF[inv.provider];
export const DEFAULT_REMINDER_TEMPLATE =
  "היי {staff_name}, תזכורת קטנה 🙏\nעדיין לא קיבלתי חשבונית / קבלה על ההעברה מ-{date} על סך {amount} ₪.\nאפשר לשלוח לי כאן בוואטסאפ? תודה!";
const VAT_RATE = 0.18;

const fmt = (n) => Number(n || 0).toLocaleString("he-IL", { maximumFractionDigits: 2 });

/** What is still missing: the transfers waiting for a document, their sum, and the VAT inside them (authorized dealers only). */
export function missingSummary(transfers, typeOf = {}) {
  const waiting = transfers.filter((t) => t.status === "waiting");
  const sum = waiting.reduce((s, t) => s + Number(t.amount), 0);
  const vat = waiting.filter((t) => !["exempt", "none"].includes(typeOf[t.staff_member_name])).reduce((s, t) => s + (Number(t.amount) * VAT_RATE) / (1 + VAT_RATE), 0);
  return { count: waiting.length, sum: Math.round(sum * 100) / 100, vat: Math.round(vat) };
}

export function reminderMessage(template, { name, amount, paidOn }) {
  const d = paidOn ? `${Number(paidOn.slice(8, 10))}/${Number(paidOn.slice(5, 7))}` : "";
  return (String(template || "").trim() ? template : DEFAULT_REMINDER_TEMPLATE)
    .replace(/\{staff_name\}|\{\{staff_name\}\}/g, name)
    .replace(/\{amount\}|\{\{amount\}\}/g, fmt(amount))
    .replace(/\{date\}|\{\{date\}\}/g, d);
}

/** Whole days from a YYYY-MM-DD day to today (Israel). */
export function daysSince(day, now = new Date()) {
  if (!day) return 0;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return Math.max(0, Math.round((Date.parse(today) - Date.parse(day)) / 86400000));
}

/** "2026-10-28…" → "2026-10". */
export const monthOf = (d) => String(d || "").slice(0, 7);

/** "2026-10-28 איילון חשבונית מס קבלה 70156 4,248₪.pdf" — safe for every file system. */
export function docFileName(inv) {
  const ext = inv.file_mime === "application/pdf" ? "pdf" : inv.file_mime === "image/png" ? "png" : "jpg";
  const parts = [inv.issued_on || String(inv.created_at || "").slice(0, 10), inv.staff_member_name, inv.doc_type, inv.doc_number, inv.amount !== null && inv.amount !== undefined ? `${fmt(inv.amount)}₪` : "", String(inv.id).slice(0, 6)];
  return `${parts.filter(Boolean).join(" ").replace(/[\\/:*?"<>|]/g, "-")}.${ext}`;
}
