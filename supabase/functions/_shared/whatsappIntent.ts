// Content gate for the WhatsApp lead bot — "is this someone asking us to photograph
// their own event?"
//
// ⚠️ Nothing in this file sends anything. It answers a yes/no question. Today the
// answer is only recorded (dry run); Stage 2 will be the first time it gates a real
// send, and that needs its own explicit go-ahead.
//
// Why a content gate is needed at all
// ---------------------------------------------------------------------------------
// The existing protection — `contact_type`, computed by matching the sender's phone
// against leads/events/staff — can only recognise people already in the database. The
// first day of real traffic showed that is not enough: of 15 chats labelled `unknown`,
// roughly a third were genuine inquiries and the rest were a wedding photographer, a
// cake supplier, a saxophonist, two event producers and some personal chats. All of
// them were bot-eligible. A stranger pitching us their services is, to a phone-number
// check, indistinguishable from a stranger asking about their wedding.
//
// The rule, and why it is shaped this way
// ---------------------------------------------------------------------------------
// A message passes only if it mentions BOTH:
//   (a) an event or a photography service   — "חתונה", "צילום", "בר מצווה", ...
//   (b) a commercial question or a date     — "מחיר", "כמה", "פנוי", or "12/7/27"
// and mentions NOTHING from the vendor-pitch list.
//
// Requiring two independent signals is the whole design. Either one alone is far too
// common: a photographer coordinating a job says "חתונה" constantly, and "כמה" shows
// up in any conversation. Requiring both is what separates "כמה עולה צילום חתונה?"
// from "אני מגיע לחתונה של שני מחר".
//
// It FAILS CLOSED. Anything unrecognised — an emoji, a voice note, a bare "היי",
// a language we didn't anticipate — returns false and the bot stays silent. Silence
// costs a reply Daniel would have written by hand anyway. A false positive costs a
// price list sent to a colleague, which is the failure mode this whole module is
// built to avoid. The asymmetry is deliberate and should not be "balanced" later.
//
// Matching is plain substring, not word-boundary, and that is correct for Hebrew:
// prefixes attach directly to the word (ל+חתונה = "לחתונה", ב+אירוע = "באירוע",
// ה+מחיר = "המחיר"). A word-boundary regex would miss every prefixed form, which is
// most of them. Hebrew has no letter case, so no case folding is needed for the
// Hebrew terms; the handful of Latin terms are lowercased first.

const BIDI_AND_INVISIBLES = new RegExp('[\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2069\\uFEFF]', 'g');
const NIQQUD = new RegExp('[\\u0591-\\u05C7]', 'g');

// Hebrew final forms (sofit) → their regular forms. This is load-bearing, and it is the
// one thing here that was found by replaying real messages rather than by reasoning.
//
// A Hebrew word ending in one of these letters swaps it for the regular form the moment
// a suffix is added: סקסופו|ן| → סקסופו|נ|יסט, אלבו|ם| → אלבו|מ|ים. To a substring match
// those are different characters, so the term silently stops matching its own inflected
// forms — and the failure is invisible, because the two glyphs look almost identical in
// the source.
//
// Both real consequences were observed in the studio's own inbox:
//   - "סקסופון" did not match a saxophonist introducing himself as "אני סקסופוניסט".
//     He was only silenced because his message happened to contain no service word
//     either. Add a price question to that same message and the vendor veto written
//     specifically for him would have let a price list through.
//   - "אלבום" did not match "אלבומים".
//
// Normalising both the message and the search terms fixes the whole class at once, and
// is why terms below are written in their plain dictionary form rather than being
// enumerated in every inflection.
const HEBREW_FINALS: Record<string, string> = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const HEBREW_FINALS_RE = new RegExp('[\\u05DA\\u05DD\\u05DF\\u05E3\\u05E5]', 'g');

// (a) The event being photographed, or the service itself.
const SERVICE_TERMS = [
  'חתונה', 'חתונת', 'חתונות', 'חינה', 'אירוסין',
  'בר מצווה', 'בת מצווה', 'ברמצווה', 'בר מצוה', 'בת מצוה',
  'ברית', 'בריתה', 'חגיגה',
  'צילום', 'צילומי', 'צילומים', 'לצלם', 'תצלום',
  'צלם', 'צלמת', 'צלמים',
  'וידאו', 'וידיאו', 'מגנטים', 'סטילס', 'אלבום',
  'wedding', 'photograph', 'photo shoot',
];

// (b) The commercial question. A date counts too and is checked separately below —
// "אנחנו מתחתנים ב-12.7.27" is an inquiry even without the word "מחיר".
const INQUIRY_TERMS = [
  'מחיר', 'מחירון', 'מחירים', 'עלות', 'עולה', 'עולים', 'כמה',
  'הצעת מחיר', 'הצעה', 'חבילה', 'חבילות', 'עסקה',
  'פנוי', 'פנויה', 'פנויים', 'זמין', 'זמינה', 'זמינות', 'תפוס',
  'מתעניין', 'מתעניינת', 'מעוניין', 'מעוניינת', 'מתחתנים', 'מתחתנת', 'מתחתן',
  'לשמוע פרטים', 'פרטים נוספים',
  'price', 'quote', 'available', 'availability',
];

