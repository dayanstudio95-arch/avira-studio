// Album orders, 2026-10-29 (the owner's design): the details he types into the print shop's
// order form, in his order; the reminder to a couple still reviewing their sketch; when the
// couple last opened their link; and the sidebar count of orders waiting for payment.
// Pure — PART 74.

// Older orders kept the address as one line ("שוחט ישראל 12 הרצליה"); the print shop wants
// city and street apart. Split after the house number (street + number, then the city). An
// address that ends with its number, or has none, stays whole in the street.
export function splitAddress(address) {
  const a = String(address || "").trim();
  if (!a) return { street: "", city: "" };
  const m = a.match(/^(.*\d+[א-ת]?(?:\s*\/\s*\d+)?)[\s,]+([^\d,]+?)\s*$/);
  if (m) return { street: m[1].replace(/[\s,]+$/, "").trim(), city: m[2].trim() };
  return { street: a, city: "" };
}

export function shippingParts(order) {
  if (order?.shippingCity || order?.shippingStreet) {
    return { street: order.shippingStreet || "", city: order.shippingCity || "" };
  }
  return splitAddress(order?.shippingAddress);
}

const isCategory = (addon, catalogById, category, nameHint) => {
  const cat = catalogById?.[addon.addonId]?.category;
  return cat ? cat === category : nameHint.test(String(addon.addonNameSnapshot || ""));
};

const ENGRAVING_TYPE = { colored: "צבעונית", blind: "עיוורת (בלי צבע)" };
const ENGRAVING_SCOPE = { main_only: "רק האלבום הראשי", full_set: "כל הסט" };

// Rows in the owner's order; a row without a value is left out (no engraving, no parents'
// album, no mini album …). { key, label, value, image? }
export function printDetailRows({ order, selection, cover, addons = [], addonCatalogById = {}, spreadsCount, coupleNames, printLink }) {
  const rows = [];
  const add = (key, label, value, extra = {}) => {
    if (value === null || value === undefined || String(value).trim() === "") return;
    rows.push({ key, label, value: String(value), ...extra });
  };
  add("product", "מוצר", selection?.productNameSnapshot?.trim());
  add("names", "שמות הזוג", coupleNames);
  add("link", "קישור לקבצים", printLink || "", { ltr: true });
  const extra = addons.filter((a) => isCategory(a, addonCatalogById, "extra_pages", /עמוד נוסף/)).reduce((n, a) => n + (Number(a.quantity) || 0), 0);
  if (spreadsCount) add("pages", "מספר דפים", `${spreadsCount} כפולות${extra ? ` (${spreadsCount - extra} + ${extra} נוספות)` : ""}`);
  add("cover", "כריכה", selection?.coverNameSnapshot, { image: cover?.previewImageUrl || null });
  if (selection?.engravingText) {
    const parts = [`"${selection.engravingText}"`];
    if (selection.engravingTextLine2) parts.push(`שורה 2: "${selection.engravingTextLine2}"`);
    if (selection.engravingType) parts.push(ENGRAVING_TYPE[selection.engravingType] || selection.engravingType);
    if (selection.engravingColorNameSnapshot) parts.push(`צבע: ${selection.engravingColorNameSnapshot}`);
    if (selection.engravingFontNameSnapshot) parts.push(`גופן: ${selection.engravingFontNameSnapshot}`);
    if (selection.engravingScope) parts.push(ENGRAVING_SCOPE[selection.engravingScope] || selection.engravingScope);
    add("engraving", "הטבעת שמות", parts.join(" · "));
  }
  const qty = (pred) => addons.filter(pred).reduce((n, a) => n + (Number(a.quantity) || 1), 0);
  const parents = qty((a) => isCategory(a, addonCatalogById, "parent_album", /הורים/));
  if (parents) add("parents", "אלבום הורים", parents > 1 ? `כן × ${parents}` : "כן");
  const mini = qty((a) => isCategory(a, addonCatalogById, "mini_album", /משב?יצון|מיני/));
  if (mini) add("mini", "משביצון", mini > 1 ? `כן × ${mini}` : "כן");
  return rows;
}

export function shippingRows(order) {
  const { street, city } = shippingParts(order);
  const rows = [];
  const add = (key, label, value, extra = {}) => { if (String(value || "").trim()) rows.push({ key, label, value: String(value).trim(), ...extra }); };
  add("ship_name", "שם", order?.shippingName);
  add("ship_city", "עיר", city);
  add("ship_street", "רחוב", street);
  add("ship_phone", "טלפון", order?.shippingPhone, { ltr: true });
  return rows;
}

