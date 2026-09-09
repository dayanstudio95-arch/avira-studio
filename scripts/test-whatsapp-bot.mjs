// Regression suite for the WhatsApp lead bot's two decision layers.
//
// Run with:  npm run test:whatsapp
//
// Why this file exists at all
// ---------------------------------------------------------------------------------
// This is the only code in the repo that decides, without a human in the loop, whether
// to send a message to a stranger from the studio's own WhatsApp number. Every case
// below is either a real message from the studio's inbox or a trap that a real message
// walked into, and five genuine defects were caught this way before the bot ever sent
// anything — a Hebrew final-letter bug that broke matching invisibly, a competing lab's
// out-of-office read as a customer asking about availability, a producer whose
// self-description slipped the vendor veto, a colleague photographer asking our prices,
// and a date form ("16 ליוני") the parser could not see.
//
// It lived in /tmp for three days and was silently deleted mid-task, which is how it
// ended up here. Do not move it back out of the repo.
//
// There is no test framework in this project (see package.json — lint, build,
// typecheck only), so this is deliberately dependency-free: esbuild is already present
// via vite, and it is used here only to turn the Edge Functions' TypeScript into
// something node can import. `deno` is not installed on the studio's machine, so
// running the real Deno runtime is not an option.

import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = await mkdtemp(join(tmpdir(), 'avira-wa-test-'));

// _shared/anthropic.ts reads Deno.env at module load, so importing anything that
// reaches it from node throws before a single test runs. Every key resolves to
// undefined on purpose: these tests exercise pure logic and must never be one
// stray environment variable away from making a real, billable API call.
globalThis.Deno = { env: { get: () => undefined } };

async function loadModule(relPath, name) {
  const outfile = join(outDir, `${name}.mjs`);
  await build({
    entryPoints: [join(repoRoot, relPath)],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'error',
  });
  return import(pathToFileURL(outfile).href);
}

let failures = 0;
const section = (title) => console.log(`\n--- ${title} ---`);
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'} ${name}` +
    (ok ? '' : `\n         got ${JSON.stringify(actual)} — want ${JSON.stringify(expected)}`)
  );
}

const { decideBotReply } = await loadModule('supabase/functions/_shared/whatsappIntent.ts', 'intent');
const { loadBotSettings, isUnderHourlyQuota } =
  await loadModule('supabase/functions/_shared/whatsappBotSend.ts', 'botsend');

// =================================================================================
// PART 1 — who the bot answers (_shared/whatsappIntent.ts)
// =================================================================================

// A message from a stranger, at a sane hour, first in the thread. Every case below
// varies only the text, so a failure is always about the words.
const inquiryBase = {
  contactType: 'unknown',
  botEnabled: true,
  state: 'NEW',
  isGroup: false,
  typeMessage: 'textMessage',
  inQuietHours: false,
  alreadyDecidedToReply: false,
};

section('real inquiries — must be answered');
for (const text of [
  'היי, כמה עולה צילום חתונה?',
  'שלום! מתחתנים ב-12/7/27, אשמח לשמוע מחירים לצילום',
  'אפשר לקבל מחירון לצילום ומגנטים?',
  'היי, אתם פנויים לחתונה ב 3.11.2027?',
  'מעוניינת בצילום בר מצווה, כמה זה עולה?',
  'שלום, אנחנו מתחתנים ב-16 בספטמבר 2027 ומחפשים צלם',
  'היי אשמח להצעת מחיר לצילום וידאו לחתונה',
  'מחפשים צלמת לברית, מה החבילות שלכם?',
]) check(text, decideBotReply({ ...inquiryBase, bodyText: text }).wouldReply, true);

section('not an inquiry — must stay silent');
for (const text of [
  'היי',
  'תודה רבה!',
  '👍',
  'מה קורה אחי, מתי אתה חוזר?',
  'כמה אנשים יש היום?',
  'החתונה של שני ועדי הייתה מדהימה',
]) check(text, decideBotReply({ ...inquiryBase, bodyText: text }).wouldReply, false);

