// חשבונית מס קבלה on an album order (2026-11-12, approved from a mockup) — the window's pure parts: the line text
// built from the order's selections, and how much of the order is still without an invoice. The server side
// (saving on album_orders.invoices_list, never on the lead) is supabase/functions/_shared/albumInvoice.ts.
// Tested in scripts/test-whatsapp-bot.mjs ("albums: חשבונית מס קבלה").

export const MAX_ALBUM_INVOICE_TEXT = 200; // same cap as the server

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const pick = (row, snake, camel) => row?.[snake] ?? row?.[camel];

// "אלבומים: סט 3 אלבומים, כריכה HM111, הגדלה זכוכית 50/70, עמוד נוסף לאלבום ×12" — the products with their
// covers, then the add-ons; the same thing twice is written once with ×N.
export function albumInvoiceDescription(selections, addons) {
  const counts = new Map();
  const add = (label, n = 1) => {
    if (!label) return;
    counts.set(label, (counts.get(label) || 0) + n);
  };
  for (const s of selections || []) {
    add(clean(pick(s, "product_name_snapshot", "productNameSnapshot")));
    const cover = clean(pick(s, "cover_name_snapshot", "coverNameSnapshot"));
    if (cover) add(`כריכה ${cover}`);
  }
  for (const a of addons || []) {
    add(clean(pick(a, "addon_name_snapshot", "addonNameSnapshot")), Math.max(1, Number(a?.quantity) || 1));
  }
  const parts = [...counts].map(([label, n]) => (n > 1 ? `${label} ×${n}` : label));
  const text = parts.length ? `אלבומים: ${parts.join(", ")}` : "אלבומים";
  return text.slice(0, MAX_ALBUM_INVOICE_TEXT);
}

const r2 = (n) => Math.round(n * 100) / 100;

export const albumInvoices = (order) => (Array.isArray(order?.invoicesList) ? order.invoicesList : []);

export const invoicedTotal = (order) => r2(albumInvoices(order).reduce((s, i) => s + (Number(i?.amount) || 0), 0));

// What is still without an invoice: the order's total minus what was invoiced (never below 0).
export const leftToInvoice = (order) => Math.max(0, r2((Number(order?.totalAmount) || 0) - invoicedTotal(order)));

// 'none' — no total yet (nothing to invoice) · 'todo' — a total, no invoice · 'partial' — invoiced, something was
// added since · 'done' — fully invoiced.
export function albumInvoiceState(order) {
  const total = Number(order?.totalAmount) || 0;
  const done = albumInvoices(order).length > 0;
  if (!done) return total > 0 ? "todo" : "none";
  return leftToInvoice(order) > 0 ? "partial" : "done";
}

export const lastAlbumInvoice = (order) => {
  const list = albumInvoices(order);
  return list.length ? list[list.length - 1] : null;
};

// "2026-11-12" → "12/11/2026"
export function invoiceDateText(d) {
  const [y, m, day] = String(d || "").slice(0, 10).split("-");
  return y && m && day ? `${day}/${m}/${y}` : "";
}
