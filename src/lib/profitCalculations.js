import { getVatPercent } from './financialCalculations';

/**
 * רווח נקי לאירוע — מהשדה השמור ב-DB אם קיים, אחרת חישוב חי
 */
export const calculateNetProfit = (event, staffMembers = []) => {
  if (!event || !event.totalAmountGross) return 0;
  if (event.profitNet != null) return event.profitNet;

  const amountBeforeVat = event.totalAmountGross / (1 + getVatPercent(event) / 100);
  const teamExpenses = (event.team || []).reduce((sum, member) => {
    let cost = parseFloat(member.cost) || 0;
    if (member.staffMemberName && staffMembers.length > 0) {
      const staff = staffMembers.find(s => s.name === member.staffMemberName);
      if (staff?.ratesByRole?.length > 0) {
        const roleRate = staff.ratesByRole.find(r => r.role === member.role);
        if (roleRate) cost = parseFloat(roleRate.rate) || 0;
      }
    }
    return sum + cost;
  }, 0);

  return amountBeforeVat - teamExpenses;
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