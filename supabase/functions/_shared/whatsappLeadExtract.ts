// Pulls event details out of what a customer actually wrote back to the bot.
//
// ⚠️ Why this does NOT call parseWhatsAppLead, contrary to the original plan
// ---------------------------------------------------------------------------------
// The plan said "existing parser first, Claude only for the gaps". That was written
// before anyone ran the parser on conversational text, and it does not survive contact
// with it. src/lib/whatsappLeadParser.js is built for the studio's OWN dictated format
// — one field per line, assigned positionally (first free line = couple names, next =
// venue). Measured against realistic bot replies on 2026-09-09:
//
//   "אנחנו דניאל ושני, מתחתנים ב-12.7.27 באולם הגן, בערך 300 אורחים"
//      -> venueName = the entire sentence. No date at all.
//   "היי! קוראים לנו יעל ואורי / התאריך 5.6.27 / גן ורדים בראשון / 250 מוזמנים"
//      -> venueName = "התאריך 5.6.27", and the real venue fell into leftovers.
//   "קסניה וקיריל. התאריך הוא 30.11 באולם בית ברעננה כ100 אורחים"  (a real message)
//      -> coupleNames = the entire sentence.
//
// The failure mode is the dangerous one: it does not leave a gap for Claude to fill,
// it confidently fills the field with something wrong. Combined with the standing rule
// "a date the parser found always beats the model", a wrong parser reading would
// actively override a correct one.
//
// So the split is drawn where each side is actually competent:
//   - Claude finds WHICH SUBSTRING is the date, the names, the venue, the guest count.
//     That is a reading-comprehension problem, which is what it is good at.
//   - parseIsraeliDate turns that substring into a real calendar date, and its verdict
//     is final. That is what the original decision was protecting against — the model
//     inventing or mis-converting a date — and this preserves it exactly, while keeping
//     the parser's positional guessing away from prose it was never designed for.
//
// parseIsraeliDate and normalizeIsraeliPhone are copied below rather than imported:
// they live in src/ and Edge Functions cannot import from there. Same deliberate
// "kept in sync manually" convention documented in _shared/automationGuards.ts and
// _shared/phone.ts. Copied verbatim — if the originals change, change these too.

import { callClaude } from './anthropic.ts';

const BIDI_AND_INVISIBLES = new RegExp('[\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2069\\uFEFF]', 'g');
const HEB = '\\u0590-\\u05FF';
const HEB_MONTH_DATE_RE = new RegExp('^(\\d{1,2})\\s*(?:ב)?[-\\s]?([' + HEB + ']+)\\.?(?:\\s+(\\d{2,4}))?$');
const HEBREW_MONTHS: Record<string, number> = {
  'ינואר': 1, 'פברואר': 2, 'מרץ': 3, 'מרס': 3, 'אפריל': 4, 'מאי': 5, 'יוני': 6,
  'יולי': 7, 'אוגוסט': 8, 'ספטמבר': 9, 'אוקטובר': 10, 'נובמבר': 11, 'דצמבר': 12,
};

