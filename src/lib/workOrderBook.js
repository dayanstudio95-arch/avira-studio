// ספר הזמנות (2026-10-21): couples who closed and have no work order yet — by the date the
// order was received (the signing day; else the deposit invoice's day), so issuing down the
// list keeps Morning's order numbers in that order — and the orders already issued. Pure; the
// page (src/pages/WorkOrders.jsx) loads the rows.
import { coupleInvoices, depositInvoiceAny, israelDateOf, orderBalance } from "./workOrder";

// Statuses the page loads. Who counts (closedNeedsOrder):
//   "נסגר/חתימה" — a closed deal, signed in the system or outside it (the couples imported
//                   from the old system have no digital signature, 2026-10-22);
//   "חוזה"       — only with a real signature (signed_at, or the signed PDF of a signing
//                   cut off halfway) — the status can be picked by hand.
export const SIGNED_STATUSES = ["נסגר/חתימה", "חוזה"];

export function closedNeedsOrder(lead) {
  if (!lead) return false;
  if (lead.status === "נסגר/חתימה") return true;
  return lead.status === "חוזה" && !!(lead.signedAt || lead.signedContractPdfUrl);
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
    outsideSystem: !l.signedAt && !l.signedContractPdfUrl,
    // signed PDF saved, the signing's second step never arrived (no signed_at)
    signingCutOff: !l.signedAt && !!l.signedContractPdfUrl,
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

// "הזמנות וחשבוניות" (2026-10-24, the owner's request): one card per couple and business —
// its orders (a replaced one first, crossed out on screen, then the one that replaced it) and
// the couple's invoices of that business by date. All of them, linked or not: most orders were
// issued after the deposit had been paid (only 8 of 261 invoices are linked in Morning), so
// "linked" and "before the order" are tags, not a filter. Invoices of the OTHER business show
// too (otherBusiness) when the couple has no order there — e.g. a deposit invoiced by the sole
// proprietor before a company order (שרי ואיתי, 2026-10-24); with an order there they belong
// to that card. `leadsById`: id → camelCase lead. Newest order first.
export function orderChains(orders, leadsById) {
  const groups = new Map();
  const businessesOf = new Map(); // lead id → the businesses it has orders in
  for (const o of orders || []) {
    const set = businessesOf.get(o.lead_id) || new Set();
    set.add(o.business_type || "sole_prop");
    businessesOf.set(o.lead_id, set);
  }
  for (const o of orders || []) {
    const key = `${o.lead_id || o.id}|${o.business_type || "sole_prop"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  }
  const byDate = (a, b) =>
    String(a.document_date || a.created_at || "").localeCompare(String(b.document_date || b.created_at || "")) ||
    String(a.created_at || "").localeCompare(String(b.created_at || ""));
  const chains = [...groups.entries()].map(([key, list]) => {
    const sorted = [...list].sort(byDate);
    const live = sorted.filter((o) => o.status !== "replaced" && o.status !== "closed");
    const current = live[live.length - 1] || sorted[sorted.length - 1];
    const lead = leadsById?.get(current.lead_id) || null;
    const business = current.business_type || "sole_prop";
    const ids = new Set(sorted.map((o) => o.id));
    const firstDate = sorted[0].document_date || null;
    const ownBusinesses = businessesOf.get(current.lead_id) || new Set([business]);
    const invoices = coupleInvoices(lead?.invoicesList)
      .filter((i) => i.businessType === business || !ownBusinesses.has(i.businessType))
      .map((i) => {
        const linked = !!i.workOrderId && ids.has(i.workOrderId);
        return { ...i, linked, otherBusiness: i.businessType !== business, beforeOrder: !linked && !!firstDate && String(i.date || "") < firstDate };
      });
    const balance = lead ? orderBalance(current, lead.invoicesList) : null;
    const total = Number(current.total) || 0;
    return {
      key,
      lead,
      coupleNames: current.couple_names || lead?.coupleNames || "",
      eventDate: lead?.eventDate || current.event_date || null,
      business,
      orders: sorted,
      current,
      invoices,
      total,
      covered: balance == null ? null : Math.round((total - balance) * 100) / 100,
      balance,
      paid: balance != null && balance <= 0.5,
    };
  });
  const num = (c) => Number(c.current.morning_number) || 0;
  return chains.sort((a, b) => (num(b) - num(a)) || String(b.current.created_at || "").localeCompare(String(a.current.created_at || "")));
}

// 'all' | 'due' (something left to invoice) | 'paid'. "נשאר לגבות" is in event order, oldest
// first (2026-10-24, the owner's choice): couples whose wedding is over and still owe come
// first, then the coming ones; the others stay newest order first.
export function filterChains(chains, filter) {
  if (filter === "due") {
    return chains
      .filter((c) => c.balance != null && c.balance > 0.5)
      .sort((a, b) => String(a.eventDate || "9999").localeCompare(String(b.eventDate || "9999")));
  }
  if (filter === "paid") return chains.filter((c) => c.paid);
  return chains;
}

// The page's search box: couple names, order numbers, invoice numbers — any part, any case.
export function bookSearchMatch(query, values) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  return (values || []).some((v) => v != null && String(v).toLowerCase().includes(q));
}

export const chainSearchValues = (c) => [
  c.coupleNames,
  ...c.orders.map((o) => o.morning_number),
  ...c.invoices.map((i) => i.number),
];
