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

// =================================================================================
// PART 10 — money: the reports must add up (src/lib/profitCalculations.js, 2026-09-19)
//
// Not bot code, but this is the only test runner in the repo and these ~60 lines have
// now produced three production money bugs. The rule under test is one sentence:
// gross − VAT − crew cost = profit, from the numbers the screen shows.
// =================================================================================

const { calculateNetProfit } = await loadModule('src/lib/profitCalculations.js', 'profit');
const { getEventVatAmount, getEventTeamCost } = await loadModule('src/lib/financialCalculations.js', 'fin');

section('net profit — adds up, and ignores everything that made it not');
{
  const team = [{ role: 'photographer1', staffMemberName: 'אבי', cost: 1500 }, { role: 'videographer', staffMemberName: 'בני', cost: '2000' }];
  const e = { totalAmountGross: 11800, vatPercent: 18, team };
  check('VAT extracted from gross', getEventVatAmount(e), 1800);
  check('crew cost = the snapshot (strings too)', getEventTeamCost(e), 3500);
  check('profit = gross − VAT − crew', calculateNetProfit(e), 6500);

  const raisedRates = [{ name: 'אבי', ratesByRole: [{ role: 'photographer1', rate: 2500 }] }];
  check('a rate raised TODAY does not rewrite a past wedding', calculateNetProfit(e, raisedRates), 6500);
  check('a stale stored profit_net is ignored', calculateNetProfit({ ...e, profitNet: 1 }), 6500);
  check('stored VAT is the VAT used', calculateNetProfit({ ...e, vatAmount: 1700 }), 6600);
  check('VAT-exempt event (0%)', calculateNetProfit({ totalAmountGross: 10000, vatPercent: 0, team }), 6500);
  check('no team yet → profit is the pre-VAT price', calculateNetProfit({ totalAmountGross: 11800, vatPercent: 18 }), 10000);
  check('no price → 0', calculateNetProfit({ team }), 0);

  // The three months from the owner's screenshots: the summary must reconcile.
  const month = [
    { totalAmountGross: 12000, vatPercent: 18, team: [{ cost: 4400 }] },
    { totalAmountGross: 13700, vatPercent: 18, team: [{ cost: 5300 }] },
    { totalAmountGross: 12000, vatPercent: 18, team: [] },
  ];
  const sum = (f) => Math.round(month.reduce((s, x) => s + f(x), 0) * 100) / 100;
  check('Σprofit = Σgross − ΣVAT − Σexpenses, to the agora',
    sum(calculateNetProfit),
    Math.round((sum((x) => x.totalAmountGross) - sum(getEventVatAmount) - sum(getEventTeamCost)) * 100) / 100);
}

// =================================================================================
// PART 11 — lump-sum staff payments (src/lib/staffPaymentAllocation.js, 2026-09-20)
//
// The preview the owner confirms must match what record_staff_payment (0066) does:
// inside the period on screen, oldest first, stop at the first that doesn't fit, the
// rest is credit FOR THAT PERIOD. The first version (0065) closed against all history —
// his 6,000 for August landed on older months and August still read 7,200. The
// "older months are not touched" cases below exist because of that.
// =================================================================================

const { unpaidRowsForStaff, allocatePayment, creditByStaff, creditForExactPeriod, undoablePaymentIds, periodRange } =
  await loadModule('src/lib/staffPaymentAllocation.js', 'staffpay');

section('period range — the month on screen, or the year for "all months"');
check('August 2026', periodRange(2026, '7'), { from: '2026-08-01', to: '2026-08-31' });
check('February 2028 (leap)', periodRange(2028, '1'), { from: '2028-02-01', to: '2028-02-29' });
check('all months → the year', periodRange(2026, 'all'), { from: '2026-01-01', to: '2026-12-31' });

section("staff payments — the owner's own example: 7,200 owed for August, 6,000 paid");
{
  const ev = (id, date, extra = {}) => ({ id, date, coupleNames: id, team: [{ staffMemberName: 'רודי', role: 'photographer1', cost: 1800, ...extra }] });
  const events = [
    ev('d', '2026-08-27'), ev('a', '2026-08-20'), ev('c', '2026-08-26'), ev('b', '2026-08-24'),
    ev('july', '2026-07-10'),
    ev('paid', '2026-08-01', { isPaid: true }),
    ev('future', '2027-01-01'),
    { id: 'other', date: '2026-08-10', coupleNames: 'other', team: [{ staffMemberName: 'דרור', cost: 1200 }] },
    { id: 'free', date: '2026-08-11', coupleNames: 'free', team: [{ staffMemberName: 'רודי', cost: 0 }] },
  ];
  const august = periodRange(2026, '7');

  check('no period → everything unpaid, oldest first (July too)',
    unpaidRowsForStaff(events, 'רודי', '2026-09-20').map((r) => r.eventId), ['july', 'a', 'b', 'c', 'd']);
  const rows = unpaidRowsForStaff(events, 'רודי', '2026-09-20', august);
  check('August only — July is not in it', rows.map((r) => r.eventId), ['a', 'b', 'c', 'd']);
  check('…his, unpaid, costed, already happened', rows.length, 4);

  const p1 = allocatePayment({ amount: 6000, creditBefore: 0, rows });
  check('6,000 closes three August events', p1.covered.map((r) => r.eventId), ['a', 'b', 'c']);
  check('…applies 5,400', p1.applied, 5400);
  check('…keeps 600 as credit', p1.creditAfter, 600);
  check('…names the one still open', p1.firstUncovered.eventId, 'd');
  // What the card then says: 1,800 still open − 600 credit = 1,200 left.
  check('"נשאר לשלם" = open − credit = 1,200', 1800 - p1.creditAfter, 1200);

  const p2 = allocatePayment({ amount: 1200, creditBefore: 600, rows: rows.slice(3) });
  check('paying the 1,200 closes the last one', [p2.covered.length, p2.applied, p2.creditAfter], [1, 1800, 0]);

  check('too little for anything → all credit', allocatePayment({ amount: 1000, creditBefore: 0, rows }).creditAfter, 1000);
  check('more than the month → the surplus is credit', allocatePayment({ amount: 10000, creditBefore: 0, rows }).creditAfter, 2800);
  check('never skips ahead to a cheaper, newer event',
    allocatePayment({ amount: 2000, creditBefore: 0, rows: [{ eventId: 'big', cost: 2500 }, { eventId: 'small', cost: 1800 }] }).covered.length, 0);
  check('agorot do not drift', allocatePayment({ amount: 0.3, creditBefore: 0, rows: [{ eventId: 'x', cost: 0.1 }, { eventId: 'y', cost: 0.2 }] }).creditAfter, 0);
}

section('credit and undo are per period');
{
  const aug = periodRange(2026, '7');
  const sep = periodRange(2026, '8');
  const year = periodRange(2026, 'all');
  const payments = [
    { id: 'a1', staffMemberName: 'רודי', amount: 6000, appliedAmount: 5400, periodFrom: aug.from, periodTo: aug.to, createdAt: '2026-09-01T10:00:00Z' },
    { id: 'a2', staffMemberName: 'רודי', amount: 500, appliedAmount: 0, periodFrom: aug.from, periodTo: aug.to, createdAt: '2026-09-02T10:00:00Z' },
    { id: 's1', staffMemberName: 'רודי', amount: 2000, appliedAmount: 1800, periodFrom: sep.from, periodTo: sep.to, createdAt: '2026-09-03T10:00:00Z' },
    { id: 'old', staffMemberName: 'דרור', amount: 300, appliedAmount: 0, periodFrom: null, periodTo: null, createdAt: '2026-09-04T10:00:00Z' },
  ];
  check('August view: August credit only (+ undated legacy)', creditByStaff(payments, aug), { 'רודי': 1100, 'דרור': 300 });
  check('September view: not August\'s leftover', creditByStaff(payments, sep), { 'רודי': 200, 'דרור': 300 });
  check('year view: all of the year', creditByStaff(payments, year), { 'רודי': 1300, 'דרור': 300 });
  check('a new August payment starts from August credit only', creditForExactPeriod(payments, 'רודי', aug), 1100);
  check('a new September payment starts from September credit only', creditForExactPeriod(payments, 'רודי', sep), 200);
  check('a new payment for a fresh month starts from zero', creditForExactPeriod(payments, 'רודי', periodRange(2026, '9')), 0);
  check('undo: the latest of each person AND period, so fixing August does not need September undone',
    [...undoablePaymentIds(payments)].sort(), ['a2', 'old', 's1']);
}

// =================================================================================
// PART 12 — which replies get rated hot / warm / cold (shouldRateReply, 2026-09-23)
//
// The rating lived inside the bot's follow-up gate, which requires the bot to be ON in
// the conversation — and the bot is muted the moment the owner touches a chat. The 🔥
// chip stayed empty for two weeks. These cases pin the fix: "is the bot muted?" must
// never be part of the question.
// =================================================================================

const { shouldRateReply } = await loadModule('supabase/functions/_shared/whatsappIntent.ts', 'rate');

section('rating a reply to the price list');
{
  const base = { isInbound: true, isGroup: false, state: 'PRICELIST_SENT', contactType: 'unknown', typeMessage: 'textMessage', currentTemperature: null };
  check('a stranger replies to the price list → rated', shouldRateReply(base), true);
  check('…the input has no botEnabled at all, so a muted bot cannot block it', 'botEnabled' in base, false);
  check('became a lead ("צור ליד") → still rated', shouldRateReply({ ...base, contactType: 'lead' }), true);
  check('a signed client saying thanks → not a sales signal', shouldRateReply({ ...base, contactType: 'client' }), false);
  check('staff → no', shouldRateReply({ ...base, contactType: 'staff' }), false);
  check('a group → no', shouldRateReply({ ...base, isGroup: true }), false);
  check('the studio\'s own message → no', shouldRateReply({ ...base, isInbound: false }), false);
  check('price list not sent yet → no', shouldRateReply({ ...base, state: 'AWAITING_DETAILS' }), false);
  check('never greeted → no', shouldRateReply({ ...base, state: 'NEW' }), false);
  check('voice note / photo → no', shouldRateReply({ ...base, typeMessage: 'audioMessage' }), false);
  check('already hot → left alone', shouldRateReply({ ...base, currentTemperature: 'hot' }), false);
  check('warm is re-rated on the next reply', shouldRateReply({ ...base, currentTemperature: 'warm' }), true);
  check('cold is re-rated on the next reply', shouldRateReply({ ...base, currentTemperature: 'cold' }), true);
}

// =================================================================================
// PART 13 — menu badges: which page a notification lights up
// (src/lib/notificationCategories.js, 2026-09-24)
//
// The owner asked for "1 next to לידים when a contract is signed, the same for albums".
// The badge and the bell read the same rows; these pin the mapping and the two rules
// that keep them honest: only UNREAD rows count, and a type nobody mapped lights nothing.
// =================================================================================

const { navRouteForNotification, unreadCountsByRoute, unreadNotificationsForRoute } =
  await loadModule('src/lib/notificationCategories.js', 'notifcat');

section('menu badges — which page each notification belongs to');
{
  check('contract signed → לידים', navRouteForNotification('contract_signed'), '/Leads');
  check('hot lead → שיחות וואטסאפ (the merged chat, 2026-10-07)', navRouteForNotification('whatsapp_hot_lead'), '/chat');
  check('album round approved → הזמנות אלבומים', navRouteForNotification('album_round_approved'), '/AlbumOrders');
  check('album revision requested → הזמנות אלבומים', navRouteForNotification('album_revision_requested'), '/AlbumOrders');
  check('transfer proof uploaded → הזמנות אלבומים', navRouteForNotification('album_transfer_proof_uploaded'), '/AlbumOrders');
  check('staff answered availability → שיבוץ צוות', navRouteForNotification('staff_availability_response'), '/StaffScheduling');
  check('a failed backup lights no page', navRouteForNotification('monthly_backup_failed'), null);
  check('a failed alert lights no page', navRouteForNotification('contract_alert_delivery_failed'), null);
  check('missing type → null, not a crash', navRouteForNotification(undefined), null);

  const rows = [
    { id: 1, type: 'contract_signed', isRead: false },
    { id: 2, type: 'contract_signed', isRead: true },
    { id: 3, type: 'album_round_approved', isRead: false },
    { id: 4, type: 'album_transfer_proof_uploaded', isRead: false },
    { id: 5, type: 'monthly_backup_failed', isRead: false },
    { id: 6, type: 'whatsapp_hot_lead', isRead: false },
  ];
  const counts = unreadCountsByRoute(rows);
  check('לידים counts unread only', counts['/Leads'], 1);
  check('אלבומים counts both album types', counts['/AlbumOrders'], 2);
  check('וואטסאפ', counts['/chat'], 1);
  check('a page with nothing is absent, not 0', '/StaffScheduling' in counts, false);
  check('the failure is in no page count', Object.values(counts).reduce((a, b) => a + b, 0), 4);
  check('visiting אלבומים marks exactly its two rows', unreadNotificationsForRoute(rows, '/AlbumOrders').map((r) => r.id).join(','), '3,4');
  check('visiting a page with no mapping marks nothing', unreadNotificationsForRoute(rows, '/Payments').length, 0);
  check('empty list → empty counts', Object.keys(unreadCountsByRoute([])).length, 0);
}

// =================================================================================
// PART 14 — the control centre: the studio's own words, required details, question
// wording, message ceiling, nudge hours (2026-09-24)
//
// Every knob here used to be a constant. The one thing that must never change is the
// rule: without overrides the gate is exactly what it was, and a broken setting degrades
// to the old constant — never to "send to everyone".
// =================================================================================

const { detectLeadIntent: detectWithTerms, effectiveTerms, BUILTIN_TERMS, decideBotFollowUp: followUpMax, explainDecision } =
  await loadModule('supabase/functions/_shared/whatsappIntent.ts', 'intent2');
const { renderQuestion, parseJsonStringArray, parseRequiredFields, loadBotSettings: loadBotSettings2 } =
  await loadModule('supabase/functions/_shared/whatsappBotSend.ts', 'botsend2');
const { missingFields: missingWithRequired } = await loadModule('supabase/functions/_shared/whatsappLeadExtract.ts', 'extract2');
const { isStalledInFlow: stalledWith } = await loadModule('supabase/functions/_shared/whatsappHousekeeping.ts', 'housekeeping2');
const botTerms = await loadModule('src/lib/botTerms.js', 'botterms');

section("the studio's words — additions, switched-off built-ins, vendor veto");
{
  check('no overrides = the built-in lists, untouched', effectiveTerms().service.length, BUILTIN_TERMS.service.length);
  check('no overrides = same verdict as before', detectWithTerms('היי, כמה עולה צילום חתונה?').isInquiry, true);
  const noBuiltin = detectWithTerms('היי, כמה עולה אירוע קונספט?');
  check('a word nobody listed does not open the gate', noBuiltin.isInquiry, false);
  const withExtra = detectWithTerms('היי, כמה עולה אירוע קונספט?', { terms: { serviceExtra: ['אירוע קונספט'] } });
  check("the studio's own service word opens it", withExtra.isInquiry, true);
  check('…and is reported as the word that fired', withExtra.matchedService, 'אירוע קונספט');
  const off = detectWithTerms('כמה עולה צילום?', { terms: { disabled: ['צילום'] } });
  check('a switched-off built-in no longer matches', off.matchedService, null);
  check('…so the gate stays shut', off.isInquiry, false);
  const offFinal = detectWithTerms('כמה עולים מגנטים?', { terms: { disabled: ['מגנטימ'] } });
  check('switching off is compared after normalisation (final letters)', offFinal.matchedService, null);
  const veto = detectWithTerms('כמה עולה צילום חתונה? אני מנהל אולם', { terms: { vendorExtra: ['מנהל אולם'] } });
  check("the studio's own vendor word vetoes", veto.isInquiry, false);
  check('…and is reported', veto.matchedVendor, 'מנהל אולם');
  const self = detectWithTerms('אנחנו חוגגים בר מצווה לבן', { terms: { selfEventExtra: ['חוגגים'] } });
  check('an own self-event word stands alone', self.isInquiry, true);
  check('extras are deduped against built-ins', effectiveTerms({ serviceExtra: ['חתונה', 'חתונה'] }).service.length, BUILTIN_TERMS.service.length);
  check('blank / junk entries are ignored', effectiveTerms({ serviceExtra: ['', '   ', null] }).service.length, BUILTIN_TERMS.service.length);
}

