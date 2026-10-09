// AI sales help in the chat (2026-10-09). Everything that decides WHAT the AI may say lives
// here, pure and tested (scripts/test-whatsapp-bot.mjs PART 48): the owner's price table
// (which price a suggestion may name, by event date and weekday), the style rules, the
// prompts, and reading the model's JSON back. The AI only drafts — every message is put in
// the box for a person to read, change and send.

// ---- Price rules ------------------------------------------------------------------------
// One row per package. `steps` = the prices a suggestion may offer on a regular day, from
// the first offer down to the floor (e.g. [13000, 12500]). `thuFri` = the floor on Thursday /
// Friday events, `winter` = the floor in the winter months (any weekday — the owner: "בינואר
// פברואר לא משנה הימים"). `none` = never discounted.
export interface PackageRule {
  name: string;
  list: number;
  steps: number[];
  thuFri?: number | null;
  winter?: number | null;
  none?: boolean;
}
export interface PriceRules {
  packages: PackageRule[];
  winterMonths: number[]; // 1..12
  henna?: string;
}

// The owner's numbers (2026-10-09). Matched to the packages table by name in the settings
// screen; until the studio saves its own table these are what the AI works with.
export const DEFAULT_PRICE_RULES: PriceRules = {
  winterMonths: [1, 2],
  packages: [
    { name: 'חבילה 2', list: 13500, steps: [13000, 12500], thuFri: 13000, winter: 12000 },
    { name: 'חבילה 1', list: 9500, steps: [9000], thuFri: 9000, winter: 8500 },
    { name: 'חבילה 3', list: 15500, steps: [14500], thuFri: 14500, winter: 14000 },
    { name: 'חבילה 4', list: 11000, steps: [], none: true },
    { name: 'חבילת וידאו', list: 5500, steps: [], none: true },
  ],
  henna: 'חינה: צלם סטילס — כולל צילום ועריכה 4,000 ₪ · צלם וידאו — כולל צילום ועריכה (סרט חינה + קליפ חינה) 4,000 ₪. בלי הנחה. אנחנו כמעט לא לוקחים חינות — לא לדחוף.',
};

// The prices a suggestion may name for this package on this event date, highest first,
// never below the floor. Winter beats the weekday rule; Thursday/Friday beats the regular
// steps. A date we don't know = regular day.
export function allowedOffers(rule: PackageRule | null | undefined, eventDate: string | null | undefined, winterMonths: number[] = [1, 2]): number[] {
  if (!rule || rule.none) return [];
  const steps = (rule.steps || []).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => b - a);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(eventDate || '');
  let floor = steps.length ? steps[steps.length - 1] : rule.list;
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
    const month = d.getUTCMonth() + 1;
    const weekday = d.getUTCDay(); // 4 = Thursday, 5 = Friday
    if (winterMonths.includes(month) && rule.winter) floor = Math.min(floor, rule.winter);
    else if ((weekday === 4 || weekday === 5) && rule.thuFri) floor = rule.thuFri;
  }
  const ladder = [...steps, floor].filter((n) => n >= floor && n < rule.list);
  return [...new Set(ladder)].sort((a, b) => b - a);
}

export function priceRulesText(rules: PriceRules, eventDate: string | null | undefined): string {
  const lines = rules.packages.map((p) => {
    const offers = allowedOffers(p, eventDate, rules.winterMonths);
    if (p.none || !offers.length) return `• ${p.name}: ${p.list.toLocaleString('en-US')} ₪ — בלי הנחה`;
    return `• ${p.name}: מחירון ${p.list.toLocaleString('en-US')} ₪ · מותר להציע לפי הסדר: ${offers.map((n) => n.toLocaleString('en-US')).join(' ← ')} ₪ (לא פחות מזה)`;
  });
  if (rules.henna) lines.push(`• ${rules.henna}`);
  return lines.join('\n');
}

