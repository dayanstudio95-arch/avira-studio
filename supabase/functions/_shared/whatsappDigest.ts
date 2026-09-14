// The daily digest the studio gets on WhatsApp every morning (2026-09-15).
//
// Pure: takes counts, returns text. The gathering lives in whatsappHousekeeping.ts so
// this can be tested without a database. What goes in was chosen for one reader — the
// owner, on a phone, before the first coffee — so it is short, every line is a number
// they can act on, and the one line that matters most is the last: if the bot heard
// NOTHING in 24 hours, the WhatsApp connection has probably dropped, and no other
// signal in the system would tell them.

export interface DigestStats {
  newStrangers: number;      // conversations from unknown numbers opened in the window
  greetings: number;         // bot:greeting sends in the window
  pricelists: number;        // bot:pricelist sends in the window
  hotLeads: string[];        // names rated hot in the window
  waitingFollowUp: number;   // PRICELIST_SENT, silent, not yet nudged (all time)
  stalledFlow: number;       // mid-flow and quiet for a day+ (all time)
  mediaFromStrangers: number;// strangers whose first message the bot could not read
  deferredPending: number;   // held for quiet hours, not yet sent
  inboundMessages: number;   // every inbound message in the window, any sender
  botEnabled: boolean;
}

export function composeDigest(stats: DigestStats, dateLabel: string): string {
  const lines: string[] = [];
  lines.push(`☀️ סיכום בוט וואטסאפ — ${dateLabel}`);
  if (!stats.botEnabled) lines.push(`⏸️ הבוט כבוי בהגדרות — רק מקליט, לא עונה.`);
  lines.push('');
  lines.push(`ב-24 השעות האחרונות:`);
  lines.push(`• פניות חדשות ממספרים לא מוכרים: ${stats.newStrangers}`);
  lines.push(`• ברכות שהבוט שלח: ${stats.greetings}`);
  lines.push(`• מחירונים שנשלחו: ${stats.pricelists}`);
  if (stats.hotLeads.length > 0) {
    lines.push(`🔥 לידים חמים: ${stats.hotLeads.join(', ')}`);
  } else {
    lines.push(`• לידים חמים: 0`);
  }
  lines.push('');
  lines.push(`מחכים לך:`);
  lines.push(`• ממתינים לפולו-אפ אחרי מחירון: ${stats.waitingFollowUp}`);
  lines.push(`• התחילו ולא סיימו למסור פרטים: ${stats.stalledFlow}`);
  if (stats.mediaFromStrangers > 0) {
    lines.push(`• שלחו הודעה קולית/תמונה והבוט לא יכול לקרוא: ${stats.mediaFromStrangers}`);
  }
  if (stats.deferredPending > 0) {
    lines.push(`• הודעות שממתינות לסיום שעות השקט: ${stats.deferredPending}`);
  }
  if (stats.inboundMessages === 0) {
    lines.push('');
    lines.push(`⚠️ לא התקבלה אף הודעה ב-24 השעות האחרונות — ייתכן שהחיבור לוואטסאפ נותק. כדאי לבדוק בהגדרות ← אינטגרציות.`);
  }
  return lines.join('\n');
}
