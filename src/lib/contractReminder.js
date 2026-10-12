// "תזכורת לחוזה שלא נחתם" (2026-10-13, the owner's choice: a ready message in the chat that
// he sends with one click — nothing is sent by itself). Pure — PART 57.

export const CONTRACT_REMINDER_AFTER_DAYS = 3;
// Older than this the lead is no longer a reminder, it is a lost lead.
export const CONTRACT_REMINDER_MAX_DAYS = 60;
const CLOSED = ["לא רלוונטי", "חוזה", "נסגר/חתימה"];

// Same text as the template's default in הגדרות ← תבניות ("תזכורת פולו-אפ (חוזה לא נחתם)").
export const DEFAULT_CONTRACT_REMINDER = `היי {{names}} 😊
רצינו לבדוק שקיבלתם את קישור החוזה ולוודא שהכל בסדר מצידכם.
נשמח שתחתמו בהקדם כדי לשריין את התאריך:
{{contract_link}}

זמינים לכל שאלה! 📸`;

const israelDay = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });

export function daysSince(iso, now = new Date()) {
  if (!iso) return null;
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 86400000);
}

export function isContractReminderDue(lead, now = new Date(), afterDays = CONTRACT_REMINDER_AFTER_DAYS) {
  if (!lead || !lead.contractSent || lead.signedAt || lead.contractReminderDoneAt) return false;
  if (CLOSED.includes(lead.status)) return false;
  if (!lead.phoneNumber) return false;
  if (lead.eventDate && String(lead.eventDate).slice(0, 10) < israelDay(now)) return false;
  const d = daysSince(lead.contractSentAt, now);
  return d !== null && d >= afterDays && d <= CONTRACT_REMINDER_MAX_DAYS;
}

// The oldest first: they have waited the longest.
export function dueContractReminders(leads, now = new Date()) {
  return (leads || [])
    .filter((l) => isContractReminderDue(l, now))
    .sort((a, b) => String(a.contractSentAt).localeCompare(String(b.contractSentAt)));
}
