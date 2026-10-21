// ספר הזמנות (2026-10-21): couples who signed and have no work order yet — oldest signature
// first, so issuing down the list keeps Morning's order numbers in signing order — and the
// orders already issued. Pure; the page (src/pages/WorkOrders.jsx) loads the rows.
import { coupleInvoices, depositInvoiceAny, israelDateOf } from "./workOrder";

export const SIGNED_STATUSES = ["נסגר/חתימה", "חוזה"];

export const ORDER_STATUS_LABELS = {
  issuing: "בבדיקה",
  active: "פעילה",
  replacing: "בהחלפה",
  replaced: "הוחלפה",
  closed: "נסגרה",
};

// leads: camelCase records (signedAt, eventDate, finalPrice, invoicesList, paymentEntity…)
// orders: work_orders rows. Any order row — whatever its status — means the couple has one.
export function missingOrders(leads, orders, today) {
  const withOrder = new Set((orders || []).map((o) => o.lead_id).filter(Boolean));
  return (leads || [])
    .filter((l) => l && l.signedAt && SIGNED_STATUSES.includes(l.status) && !withOrder.has(l.id))
    .map((l) => {
      const invoices = coupleInvoices(l.invoicesList);
      const deposit = depositInvoiceAny(l.invoicesList, l.paymentEntity || null);
      const invoiced = invoices.reduce((s, i) => s + (Number(i.amount) || 0), 0);
      const finalPrice = Number(l.finalPrice) || 0;
      return {
        lead: l,
        signedOn: israelDateOf(l.signedAt),
        deposit,
        invoicesCount: invoices.length,
        fullyInvoiced: finalPrice > 0 && invoiced >= finalPrice - 0.5,
        eventPast: !!(l.eventDate && today && String(l.eventDate).slice(0, 10) < today),
      };
    })
    .sort((a, b) => String(a.lead.signedAt).localeCompare(String(b.lead.signedAt)));
}

// 'all' | 'upcoming' | 'past' (by the event date)
export function filterMissing(rows, filter) {
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