section('vendors selling TO the studio — the expensive mistake');
for (const text of [
  // Each of these mentions a wedding and a price in the same breath, which is exactly
  // why contact_type alone was never a sufficient gate.
  'היי, אני מפיק אירועים ואשמח לשיתוף פעולה, יש לי הרבה חתונות',
  'שלום, אני נגן סקסופון לאירועים, אשמח לשלוח מחירון לחתונות',
  'אנחנו מכינים עוגות חתונה, נשמח להצעת מחיר משותפת',
  'שלום, אני צלם ורציתי לשאול על שיתוף פעולה',
  'קידום אתרים לצלמי חתונות - מעוניינים?',
  // שון אביטן, a real producer: 'אני מפיק' missed him because of the definite ה, and
  // he was saved only by having no price word and no date.
  'קוראים לי שון אביטן אני המפיק של האירוע חתונה ביום חמישי',
  // A colleague photographer. Never in the database, so only the text can catch him.
  'היי, אני צלם, כמה אתם לוקחים על חתונה?',
  'שלום, אני צלם חתונות ורציתי לשאול מה המחירים שלכם',
  'היי אני עורך וידאו, יש לכם עבודה?',
  // A competing album lab's out-of-office: scored service='אלבום' + inquiry='זמין',
  // i.e. a business declaring itself UNavailable read as a customer asking if we are.
  'תודה על פנייתך. איננו זמינים כעת אך נשיב לך ברגע שנוכל. שעות הפעילות בימים א-ה. לייזר לינק אלבומים',
]) check(text.slice(0, 45) + '…', decideBotReply({ ...inquiryBase, bodyText: text }).wouldReply, false);

section('"אני מתחתן" stands alone — and the traps around it');
for (const [text, expected] of [
  // לירון, a real groom the two-signal rule dropped: no service word in any message.
  ['בעזרת השם מתחתן ב16 ליוני', true],
  ['אנחנו מתחתנים ורוצים צילום', true],
  ['מזל טוב, אנחנו מתחתנים!', true],
  // Someone saying it about a stranger is a producer, not a customer.
  ['היי, יש לי זוג שמתחתן ב12/7, מה המחיר שלכם?', false],
  ['אני מפיק אירועים, יש לי זוג שמתחתן', false],
  ['יש לי לקוחה שמתחתנת באוגוסט, כמה אתם לוקחים?', false],
  // Must stay OPEN: these are how real customers talk. 'יש לי אירוע' is deliberately
  // not vetoed, and 'אני עורך' is deliberately not vetoed because of "עורך דין".
  ['יש לי אירוע ב12/7 ואני מחפש צלם, מה המחיר?', true],
  ['היי, אני עורך דין ומתחתן ב12/7, כמה עולה צילום חתונה?', true],
  // His third message alone is not enough — the gate needs the event, not just a price
  // word. This is the case that keeps "מחירים" from being a signal by itself.
  ['והייתי שמח לשמוע מחירים עלויות', false],
]) check(text, decideBotReply({ ...inquiryBase, bodyText: text }).wouldReply, expected);

section('the gate chain — all with a perfect inquiry body');
{
  const perfect = 'היי, כמה עולה צילום חתונה ב-12/7/27?';
  const chain = [
    ['group chat', { isGroup: true }, 'group'],
    ['existing client', { contactType: 'client' }, 'known_contact'],
    ['existing lead', { contactType: 'lead' }, 'known_contact'],
    ['staff member', { contactType: 'staff' }, 'known_contact'],
    ['muted in this chat', { botEnabled: false }, 'bot_muted'],
    ['mid-conversation', { state: 'AWAITING_DETAILS' }, 'not_first_message'],
    ['already greeted once', { alreadyDecidedToReply: true }, 'not_first_message'],
    ['voice note', { typeMessage: 'audioMessage' }, 'not_text'],
    ['quiet hours', { inQuietHours: true }, 'quiet_hours'],
  ];
  for (const [name, override, expectedReason] of chain) {
    const d = decideBotReply({ ...inquiryBase, bodyText: perfect, ...override });
    check(name, [d.wouldReply, d.reason], [false, expectedReason]);
  }
  check('nothing blocking → replies', decideBotReply({ ...inquiryBase, bodyText: perfect }).reason, 'ok');
}

// =================================================================================
// PART 2 — whether the studio is willing to send at all
// (_shared/whatsappBotSend.ts)
// =================================================================================