// Anything here forces silence even if (a) and (b) both matched. These are people
// selling TO the studio, or coordinating an existing job — both of which routinely
// mention a wedding and a price in the same breath, and both of which would be
// actively embarrassed by an automated price list.
//
// Tuning note: this list is meant to grow from observed dry-run false positives, not
// from imagination. Every term below corresponds to traffic actually seen in the
// inbox, or to an unambiguous B2B phrase. Do not add speculative terms — each one is
// a chance to silence a real customer.
const VENDOR_TERMS = [
  'שיתוף פעולה', 'שת"פ', 'שתף פעולה',
  // 'אני מפיק' alone was too literal: שון אביטן (dry-run replay, 2026-09-08) wrote
  // "אני המפיק של האירוע" — the definite ה breaks the substring, and he was silenced
  // only because his message happened to carry no price word and no date. The bare
  // 'המפיק'/'המפיקה' forms close that gap.
  'אני מפיק', 'אני מפיקה', 'המפיק', 'המפיקה', 'מפיק אירועים', 'מפיקת אירועים',
  'אני נגן', 'אני זמר', 'אני זמרת', 'דיג׳יי', "דיג'יי", 'די ג׳יי',
  // A colleague photographer/videographer asking what we charge. Daniel's own point
  // (2026-09-08): these people are not staff and will never be in the database, so
  // contact_type can never catch them — only the message text can. Deliberately ONLY
  // the self-description forms: 'צלם' itself is a SERVICE term ("מחפשים צלם"), and
  // vetoing 'צלם חתונות' would silence the very common "מחפשת צלם חתונות". Bare
  // 'אני עורך' is avoided too — it swallows "אני עורך דין", i.e. a real customer.
  'אני צלם', 'אני צלמת', 'אני הצלם', 'אני הצלמת',
  'עורך וידאו', 'עורכת וידאו', 'אני וידאומן',
  'סקסופון', 'עוגות', 'קייטרינג', 'הפקת אירועים',
  'הצעה עסקית', 'עמלה', 'קידום אתרים', 'דיוור', 'לידים', 'seo',
  'ספק', 'ספקים', 'לוגיסטיקה',
  // Coordination language — an existing job being run, not a new inquiry.
  'הגעתי', 'בדרך אליכם', 'המשמרת', 'סידור עבודה', 'הזמנת עבודה',
  // Another business's out-of-office auto-reply. Observed in the dry-run replay: a
  // competing album lab answered with "תודה על פנייתך. איננו זמינים כעת... לייזר לינק
  // אלבומים", which scored service='אלבום' + inquiry='זמין' — i.e. a business saying
  // it is UNavailable read as a customer asking about availability. These phrases are
  // written by businesses, never by someone asking to be photographed.
  'תודה על פנייתך', 'תודה על פנייתכם', 'איננו זמינים', 'אנחנו לא זמינים',
  'נשיב לך', 'נחזור אליך בהקדם', 'נחזור אליכם בהקדם', 'שעות הפעילות',
  'הודעה אוטומטית', 'מענה אוטומטי',
];

// Date shapes: 12/7/27, 12.7.2027, 12-7-27, and the day-month-only forms. Kept
// deliberately narrow (both parts must be plausible day/month numbers) so a price
// like "5,500" or a phone number can't read as a date.
//
// This is a light re-implementation of the shapes in src/lib/whatsappLeadParser.js
// rather than a copy of it. That file is in src/ and cannot be imported by an Edge
// Function; a full copy would be a large surface to keep in sync for a question that
// only needs "does a date appear here at all?", with no need for the real parser's
// ambiguity handling, year completion or validity round-trip.
const DATE_RE = /(?:^|[^\d])([0-3]?\d)\s*[./-]\s*([01]?\d)(?:\s*[./-]\s*(\d{2,4}))?(?:$|[^\d])/;
const HEBREW_MONTH_RE =
  /\b[0-3]?\d\s*(?:ב)?\s*(?:ינואר|פברואר|מרץ|מרס|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)/;

function containsDate(text: string): boolean {
  if (HEBREW_MONTH_RE.test(text)) return true;
  const m = text.match(DATE_RE);
  if (!m) return false;
  const day = Number(m[1]);
  const month = Number(m[2]);
  return day >= 1 && day <= 31 && month >= 1 && month <= 12;
}

// Strips the invisible junk WhatsApp and iOS wrap text in, strips niqqud, and folds
// Hebrew final letters — so a term isn't missed because of a character nobody can see,
// or because a suffix turned ן into נ (see HEBREW_FINALS above).
//
// Applied to BOTH sides of every comparison: the message AND the search term. That is
// what lets the term lists below stay in plain dictionary form instead of enumerating
// every inflection of every word.
function normalize(text: string): string {
  return String(text)
    .replace(BIDI_AND_INVISIBLES, '')
    .replace(NIQQUD, '')
    .replace(HEBREW_FINALS_RE, (ch) => HEBREW_FINALS[ch] || ch)
    .replace(/[  ]/g, ' ')
    .toLowerCase();
}