section('settings parsing — broken values degrade to the old constants');
{
  check('JSON array parses', parseJsonStringArray('["a","b"]').join(','), 'a,b');
  check('broken JSON → nothing', parseJsonStringArray('[a,b').length, 0);
  check('a non-array → nothing', parseJsonStringArray('"x"').length, 0);
  check('empty string → nothing', parseJsonStringArray('').length, 0);
  check('dedupe + trim', parseJsonStringArray('[" a ","a",""]').join(','), 'a');
  check('required fields: a subset', parseRequiredFields('["venue","coupleNames"]').join(','), 'coupleNames,venue');
  check('required fields: unknown names ignored', parseRequiredFields('["venue","x"]').join(','), 'venue');
  check('required fields: only unknown → all four', parseRequiredFields('["x"]').length, 4);
  check('required fields: empty → all four', parseRequiredFields('').length, 4);
  const s = await loadBotSettings2(fakeDb({ settingsRows: settingRows({
    whatsapp_max_bot_messages: '9', whatsapp_nudge_after_hours: '0',
    whatsapp_terms_service_extra: '["בוק"]', whatsapp_terms_disabled: 'not json',
    whatsapp_required_fields: '["eventDate"]', whatsapp_question_text_one: '',
  }) }), 't1');
  check('maxBotMessages clamped to 6', s.maxBotMessages, 6);
  check('nudgeAfterHours clamped to 1', s.nudgeAfterHours, 1);
  check('service extra read', s.terms.serviceExtra.join(','), 'בוק');
  check('broken disabled list → empty', s.terms.disabled.length, 0);
  check('required fields read', s.requiredFields.join(','), 'eventDate');
  check('empty question template → default', s.questionTextOne.includes('{{missing}}'), true);
  const d = await loadBotSettings2(fakeDb({ settingsRows: [] }), 't1');
  check('no rows: maxBotMessages = 3 (the old constant)', d.maxBotMessages, 3);
  check('no rows: nudge after 24h (the old constant)', d.nudgeAfterHours, 24);
  check('no rows: all four details required', d.requiredFields.length, 4);
}

section('required details and the question wording');
{
  const details = { coupleNames: 'נועה ואיתי', eventDate: null, venue: null, guestCount: null };
  check('all four required → three missing', missingWithRequired(details).length, 3);
  check('only names required → nothing missing → price list', missingWithRequired(details, ['coupleNames']).length, 0);
  check('names + date required → date missing', missingWithRequired(details, ['coupleNames', 'eventDate']).join(','), 'תאריך האירוע');
  const tpl = { questionTextOne: 'חסר לנו רק {{missing}} 🙏', questionTextMany: 'חסרים:\n{{missing_list}}' };
  check('one missing → studio template', renderQuestion(['תאריך האירוע'], tpl), 'חסר לנו רק תאריך האירוע 🙏');
  check('several missing → bullet list', renderQuestion(['א', 'ב'], tpl), 'חסרים:\n• א\n• ב');
  check('template without its placeholder → default (never a question without the question)',
    renderQuestion(['תאריך האירוע'], { questionTextOne: 'תודה!', questionTextMany: 'x' }).includes('תאריך האירוע'), true);
  check('the screen preview renders the same', botTerms.renderQuestionPreview(['א', 'ב'], tpl), renderQuestion(['א', 'ב'], tpl));
  check('screen parseRequiredFields mirrors the server', botTerms.parseRequiredFields('["x"]').length, 4);
}

section('message ceiling and nudge hours');
{
  const base = { contactType: 'unknown', botEnabled: true, state: 'AWAITING_DETAILS', isGroup: false, typeMessage: 'textMessage', inQuietHours: false };
  check('default ceiling 3: third message hands off', followUpMax({ ...base, botMessagesSoFar: 3 }).reason, 'too_many_questions');
  check('ceiling 2: second already hands off', followUpMax({ ...base, botMessagesSoFar: 2, maxBotMessages: 2 }).reason, 'too_many_questions');
  check('ceiling 6: fifth still replies', followUpMax({ ...base, botMessagesSoFar: 5, maxBotMessages: 6 }).reason, 'ok');
  const now = Date.parse('2026-09-24T12:00:00Z');
  const c = { state: 'AWAITING_DETAILS', last_bot_message_at: '2026-09-24T04:00:00Z', last_inbound_at: null };
  check('8h of silence: not stalled at the default 24h', stalledWith(c, now), false);
  check('8h of silence: stalled when the studio set 6h', stalledWith(c, now, 6 * 3600 * 1000), true);
  check('8h of silence: not stalled at 72h', stalledWith(c, now, 72 * 3600 * 1000), false);
}

section('the trace — each step says what it saw');
{
  const input = { contactType: 'unknown', botEnabled: true, state: 'NEW', isGroup: false, typeMessage: 'textMessage', bodyText: 'היי, אני צלם, כמה אתם לוקחים על חתונה?', inQuietHours: false, alreadyDecidedToReply: false };
  const trace = explainDecision(input, decideBotReply(input));
  check('seven steps', trace.length, 7);
  check('stops at the intent step', trace.find((t) => t.status === 'stopped')?.step, 'intent');
  check('…naming the vendor word', trace.find((t) => t.step === 'intent').detail.includes('אני צלם'), true);
  check('later steps are skipped, not judged', trace.find((t) => t.step === 'quiet').status, 'skipped');
  const okInput = { ...input, bodyText: 'כמה עולה צילום חתונה?' };
  const okTrace = explainDecision(okInput, decideBotReply(okInput));
  check('a passing message passes every step', okTrace.every((t) => t.status === 'passed'), true);
  const nightInput = { ...okInput, inQuietHours: true };
  check('quiet hours is "held", not "stopped"', explainDecision(nightInput, decideBotReply(nightInput)).find((t) => t.step === 'quiet').status, 'held');
  const known = { ...okInput, contactType: 'client' };
  check('a known contact stops at step 2', explainDecision(known, decideBotReply(known)).find((t) => t.status === 'stopped')?.step, 'contact');
}

section('term warnings on the screen');
{
  const lists = { service: ['צלם'], inquiry: ['כמה'], selfEvent: [], vendor: ['אני צלם'] };
  check('short word warns', botTerms.termWarnings('כל', 'service', lists).length > 0, true);
  check('a service word as vendor warns', botTerms.termWarnings('צלם', 'vendor', lists).some((w) => w.includes('ספק')), true);
  check('a vendor word as service warns', botTerms.termWarnings('אני צלם', 'service', lists).some((w) => w.includes('ספק')), true);
  check('a plain new word: quiet', botTerms.termWarnings('מגנטים', 'service', lists).length, 0);
  check('serialize/parse round-trip', botTerms.parseTermList(botTerms.serializeTermList(['א', 'ב', 'א'])).join(','), 'א,ב');
}

// =================================================================================
// PART 15 — WhatsApp Pro stage 0: receipts, group names, quotes, chat ids, no double
// sends (_shared/whatsappStatus.ts, _shared/whatsapp.ts, _shared/retry.ts, 2026-10-05)
// =================================================================================

const ws = await loadModule('supabase/functions/_shared/whatsappStatus.ts', 'wstatus');
const { resolveChatIdForSend } = await loadModule('supabase/functions/_shared/whatsapp.ts', 'wsend');
const { fetchWithRetry } = await loadModule('supabase/functions/_shared/retry.ts', 'wretry');

section('delivery receipts only move forward');
{
  check('sent < delivered < read', [ws.statusRank('sent'), ws.statusRank('delivered'), ws.statusRank('read')].join(','), '1,2,3');
  check('failures are terminal (9)', ['failed', 'noAccount', 'suspended', 'notInGroup', 'yellowCard'].every((x) => ws.statusRank(x) === 9), true);
  check('unknown status → 0, ignored', ws.statusRank('weird'), 0);
  check('first receipt is recorded', ws.shouldAdvance(null, 1), true);
  check('delivered after sent → advance', ws.shouldAdvance(1, 2), true);
  check('late "delivered" after "read" → kept as read', ws.shouldAdvance(3, 2), false);
  check('the same receipt twice → no change', ws.shouldAdvance(2, 2), false);
  check('failed after sent → advance', ws.shouldAdvance(1, 9), true);
  check('unknown never advances', ws.shouldAdvance(null, 0), false);
}

section('group title stays the group; the member is kept on the message');
{
  const sd = { chatName: 'צוות אווירה', sender: '972501234567@c.us', senderName: 'נטע', senderContactName: 'נטע צלמת' };
  check('group, inbound → group name', ws.pickDisplayName({ isInbound: true, isGroup: true, senderData: sd }), 'צוות אווירה');
  check('group, outbound → group name', ws.pickDisplayName({ isInbound: false, isGroup: true, senderData: sd }), 'צוות אווירה');
  check('private, inbound → phonebook name first', ws.pickDisplayName({ isInbound: true, isGroup: false, senderData: sd }), 'נטע צלמת');
  check('private, outbound → chatName only (never the studio)', ws.pickDisplayName({ isInbound: false, isGroup: false, senderData: { senderName: 'AVIRA', chatName: 'מיכל' } }), 'מיכל');
  const g = ws.groupSender({ isInbound: true, isGroup: true, senderData: sd });
  check('group member name', g.senderName, 'נטע צלמת');
  check('group member id', g.senderChatId, '972501234567@c.us');
  check('private chat → no sender stored', ws.groupSender({ isInbound: true, isGroup: false, senderData: sd }).senderName, null);
  check('our own message in a group → no sender', ws.groupSender({ isInbound: false, isGroup: true, senderData: sd }).senderName, null);
}

section('quotes and media');
{
  check('quoted reply id (documented shape)', ws.extractQuotedId({ typeMessage: 'quotedMessage', extendedTextMessageData: { text: 'x', stanzaId: '46618B98' } }), '46618B98');
  check('plain text → no quote', ws.extractQuotedId({ textMessageData: { textMessage: 'x' } }), null);
  check('jpeg → jpg', ws.mediaExtension('image/jpeg', 'IMG.JPG'), 'jpg');
  check('voice note ogg with codec → ogg', ws.mediaExtension('audio/ogg; codecs=opus', null), 'ogg');
  check('unknown mime → from file name', ws.mediaExtension('application/x-foo', 'contract.docx'), 'docx');
  check('nothing known → bin', ws.mediaExtension(null, null), 'bin');
  check('path starts with the tenant (the read policy keys on it)', ws.mediaPath('t1', 'c1', 'ABC/../x', 'jpg'), 't1/c1/ABC____x.jpg');
}

section('reply goes to the real chat id');
{
  check('Israeli local number → 972…@c.us (unchanged)', resolveChatIdForSend('050-123-4567'), '972501234567@c.us');
  check('a private chat id passes through', resolveChatIdForSend('447700900123@c.us'), '447700900123@c.us');
  check('a number from abroad is NOT re-prefixed with 972', resolveChatIdForSend('447700900123@c.us').startsWith('972'), false);
  check('a group id passes through', resolveChatIdForSend('120363041234567890@g.us'), '120363041234567890@g.us');
  check('old-style group id passes through', resolveChatIdForSend('972501234567-1600000000@g.us'), '972501234567-1600000000@g.us');
  check('an @lid id passes through', resolveChatIdForSend('123456789012345@lid'), '123456789012345@lid');
  check('garbage → null', resolveChatIdForSend('hello'), null);
}