// Minimal stand-in for the supabase client surface these functions touch.
function fakeDb({ settingsRows = [], settingsError = null, count = 0, countError = null } = {}) {
  return {
    from(table) {
      if (table === 'app_settings') {
        const q = { select: () => q, eq: () => q, in: () => Promise.resolve({ data: settingsRows, error: settingsError }) };
        return q;
      }
      if (table === 'whatsapp_messages') {
        const q = { select: () => q, eq: () => q, gte: () => Promise.resolve({ count, error: countError }) };
        return q;
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}
const settingRows = (o) => Object.entries(o).map(([key, value]) => ({ key, value }));

section('master switch — only an explicit yes means send');
for (const [value, expected] of [
  ['true', true], ['1', true], ['yes', true], ['TRUE', true],
  ['false', false], ['0', false], ['', false], ['maybe', false], [null, false],
]) {
  const s = await loadBotSettings(fakeDb({ settingsRows: settingRows({ whatsapp_bot_enabled: value }) }), 't1');
  check(`whatsapp_bot_enabled=${JSON.stringify(value)}`, s.enabled, expected);
}

section('a tenant who never opened the settings screen');
{
  const s = await loadBotSettings(fakeDb({ settingsRows: [] }), 't1');
  check('enabled defaults OFF', s.enabled, false);
  check('greeting defaults empty', s.greetingText, '');
  check('delay falls back', s.replyDelaySeconds, 45);
  check('quota falls back', s.maxBotMessagesPerHour, 10);
}

section('a failed settings read must not degrade into "use defaults"');
check(
  'returns null so the caller stays silent',
  await loadBotSettings(fakeDb({ settingsError: { message: 'boom' } }), 't1'),
  null
);

section('reply delay is clamped — EdgeRuntime.waitUntil dies at ~400s');
for (const [value, expected] of [['0', 0], ['30', 30], ['600', 300], ['-5', 0], ['abc', 45]]) {
  const s = await loadBotSettings(fakeDb({ settingsRows: settingRows({ whatsapp_reply_delay_seconds: value }) }), 't1');
  check(`delay ${JSON.stringify(value)}`, s.replyDelaySeconds, expected);
}

section('hourly ceiling — the blast-radius limit');
check('under quota sends', await isUnderHourlyQuota(fakeDb({ count: 3 }), 't1', 10), true);
check('at quota blocks', await isUnderHourlyQuota(fakeDb({ count: 10 }), 't1', 10), false);
check('over quota blocks', await isUnderHourlyQuota(fakeDb({ count: 99 }), 't1', 10), false);
check(
  'a failed count fails CLOSED (unlike _shared/rateLimit.ts, which fails open by design)',
  await isUnderHourlyQuota(fakeDb({ countError: { message: 'boom' } }), 't1', 10),
  false
);

// =================================================================================
// PART 3 — turning the customer's answer into lead details
// (_shared/whatsappLeadExtract.ts)
// =================================================================================

const { parseIsraeliDate, mergeDetails, missingFields, EMPTY_DETAILS } =
  await loadModule('supabase/functions/_shared/whatsappLeadExtract.ts', 'extract');

// Frozen "today" so the year-completion cases don't rot.
const TODAY = new Date(2026, 8, 9); // 2026-09-09

section('the date authority — parseIsraeliDate has the final word, not the model');
for (const [raw, expected] of [
  ['12.7.27', '2027-07-12'],
  ['5/6/27', '2027-06-05'],
  ['3-11-26', '2026-11-03'],
  ['2027-06-16', '2027-06-16'],
  ['16 ביוני 2027', '2027-06-16'],
  // No year given: completed to the next occurrence still in the future.
  ['30.11', '2026-11-30'],
  ['5.1', '2027-01-05'],
  // Not dates. These must be rejected outright rather than coerced — a guest count or
  // a venue name reaching the date field would put a wrong date on a real lead.
  ['בערך 300', null],
  ['אולם הגן', null],
  ['300 אורחים', null],
  ['0501234567', null],
  // Not a real calendar day: 31 February must not silently become March 3rd.
  ['31.2.27', null],
]) {
  const got = parseIsraeliDate(raw, TODAY);
  check(`date ${JSON.stringify(raw)}`, got ? got.iso : null, expected);
}

section('merge — a later answer must never erase an earlier one');
{
  const stored = { coupleNames: 'יעל ואורי', eventDate: null, venue: 'גן ורדים', guestCount: null };
  const incoming = { coupleNames: null, eventDate: '2027-06-05', venue: null, guestCount: 250 };
  check('fills gaps without overwriting', mergeDetails(stored, incoming), {
    coupleNames: 'יעל ואורי', eventDate: '2027-06-05', venue: 'גן ורדים', guestCount: 250,
  });
  check(
    'a stored value wins over a new one',
    mergeDetails({ venue: 'גן ורדים' }, { ...EMPTY_DETAILS, venue: 'מקום אחר' }).venue,
    'גן ורדים'
  );
  check('nothing known yet', mergeDetails({}, EMPTY_DETAILS), EMPTY_DETAILS);
}

section('what is still missing — drives which question gets asked');
check('all four', missingFields(EMPTY_DETAILS).length, 4);
check(
  'only the venue',
  missingFields({ coupleNames: 'א ו-ב', eventDate: '2027-01-01', venue: null, guestCount: 100 }),
  ['איפה האירוע מתקיים']
);
check(
  'guestCount 0 counts as answered, not missing',
  missingFields({ coupleNames: 'א', eventDate: '2027-01-01', venue: 'ב', guestCount: 0 }),
  []
);
check(
  'complete',
  missingFields({ coupleNames: 'א ו-ב', eventDate: '2027-01-01', venue: 'ג', guestCount: 300 }),
  []
);

// =================================================================================
// PART 4 — Stage 3: the follow-up gate and the price-list split
// =================================================================================

const { decideBotFollowUp, MAX_BOT_MESSAGES } =
  await loadModule('supabase/functions/_shared/whatsappIntent.ts', 'intent2');
const { planPricelistSend } = await loadModule('supabase/functions/_shared/whatsappBotSend.ts', 'botsend2');

// A customer who has been greeted and is now answering.
const flowBase = {
  contactType: 'unknown',
  botEnabled: true,
  state: 'AWAITING_DETAILS',
  isGroup: false,
  typeMessage: 'textMessage',
  inQuietHours: false,
  botMessagesSoFar: 1,
};

section('follow-up gate — intent is NOT re-required mid-flow');
check('a plain answer gets a reply', decideBotFollowUp({ ...flowBase }).shouldReply, true);
check('still in flow after one question', decideBotFollowUp({ ...flowBase, state: 'PARTIAL_DETAILS' }).shouldReply, true);

section('follow-up gate — what still blocks');
for (const [name, override, expectedReason] of [
  ['group chat', { isGroup: true }, 'group'],
  ['became a real lead mid-flow', { contactType: 'lead' }, 'known_contact'],
  ['Daniel answered', { botEnabled: false }, 'bot_muted'],
  ['never greeted', { state: 'NEW' }, 'not_in_flow'],
  ['price list already sent', { state: 'PRICELIST_SENT' }, 'not_in_flow'],
  ['already handed off', { state: 'HANDED_OFF' }, 'not_in_flow'],
  ['voice note answer', { typeMessage: 'audioMessage' }, 'not_text'],
  ['quiet hours', { inQuietHours: true }, 'quiet_hours'],
  ['bot has asked enough', { botMessagesSoFar: MAX_BOT_MESSAGES }, 'too_many_questions'],
]) {
  const d = decideBotFollowUp({ ...flowBase, ...override });
  check(name, [d.shouldReply, d.reason], [false, expectedReason]);
}

section('price list — Green API caps a caption at 1024 chars');
{
  const short = 'מחירון 2026\nחבילה בסיסית 5,000 ש"ח';
  // The studio's real price list is well over the cap and ends with its links.
  const long = 'מחירון 2026 ⭐\n' + 'פרטי חבילה. '.repeat(120) + '\nאינסטגרם: https://instagram.com/avira_weddings';

  check('image + short text rides as one caption', planPricelistSend('https://x/p.jpg', short), {
    imageUrl: 'https://x/p.jpg', caption: short, followUpText: null,
  });

  const split = planPricelistSend('https://x/p.jpg', long);
  check('long text is split, not truncated', [split.imageUrl, split.followUpText === long], ['https://x/p.jpg', true]);
  check('caption stays under the cap', split.caption.length <= 1024, true);
  check(
    'the links at the end survive',
    split.followUpText.includes('https://instagram.com/avira_weddings'),
    true
  );

  check('no image configured → text only', planPricelistSend('', long), {
    imageUrl: null, caption: null, followUpText: long,
  });
  check('nothing configured at all', planPricelistSend('', ''), {
    imageUrl: null, caption: null, followUpText: null,
  });
}

// =================================================================================
// PART 5 — lead temperature (_shared/whatsappLeadTemperature.ts)
//
// Only the pure half is covered: everything after the model returns. That is where the
// interesting failures are, and it is the part that must never write junk — the column
// has a CHECK constraint, so an invented temperature would fail the whole conversation
// UPDATE and cost the row its state transition over a label.
// =================================================================================

const { parseTemperatureResponse } = await loadModule(
  'supabase/functions/_shared/whatsappLeadTemperature.ts', 'temperature'
);

section('temperature — well-formed responses');
check(
  'hot with a reason',
  parseTemperatureResponse('{"temperature":"hot","reason":"מבקש לקבוע פגישה"}'),
  { temperature: 'hot', reason: 'מבקש לקבוע פגישה' }
);
check(
  'wrapped in a code fence',
  parseTemperatureResponse('```json\n{"temperature":"warm","reason":"שואל מה כלול"}\n```').temperature,
  'warm'
);
check(
  'with a chatty preamble',
  parseTemperatureResponse('בוודאי! הנה הניתוח:\n{"temperature":"cold","reason":"מודה ומסיים"}').temperature,
  'cold'
);
check('case-insensitive', parseTemperatureResponse('{"temperature":"HOT","reason":"x"}').temperature, 'hot');

section('temperature — malformed responses must yield null, never junk');
for (const [name, input] of [
  ['a fourth temperature the model invented', '{"temperature":"boiling","reason":"x"}'],
  ['empty temperature', '{"temperature":"","reason":"x"}'],
  ['missing temperature', '{"reason":"x"}'],
  ['prose instead of JSON', 'הלקוח נשמע מעוניין מאוד'],
  ['broken JSON', '{"temperature":"hot",'],
  ['empty string', ''],
  ['a JSON array, not an object', '["hot"]'],
]) {
  check(name, parseTemperatureResponse(input).temperature, null);
}

section('temperature — the reason is display text, not free rein');
check('missing reason becomes null', parseTemperatureResponse('{"temperature":"hot"}').reason, null);
check(
  'a non-string reason is dropped, the rating survives',
  parseTemperatureResponse('{"temperature":"hot","reason":42}'),
  { temperature: 'hot', reason: null }
);
check(
  'an essay is capped — this renders on one line in a list',
  parseTemperatureResponse(`{"temperature":"hot","reason":"${'א'.repeat(500)}"}`).reason.length,
  200
);

section('days since — drives the follow-up queue ordering');
{
  const { daysSince } = await import(
    pathToFileURL(join(repoRoot, 'src/components/whatsapp/whatsappInboxShared.js')).href
  );
  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
  check('today', daysSince(daysAgo(0)), 0);
  check('three days', daysSince(daysAgo(3)), 3);
  check('missing date', daysSince(null), null);
  check('garbage date', daysSince('not a date'), null);
  // Clock skew between the browser and the server must not render "לפני -1 ימים".
  check('a future timestamp clamps to 0', daysSince(daysAgo(-2)), 0);
}

// =================================================================================
// PART 6 — the "needs attention" queue (components/dashboard/NeedsAttentionCard.jsx)
//
// This merges three previously separate lists, so the failure modes are all about the
// seams: a lead counted twice under two reasons, someone who already signed being
// chased, or the urgent rows sorting to the bottom where nobody scrolls.
// =================================================================================

const { buildAttentionList } = await loadModule(
  'src/lib/needsAttention.js', 'attention'
);

const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();

section('needs attention — who gets in');
{
  const list = buildAttentionList(
    [
      { id: "c1", phone: "0501111111", leadTemperature: "hot", leadTemperatureAt: ago(1), coupleNames: "חם" },
      { id: "c2", phone: "0502222222", state: "PRICELIST_SENT", lastBotMessageAt: ago(9), coupleNames: "שותק 9 ימים" },
      { id: "c3", phone: "0503333333", state: "PRICELIST_SENT", lastBotMessageAt: ago(2), coupleNames: "שותק יומיים" },
      { id: "c4", phone: "0504444444", state: "PRICELIST_SENT", lastBotMessageAt: ago(30), followupSentAt: ago(1), coupleNames: "כבר נדחף" },
      { id: "c5", phone: "0505555555", state: "AWAITING_DETAILS", lastBotMessageAt: ago(30), coupleNames: "עוד באמצע" },
    ],
    []
  );
  const names = list.map((r) => r.name);
  check("a hot lead is included", names.includes("חם"), true);
  check("silent past a week is included", names.includes("שותק 9 ימים"), true);
  check("silent only two days is NOT chased yet", names.includes("שותק יומיים"), false);
  check("already nudged drops out of the queue", names.includes("כבר נדחף"), false);
  check("still mid-conversation is not chased", names.includes("עוד באמצע"), false);
}

section('needs attention — CRM leads, and not chasing closed ones');
{
  const list = buildAttentionList([], [
    { id: "l1", coupleNames: "ישן", status: "נשלחה הצעה", lastContactDate: ago(20) },
    { id: "l2", coupleNames: "טרי", status: "חדש", lastContactDate: ago(1) },
    { id: "l3", coupleNames: "חתם", status: "נסגר/חתימה", lastContactDate: ago(90) },
    { id: "l4", coupleNames: "חוזה", status: "חוזה", lastContactDate: ago(90) },
    { id: "l5", coupleNames: "לא רלוונטי", status: "לא רלוונטי", lastContactDate: ago(90) },
    // Nobody ever logged contact — must still surface rather than being invisible.
    { id: "l6", coupleNames: "בלי תאריך מגע", status: "חדש", updatedDate: ago(40) },
  ]);
  const names = list.map((r) => r.name);
  check("stale lead is included", names.includes("ישן"), true);
  check("recent lead is left alone", names.includes("טרי"), false);
  check("a signed couple is never chased", names.includes("חתם"), false);
  check("a contract is never chased", names.includes("חוזה"), false);
  check("a rejected lead is never chased", names.includes("לא רלוונטי"), false);
  check("no lastContactDate falls back to updatedDate", names.includes("בלי תאריך מגע"), true);
}

section('needs attention — a lead created from a conversation appears ONCE');
{
  // The exact case the merge exists for: the bot handled them, Daniel pressed "צור ליד",
  // and now the same couple exists on both sides.
  const list = buildAttentionList(
    [{ id: "c1", phone: "0501234567", leadTemperature: "hot", leadTemperatureAt: ago(2), coupleNames: "יעל ואורי" }],
    [{ id: "l1", coupleNames: "יעל ואורי", phoneNumber: "0501234567", status: "חדש", lastContactDate: ago(30) }]
  );
  check("counted once, not twice", list.length, 1);
  check("kept under the more urgent reason", list[0].reason, "hot");
}

section('needs attention — order decides who gets called');
{
  const list = buildAttentionList(
    [
      { id: "c1", phone: "1", state: "PRICELIST_SENT", lastBotMessageAt: ago(8), coupleNames: "שותק 8" },
      { id: "c2", phone: "2", state: "PRICELIST_SENT", lastBotMessageAt: ago(20), coupleNames: "שותק 20" },
      { id: "c3", phone: "3", leadTemperature: "hot", leadTemperatureAt: ago(0), coupleNames: "חם היום" },
    ],
    [{ id: "l1", coupleNames: "ליד ישן", phoneNumber: "9", status: "חדש", lastContactDate: ago(60) }]
  );
  check(
    "hot first, then longest-silent, CRM last",
    list.map((r) => r.name),
    ["חם היום", "שותק 20", "שותק 8", "ליד ישן"]
  );
}

section('needs attention — empty and missing inputs');
check("no data at all", buildAttentionList([], []).length, 0);
check("undefined inputs do not throw", buildAttentionList(undefined, undefined).length, 0);

await rm(outDir, { recursive: true, force: true });
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
