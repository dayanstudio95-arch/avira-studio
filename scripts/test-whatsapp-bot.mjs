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

section('came through a Facebook ad — the words no longer matter (2026-09-15)');
// The real one: Meta's pre-filled text for the studio's own wedding-photography ad.
// English, no service word, no date. Silent without the ad context, answered with it.
const adPrefill = 'Hello! Can I get more info on this?';
check('ad prefill, no ad context → silent', decideBotReply({ ...inquiryBase, bodyText: adPrefill }).wouldReply, false);
check('ad prefill, from ad → replies', decideBotReply({ ...inquiryBase, bodyText: adPrefill, fromAd: true }).wouldReply, true);
check('from ad, reason is ok', decideBotReply({ ...inquiryBase, bodyText: adPrefill, fromAd: true }).reason, 'ok');
check('from ad, intent records it', decideBotReply({ ...inquiryBase, bodyText: adPrefill, fromAd: true }).intent.matchedAd, true);
check('from ad, prefill deleted → still replies', decideBotReply({ ...inquiryBase, bodyText: '', fromAd: true }).wouldReply, true);
check('from ad, just "היי" → replies', decideBotReply({ ...inquiryBase, bodyText: 'היי', fromAd: true }).wouldReply, true);
// The ad does not switch off the rest of the chain.
check('from ad, but a colleague → silent', decideBotReply({ ...inquiryBase, bodyText: 'היי אני צלם, מה המחירים שלכם?', fromAd: true }).wouldReply, false);
check('from ad, but known contact → silent', decideBotReply({ ...inquiryBase, bodyText: adPrefill, fromAd: true, contactType: 'lead' }).reason, 'known_contact');
check('from ad, but quiet hours → held for later', decideBotReply({ ...inquiryBase, bodyText: adPrefill, fromAd: true, inQuietHours: true }).reason, 'quiet_hours_deferred');
check('from ad, but bot muted → silent', decideBotReply({ ...inquiryBase, bodyText: adPrefill, fromAd: true, botEnabled: false }).reason, 'bot_muted');
check('from ad, but not first message → silent', decideBotReply({ ...inquiryBase, bodyText: adPrefill, fromAd: true, state: 'HANDED_OFF' }).reason, 'not_first_message');

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
    ['quiet hours', { inQuietHours: true }, 'quiet_hours_deferred'],
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
      { id: "c6", phone: "0506666666", state: "AWAITING_DETAILS", lastBotMessageAt: ago(0), coupleNames: "נשאל היום" },
    ],
    []
  );
  const names = list.map((r) => r.name);
  check("a hot lead is included", names.includes("חם"), true);
  check("silent past a week is included", names.includes("שותק 9 ימים"), true);
  check("silent only two days is NOT chased yet", names.includes("שותק יומיים"), false);
  check("already nudged drops out of the queue", names.includes("כבר נדחף"), false);
  // Until 2026-09-15 this asserted the opposite — and that was the hole: a person the
  // bot asked 30 days ago and never heard from again was in no queue at all.
  check("stalled mid-conversation IS chased now", list.find((r) => r.name === "עוד באמצע")?.reason, "stalled_flow");
  check("asked today is not chased yet", names.includes("נשאל היום"), false);
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

// =================================================================================
// PART 7 — quiet hours hold instead of drop; nudge; digest; alerts (2026-09-15)
//
// Two real holes drove this: a customer answering the bot at 23:30 was dropped and
// stuck, and a night-time first message was never greeted. Everything below is the
// pure half of the fix; the sending half is guarded by the same rules as the live path.
// =================================================================================

section('gate — quiet hours no longer swallow intent');
{
  const q = { ...inquiryBase, inQuietHours: true };
  const held = decideBotReply({ ...q, bodyText: 'היי, כמה עולה צילום חתונה?' });
  check('inquiry at night → deferred, not dropped', [held.wouldReply, held.reason], [false, 'quiet_hours_deferred']);
  check('…and the intent is carried for the enqueue', held.intent.isInquiry, true);
  check('no intent at night → no_intent (the truth, not "quiet")', decideBotReply({ ...q, bodyText: 'היי' }).reason, 'no_intent');
  check('a vendor at night is still a vendor', decideBotReply({ ...q, bodyText: 'היי אני צלם, מה המחירים?' }).reason, 'no_intent');
  check('voice note at night is still not_text', decideBotReply({ ...q, bodyText: null, typeMessage: 'audioMessage' }).reason, 'not_text');
}