export function parsePriceRules(raw: unknown): PriceRules {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (v && Array.isArray((v as any).packages)) {
      return {
        winterMonths: Array.isArray((v as any).winterMonths) ? (v as any).winterMonths.map(Number).filter((n: number) => n >= 1 && n <= 12) : [1, 2],
        henna: typeof (v as any).henna === 'string' ? (v as any).henna : '',
        packages: (v as any).packages
          .filter((p: any) => p && p.name && Number(p.list) > 0)
          .map((p: any) => ({
            name: String(p.name),
            list: Number(p.list),
            steps: (Array.isArray(p.steps) ? p.steps : []).map(Number).filter((n: number) => n > 0),
            thuFri: Number(p.thuFri) || null,
            winter: Number(p.winter) || null,
            none: !!p.none,
          })),
      };
    }
  } catch { /* fall through */ }
  return DEFAULT_PRICE_RULES;
}

// ---- Style ------------------------------------------------------------------------------
export const DEFAULT_STYLE_RULES = `חם, אישי ויוקרתי בלי להתאמץ. לב גדול, ניסוח נקי, ועמוד שדרה עסקי.
1. לא מסבירים יותר מדי — משפט אחד נקי במקום פסקה שמצדיקה.
2. שפה של מחווה ולא של הנחה: "לבוא לקראתכם", "מחיר מיוחד ונקודתי", "באהבה".
3. שומרים על הערך: "בלי לשנות שום דבר מהחבילה".
4. בלי לחץ, כן תנועה: "אם זה מתאים לכם, נשלח הסכם ונשריין את התאריך". אף פעם לא "רק היום".
5. בלי השוואות לזוגות אחרים.
6. נשארים בני אדם: קצת "איזה כיף", קצת "באהבה" — בלי להגזים. אימוג׳י אחד-שניים (❤️ 🥰 😊 🙏).
7. כותבים ברבים בשם הסטודיו ("אנחנו", "נשמח", "נשלח").
8. קצר: עד 4–5 שורות, פונים לזוג בשמות.
9. מספרים מדויקים: לא ממציאים מחיר ולא יורדים מתחת למחירים המותרים.`;

// ---- Prompts ----------------------------------------------------------------------------
export interface ThreadLine { who: 'lead' | 'studio' | 'bot'; text: string; at?: string }

export function threadText(lines: ThreadLine[]): string {
  return lines
    .map((l) => `${l.who === 'lead' ? 'ליד' : l.who === 'bot' ? 'בוט (הודעה אוטומטית)' : 'הסטודיו'}${l.at ? ` [${l.at}]` : ''}: ${l.text}`)
    .join('\n');
}

export function suggestPrompt(ctx: {
  style: string; prices: string; examples: string[]; facts: string; offered: string;
}): string {
  return `אתה מנסח הצעות תשובה בוואטסאפ עבור סטודיו לצילום חתונות. הסטודיו קורא כל הצעה, יכול לשנות אותה, ושולח בעצמו.

כללי הסגנון של הסטודיו:
${ctx.style}

מחירים — מותר להשתמש רק במספרים האלה:
${ctx.prices}
אם הסטודיו כבר הציע מחיר בשיחה — אל תציע מחיר אחר ממנו (לא גבוה ולא נמוך). אם הליד מבקש פחות מהמחיר הנמוך המותר — אל תוריד: הצע לשאול על התקציב או "נבדוק ונחזור אליכם".
הצעת מחיר ראשונה — תמיד המחיר הגבוה ברשימת המותרים. רק אחרי שהליד עדיין מבקש — המחיר הבא.

מה ידוע על הליד:
${ctx.facts}
${ctx.offered ? `מה הסטודיו כבר הציע: ${ctx.offered}` : ''}

דוגמאות לסגנון (הודעות שהסטודיו כתב ושמר):
${ctx.examples.map((e) => `---\n${e}`).join('\n')}

מקרים מיוחדים:
- הליד כתב "הסר" / ביקש לא לקבל הודעות → אל תמכור. החזר הצעה אחת קצרה שמאשרת הסרה, ו-"note" שמסביר.
- הליד סגר עם מישהו אחר / לא רלוונטי → הצעה אחת קצרה ומנומסת בלי מחיר.
- הסטודיו כבר ענה אחרון והליד לא כתב מאז → הצעה להמשך עדין, בלי להוריד מחיר בגלל שתיקה.

החזר JSON בלבד:
{"suggestions":[{"label":"קצר","text":"..."},{"label":"חם","text":"..."}],"note":"משפט קצר לסטודיו או ריק"}
שתי הצעות (קצרה וחמה), אלא אם זה מקרה מיוחד. בלי {{ }} — כתוב את השמות והתאריך עצמם.`;
}