section('a send is never repeated on an ambiguous failure');
{
  const realFetch = globalThis.fetch;
  const run = async (responses, opts) => {
    let calls = 0;
    globalThis.fetch = async () => {
      const r = responses[Math.min(calls, responses.length - 1)];
      calls++;
      if (r === 'throw') throw new Error('network');
      return new Response('{}', { status: r });
    };
    let threw = false, status = null;
    try { status = (await fetchWithRetry('https://x', { method: 'POST' }, opts)).status; } catch { threw = true; }
    return { calls, threw, status };
  };
  try {
    check('send: 500 → one attempt only', (await run([500, 200], { retryUnsafe: false })).calls, 1);
    check('send: network error → one attempt, error surfaces', JSON.stringify(await run(['throw', 200], { retryUnsafe: false })), JSON.stringify({ calls: 1, threw: true, status: null }));
    check('send: 429 (not accepted) → retried', (await run([429, 200], { retryUnsafe: false })).status, 200);
    check('calendar (default): 500 → still retried', (await run([500, 200])).calls, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
}

section('recordDeliveryStatus — one alert per failure, no downgrade');
{
  const db = { status: {}, notifications: [] };
  const fake = {
    from(table) {
      const q = { _t: table, _f: {} };
      q.select = () => q;
      q.eq = (k, v) => { q._f[k] = v; return q; };
      q.limit = () => Promise.resolve({ data: table === 'whatsapp_conversations' ? [{ display_name: 'שני וגל', matched_lead_id: 'L1' }] : [{ body_text: 'הגלריה מוכנה' }] });
      q.maybeSingle = () => Promise.resolve({ data: db.status[q._f.id_message] || null });
      q.upsert = (row) => { db.status[row.id_message] = row; return Promise.resolve({ error: null }); };
      q.insert = (row) => { db.notifications.push(row); return Promise.resolve({ error: null }); };
      return q;
    },
  };
  const p = (status) => ({ typeWebhook: 'outgoingMessageStatus', chatId: '972531234567@c.us', idMessage: 'M1', status, timestamp: 1727691478 });
  check('sent recorded', await ws.recordDeliveryStatus(fake, 't1', p('sent')), 'recorded');
  check('read recorded', await ws.recordDeliveryStatus(fake, 't1', p('read')), 'recorded');
  check('late delivered → stale, stays read', (await ws.recordDeliveryStatus(fake, 't1', p('delivered'))) + '/' + db.status.M1.status, 'stale/read');
  check('no alert for a normal delivery', db.notifications.length, 0);
  const f = (status) => ({ ...p(status), idMessage: 'M2' });
  await ws.recordDeliveryStatus(fake, 't1', f('sent'));
  await ws.recordDeliveryStatus(fake, 't1', f('noAccount'));
  await ws.recordDeliveryStatus(fake, 't1', f('failed'));
  check('a failure → exactly one bell notification', db.notifications.length, 1);
  check('…of a type the bell shows in red', db.notifications[0].type.endsWith('_failed'), true);
  check('…naming the couple and linking the lead', db.notifications[0].title.includes('שני וגל') && db.notifications[0].related_lead_id === 'L1', true);
  check('no idMessage → ignored', await ws.recordDeliveryStatus(fake, 't1', { status: 'sent' }), 'ignored');
}

section('media retention — 18 months (owner, 2026-10-05)');
{
  const now = Date.parse('2028-04-05T00:00:00Z');
  const cutoff = Date.parse(ws.mediaRetentionCutoff(now));
  const days = Math.round((now - cutoff) / 86400000);
  check('cutoff is 540 days back', days, 540);
  check('a file from 2026-10-05 is due by 2028-04-05', Date.parse('2026-10-05T00:00:00Z') < cutoff, true);
  check('a file from a year ago is kept', Date.parse('2027-04-05T00:00:00Z') < cutoff, false);
}

// =================================================================================
// PART 16 — "אווירה צ'אט" rules (src/lib/chatModel.js) and "הסר" detection
// (_shared/whatsappOptOut.ts), 2026-10-05
// =================================================================================

const cm = await loadModule('src/lib/chatModel.js', 'chatmodel');
const { detectOptOut } = await loadModule('supabase/functions/_shared/whatsappOptOut.ts', 'optout');

section('who is waiting for a reply');
{
  const base = { contactType: 'unknown', lastInboundAt: '2026-10-05T10:00:00Z', lastMessageAt: '2026-10-05T10:00:00Z' };
  check('they wrote last → needs reply', cm.needsReply(base), true);
  check('you answered after → no', cm.needsReply({ ...base, lastMessageAt: '2026-10-05T10:05:00Z' }), false);
  check('the bot answered after (its echo does not move lastMessageAt) → no', cm.needsReply({ ...base, lastBotMessageAt: '2026-10-05T10:01:00Z' }), false);
  check('the bot spoke before they wrote → still needs reply', cm.needsReply({ ...base, lastBotMessageAt: '2026-10-05T09:00:00Z' }), true);
  check('a group never "needs reply"', cm.needsReply({ ...base, contactType: 'group' }), false);
  check('staff / vendor / irrelevant → no', ['staff', 'vendor', 'irrelevant'].every((t) => !cm.needsReply({ ...base, contactType: t })), true);
  check('archived → no', cm.needsReply({ ...base, archivedAt: '2026-10-05T11:00:00Z' }), false);
  const now = Date.parse('2026-10-05T10:18:00Z');
  check('waiting label in minutes', cm.waitingLabel(base, now), 'מחכה 18 דק׳');
  check('over two hours → long wait', cm.isLongWait(base, Date.parse('2026-10-05T12:30:00Z')), true);
  check('3 days', cm.waitingLabel(base, Date.parse('2026-10-08T11:00:00Z')), 'מחכה 3 ימים');
}

section('stage — the CRM vocabulary; the CRM wins when there is a lead');
{
  check('the vocabulary is exactly leads.status', cm.STAGES.join('|'), 'חדש|נשלחה הצעה|פולו-אפ|נסגר/חתימה|חוזה|לא רלוונטי');
  check('linked lead → the lead\'s status', cm.effectiveStage({ contactType: 'lead', matchedLeadId: 'L1', leadStage: 'חדש' }, { status: 'חוזה' }), 'חוזה');
  check('no lead → the conversation\'s own stage', cm.effectiveStage({ contactType: 'unknown', leadStage: 'פולו-אפ' }, null), 'פולו-אפ');
  check('bot sent the price list → shown as "נשלחה הצעה" (nothing written)', cm.effectiveStage({ contactType: 'unknown', state: 'PRICELIST_SENT' }, null), 'נשלחה הצעה');
  check('a stranger with nothing else → "חדש"', cm.effectiveStage({ contactType: 'unknown' }, null), 'חדש');
  check('staff has no stage', cm.effectiveStage({ contactType: 'staff' }, null), null);
  check('a change goes to the CRM only when linked', cm.stageTarget({ matchedLeadId: 'L1' }) + '/' + cm.stageTarget({}), 'lead/conversation');
}

section('boxes');
{
  const list = [
    { id: 'a', contactType: 'unknown', lastInboundAt: '2026-10-05T10:00:00Z', lastMessageAt: '2026-10-05T10:00:00Z' },
    { id: 'b', contactType: 'group' },
    { id: 'c', contactType: 'staff' },
    { id: 'd', contactType: 'client', archivedAt: '2026-10-01T00:00:00Z' },
    { id: 'e', contactType: 'past_client', optedOutAt: '2026-10-02T00:00:00Z' },
    { id: 'f', contactType: 'lead', state: 'PRICELIST_SENT' },
  ];
  const ctx = { unread: { a: 2 }, labelsByConv: { f: ['L9'] }, followUpAfterDays: 0 };
  const counts = cm.boxCounts(list, ctx, ['L9']);
  check('"all" = leads and strangers only, no archive (2026-10-07)', counts.all, 2);
  check('archive box', counts.archive, 1);
  check('archived chats are in no other box', cm.matchesBox(list[3], 'client', ctx), false);
  check('clients include past clients', counts.client, 1);
  check('needs reply', counts.needs, 1);
  check('unread', counts.unread, 1);
  check('label box', counts['label:L9'], 1);
  check('opted out box', counts.optedout, 1);
  check('follow-up: price list sent, no reply', cm.matchesBox(list[5], 'followup', ctx), true);
  check('…but never someone who asked to be removed', cm.matchesBox({ ...list[5], optedOutAt: 'x' }, 'followup', ctx), false);
}

section('sort, search, templates');
{
  const s = cm.sortConversations([
    { id: 'old', lastMessageAt: '2026-10-01T00:00:00Z' },
    { id: 'new', lastMessageAt: '2026-10-05T00:00:00Z' },
    { id: 'pinned', lastMessageAt: '2026-09-01T00:00:00Z', pinnedAt: '2026-10-02T00:00:00Z' },
  ]).map((c) => c.id).join(',');
  check('pinned first, then newest', s, 'pinned,new,old');
  const c = { phone: '0544251272', chatId: '972544251272@c.us', displayName: 'נועה', coupleNames: 'נועה ואיתי' };
  check('number as WhatsApp shows it', cm.matchesSearch(c, '+972 54-425-1272'), true);
  check('local number', cm.matchesSearch(c, '054-425'), true);
  check('name', cm.matchesSearch(c, 'איתי'), true);
  check('no match', cm.matchesSearch(c, 'דנה'), false);
  check('template fills from the lead', cm.renderTemplate('היי {{names}}, {{venue}}', c, { coupleNames: 'נועה ואיתי', venueName: 'אולם הגפן' }), 'היי נועה ואיתי, אולם הגפן');
  check('unknown values stay visible, never a hole', cm.renderTemplate('{{event_date}}', {}, null), '[תאריך]');
}

section('undo reverses exactly what was changed');
{
  check('type', JSON.stringify(cm.reverseOf({ action: 'set_type', conversationId: 'c1', before: { contactType: 'unknown', contactTypeManualAt: null } })), JSON.stringify({ kind: 'conversation', id: 'c1', values: { contactType: 'unknown', contactTypeManualAt: null } }));
  check('stage on a linked lead goes back to the CRM', cm.reverseOf({ action: 'set_stage', conversationId: 'c1', before: { leadId: 'L1', leadStatus: 'חדש' } }).kind, 'lead');
  check('stage on the conversation only', JSON.stringify(cm.reverseOf({ action: 'set_stage', conversationId: 'c1', before: { leadStage: null } }).values), JSON.stringify({ leadStage: null }));
  check('label added → removed', cm.reverseOf({ action: 'label_add', conversationId: 'c1', after: { labelId: 'L' } }).kind, 'label_remove');
  check('label removed → added back', cm.reverseOf({ action: 'label_remove', conversationId: 'c1', before: { labelId: 'L' } }).kind, 'label_add');
  check('archive restored', JSON.stringify(cm.reverseOf({ action: 'archive', conversationId: 'c1', before: { archivedAt: null } }).values), JSON.stringify({ archivedAt: null }));
  check('unknown action → nothing', cm.reverseOf({ action: 'note' }), null);
}

section('"הסר" — only unambiguous requests');
{
  for (const t of ['הסר', 'הסר.', 'הסירו', ' STOP ', 'תסירו אותי בבקשה', 'תפסיקו לשלוח לי הודעות', 'אפשר להוריד אותי מהרשימה? תורידו אותי מהרשימה']) {
    check(`opt-out: "${t}"`, detectOptOut(t), true);
  }
  for (const t of ['לא מעוניינים, תודה', 'איך מסירים את הכתם מהשמלה?', 'אפשר להסיר את התמונה הזו מהאלבום?', 'נשמח לשמוע מחירים', '', null]) {
    check(`not an opt-out: "${t}"`, detectOptOut(t), false);
  }
}

// =================================================================================
// PART 17 — which device gets which notification (_shared/pushPrefs.ts, 2026-10-05)
// =================================================================================

const pp = await loadModule('supabase/functions/_shared/pushPrefs.ts', 'pushprefs');
const screenPush = await loadModule('src/lib/pushPrefs.js', 'screenpush');

section('notification switches');
{
  const t0 = Date.parse('2026-10-05T10:00:00Z');
  check('defaults: a lead at noon → notify', pp.shouldNotify({}, 'lead', '12:00', t0), true);
  check('defaults: groups are off', pp.shouldNotify({}, 'group', '12:00', t0), false);
  check('defaults: vendors / irrelevant off', pp.shouldNotify({}, 'other', '12:00', t0), false);
  check('switched off by the owner', pp.shouldNotify({ client: false }, 'client', '12:00', t0), false);
  check('night 22:00–07:00 → quiet at 23:30', pp.shouldNotify({}, 'lead', '23:30', t0), false);
  check('…and at 06:59', pp.shouldNotify({}, 'lead', '06:59', t0), false);
  check('…but not at 07:00', pp.shouldNotify({}, 'lead', '07:00', t0), true);
  check('night switched off → notify at 23:30', pp.shouldNotify({ night: { enabled: false } }, 'lead', '23:30', t0), true);
  check('muted until later → quiet', pp.shouldNotify({ muteUntil: '2026-10-05T11:00:00Z' }, 'hot', '12:00', t0), false);
  check('mute expired → notify', pp.shouldNotify({ muteUntil: '2026-10-05T09:00:00Z' }, 'hot', '12:00', t0), true);
  check('a broken prefs value falls back to defaults', pp.shouldNotify('garbage', 'lead', '12:00', t0), true);
  check('a broken night time falls back', pp.mergePrefs({ night: { start: '25' } }).night.start, '22:00');
  check('daytime window (13:00–14:00)', pp.inWindow('13:30', '13:00', '14:00') && !pp.inWindow('14:00', '13:00', '14:00'), true);
  check('categories by contact type', ['unknown', 'lead', 'client', 'past_client', 'staff', 'group', 'vendor', 'irrelevant'].map(pp.categoryForContactType).join(','), 'lead,lead,client,client,staff,group,other,other');
  check('the screen\'s defaults match the server\'s', JSON.stringify(screenPush.DEFAULT_PREFS), JSON.stringify(pp.DEFAULT_PREFS));
  check('the screen shows a switch for every category', screenPush.PREF_ROWS.map((r) => r[0]).sort().join(','), ['lead', 'hot', 'client', 'staff', 'group', 'other', 'delivery'].sort().join(','));
}

section('"טופל" — out of "דורש מענה" until they write again');
{
  const c = { contactType: 'client', lastInboundAt: '2026-10-05T10:00:00Z', lastMessageAt: '2026-10-05T10:00:00Z' };
  check('"תודה" from a client → needs reply by the rule', cm.needsReply(c), true);
  check('marked handled after it → not', cm.needsReply({ ...c, handledAt: '2026-10-05T10:05:00Z' }), false);
  check('they write again after the mark → back in', cm.needsReply({ ...c, handledAt: '2026-10-05T10:05:00Z', lastInboundAt: '2026-10-05T11:00:00Z', lastMessageAt: '2026-10-05T11:00:00Z' }), true);
  check('undo restores the previous mark', JSON.stringify(cm.reverseOf({ action: 'handled', conversationId: 'c1', before: { handledAt: null } }).values), JSON.stringify({ handledAt: null }));
}

section('"is that date free?" — finding the event date');
{
  const today = new Date(2026, 9, 5); // 5 Oct 2026
  check('30/6/27', cm.findDatesInText('אנחנו מתחתנים ב-30/6/27 באולם', today).join(), '2027-06-30');
  check('30.6.2027', cm.findDatesInText('תאריך 30.6.2027', today).join(), '2027-06-30');
  check('"30 ביוני" without a year → next June', cm.findDatesInText('מתחתנים 30 ביוני', today).join(), '2027-06-30');
  check('"16 ליוני 2027"', cm.findDatesInText('בעזרת השם 16 ליוני 2027', today).join(), '2027-06-16');
  check('"12.12" without a year → this December', cm.findDatesInText('האירוע ב-12.12', today).join(), '2026-12-12');
  check('a price is not a date', cm.findDatesInText('החבילה עולה 5.500 ש"ח', today).length, 0);
  check('a time is not a date', cm.findDatesInText('נדבר ב-14.30', today).length, 0);
  check('a phone number is not a date', cm.findDatesInText('0544251272', today).length, 0);
  check('a past date is ignored', cm.findDatesInText('התחתנו ב-1/1/25', today).length, 0);
  check('31/2 does not exist', cm.findDatesInText('31/2/27', today).length, 0);
  const msgs = [
    { kind: 'message', direction: 'inbound', bodyText: 'היי, מתחתנים ב-1/7/27' },
    { kind: 'message', direction: 'outbound_human', bodyText: 'יש לנו 30/6/27 פנוי' },
    { kind: 'message', direction: 'inbound', bodyText: 'סליחה, התכוונו ל-30/6/27' },
  ];
  check('the newest date the CUSTOMER wrote (not ours)', JSON.stringify(cm.eventDateFor({}, null, msgs, today)), JSON.stringify({ date: '2027-06-30', source: 'message' }));
  check('the CRM lead wins', cm.eventDateFor({ eventDate: '2027-05-01' }, { eventDate: '2027-08-08' }, msgs, today).source, 'lead');
  check('then what the bot collected', cm.eventDateFor({ eventDate: '2027-05-01' }, null, msgs, today).date, '2027-05-01');
  check('no date anywhere → null', cm.eventDateFor({}, null, [], today), null);
  check('"מחכה עכשיו" instead of "0 דק׳"', cm.waitingLabel({ contactType: 'lead', lastInboundAt: '2026-10-05T10:00:00Z', lastMessageAt: '2026-10-05T10:00:00Z' }, Date.parse('2026-10-05T10:00:20Z')), 'מחכה עכשיו');
}

// =================================================================================
// PART 18 — who may create a new studio (_shared/permissions.ts, SEC-02, 2026-10-06)
// =================================================================================

const perms = await loadModule('supabase/functions/_shared/permissions.ts', 'permissions');

section('create-tenant: only the platform studio owner');
{
  const P = perms.PLATFORM_TENANT_ID;
  const other = '43bf2f6b-0000-0000-0000-000000000000';
  check('platform owner may', perms.canCreateTenant({ role: 'owner', tenant_id: P }, P), true);
  check('owner of another studio may not', perms.canCreateTenant({ role: 'owner', tenant_id: other }, P), false);
  check('platform admin may not', perms.canCreateTenant({ role: 'admin', tenant_id: P }, P), false);
  check('platform studio_manager may not', perms.canCreateTenant({ role: 'studio_manager', tenant_id: P }, P), false);
  check('no profile may not', perms.canCreateTenant(null, P), false);
  check('empty platform id → nobody', perms.canCreateTenant({ role: 'owner', tenant_id: '' }, ''), false);
  check('platform id is the real studio', P, '708d9428-f1df-4b8f-86c5-4ef84a161f2b');
}

section('user management hierarchy (SEC-03): only an owner touches owners and admins');
{
  const { canManageUser: m, canAssignRole: a } = perms;
  check('owner manages owner', m('owner', 'owner'), true);
  check('owner manages admin', m('owner', 'admin'), true);
  check('admin manages photographer', m('admin', 'photographer'), true);
  check('studio_manager manages lead_coordinator', m('studio_manager', 'lead_coordinator'), true);
  check('admin may not touch owner', m('admin', 'owner'), false);
  check('admin may not touch another admin', m('admin', 'admin'), false);
  check('studio_manager may not touch admin', m('studio_manager', 'admin'), false);
  check('photographer manages nobody', m('photographer', 'editor'), false);
  check('lead_coordinator manages nobody', m('lead_coordinator', 'photographer'), false);
  check('owner assigns owner', a('owner', 'owner'), true);
  check('owner assigns studio_manager', a('owner', 'studio_manager'), true);
  check('admin assigns editor', a('admin', 'editor'), true);
  check('admin may not assign owner', a('admin', 'owner'), false);
  check('admin may not assign admin', a('admin', 'admin'), false);
  check('studio_manager may not assign studio_manager', a('studio_manager', 'studio_manager'), false);
}

// =================================================================================
// PART 19 — private signed contracts: finding the file behind the stored link (PII-02)
// =================================================================================

const scServer = await loadModule('supabase/functions/_shared/signedContract.ts', 'signedcontract');
const scScreen = await loadModule('src/lib/signedContractPath.js', 'signedcontractpath');

section('signed contract link → storage path (server and screen agree)');
{
  const ours = 'https://yzurelfhjkgqrluifszz.supabase.co/storage/v1/object/public/signed-contracts/0f6c1b2e-1111-2222-3333-444455556666/signed-contract.pdf';
  const cases = [
    ['our public link', ours, '0f6c1b2e-1111-2222-3333-444455556666/signed-contract.pdf'],
    ['already a signed link', ours.replace('/public/', '/sign/') + '?token=abc', '0f6c1b2e-1111-2222-3333-444455556666/signed-contract.pdf'],
    ['legacy Base44 link stays foreign', 'https://base44.app/api/apps/x/files/mp/abc.pdf', null],
    ['another bucket is not ours', 'https://x.supabase.co/storage/v1/object/public/media-uploads/a/b.pdf', null],
    ['path traversal refused', 'https://x.supabase.co/storage/v1/object/public/signed-contracts/../album-files/x', null],
    ['empty', '', null],
    ['null', null, null],
  ];
  for (const [name, url, want] of cases) {
    check(`server: ${name}`, scServer.contractPathFromUrl(url), want);
    check(`screen: ${name}`, scScreen.contractPathFromUrl(url), want);
  }
}

section('signedContractUrl: what the couple gets');
{
  const calls = [];
  const fake = (result) => ({ storage: { from: (b) => ({ createSignedUrl: async (p, s) => { calls.push([b, p, s]); return result; } }) } });
  const ours = 'https://x.supabase.co/storage/v1/object/public/signed-contracts/L1/signed-contract.pdf';
  check('our file → signed link', await scServer.signedContractUrl(fake({ data: { signedUrl: 'SIGNED' } }), ours, 3600), 'SIGNED');
  check('asked the right bucket/path/expiry', JSON.stringify(calls[0]), JSON.stringify(['signed-contracts', 'L1/signed-contract.pdf', 3600]));
  check('signing failed → null (never the permanent link)', await scServer.signedContractUrl(fake({ error: { message: 'x' } }), ours), null);
  check('foreign link → unchanged', await scServer.signedContractUrl(fake({}), 'https://base44.app/f.pdf'), 'https://base44.app/f.pdf');
  check('no link → null', await scServer.signedContractUrl(fake({}), null), null);
}

// =================================================================================
// PART 20 — contract HTML: images in the signed-PDF template (PII-03, 2026-10-06)
// (the HTML cleaning itself needs a browser DOM — verified in the browser against staging)
// =================================================================================

const sanit = await loadModule('src/lib/sanitizeHtml.js', 'sanitizehtml');

section('safeImageSrc: only image data URLs and https');
{
  check('studio signature (data:image/png)', sanit.safeImageSrc('data:image/png;base64,iVBOR'), 'data:image/png;base64,iVBOR');
  check('https logo', sanit.safeImageSrc('https://x.supabase.co/logo.png'), 'https://x.supabase.co/logo.png');
  check('javascript: refused', sanit.safeImageSrc('javascript:alert(1)'), '');
  check('attribute break-out refused', sanit.safeImageSrc('x" onerror="alert(1)'), '');
  check('http refused', sanit.safeImageSrc('http://x/y.png'), '');
  check('data:text/html refused', sanit.safeImageSrc('data:text/html;base64,PHNjcmlwdD4='), '');
  check('empty / not a string', [sanit.safeImageSrc(''), sanit.safeImageSrc(null)], ['', '']);
  check('empty HTML stays empty', sanit.sanitizeContractHtml(null), '');
}

// =================================================================================
// PART 21 — who an automation goes to: "בחירת אנשי צוות" (AUTO-03, 2026-10-06)
// =================================================================================

const guards = await loadModule('supabase/functions/_shared/automationGuards.ts', 'guards21');

section('selected staff = the ONLY recipients; none selected = everyone');
{
  const sel = { selected_staff_ids: ['s1', 's2'] };
  check('nobody ticked → s1 gets it', guards.isStaffSelectedForAutomation({ selected_staff_ids: [] }, 's1'), true);
  check('field missing → s1 gets it', guards.isStaffSelectedForAutomation({}, 's1'), true);
  check('ticked s1 → s1 gets it', guards.isStaffSelectedForAutomation(sel, 's1'), true);
  check('ticked s1,s2 → s3 does NOT get it', guards.isStaffSelectedForAutomation(sel, 's3'), false);
  check('no automation → everyone', guards.isStaffSelectedForAutomation(null, 's1'), true);
}

// =================================================================================
// PART 22 — "הסר" is respected by every automated / bulk send (AUTO-07, 2026-10-06)
// =================================================================================

const oo = await loadModule('supabase/functions/_shared/whatsappOptOut.ts', 'optout22');
const fq22 = await loadModule('src/lib/followUpQueue.js', 'followup22');

section('opt-out list: matching a lead/event phone to the conversation that wrote "הסר"');
{
  const list = oo.buildOptOutList([
    { phone: '0501234567', chat_id: '972501234567@c.us' },
    { phone: null, chat_id: '447700900123@c.us' },           // a number from abroad
    { phone: null, chat_id: '972521112233@c.us' },           // phone column empty
  ]);
  check('same local number', oo.isOptedOut(list, '0501234567'), true);
  check('with dashes / spaces', oo.isOptedOut(list, '050-123 4567'), true);
  check('international form', oo.isOptedOut(list, '+972 50 123 4567'), true);
  check('digits only 972…', oo.isOptedOut(list, '972501234567'), true);
  check('chat id', oo.isOptedOut(list, '972501234567@c.us'), true);
  check('abroad number by digits', oo.isOptedOut(list, '447700900123'), true);
  check('phone column empty → matched through chat id', oo.isOptedOut(list, '0521112233'), true);
  check('someone else', oo.isOptedOut(list, '0509999999'), false);
  check('empty phone', oo.isOptedOut(list, ''), false);
  check('no list (test phone / dry run) → never blocks', oo.isOptedOut(null, '0501234567'), false);
  check('reason text', oo.OPTED_OUT_REASON.includes('הסר'), true);
}

section('follow-up queue never offers someone who wrote "הסר"');
{
  const base = { state: 'PRICELIST_SENT', lastBotMessageAt: '2026-09-01T10:00:00Z' };
  check('normal → in the queue', fq22.isAwaitingFollowUp(base, 0), true);
  check('opted out → not in the queue', fq22.isAwaitingFollowUp({ ...base, optedOutAt: '2026-10-01T10:00:00Z' }, 0), false);
  check('opted out beats a manual flag', fq22.isAwaitingFollowUp({ ...base, followupFlaggedAt: '2026-10-02T10:00:00Z', optedOutAt: '2026-10-01T10:00:00Z' }, 0), false);
}

// =================================================================================
// PART 23 — a queued reminder is re-checked when it is approved (AUTO-19, 2026-10-06)
// =================================================================================

const g23 = await loadModule('supabase/functions/_shared/automationGuards.ts', 'guards23');

section('queued reminder still due at approval time?');
{
  const now = new Date('2026-10-06T10:00:00Z');
  const q = (row) => g23.staleReasonFromRows('questionnaire_reminder', row, now);
  const p = (row) => g23.staleReasonFromRows('payment_reminder', row, now);
  check('questionnaire: still due', q({ event_date: '2026-10-20' }), null);
  check('questionnaire: filled in meanwhile', q({ event_date: '2026-10-20', production_form_filled_at: '2026-10-05T09:00:00Z' }), 'השאלון כבר מולא');
  check('questionnaire: reminded 1 day ago', q({ event_date: '2026-10-20', questionnaire_reminder_sent_at: '2026-10-05T10:00:00Z' }), 'כבר נשלחה תזכורת בימים האחרונים');
  check('questionnaire: reminded 4 days ago → due', q({ event_date: '2026-10-20', questionnaire_reminder_sent_at: '2026-10-02T09:00:00Z' }), null);
  check('questionnaire: event passed', q({ event_date: '2026-10-05' }), 'האירוע כבר עבר');
  check('questionnaire: lead deleted', q(null), 'הליד כבר לא קיים');
  check('payment: not paid → due', p({ client_payment_status: 'Pending' }), null);
  check('payment: paid meanwhile', p({ client_payment_status: 'Paid' }), 'כבר שולם');
  check('payment: event deleted', p(null), 'האירוע כבר לא קיים');
  check('other types are not re-checked', g23.staleReasonFromRows('album_reminder', null, now), null);
}

// =================================================================================
// PART 24 — a pause between messages sent in a row (AUTO-12, 2026-10-06)
// =================================================================================

const wa24 = await loadModule('supabase/functions/_shared/whatsapp.ts', 'wa24');

section('pacing: the first message never waits, the next ones wait 1.2–2.0s');
{
  const t = 1_000_000;
  check('first send of the invocation → no wait', wa24.msToWaitBeforeSend(t, 0, 500), 0);
  check('right after a send, no jitter → 1200ms', wa24.msToWaitBeforeSend(t, t, 0), 1200);
  check('right after a send, max jitter → 2000ms', wa24.msToWaitBeforeSend(t, t, 800), 2000);
  check('jitter is capped', wa24.msToWaitBeforeSend(t, t, 99999), 2000);
  check('half a second later → the rest', wa24.msToWaitBeforeSend(t + 500, t, 0), 700);
  check('long after → no wait', wa24.msToWaitBeforeSend(t + 5000, t, 800), 0);
}

// =================================================================================
// PART 25 — Google Calendar create-lock (AUTO-01/05, 2026-10-06)
// =================================================================================

const gcs = await loadModule('supabase/functions/_shared/googleCalendarSync.ts', 'gcs25');

section('create-lock: in progress vs. left behind by a crashed run');
{
  const now = 1_800_000_000_000;
  check('a real Google id is not a lock', gcs.isCreateLock('abc123'), false);
  check('no id is not a lock', gcs.isCreateLock(null), false);
  check('creating_<ms> is a lock', gcs.isCreateLock(`creating_${now}`), true);
  check('lock from 1 minute ago → still in progress', gcs.isStaleCreateLock(`creating_${now - 60_000}`, now), false);
  check('lock from 11 minutes ago → stale, take over', gcs.isStaleCreateLock(`creating_${now - 11 * 60_000}`, now), true);
  check('garbage lock → stale', gcs.isStaleCreateLock('creating_xyz', now), true);
  check('real id is never stale', gcs.isStaleCreateLock('abc123', now), false);
}

// =================================================================================
// PART 26 — money and dates (BUG-10 / BUG-13, 2026-10-06)
// =================================================================================

const ld = await loadModule('src/lib/localDate.js', 'localdate');

section('"today" is Israel time, not UTC');
{
  check('00:30 Israel on 7 Oct (= 21:30 UTC on 6 Oct) → 7 Oct', ld.todayInIsrael(new Date('2026-10-06T21:30:00Z')), '2026-10-07');
  check('02:59 Israel → still that day', ld.todayInIsrael(new Date('2026-10-06T23:59:00Z')), '2026-10-07');
  check('noon → same day', ld.todayInIsrael(new Date('2026-10-07T09:00:00Z')), '2026-10-07');
  check('winter time (UTC+2): 01:00 on 1 Jan', ld.todayInIsrael(new Date('2026-12-31T23:00:00Z')), '2027-01-01');
}

section('VAT inside a gross amount (the invoices page)');
{
  const vatInside = (gross, pct) => (pct > 0 ? gross - gross / (1 + pct / 100) : 0);
  check('₪10,000 at 18% → ₪1,525.42 (not ₪1,800)', Math.round(vatInside(10000, 18) * 100) / 100, 1525.42);
  check('0% → no VAT', vatInside(10000, 0), 0);
}

// =================================================================================
// PART 27 — screens report what really happened (E2: BUG-03..07, 2026-10-06)
// =================================================================================

const ao = await loadModule('src/lib/actionOutcome.js', 'actionoutcome');

section('"sent N" tells the truth');
{
  check('all sent', ao.sendSummary({ sent: 5 }), { text: 'נשלחו 5', level: 'success' });
  check('some failed', ao.sendSummary({ sent: 3, failed: 2 }).level, 'warning');
  check('all failed', ao.sendSummary({ sent: 0, failed: 2 }).level, 'error');
  check('only skipped', ao.sendSummary({ sent: 0, skipped: 2 }).level, 'warning');
  check('skipped mentioned', ao.sendSummary({ sent: 1, skipped: 1 }).text.includes('דולגו 1'), true);
  check('nothing / missing → "נשלחו 0"', ao.sendSummary(undefined).text, 'נשלחו 0');
}

section('calendar and lead→event sync answers');
{
  check('calendar ok', ao.calendarSyncOutcome({ success: true, results: [] }).ok, true);
  check('calendar: account failed (HTTP 200!) → not ok', ao.calendarSyncOutcome({ success: false, results: [{ status: 'failed', error: 'POST failed: 500' }] }).ok, false);
  check('calendar: lock → "in progress"', ao.calendarSyncOutcome({ success: false, results: [{ status: 'skipped' }] }).text.includes('בתהליך'), true);
  check('lead sync ok', ao.leadSyncOutcome({ success: true }).ok, true);
  check('lead sync skipped → not ok', ao.leadSyncOutcome({ skipped: 'status_blocked: חדש' }).ok, false);
  const settled = [{ status: 'fulfilled', value: { data: {} } }, { status: 'fulfilled', value: { data: { error: 'x' } } }, { status: 'rejected', reason: new Error('x') }];
  check('allSettled counts', ao.settledCounts(settled), { ok: 1, failed: 2 });
}

// =================================================================================
// PART 28 — after a deploy: recognise "old version" load errors (UX-02, 2026-10-06)
// =================================================================================

const sb = await loadModule('src/lib/staleBundle.js', 'stalebundle');

section('stale-version errors (reload once) vs. real bugs (show the message)');
{
  check('Chrome', sb.isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/Leads-abc.js')), true);
  check('Safari', sb.isChunkLoadError(new TypeError('Importing a module script failed.')), true);
  check('Firefox', sb.isChunkLoadError(new TypeError('error loading dynamically imported module')), true);
  check('a real bug is not a stale version', sb.isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'map')")), false);
  check('nothing', sb.isChunkLoadError(null), false);
}

// =================================================================================
// PART 29 — a staff broadcast with no real text is never sent (R1ב, 2026-10-06)
// =================================================================================

const g29 = await loadModule('supabase/functions/_shared/automationGuards.ts', 'guards29');

section('placeholder / empty staff message → nothing is sent');
{
  check('the saved placeholder', g29.isPlaceholderTemplate('כתבו כאן הודעה חופשית שתישלח לצוות שתבחרו (למשל לכל צלמי הווידאו).'), true);
  check('empty', g29.isPlaceholderTemplate('   '), true);
  check('null', g29.isPlaceholderTemplate(null), true);
  check('a real message', g29.isPlaceholderTemplate('היי {staff_name}, מחר יש ישיבת צוות ב-10'), false);
}

// =================================================================================
// PART 30 — the "after signing" wizard (src/lib/postSignFlow.js, 2026-10-07)
// =================================================================================

const ps = await loadModule('src/lib/postSignFlow.js', 'postsign');

section('when the wizard pops up');
{
  const now = new Date('2026-10-07T10:00:00Z');
  const base = { id: 'L1', status: 'חוזה', eventDate: '2027-01-14' };
  check('signed, never started → pops up', ps.isPostSignPending(base, now), true);
  check('already נסגר/חתימה, never started → no', ps.isPostSignPending({ ...base, status: 'נסגר/חתימה' }, now), false);
  check('started, not finished (status already changed) → pops up', ps.isPostSignPending({ ...base, status: 'נסגר/חתימה', postSignFlow: { step: 'invoice', done: { status: 'done' } } }, now), true);
  check('finished → no', ps.isPostSignPending({ ...base, postSignFlow: { completedAt: '2026-10-01T00:00:00Z' } }, now), false);
  check('wedding already passed → no', ps.isPostSignPending({ ...base, eventDate: '2026-10-01' }, now), false);
  check('wedding today → still yes', ps.isPostSignPending({ ...base, eventDate: '2026-10-07' }, now), true);
  check('snoozed to later → no', ps.isPostSignPending({ ...base, postSignSnoozedUntil: '2026-10-10T05:00:00Z' }, now), false);
  check('snooze already passed → yes', ps.isPostSignPending({ ...base, postSignSnoozedUntil: '2026-10-07T05:00:00Z' }, now), true);
  check('לא רלוונטי → no', ps.isPostSignPending({ ...base, status: 'לא רלוונטי', postSignFlow: { step: 'schedule' } }, now), false);
}

section('"דחה" → 08:00 Israel time on the chosen day');
{
  const now = new Date('2026-10-07T21:30:00Z'); // 00:30 on 8.10 in Israel (UTC+3)
  check('tomorrow = 9.10 (Israel date is already 8.10) 08:00 IDT', ps.snoozeUntil('tomorrow', now).toISOString(), '2026-10-09T05:00:00.000Z');
  check('3 days', ps.snoozeUntil('3days', now).toISOString(), '2026-10-11T05:00:00.000Z');
  check('a week, across the clock change (25.10) → 08:00 IST', ps.snoozeUntil('week', new Date('2026-10-20T09:00:00Z')).toISOString(), '2026-10-27T06:00:00.000Z');
  check('picked date', ps.snoozeUntil('date', now, '2026-11-10').toISOString(), '2026-11-10T06:00:00.000Z');
  check('picked date missing → null', ps.snoozeUntil('date', now, null), null);
  check('"until next login" has no date', ps.snoozeUntil('session', now), null);
}

section('steps: skip, continue where you left, finish');
{
  check('new → first step', ps.currentStep(null), 'status');
  const f1 = ps.advance(null, 'status', 'done', new Date('2026-10-07T10:00:00Z'));
  check('after status → invoice', ps.currentStep(f1), 'invoice');
  check('startedAt set', f1.startedAt, '2026-10-07T10:00:00.000Z');
  const f2 = ps.advance(f1, 'invoice', 'skipped');
  check('skip invoice → schedule', ps.currentStep(f2), 'schedule');
  check('skip is remembered', f2.done.invoice, 'skipped');
  check('done kept', f2.done.status, 'done');
  const f3 = ps.finish(f2, new Date('2026-10-08T10:00:00Z'));
  check('finish sets completedAt', f3.completedAt, '2026-10-08T10:00:00.000Z');
  check('finished flow no longer pending', ps.isPostSignPending({ status: 'נסגר/חתימה', eventDate: '2027-01-01', postSignFlow: f3 }, new Date('2026-10-08T11:00:00Z')), false);
}

section('date shown in the header');
{
  check('Friday', ps.formatEventDateHe('2026-08-14'), 'יום שישי, 14.8.2026');
  check('empty', ps.formatEventDateHe(null), '');
}

// =================================================================================
// PART 31 — one chat screen: the old inbox's boxes, the date on every row (2026-10-07)
// =================================================================================

const cm31 = await loadModule('src/lib/chatModel.js', 'chatmodel31');

section('boxes from the old inbox');
{
  const list = [
    { id: 'u', contactType: 'unknown' },
    { id: 'l', contactType: 'lead', leadTemperature: 'hot', leadTemperatureReason: 'רוצים להיפגש' },
    { id: 'p', contactType: 'lead', state: 'PRICELIST_SENT', followupSentAt: '2026-10-01T00:00:00Z' },
    { id: 'c', contactType: 'client' },
    { id: 'g', contactType: 'group', leadTemperature: 'hot' },
    { id: 's', contactType: 'staff', followupSentAt: 'x' },
    { id: 'a', contactType: 'unknown', archivedAt: '2026-10-01T00:00:00Z' },
  ];
  const n = (box) => list.filter((c) => cm31.matchesBox(c, box, {})).map((c) => c.id).join(',');
  check('opens on "לידים" (owner, 2026-10-07)', cm31.DEFAULT_BOX, 'lead');
  check('לא מוכר: strangers only, not archived', n('unknown'), 'u');
  check('לידים: leads only (strangers have their own box now)', n('lead'), 'l,p');
  check('הכל: leads + strangers, no clients/groups/staff', n('all'), 'u,l,p');
  check('ליד חם: never a group', n('hot'), 'l');
  check('נשלח פולו-אפ: never staff', n('followup_sent'), 'p');
  check('נשלח מחירון', n('pricelist_sent'), 'p');
  check('the primary tabs (owner, 2026-10-07)', cm31.BOXES.filter((b) => b.primary).map((b) => b.key).join(','), 'unknown,lead,followup,hot,unread,all');
}

section('strangers the bot recognised count as leads (display only)');
{
  const n = (c, box) => cm31.matchesBox(c, box, {});
  const asked = { contactType: 'unknown', state: 'PRICELIST_SENT', botWouldReplyAt: 't' };
  const friend = { contactType: 'unknown', state: 'NEW' };
  check('price list sent → לידים', n(asked, 'lead'), true);
  check('…and not לא מוכר', n(asked, 'unknown'), false);
  check('a friend saying hi → לא מוכר', n(friend, 'unknown'), true);
  check('…not לידים', n(friend, 'lead'), false);
  check('mid-details counts too', cm31.isBotLead({ contactType: 'unknown', state: 'AWAITING_DETAILS' }), true);
  check('bot saw an inquiry but the first message is still NEW', cm31.isBotLead({ contactType: 'unknown', state: 'NEW', botWouldReplyAt: 't' }), true);
  check('a real lead is just a lead', cm31.displayType({ contactType: 'lead', state: 'PRICELIST_SENT' }), 'lead');
  check('shown as "ליד (מהבוט)"', cm31.contactTypeLabel(cm31.displayType(asked)), 'ליד (מהבוט)');
}

section('round 3 (2026-10-07): names, file names, follow-up out, pacing');
{
  check('WhatsApp name + the names they gave', cm31.chatTitle({ displayName: 'Adi', coupleNames: 'עדי ואור' }), 'Adi (עדי ואור)');
  check('long names → first names', cm31.shortCoupleNames('דניאל דיין וסבינה גויכמן'), 'דניאל וסבינה');
  check('a name starting with ו is not split', cm31.shortCoupleNames('דני ויקטוריה'), 'דני ויקטוריה');
  check('same name once', cm31.chatTitle({ displayName: 'עדי ואור', coupleNames: 'עדי ואור' }), 'עדי ואור');
  check('no WhatsApp name → the names', cm31.chatTitle({ coupleNames: 'עדי ואור', phone: '050' }), 'עדי ואור');
  check('nothing → phone', cm31.chatTitle({ phone: '0501234567' }), '0501234567');
  const today = new Date('2026-10-07T10:00:00');
  check('a voice-note file name is not a date', cm31.findDatesInText('fd2c06b1-6e5e-4b24-8e77-8f20b1bd5003.oga', today).length, 0);
  check('Hebrew prefix still a date', cm31.findDatesInText('ב30/6', today)[0], '2027-06-30');
  check('row uses the message search once loaded', cm31.rowEventDate({ lastMessagePreview: '1-6' }, null, today, '2027-06-30'), '2027-06-30');
  check('…and null means none, not the preview', cm31.rowEventDate({ lastMessagePreview: '14.8.27' }, null, today, null), null);
  check('file-name preview ignored while loading', cm31.rowEventDate({ lastMessagePreview: 'x-1-6.oga' }, null, today), null);
}
{
  const fq = await loadModule('src/lib/followUpQueue.js', 'fq31');
  const bot = { state: 'PRICELIST_SENT', lastBotMessageAt: '2026-10-01T00:00:00Z' };
  check('bot path in the queue', fq.isAwaitingFollowUp(bot, 0), true);
  check('"הסר מפולו-אפ" takes the bot path out', fq.isAwaitingFollowUp({ ...bot, followupDismissedAt: '2026-10-05T00:00:00Z' }, 0), false);
  check('flagging again after removal brings it back', fq.isAwaitingFollowUp({ ...bot, followupDismissedAt: '2026-10-05T00:00:00Z', followupFlaggedAt: '2026-10-06T00:00:00Z' }, 0), true);
  check('a flag older than the removal stays out', fq.isAwaitingFollowUp({ followupFlaggedAt: '2026-10-04T00:00:00Z', followupDismissedAt: '2026-10-05T00:00:00Z' }, 0), false);
  check('after sending: out of the queue', fq.isAwaitingFollowUp({ ...bot, followupSentAt: '2026-10-06T00:00:00Z' }, 0), false);
  check('re-flag after sending: back in (a reminder)', fq.isAwaitingFollowUp({ ...bot, followupSentAt: '2026-10-06T00:00:00Z', followupFlaggedAt: '2026-10-07T00:00:00Z' }, 0), true);
  check('pace: 10 → 2–4s', fq.followUpPaceRange(10).join('-'), '2000-4000');
  check('pace: 20 → 4–7s', fq.followUpPaceRange(20).join('-'), '4000-7000');
  check('pace: 40 → 8–12s', fq.followUpPaceRange(40).join('-'), '8000-12000');
  check('pace: 50 → 15–25s', fq.followUpPaceRange(50).join('-'), '15000-25000');
  check('50 messages ≈ 17 min', Math.round(fq.followUpEstimateSeconds(50) / 60), 17);
}

section('the date on a row, and whether it is free');
{
  const today = new Date('2026-10-07T10:00:00');
  check('the linked lead wins', cm31.rowEventDate({ eventDate: '2026-12-01' }, { eventDate: '2027-01-05' }, today), '2027-01-05');
  check('then what the bot collected', cm31.rowEventDate({ eventDate: '2026-12-01T00:00:00' }, null, today), '2026-12-01');
  check('then a date in the last message', cm31.rowEventDate({ lastMessagePreview: 'מתחתנים ב 14.8.27 באולם' }, null, today), '2027-08-14');
  check('nothing → null', cm31.rowEventDate({ lastMessagePreview: 'כמה עולה?' }, null, today), null);
  check('weekday', cm31.formatDateWithWeekday('2026-08-14'), 'יום שישי, 14.8.2026');
  const map = { '2026-08-14': { eventLeadIds: ['L1', null], closingLeadIds: ['L2', 'L1'] } };
  check('busy: other events count', JSON.stringify(cm31.dateStatus(map, '2026-08-14')), '{"events":2,"closing":2}');
  check("the couple's own event is not 'taken'", JSON.stringify(cm31.dateStatus(map, '2026-08-14', 'L1')), '{"events":1,"closing":1}');
  check('free date', JSON.stringify(cm31.dateStatus(map, '2026-09-01')), '{"events":0,"closing":0}');
  check('undo of "לפולו-אפ"', JSON.stringify(cm31.reverseOf({ action: 'followup_flag', conversationId: 'X', before: {}, after: { followupFlaggedAt: 't' } })), '{"kind":"conversation","id":"X","values":{"followupFlaggedAt":null,"followupDismissedAt":null}}');
}

// =================================================================================
// PART 32 — sales meetings: Israel times, groups, who gets a reminder (2026-10-07)
// =================================================================================

const mt = await loadModule('src/lib/meetings.js', 'meetings32');
const mr = await loadModule('supabase/functions/_shared/meetingReminders.ts', 'meetrem32');
const pp32 = await loadModule('supabase/functions/_shared/pushPrefs.ts', 'pushprefs32');

section('meeting times are Israel wall-clock');
{
  check('summer (UTC+3): 12:00 → 09:00Z', mt.israelLocalToUtc('2026-10-08', '12:00').toISOString(), '2026-10-08T09:00:00.000Z');
  check('winter (UTC+2): 12:00 → 10:00Z', mt.israelLocalToUtc('2026-11-08', '12:00').toISOString(), '2026-11-08T10:00:00.000Z');
  check('back to the form', JSON.stringify(mt.utcToIsraelParts('2026-10-08T09:00:00.000Z')), '{"date":"2026-10-08","time":"12:00"}');
  check('bad input → null', mt.israelLocalToUtc('', '12:00'), null);
  check('when, in words', mt.formatMeetingWhen('2026-10-09T09:00:00.000Z'), 'יום שישי, 9.10 בשעה 12:00');
}

section('meeting groups');
{
  const now = new Date('2026-10-07T07:00:00Z'); // 10:00 Israel
  const m = (id, startsAt, extra = {}) => ({ id, startsAt, status: 'scheduled', durationMin: 30, ...extra });
  const g = mt.groupMeetings([
    m('today', '2026-10-07T13:00:00Z'),
    m('tomorrow', '2026-10-08T09:00:00Z'),
    m('week', '2026-10-11T09:00:00Z'),
    m('later', '2026-10-20T09:00:00Z'),
    m('done', '2026-10-06T09:00:00Z', { status: 'done' }),
    m('over', '2026-10-07T05:00:00Z'),
    m('cancelled', '2026-10-09T09:00:00Z', { status: 'cancelled' }),
  ], now);
  check('today', g.today.map((x) => x.id).join(), 'today');
  check('tomorrow', g.tomorrow.map((x) => x.id).join(), 'tomorrow');
  check('this week', g.week.map((x) => x.id).join(), 'week');
  check('later', g.later.map((x) => x.id).join(), 'later');
  check('past: done, ended, cancelled (newest first)', g.past.map((x) => x.id).join(), 'cancelled,over,done');
  check('starts in 25 min', mt.startsInLabel('2026-10-07T07:25:00Z', now.getTime()), 'בעוד 25 דק׳');
  check('the banner picks the next one within the hour', mt.nextSoon([m('a', '2026-10-07T07:40:00Z'), m('b', '2026-10-07T07:20:00Z')], 60, now.getTime())?.id, 'b');
  check('nothing soon → no banner', mt.nextSoon([m('a', '2026-10-07T12:00:00Z')], 60, now.getTime()), null);
}

section('who gets a reminder');
{
  const now = Date.parse('2026-10-07T09:00:00Z');
  const base = { id: 'M', title: 'עדי ואור', kind: 'call', status: 'scheduled', phone: '050' };
  const at = (min) => new Date(now + min * 60000).toISOString();
  check('11 min ahead → not yet', mr.isFirstDue({ ...base, starts_at: at(11) }, now), false);
  check('10 min ahead → first', mr.isFirstDue({ ...base, starts_at: at(10) }, now), true);
  check('booked 3 min ahead → first at once', mr.isFirstDue({ ...base, starts_at: at(3) }, now), true);
  check('already sent → no', mr.isFirstDue({ ...base, starts_at: at(8), reminder_sent_at: at(-2) }, now), false);
  check('cancelled → no', mr.isFirstDue({ ...base, starts_at: at(5), status: 'cancelled' }, now), false);
  check('started 40 min ago → no (stale)', mr.isFirstDue({ ...base, starts_at: at(-40) }, now), false);
  check('second: 5 min after the first, not seen', mr.isSecondDue({ ...base, starts_at: at(5), reminder_sent_at: at(-5) }, now), true);
  check('second: only 4 min after → not yet', mr.isSecondDue({ ...base, starts_at: at(6), reminder_sent_at: at(-4) }, now), false);
  check('second: seen → no', mr.isSecondDue({ ...base, starts_at: at(5), reminder_sent_at: at(-5), acknowledged_at: at(-1) }, now), false);
  check('second: once only', mr.isSecondDue({ ...base, starts_at: at(5), reminder_sent_at: at(-5), second_reminder_sent_at: at(0) }, now), false);
  check('first text', mr.reminderText({ ...base, starts_at: at(10) }, 'first', now).title, '⏰ בעוד 10 דק׳: שיחה עם עדי ואור');
  check('second text at start', mr.reminderText({ ...base, kind: 'zoom', starts_at: at(0), zoom_url: 'https://zoom.us/j/1' }, 'second', now).body, '050 · https://zoom.us/j/1 · עוד לא אישרת שראית');
  check('a meeting reminder ignores night + mute', pp32.shouldNotify({ muteUntil: '2099-01-01T00:00:00Z' }, 'meeting', '23:30'), true);
  check('…other categories still respect them', pp32.shouldNotify({ muteUntil: '2099-01-01T00:00:00Z' }, 'lead', '12:00'), false);
}

// =================================================================================
// PART 33 — dashboard v2: one "missing team" rule, notes, date search, old debts,
//           the booking message (2026-10-07)
// =================================================================================

const mtm = await loadModule('src/lib/missingTeam.js', 'missingteam33');
const sd = await loadModule('src/lib/searchDate.js', 'searchdate33');
const spa = await loadModule('src/lib/staffPaymentAllocation.js', 'spa33');
const sb33 = await loadModule('src/lib/staffBooking.js', 'booking33');
const ep = await loadModule('src/lib/eventProgress.js', 'progress33');

section('missing team — one rule everywhere');
{
  const today = '2026-10-07';
  const t = (...roles) => roles.map(([role, name]) => ({ role, staffMemberName: name }));
  check('3 shooters + editor, needs 3 → full', mtm.isMissingTeam({ date: '2026-11-01', requiredCrew: 3, team: t(['photographer1', 'א'], ['photographer2', 'ב'], ['videographer', 'ג'], ['editor', 'ד']) }, today), false);
  check('2 shooters + editor, needs 3 → missing (the editor is not crew)', mtm.isMissingTeam({ date: '2026-11-01', requiredCrew: 3, team: t(['photographer1', 'א'], ['videographer', 'ג'], ['editor', 'ד']) }, today), true);
  check('"אין וידאו" fills its slot', mtm.isMissingTeam({ date: '2026-11-01', requiredCrew: 3, team: t(['photographer1', 'א'], ['photographer2', 'ב'], ['videographer', 'אין וידאו']) }, today), false);
  check("today's event still counts (no UTC drop)", mtm.isMissingTeam({ date: '2026-10-07', requiredCrew: 2, team: [] }, today), true);
  check('a past event never counts', mtm.isMissingTeam({ date: '2026-10-06', requiredCrew: 2, team: [] }, today), false);
  check('next year counts too (the sidebar used to stop at Dec 31)', mtm.isMissingTeam({ date: '2027-05-01', team: [] }, today), true);
  check('empty name rows are not crew', mtm.assignedShooters({ team: [{ role: 'photographer1', staffMemberName: '' }] }), 0);
  const yp = mtm.yearProgress([{ date: '2026-01-01' }, { date: '2026-12-01' }, { date: '2025-05-01' }], new Date('2026-10-07T10:00:00Z'));
  check('events this year: held / all', `${yp.done}/${yp.total}`, '1/2');
  check('notes: event + lead', mtm.combinedNotes('ביקשו את דניאל', 'להגיע 17:00'), 'ביקשו את דניאל\nלהגיע 17:00');
  check('notes: only on the lead', mtm.combinedNotes('', 'ביקשו את דודו'), 'ביקשו את דודו');
  check('notes: same text once', mtm.combinedNotes('אותו דבר', 'אותו דבר'), 'אותו דבר');
}

section('which role is missing');
{
  const t = (...roles) => roles.map(([role, name]) => ({ role, staffMemberName: name }));
  check('package 2 photo + 1 video, video missing', mtm.missingRoles({ requiredCrew: 3, team: t(['photographer1', 'א'], ['photographer2', 'ב']) }, { photographers: 2, videographers: 1 }).join(' + '), 'וידאו');
  check('video + second photographer missing', mtm.missingRoles({ requiredCrew: 3, team: t(['photographer1', 'א']) }, null).join(' + '), 'צלם + וידאו');
  check('package with 2 videographers', mtm.missingRoles({ requiredCrew: 4, team: t(['photographer1', 'א'], ['photographer2', 'ב']) }, { photographers: 2, videographers: 2 }).join(' + '), '2 וידאו');
  check('"אין וידאו" counts as filled', mtm.missingRoles({ requiredCrew: 3, team: t(['photographer1', 'א'], ['videographer', 'אין וידאו']) }, null).join(' + '), 'צלם');
  check('no package, crew of 2 → 1 photo + 1 video', JSON.stringify(mtm.expectedSplit({ requiredCrew: 2 }, null)), '{"photo":1,"video":1}');
}

section('search by date');
{
  const now = new Date('2026-10-07T10:00:00');
  check('16/9/26', JSON.stringify(sd.searchDates('16/9/26', now)), '["2026-09-16"]');
  check('16.9.2026', JSON.stringify(sd.searchDates('16.9.2026', now)), '["2026-09-16"]');
  check('16/9 → that day in nearby years', sd.searchDates('16/9', now).join(), '2024-09-16,2025-09-16,2026-09-16,2027-09-16,2028-09-16');
  check('a name is not a date', sd.searchDates('עדי ואור', now), null);
  check('a phone is not a date', sd.searchDates('0501234567', now), null);
  check('lead on that date matches', sd.dateMatches('2026-09-16', '16/9/26', now), true);
  check('…another date does not', sd.dateMatches('2026-09-17', '16/9/26', now), false);
}

section('payments: debts left in earlier months');
{
  const events = [
    { date: '2026-09-10', team: [{ staffMemberName: 'דודו', cost: 1000, isPaid: false }, { staffMemberName: 'רון', cost: 800, isPaid: true }] },
    { date: '2026-08-02', team: [{ staffMemberName: 'דודו', cost: 900, isPaid: false }] },
    { date: '2026-10-03', team: [{ staffMemberName: 'דודו', cost: 700, isPaid: false }] },
    { date: '2026-10-20', team: [{ staffMemberName: 'דודו', cost: 700, isPaid: false }] },
  ];
  const payments = [{ staffMemberName: 'דודו', amount: 400, appliedAmount: 0, periodFrom: '2026-08-01', periodTo: '2026-08-31' }];
  const d = spa.earlierMonthDebts(events, payments, '2026-10-07');
  check('September and August, newest first; this month left out', d.map((x) => `${x.key}:${x.remaining}`).join(' '), '2026-09:1000 2026-08:500');
  check('month index 0-based for the page', d[0].month, 8);
}

section('booking message to the crew');
{
  const v = sb33.bookingVars({ staffName: 'איילון כהן', roleLabel: 'צלם 1', event: { date: '2026-10-08', coupleNames: 'נלי ותמיר', venue: 'גבעה' }, lead: { productionBridePrepLocation: 'סטודיו מאיה' } });
  const msg = sb33.renderBookingMessage('', v);
  check('first name + role + couple', msg.split('\n').slice(0, 2).join(' | '), 'היי איילון 👋 | שובצת כצלם 1 באירוע של נלי ותמיר');
  check('date with the weekday', msg.includes('📅 יום חמישי, 8.10.2026'), true);
  check('empty times are dropped, not left blank', msg.includes('חופה'), false);
  check('getting-ready place kept', msg.includes('💄 התארגנות: סטודיו מאיה'), true);
  check('a saved template wins', sb33.renderBookingMessage('שלום {{name}} — {{role}}', v), 'שלום איילון — צלם 1');
}

section('work progress (shared)');
{
  check('raw + final + crew flags', ep.progressPct({ team: [{ role: 'photographer1' }], photographer1Done: true, rawLink: 'x', finalDoneManual: false }), 67);
  check('nothing → 0', ep.progressPct({}), 0);
}

await rm(outDir, { recursive: true, force: true });
// ---------------------------------------------------------------------------------
// PART 34 — "ליד חם" drops couples who already closed (2026-10-07)
// ---------------------------------------------------------------------------------
console.log('\n— PART 34: hot lead vs closed deal —');
{
  const hotConv = { leadTemperature: 'hot', contactType: 'lead' };
  check('hot, no lead → hot', cm31.isHotLead(hotConv, null), true);
  check('hot, open lead → hot', cm31.isHotLead(hotConv, { status: 'נשלחה הצעה' }), true);
  check('hot, lead נסגר/חתימה → not hot', cm31.isHotLead(hotConv, { status: 'נסגר/חתימה' }), false);
  check('hot, lead חוזה → not hot', cm31.isHotLead(hotConv, { status: 'חוזה' }), false);
  check('hot, lead signed → not hot', cm31.isHotLead(hotConv, { status: 'נשלחה הצעה', signed: true }), false);
  check('hot client → not hot', cm31.isHotLead({ leadTemperature: 'hot', contactType: 'client' }, null), false);
  check('hot group → not hot', cm31.isHotLead({ leadTemperature: 'hot', contactType: 'group' }, null), false);
  check('warm → not hot', cm31.isHotLead({ leadTemperature: 'warm', contactType: 'lead' }, null), false);
  check('box hot uses ctx.leadsById', cm31.matchesBox({ leadTemperature: 'hot', contactType: 'lead', matchedLeadId: 'L1' }, 'hot', { leadsById: { L1: { status: 'חוזה' } } }), false);
}

// PART 35 — follow-up outcome boxes (2026-10-07)
console.log('\n— PART 35: follow-up sent / replied —');
{
  const sent = { contactType: 'lead', followupSentAt: '2026-10-07T10:00:00Z', lastInboundAt: '2026-10-06T10:00:00Z' };
  const replied = { contactType: 'lead', followupSentAt: '2026-10-07T10:00:00Z', lastInboundAt: '2026-10-07T12:00:00Z' };
  check('none → null', cm31.followUpOutcome({ contactType: 'lead' }), null);
  check('no answer since → sent', cm31.followUpOutcome(sent), 'sent');
  check('wrote after → replied', cm31.followUpOutcome(replied), 'replied');
  check('box לא ענו', cm31.matchesBox(sent, 'followup_noreply', {}), true);
  check('box ענו', cm31.matchesBox(replied, 'followup_replied', {}), true);
  check('replied not in לא ענו', cm31.matchesBox(replied, 'followup_noreply', {}), false);
  check('group never', cm31.matchesBox({ ...sent, contactType: 'group' }, 'followup_noreply', {}), false);
}

// PART 36 — "תשובות זמינות" grouping (2026-10-07)
console.log('\n— PART 36: availability answers inbox —');
{
  const ai = await loadModule('src/lib/availabilityInbox.js', 'availinbox');
  const ev = { id: 'E1', sourceLeadId: 'L1', date: '2026-10-08', coupleNames: 'יקור ושני', team: [{ role: 'photographer1', staffMemberName: "ג׳וני" }] };
  const req = (o) => ({ eventId: 'E1', leadId: 'L1', role: 'photographer', eventDateSnapshot: '2026-10-08', requestedAt: '2026-10-07T10:00:00Z', ...o });
  const out = ai.buildAvailabilityInbox({ today: '2026-10-07', events: [ev], requests: [
    req({ id: 'a', staffMemberId: 's1', staffNameSnapshot: "ג׳וני", status: 'available', teamRole: 'photographer1' }),
    req({ id: 'b', staffMemberId: 's2', staffNameSnapshot: 'סלבה', status: 'available', teamRole: 'photographer2' }),
    req({ id: 'c', staffMemberId: 's3', staffNameSnapshot: 'רודי', status: 'pending' }),
    req({ id: 'd', staffMemberId: 's4', staffNameSnapshot: 'אביהו', status: 'declined' }),
    req({ id: 'old', staffMemberId: 's2', staffNameSnapshot: 'סלבה', status: 'declined', requestedAt: '2026-10-01T10:00:00Z' }),
    req({ id: 'past', staffMemberId: 's5', staffNameSnapshot: 'עבר', status: 'available', eventDateSnapshot: '2026-10-01' }),
  ] });
  const g = out.groups[0];
  const st = Object.fromEntries(g.rows.map((r) => [r.request.id, r.state]));
  check('one group, past dropped', out.groups.length, 1);
  check('on team → assigned', st.a, 'assigned');
  check('free slot → decide', st.b, 'decide');
  check('asked slot preselected', g.rows.find((r) => r.request.id === 'b').defaultSlot, 'photographer2');
  check('latest answer per person wins', st.old, undefined);
  check('pending / declined', [st.c, st.d].join(','), 'pending,declined');
  check('toDecide counts 1', out.toDecide, 1);
  const full = ai.buildAvailabilityInbox({ today: '2026-10-07', events: [{ ...ev, team: [{ role: 'photographer1', staffMemberName: 'x' }, { role: 'photographer2', staffMemberName: 'y' }] }], requests: [req({ id: 'e', staffMemberId: 's6', staffNameSnapshot: 'עידן', status: 'available' })] });
  check('slots taken → full', full.groups[0].rows[0].state, 'full');
  const dis = ai.buildAvailabilityInbox({ today: '2026-10-07', events: [ev], requests: [req({ id: 'f', staffMemberId: 's7', staffNameSnapshot: 'ז', status: 'available', decisionDismissedAt: '2026-10-07T11:00:00Z' })] });
  check('לא צריך → dismissed, not counted', [dis.groups[0].rows[0].state, dis.toDecide].join(','), 'dismissed,0');
  const noEv = ai.buildAvailabilityInbox({ today: '2026-10-07', events: [], requests: [req({ id: 'g', eventId: null, leadId: 'L9', staffMemberId: 's8', staffNameSnapshot: 'ח', status: 'available' })] });
  check('no event yet → no_event', noEv.groups[0].rows[0].state, 'no_event');
  // "סגור" on an event (2026-10-09): unanswered rows stop waiting; revoked (resent) rows are ignored
  const cl = ai.buildAvailabilityInbox({ today: '2026-10-07', events: [ev], requests: [
    req({ id: 'p1', staffMemberId: 's3', staffNameSnapshot: 'רודי', status: 'pending', decisionDismissedAt: '2026-10-07T12:00:00Z' }),
    req({ id: 'p2', staffMemberId: 's9', staffNameSnapshot: 'ט', status: 'pending' }),
  ] });
  check('closed → not waiting', [cl.groups[0].rows.find((r) => r.request.id === 'p1').state, cl.groups[0].waiting, cl.groups[0].closed].join(','), 'closed,1,1');
  const rs = ai.buildAvailabilityInbox({ today: '2026-10-07', events: [ev], requests: [
    req({ id: 'oldlink', staffMemberId: 's3', staffNameSnapshot: 'רודי', status: 'pending', revokedAt: '2026-10-07T13:00:00Z' }),
    req({ id: 'newlink', staffMemberId: 's3', staffNameSnapshot: 'רודי', status: 'pending', requestedAt: '2026-10-07T13:00:00Z' }),
  ] });
  check('resend: only the new link counts', rs.groups[0].rows.map((r) => r.request.id).join(), 'newlink');
}

// PART 37 — follow-up pulses and the date line (2026-10-07)
console.log('\n— PART 37: follow-up pulses —');
{
  const fq = await loadModule('src/lib/followUpQueue.js', 'fq37');
  check('wave: none sent → 30', fq.followUpWaveLimit(0), 30);
  check('wave: 27 sent → 13 (cap 40)', fq.followUpWaveLimit(27), 13);
  check('wave: 40 sent → 0', fq.followUpWaveLimit(40), 0);
  const tpl = 'היי {{names}}\nהתאריך {{event_date}} עדיין פנוי\nבאולם {{venue}}\nזמינים!';
  check('date filled', fq.renderFollowUpMessage(tpl, { names: 'סוניה ועוז', eventDate: '28/5/2027', venue: 'גן' }), 'היי סוניה ועוז\nהתאריך 28/5/2027 עדיין פנוי\nבאולם גן\nזמינים!');
  check('no date → line dropped', fq.renderFollowUpMessage(tpl, { names: 'גל', venue: 'גן' }), 'היי גל\nבאולם גן\nזמינים!');
  check('no venue → line dropped', fq.renderFollowUpMessage(tpl, { names: 'גל', eventDate: '1/1/2027' }), 'היי גל\nהתאריך 1/1/2027 עדיין פנוי\nזמינים!');
  check('sent today counts Israel day', fq.followUpsSentToday([{ followupSentAt: '2026-10-07T20:30:00Z' }, { followupSentAt: '2026-10-07T22:30:00Z' }], '2026-10-07'), 1);
}

// PART 38 — notification tabs (2026-10-07)
console.log('\n— PART 38: notification tabs —');
{
  const nc = await loadModule('src/lib/notificationCategories.js', 'nc38');
  check('hot lead → whatsapp', nc.notificationTab('whatsapp_hot_lead'), 'whatsapp');
  check('opt-out → whatsapp', nc.notificationTab('whatsapp_opt_out'), 'whatsapp');
  check('availability → staff', nc.notificationTab('staff_availability_response'), 'staff');
  check('signed → contracts', nc.notificationTab('contract_signed'), 'contracts');
  check('album → albums', nc.notificationTab('album_round_approved'), 'albums');
  check('backup failed → system', nc.notificationTab('monthly_backup_failed'), 'system');
  check('meeting → system', nc.notificationTab('meeting_reminder'), 'system');
  check('emoji hot', nc.notificationEmoji('whatsapp_hot_lead'), '🔥');
  check('emoji failure', nc.notificationEmoji('monthly_backup_failed'), '⚠️');
  const now = new Date('2026-10-07T20:00:00Z');
  check('today', nc.notificationDayGroup('2026-10-07T10:00:00Z', now), 'today');
  check('yesterday', nc.notificationDayGroup('2026-10-06T10:00:00Z', now), 'yesterday');
  check('earlier', nc.notificationDayGroup('2026-10-01T10:00:00Z', now), 'earlier');
}

// PART 39 — album design editor, stage 1 (2026-10-08)
console.log('\n— PART 39: album editor —');
{
  const at = await loadModule('src/lib/albumTemplates.js', 'at39');
  const ad = await loadModule('src/lib/albumDesign.js', 'ad39');
  const badArea = at.PHOTO_TEMPLATES.filter((t) => Math.abs(t.cells.reduce((a, c) => a + c[2] * c[3], 0) / 100 - 100) > 1.5);
  check('every template covers the spread', badArea.length, 0);
  check('templates for 1..20 photos', at.PHOTO_COUNTS.join(','), Array.from({ length: 20 }, (_, i) => i + 1).join(','));
  const badGen = at.GENERATED_TEMPLATES.filter((t) => Math.abs(t.cells.reduce((a, c) => a + c[2] * c[3], 0) / 100 - 100) > 1);
  check('generated layouts cover the spread', badGen.length, 0);
  check('every count 2..20 has a mixed or landscape option', [...Array(19)].every((_, i) => at.templatesForCount(i + 2).length >= 2), true);
  check('his layouts listed first', at.templatesForCount(4)[0].id, 'p4-a');
  check('4 portrait columns are portrait', at.templateKind(at.getTemplate('p4-a')), 'portrait');
  const r = at.cellRects(at.getTemplate('p2-a'));
  check('outer edge full bleed', r[0].x, 0);
  check('gutter between cells = 38px', Math.round((r[1].x - (r[0].x + r[0].w)) / 100 * 9449), 38);
  const fl = at.cellRects(at.getTemplate('p2-b'), true);
  check('flip mirrors the big cell to the right', fl[0].x > 20, true);
  check('hebrew date', ad.hebrewDateText('2025-03-16'), 'ט״ז באדר, תשפ״ה');
  check('hebrew 15', ad.hebrewNumeral(15), 'ט״ו');
  check('dot date', ad.formatDotDate('2025-03-16'), '16.03.2025');
  check('camera prefix', ad.cameraOf('AVIRA-S-801.jpg') + '|' + ad.cameraOf('AVIRA-3.jpg'), 'AVIRA-S|AVIRA');
  const a = [
    { name: 'AVIRA-S-2.jpg', camera: 'AVIRA-S', time: '2026:07:05 14:00:00' },
    { name: 'AVIRA-10.jpg', camera: 'AVIRA', time: '2026:07:05 15:00:00' },
    { name: 'AVIRA-2.jpg', camera: 'AVIRA', time: '2026:07:05 13:00:00' },
    { name: 'no-time.jpg', camera: 'no-time', time: null },
  ];
  check('sort by shooting time, two cameras interleave', ad.sortAssets(a).map((x) => x.name).join(' '), 'AVIRA-2.jpg AVIRA-S-2.jpg AVIRA-10.jpg no-time.jpg');
  check('camera offset +2h moves its photos', ad.sortAssets(a, { 'AVIRA-S': 120 }).map((x) => x.name).join(' '), 'AVIRA-2.jpg AVIRA-10.jpg AVIRA-S-2.jpg no-time.jpg');
  const c = ad.computeCrop(200, 300, 6000, 4000, {});
  check('cover fills the cell height', Math.round(c.drawH), 300);
  check('centred', Math.round(c.offX), Math.round((200 - c.drawW) / 2));
  const edge = ad.computeCrop(200, 300, 6000, 4000, { cx: 0 });
  check('pan clamped (no white edge)', edge.offX, 0);
  const fit = ad.computeCrop(200, 300, 6000, 4000, { zoom: 0.01 });
  check('zoom out stops at whole photo inside', Math.round(fit.drawW), 200);
  check('zoomed-out photo stays inside the cell', fit.offY >= 0 && fit.offY + fit.drawH <= 300.001, true);
  check('names for title', ad.coupleNamesForTitle('דניאל וסבינה'), 'דניאל & סבינה');
  let pc = ad.setPageCount(ad.emptyDoc({}), 30);
  check('page count up', pc.doc.pages.length, 30);
  pc = ad.setPageCount(pc.doc, 5);
  check('page count down (empty ones)', pc.doc.pages.length + '/' + pc.blocked, '5/0');
  check('dpi of a 20×30cm cell from 6000×4000', ad.effectiveDpi({ w: 6000, h: 4000 }, { w: 25, h: 100 }), 339);
  let d = ad.emptyDoc({ names: 'Talya & Avinoam', date: '2025-03-16' });
  check('new doc = title + one spread', d.pages.map((p) => p.templateId).join(','), 't-a,p4-a');
  check('title prefilled', d.pages[0].title.hebrewDate, 'ט״ז באדר, תשפ״ה');
  const pid = d.pages[1].id;
  d = ad.placeAsset(d, pid, 0, 'A');
  d = ad.placeAsset(d, pid, 2, 'B');
  d = ad.setTemplate(d, pid, 'p2-a');
  check('template switch keeps photos in order', d.pages[1].slots.map((s) => s.assetId).join(','), 'A,B');
  d = ad.placeAsset(d, d.pages[0].id, 0, 'A');
  check('usage counts', JSON.stringify(ad.usageCounts(d)), JSON.stringify({ A: 2, B: 1 }));
  d = ad.swapSlots(d, { pageId: pid, index: 0 }, { pageId: pid, index: 1 });
  check('swap', d.pages[1].slots.map((s) => s.assetId).join(','), 'B,A');
  d = ad.duplicatePage(d, pid);
  d = ad.movePage(d, 2, 0);
  check('duplicate + move', d.pages.length + ':' + d.pages[0].templateId, '3:p2-a');
  check('price 32 spreads × 45', JSON.stringify(ad.priceSummary(32, 45)), JSON.stringify({ pages: 32, included: 30, extra: 2, extraCost: 90 }));
  check('price under 30', ad.priceSummary(24, 45).extraCost, 0);
}

// PART 40 — album auto-sketch (2026-10-08)
console.log('\n— PART 40: album auto-sketch —');
{
  const al = await loadModule('src/lib/albumAutoLayout.js', 'al40');
  const at = await loadModule('src/lib/albumTemplates.js', 'at40');
  const c = al.distributeCounts(148, 29);
  check('every photo placed (148 → 29 spreads)', c.reduce((a, b) => a + b, 0), 148);
  check('29 spreads', c.length, 29);
  check('hero every 5th (index 2) is small', c[2] <= 3 && c[7] <= 3, true);
  check('no spread over 10', Math.max(...c) <= 10, true);
  check('few photos → 1 each', al.distributeCounts(3, 10).join(','), '1,1,1');
  const capped = al.distributeCounts(400, 29);
  check('400 photos capped at 10 a spread', Math.max(...capped), 10);
  const P = { w: 4000, h: 6000 }; const L = { w: 6000, h: 4000 };
  const pick = al.pickTemplate([{ id: 'a', ...L }, { id: 'b', ...P }], null);
  const rects = at.cellRects(at.getTemplate(pick.templateId), pick.flip);
  const landscapeCell = rects.findIndex((r) => at.cellAspect(r) > 1);
  check('landscape photo lands in the landscape cell', landscapeCell >= 0 ? pick.assign[landscapeCell] : 0, 0);
  const four = [P, P, P, P].map((x, i) => ({ id: 'p' + i, ...x }));
  const first = al.pickTemplate(four, null);
  check('4 portraits → his most used 4-up (p4-a)', first.templateId, 'p4-a');
  // He repeats his 4-up when nothing else fits (e.g. spreads _03 and _04) — repeat is penalised, not forbidden.
  check('4 portraits again → still 4-up (nothing else fits)', al.pickTemplate(four, 'p4-a').templateId, 'p4-a');
  const mixed = [L, P, P].map((x, i) => ({ id: 'm' + i, ...x }));
  const m1 = al.pickTemplate(mixed, null);
  const m2 = al.pickTemplate(mixed, m1.templateId);
  check('with alternatives, the next spread varies', m2.templateId !== m1.templateId || m2.flip !== m1.flip, true);
  const assets = Array.from({ length: 150 }, (_, i) => ({ id: 'x' + i, ...(i % 3 ? L : P) }));
  const { pages, unused } = al.autoLayout(assets, { spreads: 30, title: { names: 'A & B' } });
  check('30 spreads', pages.length, 30);
  check('title spread first, names kept', pages[0].templateId + '|' + pages[0].title.names, 't-a|A & B');
  const used = pages.flatMap((p) => p.slots.map((s) => s.assetId)).filter(Boolean);
  check('all 150 used once', new Set(used).size + '/' + used.length + '/' + unused, '150/150/0');
  const firstIds = pages.slice(1, 4).map((p) => p.slots.map((s) => +s.assetId.slice(1)));
  check('order kept across spreads', Math.max(...firstIds[0]) < Math.min(...firstIds[1]) && Math.max(...firstIds[1]) < Math.min(...firstIds[2]), true);
  check('suggested spreads for 150', al.suggestedSpreads(150), 30);
}

// PART 41 — album export helpers (2026-10-08)
console.log('\n— PART 41: album export —');
{
  const ar = await loadModule('src/lib/albumRender.js', 'ar41');
  const at = await loadModule('src/lib/albumTemplates.js', 'at41');
  const jfif = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const out = ar.setJpegDpi(jfif, 300);
  check('dpi unit = inch', out[13], 1);
  check('x density 300', (out[14] << 8) | out[15], 300);
  check('y density 300', (out[16] << 8) | out[17], 300);
  check('non-JFIF untouched', Array.from(ar.setJpegDpi([1, 2, 3, 4])).join(','), '1,2,3,4');
  const rs = at.cellRects(at.getTemplate('p4-a')).map((r) => ar.pixelRect(r, 9449, 3543));
  check('cells end at the right edge', rs[3].x + rs[3].w, 9449);
  check('pixel gutter 38px', rs[1].x - (rs[0].x + rs[0].w), 38);
  check('full height', rs[0].h, 3543);
}

// PART 42 — couple edits: server sanitising + upload quality (2026-10-08)
console.log('\n— PART 42: couple edits —');
{
  const sz = await loadModule('supabase/functions/_shared/albumDesignSanitize.ts', 'sz42');
  const aa = await loadModule('src/lib/albumAssets.js', 'aa42');
  const studio = { assets: [{ id: 'd1' }, { id: 'd2' }], cameraOffsets: { X: 30 }, pages: [{ id: 's', templateId: 'p1-a', slots: [{ assetId: 'd1' }] }] };
  const assets = sz.clientAssets(studio, [{ id: 'up_1', name: 'a.jpg', w: 4000, h: 3000, fileKey: 't/o/client-uploads/a.jpg' }]);
  check('assets = studio + uploads', assets.map((a) => a.id).join(','), 'd1,d2,up_1');
  const evil = {
    assets: [{ id: 'evil', source: 'upload', fileKey: 'other-tenant/x.jpg' }],
    pages: [
      { id: 'a', templateId: 'p2-a', slots: [{ assetId: 'evil', zoom: 99, cx: -3, filter: 'url(javascript:x)' }, { assetId: 'up_1' }] },
      { id: 'a', templateId: '<script>', slots: [] },
      { id: 'c', templateId: 't-a', slots: [], title: { names: 'x'.repeat(500), color: 'red;background:url(x)', font: 'Comic' } },
    ],
  };
  const clean = sz.sanitizeClientDoc(evil, assets, studio);
  check('client assets ignored', clean.assets.map((a) => a.id).join(','), 'd1,d2,up_1');
  check('unknown photo emptied', clean.pages[0].slots[0].assetId, null);
  check('upload kept', clean.pages[0].slots[1].assetId, 'up_1');
  check('zoom clamped', clean.pages[0].slots[0].zoom, 4);
  check('cx clamped', clean.pages[0].slots[0].cx, 0);
  check('bad filter → none', clean.pages[0].slots[0].filter, 'none');
  check('bad template → p4-a', clean.pages[1].templateId, 'p4-a');
  check('duplicate page id fixed', clean.pages[1].id !== clean.pages[0].id, true);
  check('title trimmed', clean.pages[2].title.names.length, 120);
  check('bad colour → default', clean.pages[2].title.color, '#3a3a3a');
  check('bad font → bellefair', clean.pages[2].title.font, 'bellefair');
  check('camera offsets from studio', clean.cameraOffsets.X, 30);
  const rich = sz.sanitizeClientDoc({ pages: [{ id: 'r', templateId: 'g14-m1', blend: 'fade', foldOk: 'k', branding: { show: true, x: 500, y: 5, scale: 9 },
    slots: [{ assetId: 'd1', shape: 'ellipse', adj: { exposure: 9, contrast: -30, evil: 5 }, heal: [{ x: 2, y: 0.5, sx: 0.4, sy: 0.4, r: 0.03 }] }] }] }, assets, studio);
  const rs = rich.pages[0].slots[0];
  check('generated template id accepted', rich.pages[0].templateId, 'g14-m1');
  check('fade kept', rich.pages[0].blend, 'fade');
  check('ellipse kept', rs.shape, 'ellipse');
  check('adjustments clamped + unknown dropped', JSON.stringify(rs.adj), JSON.stringify({ exposure: 2, contrast: -30 }));
  check('heal point clamped', rs.heal[0].x, 1);
  check('branding clamped', JSON.stringify(rich.pages[0].branding), JSON.stringify({ show: true, x: 100, y: 5, scale: 3 }));
  const src = sz.sanitizeSource({ name: 'מגנטים', folderId: '1E27LBxgwCs_nn1jOCOlOp5QaOZTSQVO9', assets: [{ id: '11b94mvTIEWaWg_o7gx0py3zMLWPx3mwZ', name: 'a.jpg', w: 4000, h: 6000 }, { id: '../../x' }] });
  check('source: bad ids dropped', src.assets.length, 1);
  check('source: bad link rejected', sz.sanitizeSource({ name: 'x', folderId: 'javascript:alert(1)' }), null);
  check('source assets in the couple list (tab name)', sz.clientAssets(studio, [], [src]).find((a) => a.id === src.assets[0].id)?.group, 'מגנטים');
  const prods = { c1: { name: 'קנבס 40×60', price: 350, category: 'canvas' } };
  const en = sz.sanitizeEnlargements([{ assetId: 'd1', addonId: 'c1', orientation: 'landscape', by: 'studio' }, { assetId: 'nope', addonId: 'c1' }, { assetId: 'd2', addonId: 'zz' }], new Set(['d1', 'd2']), prods, 'couple');
  check('enlargement: only known photo + product', en.length, 1);
  check('enlargement: price snapshotted', en[0].addonName + '|' + en[0].addonPrice, 'קנבס 40×60|350');
  check('81 pages capped', sz.sanitizeClientDoc({ pages: Array.from({ length: 200 }, (_, i) => ({ id: 'p' + i, templateId: 'p1-a', slots: [] })) }, assets, studio).pages.length, 80);
  check('empty → studio pages', sz.sanitizeClientDoc({}, assets, studio).pages[0].id, 's');
  check('safe file name', sz.safeUploadName('../../etc/פספורט.png'), '.._.._etc_______.png');
  const w = (x) => aa.uploadQualityWarnings(x).map((y) => y.code).join(',');
  check('good photo → no warnings', w({ name: 'a.jpg', type: 'image/jpeg', size: 9e6, width: 6000, height: 4000 }), '');
  check('small photo', w({ name: 'a.jpg', type: 'image/jpeg', size: 2e6, width: 1600, height: 1200 }), 'small');
  check('screenshot', w({ name: 'IMG.PNG', type: 'image/png', size: 3e6, width: 1179, height: 2556 }), 'screenshot');
  check('whatsapp-compressed', w({ name: 'w.jpg', type: 'image/jpeg', size: 300000, width: 1600, height: 1200 }), 'small,compressed');
  check('heic flagged', w({ name: 'x.heic', type: 'image/heic', size: 3e6, width: 4000, height: 3000 }), 'type');
  check('upload src = signed url', aa.assetSrc({ id: 'up', source: 'upload', url: 'https://s/x' }), 'https://s/x');
  check('drive src = lh3', aa.assetSrc({ id: 'abc' }, 200), 'https://lh3.googleusercontent.com/d/abc=w200');
}

// PART 45 — year pickers up to 2050 (2026-10-09)
console.log('\n— PART 45: year options —');
{
  const yo = await loadModule('src/lib/yearOptions.js', 'yo45');
  const at = (y) => new Date(`${y}-06-01T12:00:00Z`);
  check('2026: same short list as before', yo.yearOptions({ now: at(2026) }).join(), '2025,2026,2027,2028,2029,2030');
  check('2031: moves forward by itself', yo.yearOptions({ now: at(2031) }).join(), '2030,2031,2032,2033,2034,2035');
  check('years with events are added', yo.yearOptions({ now: at(2026), dates: ['2023-05-01', '2033-01-02'] }).join(), '2023,2025,2026,2027,2028,2029,2030,2033');
  check('never past 2050', yo.yearOptions({ now: at(2048) }).join(), '2047,2048,2049,2050');
  check('the selected year is always there', yo.yearOptions({ now: at(2026), selected: 2040 }).includes(2040), true);
}

// PART 44 — dashboard "חורים השנה" (2026-10-09)
console.log('\n— PART 44: year gaps —');
{
  const eg = await loadModule('src/lib/eventGaps.js', 'eg44');
  const today = '2026-10-09';
  const full = [{ role: 'photographer1', staffMemberName: 'a' }, { role: 'photographer2', staffMemberName: 'b' }, { role: 'videographer', staffMemberName: 'c' }];
  const ok = { id: 'ok', date: '2026-11-20', requiredCrew: 3, team: full, googleCalendarEventId: 'g' };
  check('all good → no holes', eg.eventGaps(ok, { today, questionnaireFilled: true }).join(), '');
  check('missing team + calendar (upcoming)', eg.eventGaps({ ...ok, team: full.slice(0, 2), googleCalendarEventId: null }, { today }).join(), 'team,calendar');
  check('past: no team / calendar hole', eg.eventGaps({ ...ok, date: '2026-08-01', team: [], googleCalendarEventId: null, clientPaymentStatus: 'Paid' }, { today }).join(), '');
  check('past not paid (partial too)', eg.eventGaps({ ...ok, date: '2026-08-01', clientPaymentStatus: 'Partially Paid' }, { today }).join(), 'payment');
  check('today: not yet a payment hole', eg.eventGaps({ ...ok, date: today }, { today, questionnaireFilled: true }).join(), '');
  check('in progress counts, waiting / done do not', [
    eg.eventGaps({ ...ok, date: '2026-08-01', clientPaymentStatus: 'Paid', photographer1Done: true }, { today }).join(),
    eg.eventGaps({ ...ok, date: '2026-08-01', clientPaymentStatus: 'Paid' }, { today }).join(),
    eg.eventGaps({ ...ok, date: '2026-08-01', clientPaymentStatus: 'Paid', photographer1Done: true, photographer2Done: true, video1Done: true, rawDoneManual: true, finalDoneManual: true }, { today }).join(),
  ].join('|'), 'progress||');
  check('questionnaire: within 30 days only', [
    eg.eventGaps({ ...ok, date: '2026-10-30' }, { today, questionnaireFilled: false }).join(),
    eg.eventGaps({ ...ok, date: '2026-12-30' }, { today, questionnaireFilled: false }).join(),
    eg.eventGaps({ ...ok, date: '2026-10-30' }, { today, questionnaireFilled: null }).join(),
  ].join('|'), 'questionnaire||');
  const yg = eg.yearGaps([ok, { ...ok, id: 'x', team: [] }, { ...ok, id: 'y', date: '2027-01-05', team: [] }], { today, year: 2026 });
  check('year gaps: only that year, only with holes', Object.keys(yg).join(), 'x');
}

// PART 43 — album editor round 2: adjustments, fade, split, groups, presets, tags (2026-10-08)
console.log('\n— PART 43: album editor round 2 —');
{
  const aj = await loadModule('src/lib/albumAdjust.js', 'aj43');
  const at = await loadModule('src/lib/albumTemplates.js', 'at43');
  const al = await loadModule('src/lib/albumAutoLayout.js', 'al43');
  const ad = await loadModule('src/lib/albumDesign.js', 'ad43');
  check('neutral adj → no filter', aj.slotFilter({ adj: {} }, 'none'), 'none');
  check('same look → same id', aj.adjId({ exposure: 0.5, contrast: 10 }), aj.adjId({ contrast: 10, exposure: 0.5, tint: 0 }));
  check('adj + B&W chain', aj.slotFilter({ adj: { exposure: 0.5 } }, 'grayscale(1)').startsWith('url(#adj-') && aj.slotFilter({ adj: { exposure: 0.5 } }, 'grayscale(1)').endsWith('grayscale(1)'), true);
  const svg = aj.adjFilterSvg({ exposure: 1, shadows: 40, temp: 30, saturation: -20, sharpness: 50 });
  check('filter has all stages', ['slope="2"', 'type="table"', 'feColorMatrix type="matrix"', 'type="saturate"', 'feConvolveMatrix'].every((x) => svg.includes(x)), true);
  const tone = aj.toneTable({ shadows: 60 });
  check('shadows lift the dark end', tone[3] > 3 / 16, true);
  check('tone stays in 0..1', tone.every((v) => v >= 0 && v <= 1), true);
  check('docFilters dedupes', aj.docFilters({ pages: [{ slots: [{ adj: { exposure: 1 } }, { adj: { exposure: 1 } }, { adj: {} }] }] }).length, 1);
  const fr = at.layoutRects(at.getTemplate('p2-a'), false, 'fade');
  check('fade: first photo no fade', fr[0].fadeL, 0);
  check('fade: second fades over the first', fr[1].fadeL > 0 && fr[1].x < 50, true);
  check('fade: no white gutter', fr[0].x + fr[0].w, 50);
  const f0 = at.layoutRects(at.getTemplate('p2-a'), false, 'fade', 0);
  const f200 = at.layoutRects(at.getTemplate('p2-a'), false, 'fade', 200);
  check('fade 0% = no overlap', f0[1].x, 50);
  check('fade 200% = twice the band', Math.round((50 - f200[1].x) * 100) / 100, Math.round(2 * at.FADE_X * 100) / 100);
  check('fade strength clamped', at.layoutRects(at.getTemplate('p2-a'), false, 'fade', 999)[1].x, f200[1].x);
  const P = { w: 4000, h: 6000 }; const L = { w: 6000, h: 4000 };
  const byId = {}; const ids = [];
  for (let i = 0; i < 18; i++) { const a = { id: 'q' + i, name: 'AVIRA-' + i + '.jpg', ...(i % 2 ? L : P) }; byId[a.id] = a; ids.push(a); }
  check('20-photo layouts exist', al.rankTemplates(ids.slice(0, 18)).length > 0, true);
  let doc = ad.emptyDoc({ spreads: 2 });
  let g = al.placeGroup(doc, ids.slice(0, 8), { afterIndex: 0 });
  check('group → new spread after current', g.doc.pages.length + ':' + g.doc.pages[1].slots.filter((s) => s.assetId).length, '3:8');
  const big = al.placeGroup(doc, [...ids, ...ids.map((x) => ({ ...x, id: x.id + 'b' }))].slice(0, 30), { afterIndex: 0 });
  check('30 photos → 2 spreads (max 20 each)', big.pageIds.length, 2);
  const split = al.splitPage(g.doc, g.doc.pages[1].id, 3, byId);
  check('split 8 → 3 + 5', split.pages[1].slots.filter((s) => s.assetId).length + '+' + split.pages[2].slots.filter((s) => s.assetId).length, '3+5');
  check('split keeps the spread id', split.pages[1].id, g.doc.pages[1].id);
  check('split keeps order', split.pages[2].slots.map((s) => s.assetId).filter(Boolean).every((id) => ['q3', 'q4', 'q5', 'q6', 'q7'].includes(id)), true);
  const preset = al.presetFromDoc(split, 'test');
  const ap = al.applyPreset(ids, preset);
  check('preset reapplies layouts', ap.pages.map((p) => p.templateId).join(','), split.pages.map((p) => p.templateId).join(','));
  let tagged = ad.tagAssets({ tags: {} }, ['a', 'b'], 'chuppah');
  tagged = ad.tagAssets(tagged, ['a'], 'dancing');
  check('tags add up', tagged.tags.a.join(','), 'chuppah,dancing');
  check('tags clear', JSON.stringify(ad.tagAssets(tagged, ['a'], null).tags), JSON.stringify({ b: ['chuppah'] }));
  const withPhotos = ad.placeAsset(ad.placeAsset(ad.emptyDoc({}), 'x', 0, 'A'), 'x', 0, 'A');
  check('insert at index', ad.insertPageAt(withPhotos, 1).pages.length, 3);
  const before = ad.setTitle(g.doc, g.doc.pages[0].id, { names: 'דניאל & סבינה' });
  const reset = ad.resetSketch(before);
  check('reset: no photos left', reset.pages.every((p) => p.slots.every((s) => !s.assetId)), true);
  check('reset: same number of spreads', reset.pages.length, before.pages.length);
  check('reset: opening text kept', reset.pages[0].title.names, 'דניאל & סבינה');
  check('reset: bank kept', reset.assets === before.assets, true);
  // move / paste between pages
  let mv = ad.placeAsset(ad.placeAsset(ad.emptyDoc({ spreads: 3 }), 'x', 0, 'A'), 'x', 0, 'A');
  const p1 = mv.pages[1].id, p2 = mv.pages[2].id;
  mv = ad.placeAsset(mv, p1, 0, 'A');
  mv = ad.placeAsset(mv, p2, 0, 'B');
  const moved = ad.moveSlot(mv, { pageId: p1, index: 0 }, { pageId: p2, index: 0 });
  check('move: target gets the photo', moved.pages[2].slots[0].assetId, 'A');
  check('move: source empties', moved.pages[1].slots[0].assetId, null);
  check('move: replaced photo leaves the album (back to bank)', JSON.stringify(ad.usageCounts(moved)), JSON.stringify({ A: 1 }));
  const sw = ad.swapSlots(mv, { pageId: p1, index: 0 }, { pageId: p2, index: 0 });
  check('swap across pages', sw.pages[1].slots[0].assetId + sw.pages[2].slots[0].assetId, 'BA');
  const pasted = ad.pasteSlot(mv, p2, 1, { assetId: 'A', filter: 'bw-classic', adj: { exposure: 1 }, zoom: 2 });
  check('paste keeps the look, resets the crop', pasted.pages[2].slots[1].filter + '|' + pasted.pages[2].slots[1].zoom, 'bw-classic|1');
  const op = al.autoLayout(ids, { spreads: 6, openingCount: 3, openingEmpty: true });
  check('auto-sketch: opening with 3 empty frames', op.pages[0].templateId + ':' + op.pages[0].slots.filter((s) => s.assetId).length, 't-d:0');
  check('auto-sketch: album starts from the first photo', op.pages[1].slots.map((s) => s.assetId).includes('q0'), true);
  // drop on a page in the strip → joins it, both pages re-layout
  let jd = al.placeGroup(ad.emptyDoc({ spreads: 2 }), ids.slice(0, 4), { afterIndex: 0 }).doc;
  jd = al.placeGroup(jd, ids.slice(4, 9), { afterIndex: 1 }).doc;
  jd = { ...jd, assets: ids };
  const pA = jd.pages[1], pB = jd.pages[2];
  const lookIdx = pA.slots.findIndex((s) => s.assetId);
  jd = ad.updateSlot(jd, pA.id, lookIdx, { filter: 'bw-classic' });
  const movedId = jd.pages[1].slots[lookIdx].assetId;
  const j = al.addToPage(jd, pB.id, [movedId], byId, { pageId: pA.id, index: lookIdx });
  const cnt = (p) => p.slots.filter((s) => s.assetId).length;
  check('join: target +1, source −1', cnt(j.doc.pages[1]) + '/' + cnt(j.doc.pages[2]), '3/6');
  check('join: layouts changed to fit', j.doc.pages[1].slots.length + '/' + j.doc.pages[2].slots.length, '3/6');
  check('join: the photo keeps its B&W', j.doc.pages[2].slots.find((s) => s.assetId === movedId).filter, 'bw-classic');
  const fromBank = al.addToPage(jd, pB.id, ['q12'], byId);
  check('from the bank: target +1, nothing removed', cnt(fromBank.doc.pages[1]) + '/' + cnt(fromBank.doc.pages[2]), '4/6');
  check('opening takes max 3', !!al.addToPage(jd, jd.pages[0].id, ['q12', 'q13', 'q14', 'q15'], byId).error, true);
  const cutDoc = al.removeFromPage(jd, pB.id, 0, byId);
  check('cut: page closes the gap (5 → 4 frames)', cutDoc.pages[2].slots.length + '/' + cutDoc.pages[2].slots.filter((s) => s.assetId).length, '4/4');
  // ⌘+click several photos → move the group to another page (the owner's example: 6 → 2; a page of 3 gets the 4 → 7)
  let gd = al.placeGroup(ad.emptyDoc({ spreads: 2 }), ids.slice(0, 6), { afterIndex: 0 }).doc;
  gd = al.placeGroup(gd, ids.slice(6, 9), { afterIndex: 1 }).doc;
  const g6 = gd.pages[1], g3 = gd.pages[2];
  const pick = g6.slots.map((s, k) => (s.assetId ? k : -1)).filter((k) => k >= 0).slice(0, 4);
  const pickedIds = pick.map((k) => g6.slots[k].assetId);
  const gm = al.addToPage(gd, g3.id, pickedIds, byId, { pageId: g6.id, index: pick[0], indices: pick });
  check('group move: 6 → 2 and 3 → 7', cnt(gm.doc.pages[1]) + '/' + cnt(gm.doc.pages[2]), '2/7');
  check('group move: no empty frames left', gm.doc.pages[1].slots.length + '/' + gm.doc.pages[2].slots.length, '2/7');
  check('group move: the 4 photos are on the target', pickedIds.every((id) => gm.doc.pages[2].slots.some((s) => s.assetId === id)), true);
  check('group move: none left on the source', pickedIds.some((id) => gm.doc.pages[1].slots.some((s) => s.assetId === id)), false);
  check('group move: every photo still once', JSON.stringify(Object.values(ad.usageCounts(gm.doc)).every((n) => n === 1)), 'true');
  const all6 = g6.slots.map((s, k) => k);
  const gAll = al.addToPage(gd, g3.id, g6.slots.map((s) => s.assetId), byId, { pageId: g6.id, index: 0, indices: all6 });
  check('group move: whole page → source empty, target 9', cnt(gAll.doc.pages[1]) + '/' + cnt(gAll.doc.pages[2]), '0/9');
  const gCut = al.removeFromPage(gd, g6.id, pick, byId);
  check('group cut / delete: 6 → 2 frames', gCut.pages[1].slots.length + '/' + cnt(gCut.pages[1]), '2/2');
  check('fromIndices: single / group', al.fromIndices({ index: 3 }).join() + '|' + al.fromIndices({ index: 0, indices: [1, 2] }).join(), '3|1,2');
  const lf = ad.titleLineFonts({ font: 'josefin' });
  check('fonts synced: one font, Hebrew date falls back to a Hebrew font', lf.names.id + lf.date.id + '|' + lf.hebrew.id, 'josefinjosefin|bellefair');
  const lf2 = ad.titleLineFonts({ font: 'josefin', syncFonts: false, fontNames: 'greatvibes', fontHebrew: 'frank' });
  check('fonts per line', lf2.names.id + '|' + lf2.date.id + '|' + lf2.hebrew.id, 'greatvibes|josefin|frank');
  const picked = al.autoLayout(ids, { spreads: 6, openingCount: 2, openingIds: ['q11', 'q5'] });
  check('opening = the 2 picked photos', picked.pages[0].slots.map((s) => s.assetId).sort().join(','), 'q11,q5');
  check('picked photos not repeated later', picked.pages.slice(1).flatMap((p) => p.slots.map((s) => s.assetId)).some((x) => x === 'q11' || x === 'q5'), false);
  check('the rest are all used', picked.pages.slice(1).flatMap((p) => p.slots.map((s) => s.assetId)).filter(Boolean).length + picked.unused, 16);
  // sketch by tags
  const tg = {};
  ids.slice(0, 6).forEach((a) => (tg[a.id] = ['chuppah']));
  ids.slice(6, 10).forEach((a) => (tg[a.id] = ['bride_prep']));
  const bt = al.autoLayoutByTags(ids, { spreads: 8, openingCount: 1, openingIds: ['q15'], tags: tg, sections: [{ id: 'bride_prep', label: 'התארגנות כלה' }, { id: 'chuppah', label: 'חופה' }] });
  check('by tags: opening = picked', bt.pages[0].slots.map((s) => s.assetId).filter(Boolean).join(), 'q15');
  check('by tags: sections in the chosen order', [...new Set(bt.pages.slice(1).map((p) => p.section))].join(' > '), 'התארגנות כלה > חופה > ללא תווית');
  const mixed = bt.pages.slice(1).some((p) => new Set(p.slots.map((s) => (s.assetId ? (tg[s.assetId]?.[0] || 'none') : null)).filter(Boolean)).size > 1);
  check('by tags: no page mixes tags', mixed, false);
  check('by tags: every photo once', bt.pages.flatMap((p) => p.slots.map((s) => s.assetId)).filter(Boolean).length, 18);
  const noUn = al.autoLayoutByTags(ids, { spreads: 8, openingCount: 1, openingIds: ['q15'], tags: tg, sections: [{ id: 'chuppah', label: 'חופה' }], includeUntagged: false });
  check('by tags: untagged left out when asked', noUn.unused, 11);
  const pc = ad.setPageCount(g.doc, 1);
  check('page count never deletes spreads with photos', pc.blocked, 1);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