section('follow-up gate — quiet hours are checked LAST');
check('budget exhausted at night → too_many_questions, not quiet', decideBotFollowUp({ ...flowBase, inQuietHours: true, botMessagesSoFar: MAX_BOT_MESSAGES }).reason, 'too_many_questions');
check('otherwise quiet_hours = "everything passed, hold the reply"', decideBotFollowUp({ ...flowBase, inQuietHours: true }).reason, 'quiet_hours');

const { composeSends, DEFAULT_FLOW_NUDGE_TEXT } =
  await loadModule('supabase/functions/_shared/whatsappBotSend.ts', 'botsend3');

section('composeSends — the exact payload a deferred row carries');
check('greeting → one text', composeSends('greeting', { text: 'שלום' }), [{ type: 'text', text: 'שלום' }]);
check('empty greeting → nothing', composeSends('greeting', { text: '  ' }), []);
check('question → one text', composeSends('question', { text: 'מתי?' }), [{ type: 'text', text: 'מתי?' }]);
check('short price list with image → file only',
  composeSends('pricelist', { pricelistUrl: 'https://x/p.jpg', pricelistText: 'קצר' }),
  [{ type: 'file', url: 'https://x/p.jpg', caption: 'קצר' }]);
check('long price list with image → file + text',
  composeSends('pricelist', { pricelistUrl: 'https://x/p.jpg', pricelistText: 'א'.repeat(1100) }).map((i) => i.type),
  ['file', 'text']);
check('price list without image → text only',
  composeSends('pricelist', { pricelistUrl: '', pricelistText: 'טקסט' }),
  [{ type: 'text', text: 'טקסט' }]);

section('new settings — ad greeting, nudge text, digest hour');
{
  const none = await loadBotSettings(fakeDb({ settingsRows: [] }), 't1');
  check('ad greeting defaults empty (= use the regular one)', none.greetingTextAd, '');
  check('nudge text has a default — a nudge must never fail for want of words', none.flowNudgeText, DEFAULT_FLOW_NUDGE_TEXT);
  check('digest hour defaults to 8', none.digestHour, 8);
  for (const [value, expected] of [['6', 6], ['30', 23], ['-1', 0], ['abc', 8]]) {
    const s = await loadBotSettings(fakeDb({ settingsRows: settingRows({ whatsapp_digest_hour: value }) }), 't1');
    check(`digest hour ${JSON.stringify(value)} → ${expected}`, s.digestHour, expected);
  }
  const custom = await loadBotSettings(fakeDb({ settingsRows: settingRows({ whatsapp_flow_nudge_text: ' עדיין כאן ' }) }), 't1');
  check('custom nudge text is trimmed and kept', custom.flowNudgeText, 'עדיין כאן');
}

const { nextQuietHoursEnd } = await loadModule('supabase/functions/_shared/automationGuards.ts', 'guards');

section('nextQuietHoursEnd — when a held message goes out (Jerusalem, IDT = UTC+3 in September)');
{
  const win = { quiet_hours_enabled: true, quiet_hours_start: '22:00', quiet_hours_end: '08:00' };
  check('disabled → null', nextQuietHoursEnd({ ...win, quiet_hours_enabled: false }, new Date('2026-09-15T00:30:00Z')), null);
  check('misconfigured → null', nextQuietHoursEnd({ ...win, quiet_hours_end: 'x' }, new Date('2026-09-15T00:30:00Z')), null);
  check('03:30 local → today 08:00 local', nextQuietHoursEnd(win, new Date('2026-09-15T00:30:00Z'))?.toISOString(), '2026-09-15T05:00:00.000Z');
  check('23:00 local → tomorrow 08:00 local', nextQuietHoursEnd(win, new Date('2026-09-15T20:00:00Z'))?.toISOString(), '2026-09-16T05:00:00.000Z');
}