export function improvePrompt(style: string, tweak: 'shorter' | 'warmer' | null): string {
  const extra = tweak === 'shorter' ? '\nהפעם: קצר יותר משמעותית — שורה או שתיים.' : tweak === 'warmer' ? '\nהפעם: חם ואישי יותר, עדיין בלי להגזים.' : '';
  return `אתה משפר ניסוח של הודעת וואטסאפ שכתב סטודיו לצילום חתונות, בסגנון שלו.

כללי הסגנון:
${style}

חובה:
- לשמור על התוכן, הסכומים, ההנחות וההבטחות בדיוק כמו בטיוטה. לא להוסיף מחיר, הנחה או הבטחה.
- לשמור על הגוף והמין של מי שכתב: "יכולה לעשות לכם" נשאר בלשון נקבה, "אני יכול" נשאר בזכר, "אנחנו" נשאר ברבים. שני אנשים עונים בסטודיו — זו לא טעות.
- לתקן כתיב ופיסוק, לכתוב סכומים עם פסיק (11,300), ולסדר את המשפטים כך שיהיה ברור מה ההצעה ומה הצעד הבא.
- לא להאריך: אורך דומה לטיוטה (אפשר קצת יותר מסודר).${extra}

החזר JSON בלבד: {"text":"..."}`;
}

export const SUMMARY_PROMPT = `אתה מסכם שיחת וואטסאפ בין סטודיו לצילום חתונות לבין ליד, בשביל הסטודיו.
החזר JSON בלבד:
{"budget":"מה אמרו על תקציב או ריק","wants":"איזו חבילה/מה רוצים או ריק","asked":"מה ביקשו או שאלו, קצר","offers":[{"price":12500,"date":"8.10","what":"פרימיום"}],"status":"משפט אחד: איפה זה עומד עכשיו"}
offers = רק מחירים שהסטודיו (לא הבוט, לא הליד) הציע בשיחה, לפי הסדר. אם אין — מערך ריק. אל תמציא.`;

export const TAG_KEYS = ['discount', 'wants_call', 'needs_time', 'closed_other', 'opt_out', 'question', 'ready', 'other'] as const;
export type AiTag = typeof TAG_KEYS[number];

// ---- Building the context -----------------------------------------------------------------
const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
export function hebrewDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  return `יום ${WEEKDAYS[d.getUTCDay()]} ${+m[3]}.${+m[2]}.${m[1]}`;
}

// Messages the studio typed itself, as style samples: not the bot, not links-only, not
// one-word "👍", not the long price list pasted by hand. Newest first, no repeats.
export function pickStyleExamples(texts: (string | null | undefined)[], max = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of texts) {
    const t = (raw || '').trim();
    if (t.length < 25 || t.length > 500) continue;
    if (/https?:\/\//.test(t)) continue;
    const key = t.replace(/\s+/g, ' ').slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

// The first moment of this month in Israel, for the monthly cap.
export function israelMonthStartIso(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }).formatToParts(now);
  const y = +parts.find((p) => p.type === 'year')!.value;
  const mo = +parts.find((p) => p.type === 'month')!.value;
  // Israel is UTC+2/+3; midnight local on the 1st is 21:00/22:00 UTC on the last day of the
  // previous month. Taking 21:00 UTC is at most one hour early — fine for a spending meter.
  return new Date(Date.UTC(y, mo - 1, 1, 0, 0, 0) - 3 * 3600000).toISOString();
}

