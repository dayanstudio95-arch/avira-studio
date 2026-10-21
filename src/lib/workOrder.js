// "הזמנת עבודה" on the screen (2026-10-21, the owner's decisions): the rows are services only
// (stills + video = the couple's final price; the 500₪ deposit is a remark, not a row), the
// split comes from the package (packages.stills_price / video_price) and can be edited per
// couple. Pure — PART 63. The server side is supabase/functions/_shared/workOrder.ts.

export const STILLS_LINE = "צילום סטילס";
export const VIDEO_LINE = "צילום וידאו";
export const EVENT_LINE = "צילום האירוע";
export const DEPOSIT_ITEM = "מקדמה";

// The subcontractor clause — the default of template_work_order_note (הגדרות ← תבניות).
export const DEFAULT_WORK_ORDER_NOTE =
  "חלק מהשירותים המפורטים בהזמנה זו (ובכלל זה צילום וידאו) עשויים להינתן על ידי ספק עצמאי הפועל בשיתוף פעולה עם הסטודיו. " +
  "לבחירת הלקוח, ניתן לשלם עבור שירותים אלה ישירות לספק, כנגד חשבונית מס שתופק על ידו. " +
  "במקרה כזה הסכום ששולם ישירות לספק אינו חלק מהתמורה לסטודיו, ותופק הזמנת עבודה מעודכנת המחליפה הזמנה זו.";

export function fmtDate(d) {
  const s = String(d || "").slice(0, 10);
  const [y, m, day] = s.split("-");
  return y && m && day ? `${day}/${m}/${y}` : s;
}

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const ils = (n) => `${money(n).toLocaleString("he-IL")} ₪`;

// The package of a lead: by id, else by name.
export function packageForLead(lead, packages) {
  const list = packages || [];
  return list.find((p) => lead?.packageId && p.id === lead.packageId)
    || list.find((p) => lead?.packageChoice && String(p.name || "").trim() === String(lead.packageChoice).trim())
    || null;
}

// Default rows for a couple. Video = the package's video price; stills = the rest of the
// final price. When the split can't be known, one "צילום האירוע" row and `needsSplit` says why:
//   'no_package'  — no package found for the couple
//   'no_split'    — the package has no stills/video split yet (Settings ← packages)
//   'video_over'  — the package's video price is not below the couple's final price
// A package with a stills price and no video (or video set to 0) is stills only.
export function defaultOrderLines(finalPrice, pkg) {
  const total = money(finalPrice);
  if (!(total > 0)) return { lines: [], needsSplit: false };
  const one = (needsSplit) => ({ lines: [{ description: EVENT_LINE, price: total }], needsSplit });
  if (!pkg) return one('no_package');
  const video = money(pkg.videoPrice);
  if (video > 0) {
    if (total - video > 0) {
      return { lines: [{ description: STILLS_LINE, price: money(total - video) }, { description: VIDEO_LINE, price: video }], needsSplit: false };
    }
    return one('video_over');
  }
  const videoSetToZero = pkg.videoPrice !== null && pkg.videoPrice !== undefined && pkg.videoPrice !== '' && Number(pkg.videoPrice) === 0;
  if (money(pkg.stillsPrice) > 0 || videoSetToZero) return { lines: [{ description: STILLS_LINE, price: total }], needsSplit: false };
  return one('no_split');
}

export function linesTotal(lines) {
  return money((lines || []).reduce((s, l) => s + (Number(l.price) || 0), 0));
}