const { composeDigest } = await loadModule('supabase/functions/_shared/whatsappDigest.ts', 'digest');

section('daily digest — the morning message');
{
  const base = {
    newStrangers: 3, greetings: 2, pricelists: 1, hotLeads: ['נועה ואיתי'], waitingFollowUp: 4,
    stalledFlow: 1, mediaFromStrangers: 0, deferredPending: 0, inboundMessages: 12, botEnabled: true,
  };
  const t = composeDigest(base, '15/09/2026');
  check('names the hot lead', t.includes('נועה ואיתי'), true);
  check('no warning when the line is alive', t.includes('⚠️'), false);
  check('silent 24h → the disconnect warning', composeDigest({ ...base, inboundMessages: 0 }, 'x').includes('ייתכן שהחיבור לוואטסאפ נותק'), true);
  check('bot off is stated', composeDigest({ ...base, botEnabled: false }, 'x').includes('הבוט כבוי'), true);
  check('all zeros still produces a message', composeDigest({ ...base, newStrangers: 0, greetings: 0, pricelists: 0, hotLeads: [], waitingFollowUp: 0, stalledFlow: 0, inboundMessages: 0 }, 'x').length > 20, true);
  check('media count only when non-zero', t.includes('הודעה קולית'), false);
  check('media count shown when non-zero', composeDigest({ ...base, mediaFromStrangers: 2 }, 'x').includes('הודעה קולית'), true);
}

const { composeHotLeadAlert } = await loadModule('supabase/functions/_shared/whatsappStudioAlerts.ts', 'alerts');

section('hot-lead alert — what the owner reads');
{
  const t = composeHotLeadAlert({
    tenantId: 't', phone: '0501234567', reason: 'רוצה לקבוע פגישה',
    replyText: 'נשמע מעולה, מתי אפשר להיפגש?',
    conversation: { couple_names: 'דנה ורון', event_date: '2027-06-16', venue: 'אחוזה' },
  });
  check('names + why + the reply', ['דנה ורון', 'רוצה לקבוע פגישה', 'מתי אפשר להיפגש'].every((x) => t.includes(x)), true);
  check('falls back to the phone when nameless', composeHotLeadAlert({ tenantId: 't', phone: '0501234567', reason: null, replyText: null, conversation: {} }).includes('0501234567'), true);
}

const { isStalledInFlow } = await loadModule('supabase/functions/_shared/whatsappHousekeeping.ts', 'housekeeping');

section('stalled mid-flow — who gets the one-time nudge');
{
  const now = Date.now();
  const h = (n) => new Date(now - n * 3600000).toISOString();
  check('asked 30h ago, never answered', isStalledInFlow({ state: 'AWAITING_DETAILS', last_bot_message_at: h(30), last_inbound_at: h(31) }, now), true);
  check('asked 30h ago, no inbound at all', isStalledInFlow({ state: 'PARTIAL_DETAILS', last_bot_message_at: h(30), last_inbound_at: null }, now), true);
  check('asked 30h ago but they answered since', isStalledInFlow({ state: 'AWAITING_DETAILS', last_bot_message_at: h(30), last_inbound_at: h(2) }, now), false);
  check('asked 5h ago → too soon', isStalledInFlow({ state: 'AWAITING_DETAILS', last_bot_message_at: h(5), last_inbound_at: h(6) }, now), false);
  check('price list already sent → not in flow', isStalledInFlow({ state: 'PRICELIST_SENT', last_bot_message_at: h(30), last_inbound_at: h(31) }, now), false);
  check('never greeted → nothing to nudge', isStalledInFlow({ state: 'AWAITING_DETAILS', last_bot_message_at: null, last_inbound_at: h(31) }, now), false);
}