function toIso(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Round-trip check: new Date(2027, 1, 31) silently becomes March 3rd.
function isRealDate(y: number, m: number, d: number): boolean {
  if (!(y >= 1900 && y <= 2199) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function localTodayIso(today: Date): string {
  return toIso(today.getFullYear(), today.getMonth() + 1, today.getDate());
}

function expandYear(raw: string): number | null {
  const n = Number(raw);
  if (raw.length === 4) return n;
  if (raw.length === 2) return 2000 + n;
  return null;
}

export function normalizeIsraeliPhone(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  let d = String(raw).replace(BIDI_AND_INVISIBLES, '').replace(/\D/g, '');
  if (d.startsWith('00972')) d = '0' + d.slice(5);
  else if (d.startsWith('972')) d = '0' + d.slice(3);
  if (d.length === 9 && !d.startsWith('0')) d = '0' + d;
  if ((d.length === 9 || d.length === 10) && d.startsWith('0')) return d;
  return null;
}

export interface ParsedDate { iso: string; warnings: string[] }

// Verbatim copy of src/lib/whatsappLeadParser.js's parseIsraeliDate. Anchored (^...$),
// so it only ever runs on an isolated candidate string — never on a whole sentence.
export function parseIsraeliDate(raw: string | null | undefined, today: Date = new Date()): ParsedDate | null {
  if (!raw) return null;
  const line = String(raw).trim();
  const warnings: string[] = [];
  let y: number | null = null, m: number | null = null, d: number | null = null;

  let mt: RegExpMatchArray | null;
  if ((mt = line.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    y = Number(mt[1]); m = Number(mt[2]); d = Number(mt[3]);
  } else if ((mt = line.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/))) {
    const a = Number(mt[1]), b = Number(mt[2]);
    y = expandYear(mt[3]);
    if (y === null) return null;
    if (a > 12 && b <= 12) { d = a; m = b; }
    else if (a <= 12 && b > 12) { d = b; m = a; warnings.push('זוהה פורמט אמריקאי (חודש/יום) — התאריך הוחלף'); }
    else if (a <= 12 && b <= 12) {
      d = a; m = b;
      if (a !== b) warnings.push('תאריך דו-משמעי — פורש כיום/חודש. ודא שהתאריך נכון');
    } else return null;
  } else if ((mt = line.match(/^(\d{1,2})[./-](\d{1,2})$/))) {
    const a = Number(mt[1]), b = Number(mt[2]);
    if (b > 12) return null;
    d = a; m = b;
    if (a <= 12 && a !== b) warnings.push('תאריך דו-משמעי — פורש כיום/חודש. ודא שהתאריך נכון');
    const cy = today.getFullYear();
    y = isRealDate(cy, m, d) && toIso(cy, m, d) >= localTodayIso(today) ? cy : cy + 1;
    warnings.push('לא צוינה שנה — הושלמה אוטומטית');
  } else if ((mt = line.match(HEB_MONTH_DATE_RE))) {
    const mon = HEBREW_MONTHS[mt[2]];
    if (!mon) return null;
    d = Number(mt[1]); m = mon;
    if (mt[3]) {
      y = expandYear(mt[3]);
      if (y === null) return null;
    } else {
      const cy = today.getFullYear();
      y = isRealDate(cy, m, d) && toIso(cy, m, d) >= localTodayIso(today) ? cy : cy + 1;
      warnings.push('לא צוינה שנה — הושלמה אוטומטית');
    }
  } else {
    return null;
  }

  if (!isRealDate(y!, m!, d!)) return null;
  const iso = toIso(y!, m!, d!);
  if (iso < localTodayIso(today)) warnings.push('התאריך שזוהה כבר עבר — ודא שהוא נכון');
  return { iso, warnings };
}

// ---------------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------------

export interface LeadDetails {
  coupleNames: string | null;
  eventDate: string | null;   // ISO, or null
  venue: string | null;
  guestCount: number | null;
}

export const EMPTY_DETAILS: LeadDetails = {
  coupleNames: null, eventDate: null, venue: null, guestCount: null,
};

const SYSTEM_PROMPT = `אתה מחלץ פרטי אירוע מהודעות וואטסאפ בעברית שנשלחו לסטודיו לצילום אירועים.

החזר JSON בלבד, בלי טקסט לפניו או אחריו, במבנה:
{"couple_names": string|null, "event_date_raw": string|null, "venue": string|null, "guest_count": number|null}

כללים:
- couple_names — שמות בני הזוג בלבד, בלי מילות פתיחה. "קוראים לנו יעל ואורי" -> "יעל ואורי".
- event_date_raw — העתק מדויק של הטקסט שבו הלקוח כתב את התאריך, כפי שהוא. אל תמיר לפורמט אחר ואל תשלים שנה. "מתחתנים ב-12.7.27" -> "12.7.27". "ב16 ליוני" -> "16 ליוני".
- venue — שם האולם או המקום בלבד. "באולם הגן בראשון" -> "אולם הגן בראשון".
- guest_count — מספר שלם. "בערך 300 אורחים" -> 300. "כ100" -> 100.
- שדה שלא נאמר במפורש -> null. אל תנחש, אל תשלים ואל תמציא.
- אם ההודעה אינה קשורה לאירוע כלל, החזר את כל השדות כ-null.`;

function extractJson(text: string): Record<string, unknown> | null {
  // The model is told to return bare JSON, but a stray ```json fence or a leading
  // sentence is the classic failure. Take the outermost braces rather than trusting the
  // whole string to parse.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function cleanString(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (!t || t.length > maxLen) return null;
  return t;
}

function cleanGuestCount(value: unknown): number | null {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  // A wedding with 4 guests or 6000 is not what the customer meant; it is a
  // misread price, year or phone number. Out-of-range reads as "not stated".
  if (!Number.isFinite(n) || n < 5 || n > 5000) return null;
  return Math.round(n);
}

export interface ExtractResult {
  details: LeadDetails;
  dateWarnings: string[];
  failed: boolean;   // the model call or its JSON failed — NOT "nothing was found"
}

// `conversationText` is the customer's own inbound messages, newest last. Never include
// the bot's own greeting: it lists the four questions verbatim, and a model reading it
// back would happily extract them as if the customer had answered.
export async function extractLeadDetails(
  conversationText: string,
  apiKey: string | null,
  today: Date = new Date()
): Promise<ExtractResult> {
  if (!conversationText.trim()) {
    return { details: { ...EMPTY_DETAILS }, dateWarnings: [], failed: false };
  }

  let raw: Record<string, unknown> | null = null;
  try {
    const res = await callClaude({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: conversationText }],
      apiKey,
      // Reading, not writing: the same message must not resolve to two different dates.
      temperature: 0,
    });
    const text = res.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    raw = extractJson(text);
  } catch (e: any) {
    console.error('[whatsappLeadExtract] Claude call failed:', e?.message || e);
    return { details: { ...EMPTY_DETAILS }, dateWarnings: [], failed: true };
  }

  if (!raw) {
    // Per the plan: malformed JSON is not retried. A second attempt at the same
    // temperature on the same input is unlikely to differ, and the conversation is
    // better off in a human's hands than in a retry loop.
    console.error('[whatsappLeadExtract] model returned unparseable JSON');
    return { details: { ...EMPTY_DETAILS }, dateWarnings: [], failed: true };
  }

  // ⚠️ The date the model reports is never used directly. It hands over the substring
  // the customer wrote; parseIsraeliDate decides what day that is, or rejects it. This
  // is the standing "the parser's date wins over the model's" rule, applied where the
  // parser is actually competent — see the file header.
  const dateRaw = cleanString(raw.event_date_raw, 40);
  const parsedDate = dateRaw ? parseIsraeliDate(dateRaw, today) : null;

  return {
    details: {
      coupleNames: cleanString(raw.couple_names, 120),
      eventDate: parsedDate ? parsedDate.iso : null,
      venue: cleanString(raw.venue, 120),
      guestCount: cleanGuestCount(raw.guest_count),
    },
    dateWarnings: parsedDate ? parsedDate.warnings : [],
    failed: false,
  };
}

// Merge newly-extracted details onto what the conversation already knows.
// A null never overwrites a stored value: the customer answering "300 אורחים" to a
// follow-up question must not wipe the venue they gave three messages ago.
export function mergeDetails(existing: Partial<LeadDetails>, incoming: LeadDetails): LeadDetails {
  return {
    coupleNames: existing.coupleNames ?? incoming.coupleNames ?? null,
    eventDate: existing.eventDate ?? incoming.eventDate ?? null,
    venue: existing.venue ?? incoming.venue ?? null,
    guestCount: existing.guestCount ?? incoming.guestCount ?? null,
  };
}

export function missingFields(details: LeadDetails): string[] {
  const missing: string[] = [];
  if (!details.coupleNames) missing.push('השמות שלכם');
  if (!details.eventDate) missing.push('תאריך האירוע');
  if (!details.venue) missing.push('איפה האירוע מתקיים');
  if (details.guestCount === null) missing.push('כמה מוזמנים');
  return missing;
}