export interface IntentResult {
  isInquiry: boolean;
  // Which terms fired. Recorded for the dry run so a wrong verdict can be traced back
  // to the exact word that caused it, instead of being re-litigated by guesswork.
  matchedService: string | null;
  matchedInquiry: string | null;
  matchedVendor: string | null;
  matchedDate: boolean;
}

export function detectLeadIntent(bodyText: string | null | undefined): IntentResult {
  const empty: IntentResult = {
    isInquiry: false,
    matchedService: null,
    matchedInquiry: null,
    matchedVendor: null,
    matchedDate: false,
  };
  if (!bodyText || typeof bodyText !== 'string' || !bodyText.trim()) return empty;

  const text = normalize(bodyText);

  const matchedVendor = VENDOR_TERMS.find((t) => text.includes(normalize(t))) || null;
  const matchedService = SERVICE_TERMS.find((t) => text.includes(normalize(t))) || null;
  const matchedInquiry = INQUIRY_TERMS.find((t) => text.includes(normalize(t))) || null;
  const matchedDate = containsDate(text);

  return {
    // Vendor terms veto, regardless of what else matched.
    isInquiry: !matchedVendor && !!matchedService && (!!matchedInquiry || matchedDate),
    matchedService,
    matchedInquiry,
    matchedVendor,
    matchedDate,
  };
}

// ---------------------------------------------------------------------------------
// The full gate chain.
// ---------------------------------------------------------------------------------
//
// Order matters, and it is cheapest-and-most-decisive first: a group chat or a known
// contact is settled by one field and can never be overturned by content, so those are
// checked before anything that reads the message body.
//
// The returned `reason` is a stable code, not a sentence — it is stored in
// whatsapp_messages.bot_skip_reason and grouped in SQL to answer "what is actually
// stopping the bot?". The Hebrew wording lives in the frontend
// (src/components/whatsapp/whatsappInboxShared.js) and can change without a migration.

export type BotDecisionReason =
  | 'ok'
  | 'group'
  | 'known_contact'
  | 'bot_muted'
  | 'not_first_message'
  | 'not_text'
  | 'quiet_hours'
  | 'no_intent';

export interface BotDecision {
  wouldReply: boolean;
  reason: BotDecisionReason;
  intent: IntentResult;
}

export interface BotDecisionInput {
  contactType: string;
  botEnabled: boolean;
  state: string;
  isGroup: boolean;
  typeMessage: string | null;
  bodyText: string | null;
  inQuietHours: boolean;
  // Has this conversation already produced a `wouldReply` verdict?
  //
  // This exists purely because the dry run cannot advance the state machine. In Stage 2
  // sending the greeting moves the conversation NEW → AWAITING_DETAILS, and the
  // `state !== 'NEW'` check below is what stops a second greeting. Sending nothing means
  // the state never moves, so without this flag a chatty stranger who writes four
  // messages would be counted as four separate "the bot would have replied" events and
  // the measured hit rate would be inflated by exactly the people who talk the most.
  alreadyDecidedToReply: boolean;
}

const TEXT_MESSAGE_TYPES = ['textMessage', 'extendedTextMessage', 'quotedMessage'];

export function decideBotReply(input: BotDecisionInput): BotDecision {
  const noIntent: IntentResult = {
    isInquiry: false,
    matchedService: null,
    matchedInquiry: null,
    matchedVendor: null,
    matchedDate: false,
  };
  const stop = (reason: BotDecisionReason): BotDecision => ({ wouldReply: false, reason, intent: noIntent });

  if (input.isGroup) return stop('group');

  // Only strangers. A lead, a client mid-production or a photographer must never get
  // an automated first-contact greeting.
  if (input.contactType !== 'unknown') return stop('known_contact');

  // A human is already in this conversation (Daniel answered from his phone, or from
  // the inbox screen). Permanent, per conversation.
  if (!input.botEnabled) return stop('bot_muted');

  // Only the very first message of a conversation gets a greeting. Everything past
  // 'NEW' is either mid-flow or already handed to a human, and neither is a case for
  // an opening line. `alreadyDecidedToReply` stands in for the state transition the dry
  // run cannot perform — see the field's note above.
  if (input.state !== 'NEW' || input.alreadyDecidedToReply) return stop('not_first_message');

  // An image, voice note or location can't be intent-checked, so it can't clear a
  // fail-closed gate. (Stage 2's plan allows greeting a non-text first message; that
  // decision is deliberately NOT taken here — during the dry run the honest answer is
  // "we cannot tell", and pretending otherwise would inflate the measured hit rate.)
  if (!input.typeMessage || !TEXT_MESSAGE_TYPES.includes(input.typeMessage)) return stop('not_text');

  // Same tenant-level do-not-disturb window as every other automation
  // (_shared/automationGuards.ts). A bot that messages a stranger at 02:00 is worse
  // than one that doesn't reply at all.
  if (input.inQuietHours) return stop('quiet_hours');

  const intent = detectLeadIntent(input.bodyText);
  if (!intent.isInquiry) return { wouldReply: false, reason: 'no_intent', intent };

  return { wouldReply: true, reason: 'ok', intent };
}