section('needs attention — media from a stranger, and stalled flows');
{
  const media = { id: 'm1', phone: '11', contactType: 'unknown', state: 'NEW', botLastDecision: 'not_text', botEnabled: true, lastInboundAt: ago(1), displayName: 'קול' };
  check('voice note from a stranger is in', buildAttentionList([media], []).map((r) => r.reason), ['media_from_stranger']);
  check('…not after 8 days', buildAttentionList([{ ...media, lastInboundAt: ago(8) }], []).length, 0);
  check('…not once a human took over', buildAttentionList([{ ...media, botEnabled: false }], []).length, 0);
  check('…not if the gate said something else', buildAttentionList([{ ...media, botLastDecision: 'no_intent' }], []).length, 0);

  const stalled = { id: 's1', phone: '12', contactType: 'unknown', state: 'PARTIAL_DETAILS', botEnabled: true, lastBotMessageAt: ago(2), lastInboundAt: ago(3), coupleNames: 'תקוע' };
  check('stalled mid-flow is in', buildAttentionList([stalled], []).map((r) => r.reason), ['stalled_flow']);
  check('…not if they answered after the bot', buildAttentionList([{ ...stalled, lastInboundAt: ago(1) }], []).length, 0);
  check('…not on the same day', buildAttentionList([{ ...stalled, lastBotMessageAt: ago(0) }], []).length, 0);
  check('after the nudge the detail says so', buildAttentionList([{ ...stalled, nudgeSentAt: ago(1) }], [])[0].detail.includes('תזכורת'), true);

  const order = buildAttentionList(
    [
      { id: 'c1', phone: '1', state: 'PRICELIST_SENT', lastBotMessageAt: ago(9), coupleNames: 'שותק' },
      stalled,
      media,
      { id: 'c3', phone: '3', leadTemperature: 'hot', leadTemperatureAt: ago(0), coupleNames: 'חם' },
    ],
    [{ id: 'l1', coupleNames: 'ליד ישן', phoneNumber: '9', status: 'חדש', lastContactDate: ago(60) }]
  );
  check('order: hot → media → silent → stalled → CRM', order.map((r) => r.reason), ['hot', 'media_from_stranger', 'silent_pricelist', 'stalled_flow', 'stale_lead']);
}

// =================================================================================
// PART 8 — "מצא מחליף" (src/lib/staffReplacement.js, 2026-09-15)
//
// Everyone in the role is pre-ticked; the only judgement is who NOT to pre-tick, and
// each of those must carry a reason the owner can read.
// =================================================================================

const { pickReplacementCandidates, buildTeamWithAssignment, namesBookedOnDate } =
  await loadModule('src/lib/staffReplacement.js', 'replacement');

section('replacement — who is pre-ticked');
{
  const staff = [
    { id: 'a', name: 'אבי', role: 'photographer', phoneNumber: '0501' },
    { id: 'b', name: 'בני', role: 'photographer', phoneNumber: '0502' },
    { id: 'c', name: 'גל', role: 'photographer', phoneNumber: null },
    { id: 'd', name: 'דנה', role: 'photographer', phoneNumber: '0504' },
    { id: 'e', name: 'עומר', role: 'photographer', phoneNumber: '0505' },
    { id: 'v', name: 'וידאו', role: 'videographer', phoneNumber: '0506' },
  ];
  const eventTeam = [{ role: 'photographer1', staffMemberName: 'אבי' }, { role: 'videographer', staffMemberName: 'וידאו' }];
  const eventsOnDate = [
    { id: 'this', date: '2027-06-16', team: eventTeam },
    { id: 'other', date: '2027-06-16', team: [{ role: 'photographer2', staffMemberName: 'דנה' }] },
    { id: 'another-day', date: '2027-06-17', team: [{ role: 'photographer1', staffMemberName: 'עומר' }] },
  ];
  const out = pickReplacementCandidates({
    staffMembers: staff, jobRole: 'photographer', eventTeam, eventsOnDate,
    eventId: 'this', eventDate: '2027-06-16', excludeName: 'בני',
  });
  const by = Object.fromEntries(out.map((c) => [c.staff.name, c]));
  check('only the role', Object.keys(by).sort(), ['אבי', 'בני', 'גל', 'דנה', 'עומר'].sort());
  check('already on this event → not ticked, says so', [by['אבי'].preselected, by['אבי'].reason], [false, 'כבר משובץ כאן']);
  check('the one who cancelled → not ticked', [by['בני'].preselected, by['בני'].reason], [false, 'זה מי שביטל']);
  check('no phone → not ticked', [by['גל'].preselected, by['גל'].reason], [false, 'אין טלפון']);
  check('booked on another event that day (other slot!) → not ticked', [by['דנה'].preselected, by['דנה'].reason], [false, 'משובץ באירוע אחר באותו יום']);
  check('booked on another DAY → ticked', [by['עומר'].preselected, by['עומר'].reason], [true, null]);
  check('booked names ignore the event itself', [...namesBookedOnDate(eventsOnDate, '2027-06-16', 'this')], ['דנה']);
}

