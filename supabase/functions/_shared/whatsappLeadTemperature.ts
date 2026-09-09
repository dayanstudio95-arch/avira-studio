// Reads what a customer wrote AFTER receiving the price list and rates how close they
// are to booking.
//
// ⚠️ This sends nothing, ever. It writes a label on a row in the inbox so Daniel knows
// which conversation to open first. That is the entire feature.
//
// Why AI here, when the reply gate is a hand-written word list
// ---------------------------------------------------------------------------------
// _shared/whatsappIntent.ts had to be a readable, fail-closed word list because a
// mistake there sends a price list to a colleague — a real, embarrassing, unrecoverable
// cost. A mistake here costs one glance at a row that didn't need attention. The two
// jobs have wildly different failure costs, so they get different tools, and this file
// is deliberately the generous one.
//
// It also happens to be the job a word list is worst at. "וואו, זה בדיוק מה שחיפשנו"
// and "אנחנו בפנים" and "אפשר לדבר מחר בערב?" share no vocabulary at all, and the
// difference between "נראה מעולה, כמה זה התחייבות?" (hot) and "נראה מעולה, נחשוב"
// (cold) is not lexical.

import { callClaude } from './anthropic.ts';

export type LeadTemperature = 'hot' | 'warm' | 'cold';

export interface TemperatureResult {
  temperature: LeadTemperature | null;
  reason: string | null;
}

export const EMPTY_TEMPERATURE: TemperatureResult = { temperature: null, reason: null };

const SYSTEM_PROMPT = `אתה עוזר לסטודיו צילום אירועים לדרג עד כמה לקוח קרוב לסגור, לפי מה שכתב אחרי שקיבל מחירון.

החזר JSON בלבד, בלי טקסט לפניו או אחריו:
{"temperature": "hot" | "warm" | "cold", "reason": "משפט קצר אחד בעברית"}

הדירוגים:
- "hot" — מבקש לסגור, לקבוע פגישה או שיחת טלפון, שואל על מקדמה/תשלום/חוזה, מאשר תאריך, או מביע התלהבות ברורה עם כוונה להתקדם. דוגמאות: "אנחנו בפנים", "מתי אפשר להיפגש?", "איך סוגרים?", "אפשר לדבר בטלפון?", "מה הלאה?", "רוצים את חבילת הפרימיום".
- "warm" — מתעניין וממשיך לשאול, אבל עוד לא מבקש להתקדם. שאלות על מה כלול, על תוספות, על הנחה, בקשה לראות עוד עבודות, או "נחזור אליכם" עם המשך שיחה.
- "cold" — מנומס וסוגר: "תודה, נחשוב", "יקר לנו", "מצאנו מישהו אחר", "לא רלוונטי", או תודה בלבד בלי שאלה.

reason — משפט קצר שמסביר על סמך מה דירגת, כדי שאדם יוכל לקרוא ולהחליט אם טעית. אל תצטט את כל ההודעה.
אם ההודעה לא קשורה בכלל (הודעה שנשלחה בטעות, סתם אימוג'י) — החזר "cold".`;

const VALID: LeadTemperature[] = ['hot', 'warm', 'cold'];

function extractJson(text: string): Record<string, unknown> | null {
  // The model is told to return bare JSON; a stray ```json fence or a leading sentence
  // is the classic failure. Take the outermost braces rather than trusting the whole
  // string to parse.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// Exported for the test suite: everything after the network call is pure, and it is
// where the interesting failure modes live (a model that invents a fourth temperature,
// or returns prose instead of JSON).
export function parseTemperatureResponse(text: string): TemperatureResult {
  const raw = extractJson(text);
  if (!raw) return { ...EMPTY_TEMPERATURE };

  const value = String(raw.temperature ?? '').trim().toLowerCase();
  // An unrecognised value reads as "not rated" rather than being coerced to something.
  // The DB has a CHECK constraint on this column, so writing junk would fail the whole
  // conversation update — the row would lose its state transition over a label.
  if (!VALID.includes(value as LeadTemperature)) return { ...EMPTY_TEMPERATURE };

  const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';
  return {
    temperature: value as LeadTemperature,
    // Capped: this renders on one line under a name in a list.
    reason: reason ? reason.slice(0, 200) : null,
  };
}

// `replyText` is the customer's own message only. Never include the price list we sent —
// it is full of enthusiastic sales copy and a model reading it back would rate our own
// marketing as the customer's excitement.
export async function classifyReply(
  replyText: string | null | undefined,
  apiKey: string | null
): Promise<TemperatureResult> {
  if (!replyText || !replyText.trim()) return { ...EMPTY_TEMPERATURE };

  try {
    const res = await callClaude({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: replyText }],
      apiKey,
      // The same message must not be hot on Monday and warm on Tuesday — Daniel is
      // going to learn to trust this ordering, and it has to be stable to be trusted.
      temperature: 0,
    });
    const text = res.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    return parseTemperatureResponse(text);
  } catch (e: any) {
    // Rating is a nice-to-have on top of a conversation that is already safely stored.
    // A failure here must never propagate: it would turn a labelling problem into a
    // 500, and Green API would redeliver the customer's message for 24 hours.
    console.error('[whatsappLeadTemperature] classification failed:', e?.message || e);
    return { ...EMPTY_TEMPERATURE };
  }
}
