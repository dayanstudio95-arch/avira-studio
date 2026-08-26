// Financial calculations helper for the photography studio
// Constants
export const DROR_EDITOR_COST = 1200; // Editor (Dror) fixed cost in NIS

/**
 * השיעור החוקי שספק/פרילנסר עוסק מורשה מחייב את הסטודיו. זו *לא* הגדרת המע"מ
 * של הסטודיו עצמו (tenants.default_vat_percent) — סטודיו עוסק פטור עדיין מקבל
 * חשבונית עם מע"מ מצלם מורשה. אין כיום שדה מע"מ ברמת איש צוות, ולכן זה קבוע.
 */
export const SUPPLIER_VAT_RATE = 1.18;

/**
 * שיעור המע"מ של אירוע ספציפי. events.vat_percent הוא NOT NULL DEFAULT 18
 * ונחתם מ-tenants.default_vat_percent ביצירה — ה-fallback חל רק על אובייקטים
 * שטרם נשמרו. ?? ולא || כדי שאירוע פטור ממע"מ (0) לא ייפול חזרה ל-18.
 */
export const getVatPercent = (event, fallbackPercent = 18) =>
  event?.vatPercent ?? fallbackPercent;

/**
 * Calculate financial details for an event
 * @param {Object} event - Event data
 * @returns {Object} Calculated financial data
 */
export const calculateEventFinancials = (event, staffMembers = []) => {
  const totalAmountGross = event.totalAmountGross || 0;
  const vatPercent = getVatPercent(event);
  const amountBeforeVat = Math.round((totalAmountGross / (1 + vatPercent / 100)) * 100) / 100;
  const vatAmount = Math.round((totalAmountGross - amountBeforeVat) * 100) / 100;
  const totalExpenses = (event.team || []).reduce((sum, m) => sum + (m.cost || 0), 0);
  const profitNet = Math.round((amountBeforeVat - totalExpenses) * 100) / 100;
  const profitPercentage = amountBeforeVat > 0 ? Math.round((profitNet / amountBeforeVat) * 100) : 0;

  return {
    amountBeforeVat: Math.round(amountBeforeVat * 100) / 100,
    vatAmount: Math.round(vatAmount * 100) / 100,
    totalExpenses,
    profitNet: Math.round(profitNet * 100) / 100,
    profitPercentage
  };
};

/**
 * Determine profit color based on percentage
 * @param {number} profitPercentage - Profit as percentage of net income
 * @returns {string} Tailwind color classes
 */
export const getProfitColorClass = (profitPercentage) => {
  if (profitPercentage >= 35) {
    return 'text-green-400'; // Good profit
  } else if (profitPercentage < 25) {
    return 'text-red-400'; // Low profit
  }
  return 'text-yellow-400'; // Medium profit
};

/**
 * Get profit status badge
 * @param {number} profitPercentage - Profit as percentage of net income
 * @returns {Object} Badge config with label and colors
 */
export const getProfitStatus = (profitPercentage) => {
  if (profitPercentage >= 35) {
    return {
      label: 'ברווח טוב',
      bgColor: 'bg-green-500/20',
      textColor: 'text-green-400',
      borderColor: 'border-green-500/30'
    };
  } else if (profitPercentage < 25) {
    return {
      label: 'רווח נמוך',
      bgColor: 'bg-red-500/20',
      textColor: 'text-red-400',
      borderColor: 'border-red-500/30'
    };
  }
  return {
    label: 'רווח בינוני',
    bgColor: 'bg-yellow-500/20',
    textColor: 'text-yellow-400',
    borderColor: 'border-yellow-500/30'
  };
};