section('replacement — assigning into a slot');
{
  const staff = { name: 'עומר', defaultRate: 1000, ratesByRole: [{ role: 'photographer2', rate: 1200 }] };
  const team = [
    { role: 'photographer1', staffMemberName: 'אבי', cost: 900, isPaid: true, progressStatus: 'done' },
    { role: 'photographer2', staffMemberName: 'בני', cost: 800, isPaid: false, progressStatus: 'pending' },
  ];
  const next = buildTeamWithAssignment(team, 'photographer2', staff);
  check('replaces the occupant of that slot', next.find((m) => m.role === 'photographer2').staffMemberName, 'עומר');
  check('per-slot rate wins over default', next.find((m) => m.role === 'photographer2').cost, 1200);
  check('default rate when no per-slot rate', buildTeamWithAssignment(team, 'photographer1', staff).find((m) => m.role === 'photographer1').cost, 1000);
  check('other slots untouched', next.find((m) => m.role === 'photographer1'), team[0]);
  check('input not mutated', team.find((m) => m.role === 'photographer2').staffMemberName, 'בני');
  check('fresh assignment is unpaid and pending', [next[1].isPaid, next[1].progressStatus], [false, 'pending']);
}

// =================================================================================
// PART 9 — the follow-up queue (src/lib/followUpQueue.js, 2026-09-15)
// =================================================================================

const { isAwaitingFollowUp, isManuallyFlagged, followUpReferenceDate } =
  await loadModule('src/lib/followUpQueue.js', 'followup');

section('follow-up queue — bot path and manual flag');
{
  const botSilent = { state: 'PRICELIST_SENT', lastBotMessageAt: ago(3) };
  check('price list sent, silent → in', isAwaitingFollowUp(botSilent), true);
  check('…but they replied (rated) → out', isAwaitingFollowUp({ ...botSilent, leadTemperature: 'warm' }), false);
  check('…already nudged → out', isAwaitingFollowUp({ ...botSilent, followupSentAt: ago(1) }), false);
  check('threshold 2 days, silent 3 → in', isAwaitingFollowUp(botSilent, 2), true);
  check('threshold 5 days, silent 3 → not yet', isAwaitingFollowUp(botSilent, 5), false);
  check('mid-flow is not the queue', isAwaitingFollowUp({ state: 'AWAITING_DETAILS', lastBotMessageAt: ago(9) }), false);

  const manual = { state: 'NEW', followupFlaggedAt: ago(0) };
  check('flagged by hand → in, whatever the state', isAwaitingFollowUp(manual), true);
  check('flag ignores the day threshold — he asked for it now', isAwaitingFollowUp(manual, 5), true);
  check('flag older than the last nudge → out', isManuallyFlagged({ followupFlaggedAt: ago(5), followupSentAt: ago(1) }), false);
  check('re-flagged after a nudge → in again', isManuallyFlagged({ followupFlaggedAt: ago(0), followupSentAt: ago(1) }), true);
  check('reference date: price list for bot rows', followUpReferenceDate(botSilent), botSilent.lastBotMessageAt);
  check('reference date: the flag for manual rows', followUpReferenceDate(manual), manual.followupFlaggedAt);
  check('null-safe', isAwaitingFollowUp(null), false);
}

await rm(outDir, { recursive: true, force: true });
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