// The remarks printed on the order. All parts optional:
//   note       — the subcontractor clause (template)
//   deposit    — { amount, invoice?: { number, date } , orderNumber? }
//   receivedOn — the contract's signing date, when the order is dated later
//   replaces   — { number, date, reason, supplier }
export function orderRemarks({ note, deposit, receivedOn, documentDate, replaces } = {}) {
  const parts = [];
  if (replaces) {
    let line = `הזמנה זו מחליפה את הזמנת עבודה מס' ${replaces.number} מיום ${fmtDate(replaces.date)}.`;
    if (replaces.reason) line += ` סיבת העדכון: ${String(replaces.reason).trim().replace(/\.$/, "")}${replaces.supplier ? ` (${String(replaces.supplier).trim()})` : ""}.`;
    parts.push(line);
  }
  if (receivedOn && (!documentDate || String(receivedOn).slice(0, 10) < String(documentDate).slice(0, 10))) {
    parts.push(`ההזמנה התקבלה בתאריך ${fmtDate(receivedOn)} (חתימת החוזה).`);
  }
  if (deposit && money(deposit.amount) > 0) {
    if (deposit.invoice?.number) {
      parts.push(`מקדמה בסך ${ils(deposit.amount)} שולמה בחשבונית מס' ${deposit.invoice.number}${deposit.invoice.date ? ` מיום ${fmtDate(deposit.invoice.date)}` : ""}${deposit.orderNumber ? ` (מקושרת להזמנה מס' ${deposit.orderNumber})` : ""} — חלק מהסכום הכולל.`);
    } else {
      parts.push(`מקדמה לשריון התאריך בסך ${ils(deposit.amount)} — חלק מהסכום הכולל.`);
    }
  }
  if (note && String(note).trim()) parts.push(String(note).trim());
  return parts.join("\n");
}

// The couple's invoices that count against an order of business `businessType`: every invoice
// of that business (also ones issued before the order existed — a deposit paid at signing).
// Old invoices without a businessType were issued by the sole proprietorship.
export function invoicesForBusiness(invoices, businessType) {
  return (invoices || []).filter((i) => (i.businessType || "sole_prop") === businessType);
}

// What is left to invoice on the active order.
export function orderBalance(order, invoices) {
  if (!order) return null;
  const paid = invoicesForBusiness(invoices, order.business_type || order.businessType).reduce((s, i) => s + (Number(i.amount) || 0), 0);
  return money(Number(order.total) - paid);
}

// Before issuing an invoice against an order:
//   'partial' — a "תשלום יתרה" smaller than what is left: did the couple pay part directly
//               to a supplier? (then a replacement order first)
//   'over'    — more than what is left on the order
//   null      — fine
export function invoiceOrderCheck({ item, amount, balance }) {
  if (balance == null) return null;
  const a = money(amount);
  if (a > balance + 0.5) return "over";
  if (item === "תשלום יתרה" && a < balance - 0.5) return "partial";
  return null;
}

// The active order of a couple for a business (the newest one, if several by mistake).
export function activeOrder(orders, businessType) {
  return (orders || [])
    .filter((o) => o.status === "active" && (!businessType || (o.business_type || o.businessType) === businessType))
    .sort((a, b) => String(b.created_at || b.createdDate || "").localeCompare(String(a.created_at || a.createdDate || "")))[0] || null;
}

// An order whose issue did not finish ('issuing' — the outcome in Morning is unknown until it
// is checked). While one exists nothing new is issued for that business.
export function pendingOrder(orders, businessType) {
  return (orders || []).find((o) => o.status === "issuing" && (!businessType || o.business_type === businessType)) || null;
}

// The Israeli calendar date of a timestamp ("YYYY-MM-DD") — signed_at is stored in UTC, and a
// signature after midnight in Israel is still "yesterday" in UTC.
export function israelDateOf(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// The deposit invoice to mention on a (replacement) order.
export function depositInvoiceOf(invoices, businessType) {
  return invoicesForBusiness(invoices, businessType).find((i) => i.description === DEPOSIT_ITEM) || null;
}

// The browser's own network error ("Failed to fetch") in Hebrew. When it happens while issuing
// a document the request may still have reached Morning, so the text says to check first.
export function friendlyError(e, { fallback = "הפעולה נכשלה", issuing = false } = {}) {
  const msg = String(e?.message || "");
  // the browser's network error, or a gateway answer (502/503/504) — the server may still
  // have done the work
  if (/failed to fetch|networkerror|load failed|network request failed|\(HTTP 50[234]\)/i.test(msg)) {
    return issuing
      ? "לא התקבלה תשובה מהשרת — ייתכן שהמסמך כן הופק. סגרו את החלון ובדקו בחלונית הזוג (או ב-Morning) לפני שמנסים שוב."
      : "לא הצלחנו להגיע לשרת — בדקו את החיבור לאינטרנט ונסו שוב.";
  }
  return msg || fallback;
}
