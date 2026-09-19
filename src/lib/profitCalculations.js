import { getVatPercent, getEventVatAmount, getEventTeamCost } from './financialCalculations';

/**
 * רווח נקי לאירוע = מחיר ברוטו − מע"מ − עלות הצוות שנרשמה באירוע.
 *
 * FIXED 2026-09-19, after the owner asked whether the Reports page adds up. It did not:
 * on the same card, "Total Expenses" summed team[].cost while "Net Profit" came from
 * here — and this function did two things that made the lines disagree:
 *
 *   1. When `staffMembers` was passed (Dashboard, Reports), it REPLACED each member's
 *      snapshotted cost with that staff member's CURRENT per-role rate. Raise a
 *      photographer's rate today and the profit of every wedding he ever shot dropped,
 *      while the expenses line next to it did not move. December 2026 showed
 *      147,000 − 22,423.74 − 44,500 = 80,076.26 on paper and 77,076.27 on screen.
 *      team[].cost is a snapshot on purpose (see staffRates.js, Dashboard.jsx) and it is
 *      the number Payments.jsx actually pays out — so it is the expense.
 *   2. It returned the stored events.profit_net when present. That column is written
 *      only by the event save forms, and every staff-assignment path writes `team`
 *      without touching it, so a stored value goes stale the first time the crew changes.
 *
 * Now it is always computed, from the same VAT figure the reports display
 * (getEventVatAmount), so gross − VAT − expenses = profit holds to the agora on every
 * screen. `staffMembers` is kept in the signature for the existing callers and ignored.
 */
export const calculateNetProfit = (event, _staffMembers = []) => {
  if (!event || !event.totalAmountGross) return 0;
  const profit = event.totalAmountGross - getEventVatAmount(event) - getEventTeamCost(event);
  return Math.round(profit * 100) / 100;
};

/**
 * חישוב אחוז רווח ביחס לסכום לפני מע"מ
 */
export const calculateProfitPercentage = (event, staffMembers = []) => {
  if (!event || !event.totalAmountGross) return 0;
  
  const profitNet = calculateNetProfit(event, staffMembers);
  const grossAmount = event.totalAmountGross;
  const amountBeforeVat = grossAmount / (1 + getVatPercent(event) / 100);

  return amountBeforeVat > 0 ? (profitNet / amountBeforeVat) * 100 : 0;
};

/**
 * קבלת צבע בהתאם לרווח
 */
export const getProfitColor = (event, staffMembers = []) => {
  const profitPercentage = calculateProfitPercentage(event, staffMembers);

  if (profitPercentage >= 35) {
    return 'text-green-400'; // ירוק - רווח טוב
  } else if (profitPercentage >= 20) {
    return 'text-yellow-400'; // צהוב - רווח בסדר
  } else {
    return 'text-red-400'; // אדום - רווח נמוך (אזהרה)
  }
};