// "העתק הכל": one "label: value" line per row, the shipping block after an empty line.
export function printDetailsText(rows, ship) {
  const line = (r) => `${r.label}: ${r.value}`;
  return [...rows.map(line), ...(ship.length ? ["", "משלוח:", ...ship.map(line)] : [])].join("\n");
}

// Waiting for the studio: the couple chose and has to pay, or sent a transfer to approve.
export function isAwaitingPayment(order) {
  if (!order || order.paymentStatus === "paid") return false;
  return order.workflowStatus === "awaiting_payment" || order.paymentStatus === "transfer_pending_review";
}

// The order of the list (2026-10-30, the owner): "נדרש תיקון" first, then waiting for
// payment, then everything still open, and what is at the print shop or past it last
// (2026-10-07). Within each part the server's newest-first order is kept (the sort is stable).
const DONE_STATUSES = ["in_print", "delivered", "completed"];
export function orderListRank(order) {
  if (DONE_STATUSES.includes(order?.workflowStatus)) return 3;
  if (order?.workflowStatus === "revision_requested") return 0;
  if (isAwaitingPayment(order)) return 1;
  return 2;
}

export function sortOrdersForList(orders) {
  return [...(orders || [])].sort((a, b) => orderListRank(a) - orderListRank(b));
}

// "היום 14:20" / "אתמול 21:40" / "12/10 09:15" — in Israel time.
export function lastOpenedText(iso, now = new Date()) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const tz = "Asia/Jerusalem";
  const day = (x) => x.toLocaleDateString("en-CA", { timeZone: tz });
  const time = d.toLocaleTimeString("he-IL", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
  const today = day(now);
  const yesterday = day(new Date(now.getTime() - 86400000));
  if (day(d) === today) return `היום ${time}`;
  if (day(d) === yesterday) return `אתמול ${time}`;
  const [, m, dd] = day(d).split("-");
  return `${Number(dd)}/${Number(m)} ${time}`;
}

export const REVIEW_REMINDER_TEMPLATE_KEY = "template_album_review_reminder";
export const DEFAULT_REVIEW_REMINDER = `היי {{names}} 😊
רק מזכירים שהסקיצה של האלבום מחכה לכם לבדיקה ואישור 💛
אפשר לסמן הערות על כל עמוד, ולאשר כשמוכן:
{{link}}`;

// After "אושר" the couple still has to choose the cover, add-ons and shipping, and pay — an
// order can sit there for days (the owner, 2026-10-29), so it gets its own reminder.
export const PURCHASE_REMINDER_TEMPLATE_KEY = "template_album_purchase_reminder";
export const DEFAULT_PURCHASE_REMINDER = `היי {{names}} 😊
האלבום שלכם אושר 💛
נשאר רק לבחור כריכה, תוספות ופרטי משלוח — ולסיים את ההזמנה:
{{link}}`;

// Which reminder an order gets in the list: "review" (in the couple's review), "purchase"
// (approved, nothing chosen yet), or null.
export function reminderKind(order) {
  if (order?.workflowStatus === "in_review") return "review";
  if (order?.workflowStatus === "approved" && order?.paymentStatus !== "paid") return "purchase";
  return null;
}

export const REMINDERS = {
  review: { key: REVIEW_REMINDER_TEMPLATE_KEY, fallback: DEFAULT_REVIEW_REMINDER, title: "תזכורת לבדיקת סקיצה", hint: "שלח לזוג תזכורת לבדוק את הסקיצה" },
  purchase: { key: PURCHASE_REMINDER_TEMPLATE_KEY, fallback: DEFAULT_PURCHASE_REMINDER, title: "תזכורת להשלמת ההזמנה", hint: "שלח לזוג תזכורת לבחור כריכה ומשלוח ולסיים את ההזמנה" },
};

export function renderAlbumReminder(kind, template, { names, link }) {
  const tpl = String(template || "").trim() ? template : (REMINDERS[kind] || REMINDERS.review).fallback;
  return tpl.replace(/\{\{names\}\}/g, names || "").replace(/\{\{link\}\}/g, link || "").trim();
}

export function renderReviewReminder(template, vars) {
  return renderAlbumReminder("review", template, vars);
}
