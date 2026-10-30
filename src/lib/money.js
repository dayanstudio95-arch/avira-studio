// Money on screen (fix plan P28). No imports.
//
// Decision D22(4): agorot only on the invoice and payment screens (the invoice dialog, "ניהול חשבוניות",
// crew payments, the manual-payment and payment-request dialogs, the album portal's payment and totals);
// everywhere else whole shekels. The same amount used to show as ₪1,234.5, ₪1,234.50 or ₪1,235 depending
// on the page — 156 hand-written `₪${n.toLocaleString()}`.
//
//   formatILS(1234.5)                  → '₪1,235'
//   formatILS(1234.5, { agorot: true }) → '₪1,234.50'
//   formatILS(null)                    → '₪0'   ({ blank: true } → '')
//   formatAmount(5000.5, { agorot: true }) → '5,000.50' (no ₪, for a message that says ש"ח)
// Text amounts are read too ('1,800', '₪1,800' → 1800), like the database reads crew costs.

const whole = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 });
const withAgorot = new Intl.NumberFormat("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A number from a number or a money text; NaN when there is none. @param {any} amount */
export function toAmount(amount) {
  if (typeof amount === "number") return amount;
  if (typeof amount === "string") {
    const s = amount.replace(/[₪,\s]/g, "");
    return s === "" ? NaN : Number(s);
  }
  return NaN;
}

/**
 * The number alone, for a text that says ש"ח itself: '1,235', or '1,234.50' with { agorot: true };
 * '0' (or '' with { blank: true }) when there is no amount. A value that rounds to zero is never '-0'.
 * @param {any} amount
 * @param {{ agorot?: boolean, blank?: boolean }} [options]
 */
export function formatAmount(amount, { agorot = false, blank = false } = {}) {
  const n = toAmount(amount);
  if (!Number.isFinite(n)) return blank ? "" : agorot ? "0.00" : "0";
  const rounded = agorot ? Math.round(n * 100) / 100 : Math.round(n);
  const value = rounded === 0 ? 0 : agorot ? n : rounded;
  return (agorot ? withAgorot : whole).format(value);
}

/**
 * '₪1,235' — or '₪1,234.50' with { agorot: true }. A missing or unreadable amount is ₪0, or '' with
 * { blank: true }.
 * @param {any} amount
 * @param {{ agorot?: boolean, blank?: boolean }} [options]
 */
export function formatILS(amount, { agorot = false, blank = false } = {}) {
  const n = toAmount(amount);
  if (!Number.isFinite(n)) return blank ? "" : "₪0";
  return `₪${formatAmount(n, { agorot })}`;
}

/**
 * A price change with its sign (fix plan P53): '+₪100', '−₪50' (a discount), '₪0' — never '+₪-50'.
 * @param {any} amount
 * @param {{ agorot?: boolean, blank?: boolean }} [options]
 */
export function formatSignedILS(amount, { agorot = false, blank = false } = {}) {
  const n = toAmount(amount);
  if (!Number.isFinite(n)) return blank ? "" : "₪0";
  const shown = formatILS(Math.abs(n), { agorot });
  if (shown === formatILS(0, { agorot })) return shown;
  return `${n < 0 ? "−" : "+"}${shown}`;
}
