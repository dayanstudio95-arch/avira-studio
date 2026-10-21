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
//   deposit    — { amount, invoice?: { number, date, businessLabel? }, orderNumber? }
//                businessLabel: set when the deposit was invoiced by the OTHER business
//   prior      — invoices already issued to the couple before this order (not the deposit):
//                [{ description, amount, number, date, businessLabel? }]
//   receivedOn — the contract's signing date, when the order is dated later
//   recordedOn — the day the order is actually issued (today); when the order carries an
//                earlier date this is said, and invoices dated after the order's date are
//                described without "paid/already" (they came after that date)
//   replaces   — { number, date, reason, supplier }
export function orderRemarks({ note, deposit, prior, receivedOn, documentDate, recordedOn, replaces } = {}) {
  const docDay = documentDate ? String(documentDate).slice(0, 10) : null;
  const backdated = !!(docDay && recordedOn && docDay < String(recordedOn).slice(0, 10));
  const afterOrderDate = (d) => !!(docDay && d && String(d).slice(0, 10) > docDay);
  const parts = [];
  if (replaces) {
    let line = `הזמנה זו מחליפה את הזמנת עבודה מס' ${replaces.number} מיום ${fmtDate(replaces.date)}.`;
    if (replaces.reason) line += ` סיבת העדכון: ${String(replaces.reason).trim().replace(/\.$/, "")}${replaces.supplier ? ` (${String(replaces.supplier).trim()})` : ""}.`;
    parts.push(line);
  }
  if (receivedOn && (!documentDate || String(receivedOn).slice(0, 10) !== String(documentDate).slice(0, 10))) {
    parts.push(`ההזמנה התקבלה בתאריך ${fmtDate(receivedOn)} (חתימת החוזה).`);
  }
  if (backdated) parts.push(`ההזמנה נרשמה בספר ההזמנות ביום ${fmtDate(recordedOn)}.`);
  if (deposit && money(deposit.amount) > 0) {
    if (deposit.invoice?.number) {
      const where = deposit.invoice.businessLabel ? ` של ה${deposit.invoice.businessLabel}` : "";
      const verb = afterOrderDate(deposit.invoice.date) ? "—" : "שולמה";
      parts.push(`מקדמה בסך ${ils(deposit.amount)} ${verb} בחשבונית מס' ${deposit.invoice.number}${where}${deposit.invoice.date ? ` מיום ${fmtDate(deposit.invoice.date)}` : ""}${deposit.orderNumber ? ` (מקושרת להזמנה מס' ${deposit.orderNumber})` : ""} — חלק מהסכום הכולל.`);
    } else {
      parts.push(`מקדמה לשריון התאריך בסך ${ils(deposit.amount)} — חלק מהסכום הכולל.`);
    }
  }
  const before = (prior || []).filter((i) => i && money(i.amount) > 0 && i.number);
  if (before.length) {
    const items = before.map((i) =>
      `${i.description || "תשלום"} ${ils(i.amount)} — חשבונית מס' ${i.number}${i.businessLabel ? ` של ה${i.businessLabel}` : ""}${i.date ? ` מיום ${fmtDate(i.date)}` : ""}`);
    parts.push(`${backdated ? "חשבוניות שהופקו לזוג עד יום הרישום" : "חשבוניות שכבר הופקו לזוג"}: ${items.join("; ")}.`);
  }
  if (note && String(note).trim()) parts.push(String(note).trim());
  return parts.join("\n");
}

// The couple's invoices, oldest first (old ones without businessType are the sole proprietor's).
export function coupleInvoices(invoices) {
  return (invoices || [])
    .filter((i) => i && money(i.amount) > 0)
    .map((i) => ({ ...i, businessType: i.businessType || "sole_prop" }))
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
}

// The deposit invoice to mention: the order's own business first, otherwise the other one's.
export function depositInvoiceAny(invoices, businessType) {
  const list = coupleInvoices(invoices).filter((i) => i.description === DEPOSIT_ITEM);
  return list.find((i) => i.businessType === businessType) || list[0] || null;
}

// The business of the couple's most recent invoice — a default when the couple's business
// was never set (old invoices are the sole proprietor's).
export function businessFromInvoices(invoices) {
  const list = coupleInvoices(invoices);
  return list.length ? list[list.length - 1].businessType : null;
}

// The order's date: Morning accepts from the business's last order of this type up to today
// (GET /documents/info?type=100 → lastDocumentDate, today). Earlier is Morning-website-only
// (≤60 days) and not offered here. Returns an error text or null.
// receivedOn: the contract's signing day — an order is never dated before it was received.
// Kept in step with supabase/functions/_shared/workOrder.ts orderDateProblem.
export function orderDateProblem(date, { today, lastDocumentDate, receivedOn } = {}) {
  const d = String(date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return "בחרו תאריך להזמנה";
  if (today && d > today) return "אי אפשר להוציא הזמנה בתאריך עתידי";
  if (lastDocumentDate && d < lastDocumentDate) return `Morning מאפשר תאריך מההזמנה האחרונה של העסק (${fmtDate(lastDocumentDate)}) ועד היום`;
  if (receivedOn && d < String(receivedOn).slice(0, 10)) return `תאריך ההזמנה לא יכול להיות לפני חתימת החוזה (${fmtDate(receivedOn)})`;
  return null;
}

// Quick picks for the date: today, the signing day, the deposit invoice's day — each with
// whether Morning would accept it.
export function orderDateChoices({ today, lastDocumentDate, signedOn, depositDate } = {}) {
  const raw = [
    { key: "today", label: "היום", date: today },
    { key: "signed", label: "תאריך החתימה", date: signedOn },
    { key: "deposit", label: "תאריך חשבונית המקדמה", date: depositDate },
  ];
  return raw.filter((c) => c.date)
    .map((c) => ({ ...c, date: String(c.date).slice(0, 10), allowed: !orderDateProblem(c.date, { today, lastDocumentDate, receivedOn: signedOn }) }));
}

export function invoicesForBusiness(invoices, businessType) {
  return (invoices || []).filter((i) => (i.businessType || "sole_prop") === businessType);
}

// What is left to invoice on the active order.
// What is left to invoice on an order: its total minus the invoices of its business — and,
// when the deposit was invoiced by the OTHER business, that deposit too (the order's remarks
// name it as part of the total).
export function orderBalance(order, invoices) {
  if (!order) return null;
  const b = order.business_type || order.businessType;
  const own = invoicesForBusiness(invoices, b);
  let paid = own.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  if (!own.some((i) => i.description === DEPOSIT_ITEM)) {
    const dep = depositInvoiceAny(invoices, b);
    // …unless that deposit already belongs to the other business's own order
    const linkedElsewhere = dep?.workOrderId && dep.workOrderId !== order.id;
    if (dep && dep.businessType !== b && !linkedElsewhere) paid += Number(dep.amount) || 0;
  }
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