export const DEFAULT_MONTHLY_CAP_ILS = 50;

// ---- Reading the model's answers --------------------------------------------------------
export function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1));
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function parseSuggestions(text: string): { suggestions: { label: string; text: string }[]; note: string } {
  const raw = extractJson(text);
  const list = Array.isArray(raw?.suggestions) ? (raw!.suggestions as any[]) : [];
  const suggestions = list
    .filter((s) => s && typeof s.text === 'string' && s.text.trim())
    .slice(0, 3)
    .map((s) => ({ label: typeof s.label === 'string' ? s.label.slice(0, 20) : '', text: s.text.trim().slice(0, 1500) }));
  return { suggestions, note: typeof raw?.note === 'string' ? raw.note.trim().slice(0, 300) : '' };
}

export function parseImproved(text: string): string {
  const raw = extractJson(text);
  return typeof raw?.text === 'string' ? raw.text.trim().slice(0, 1500) : '';
}

export function parseSummary(text: string) {
  const raw = extractJson(text);
  if (!raw) return null;
  const s = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string).trim().slice(0, 200) : '');
  const offers = (Array.isArray(raw.offers) ? raw.offers : [])
    .filter((o: any) => o && Number(o.price) > 0)
    .slice(0, 10)
    .map((o: any) => ({ price: Number(o.price), date: String(o.date || '').slice(0, 12), what: String(o.what || '').slice(0, 40) }));
  return { budget: s('budget'), wants: s('wants'), asked: s('asked'), status: s('status'), offers };
}

export function parseTag(value: unknown): AiTag | null {
  const v = String(value ?? '').trim().toLowerCase();
  return (TAG_KEYS as readonly string[]).includes(v) ? (v as AiTag) : null;
}

// ---- "מתי לחזור אליהם" ------------------------------------------------------------------
// A lead who says they need time gets a reminder in 3 days, unless one is already waiting.
// Any other tag on a later message means they came back on their own: a reminder that was
// not yet fired is dropped (otherwise "let's close!" on Monday is followed by "חזור אליהם"
// on Wednesday). Returns the columns to write, or null for "leave as is".
export const RETURN_AFTER_DAYS = 3;
export function returnUpdateForTag(
  tag: AiTag | null,
  current: { return_at?: string | null; return_notified_at?: string | null },
  now: Date = new Date(),
): { return_at: string | null; return_notified_at: null } | null {
  if (!tag) return null;
  const pending = !!current.return_at && !current.return_notified_at;
  if (tag === 'needs_time') {
    if (pending) return null;
    return { return_at: new Date(now.getTime() + RETURN_AFTER_DAYS * 86400000).toISOString(), return_notified_at: null };
  }
  if (pending) return { return_at: null, return_notified_at: null };
  return null;
}

// ---- Cost --------------------------------------------------------------------------------
// Estimated, for the monthly cap and the counter in Settings: Claude Sonnet list price per
// million tokens (USD 3 in / 15 out) at ~3.7 ₪ per dollar. Verify against Anthropic's
// pricing page if the model changes (ANTHROPIC_MODEL) — this is a guard rail, not a bill.
export const USD_PER_MTOK_IN = 3;
export const USD_PER_MTOK_OUT = 15;
export const ILS_PER_USD = 3.7;
export function costIls(inputTokens: number, outputTokens: number): number {
  const usd = (inputTokens / 1e6) * USD_PER_MTOK_IN + (outputTokens / 1e6) * USD_PER_MTOK_OUT;
  return Math.round(usd * ILS_PER_USD * 10000) / 10000;
}
