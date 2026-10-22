// ספר הזמנות (2026-10-21): couples who closed and have no work order yet — by the date the
// order was received (the signing day; else the deposit invoice's day), so issuing down the
// list keeps Morning's order numbers in that order — and the orders already issued. Pure; the
// page (src/pages/WorkOrders.jsx) loads the rows.
import { coupleInvoices, depositInvoiceAny, israelDateOf } from "./workOrder";

// Statuses the page loads. Who counts (closedNeedsOrder):
//   "נסגר/חתימה" — a closed deal, signed in the system or outside it (the couples imported
//                   from the old system have no digital signature, 2026-10-22);
//   "חוזה"       — only with a real digital signature (the status can be picked by hand).
export const SIGNED_STATUSES = ["נסגר/חתימה", "חוזה"];

export function closedNeedsOrder(lead) {
  if (!lead) return false;
  if (lead.status === "נסגר/חתימה") return true;
  return lead.status === "חוזה" && !!lead.signedAt;
}

export const ORDER_STATUS_LABELS = {
  issuing: "בבדיקה",
  active: "פעילה",
  replacing: "בהחלפה",
  replaced: "הוחלפה",
  closed: "נסגרה",
};

function rowOf(l, today) {
  const invoices = coupleInvoices(l.invoicesList);
  const deposit = depositInvoiceAny(l.invoicesList, l.paymentEntity || null);
  const invoiced = invoices.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const finalPrice = Number(l.finalPrice) || 0;
  const signedOn = israelDateOf(l.signedAt);
  return {
    lead: l,
    signedOn,
    // the best known day the order was received: the signature, else the deposit invoice
    receivedKey: signedOn || deposit?.date || null,
    outsideSystem: !l.signedAt,
    deposit,
    invoicesCount: invoices.length,
    fullyInvoiced: finalPrice > 0 && invoiced >= finalPrice - 0.5,
    eventPast: !!(l.eventDate && today && String(l.eventDate).slice(0, 10) < today),
  };
}

// leads: camelCase records (signedAt, eventDate, finalPrice, invoicesList, paymentEntity,
// workOrderSkippedAt…). orders: work_orders rows — any order row, whatever its status, means
// the couple has one. Couples the owner removed from the list are left out (see skippedRows).
// Order: by the known receipt day; couples with none (signed outside the system, no deposit
// invoice) after them, by the event date.
export function missingOrders(leads, orders, today) {
  const withOrder = new Set((orders || []).map((o) => o.lead_id).filter(Boolean));
  return (leads || [])
    .filter((l) => closedNeedsOrder(l) && !withOrder.has(l.id) && !l.workOrderSkippedAt)
    .map((l) => rowOf(l, today))
    .sort((a, b) => {
      if (a.receivedKey && b.receivedKey) return a.receivedKey.localeCompare(b.receivedKey) || String(a.lead.signedAt || "").localeCompare(String(b.lead.signedAt || ""));
      if (a.receivedKey) return -1;
      if (b.receivedKey) return 1;
      return String(a.lead.eventDate || "9999").localeCompare(String(b.lead.eventDate || "9999"));
    });
}

// Couples removed from the list (no order), the latest removal first.
export function skippedRows(leads, orders, today) {
  const withOrder = new Set((orders || []).map((o) => o.lead_id).filter(Boolean));
  return (leads || [])
    .filter((l) => closedNeedsOrder(l) && !withOrder.has(l.id) && l.workOrderSkippedAt)
    .map((l) => rowOf(l, today))
    .sort((a, b) => String(b.lead.workOrderSkippedAt).localeCompare(String(a.lead.workOrderSkippedAt)));
}

// 'month' (events from the 1st of this month on) | 'upcoming' | 'past' | 'all'
export function filterMissing(rows, filter, today) {
  if (filter === "month") {
    const first = today ? `${String(today).slice(0, 7)}-01` : null;
    return rows.filter((r) => !r.lead.eventDate || !first || String(r.lead.eventDate).slice(0, 10) >= first);
  }
  if (filter === "upcoming") return rows.filter((r) => !r.eventPast);
  if (filter === "past") return rows.filter((r) => r.eventPast);
  return rows;
}

// Issued orders in the book's order: by Morning number, reservations (no number yet) last.
export function issuedOrders(orders) {
  return [...(orders || [])].sort((a, b) => {
    const na = Number(a.morning_number) || Infinity;
    const nb = Number(b.morning_number) || Infinity;
    if (na !== nb) return na - nb;
    return String(a.created_at || "").localeCompare(String(b.created_at || ""));
  });
}
