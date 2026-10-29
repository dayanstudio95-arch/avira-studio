// "The couple finished choosing in Pixieset" → a WhatsApp to the studio's album group
// (2026-10-29, the owner's request). Pixieset has no API or webhook; the only signal is the
// email it sends when the couple presses "send to photographer" on their favorites list:
//   subject "[Pixieset] Check out favorites from <collection>", from mailer@pixiesetmail.com,
//   body "<client email> wants to share their favorite photos from <collection> with you.
//   Message: <what they wrote>  View Favorites <link>".
// (Verified on real emails in the studio's mailbox; "New favorites list created for …" is a
// different email — sent when they START a list, several times — and is not a "done".)
// Pure — tested in PART 73.

export const PIXIESET_DONE_TEMPLATE_KEY = 'template_pixieset_done';
export const DEFAULT_PIXIESET_DONE_TEMPLATE = `✅ {{names}} סיימו לבחור תמונות בפיקסיסט
📅 חתונה: {{event_date}}
💬 {{message}}
🔗 המועדפים: {{link}}`;

export interface PixiesetFavorites {
  couple: string;
  clientEmail: string | null;
  message: string;
  link: string | null;
}

const clean = (s: string) =>
  String(s || '')
    .split('\n')
    .map((l) => l.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();

// Mandrill wraps every link: https://mandrillapp.com/track/click/<n>/<host>?p=<base64url JSON>
// whose inner JSON string holds the real url. Unwrap it so the group gets the Pixieset link.
export function unwrapMandrill(url: string): string {
  try {
    const u = new URL(url);
    if (!/mandrillapp\.com$/i.test(u.hostname)) return url;
    const p = u.searchParams.get('p');
    if (!p) return url;
    const b64 = p.replace(/-/g, '+').replace(/_/g, '/');
    const outer = JSON.parse(atob(b64 + '==='.slice((b64.length + 3) % 4)));
    const inner = typeof outer.p === 'string' ? JSON.parse(outer.p) : outer.p;
    return typeof inner?.url === 'string' && /^https?:\/\//.test(inner.url) ? inner.url : url;
  } catch {
    return url;
  }
}

const URL_RE = /https?:\/\/[^\s"'<>()\]]+/g;

export function parsePixiesetFavoritesEmail(subject: string, body: string, html = ''): PixiesetFavorites | null {
  const subj = String(subject || '').replace(/^\s*\[pixieset\]\s*/i, '').trim();
  const m = subj.match(/^check out favorites from\s+(.+?)\s*$/i);
  if (!m) return null;
  const couple = m[1].trim();
  const text = String(body || '');

  const emailMatch = text.match(/([^\s|<>]+@[^\s|<>]+\.[a-z]{2,})\s+wants to share/i) || text.match(/View Favorites by\s+([^\s|<>]+@[^\s|<>]+)/i);
  const clientEmail = emailMatch ? emailMatch[1] : null;

  let message = '';
  const msgStart = text.search(/Message:/i);
  if (msgStart >= 0) {
    const after = text.slice(msgStart + 'Message:'.length);
    const end = after.search(/View Favorites|Have a question\?/i);
    message = clean(end >= 0 ? after.slice(0, end) : after).slice(0, 800);
  }

  const urls = [...String(html || '').matchAll(URL_RE), ...text.matchAll(URL_RE)]
    .map((x) => x[0].replace(/&amp;/g, '&'))
    .map(unwrapMandrill);
  const link = urls.find((u) => /favoriteview/i.test(u)) || null;

  return { couple, clientEmail, message, link };
}

// The couple's names as words: "קורל & נתנאל", "קורל ונתנאל" and "נתנאל וקורל" are the same
// couple. The joining Hebrew "ו" can't simply be cut off — ורד / ויקי start with it — so two
// words also match when one is the other with a leading "ו".
export function coupleKey(names: string): string[] {
  return String(names || '')
    .replace(/[&+,/]|\band\b/gi, ' ')
    .split(/\s+/)
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
}

const wordsMatch = (a: string, b: string) => a === b || a === 'ו' + b || b === 'ו' + a;

export function sameCouple(a: string, b: string): boolean {
  const ka = coupleKey(a);
  const kb = coupleKey(b);
  if (ka.length < 2 || kb.length < 2) return false;
  const covers = (x: string[], y: string[]) => x.every((w) => y.some((v) => wordsMatch(w, v)));
  return covers(ka, kb) || covers(kb, ka);
}

// Lines whose {{variable}} came out empty are dropped (no "📅 חתונה:" without a date).
export function renderPixiesetDone(template: string | null | undefined, vars: Record<string, string>): string {
  const tpl = String(template || '').trim() ? String(template) : DEFAULT_PIXIESET_DONE_TEMPLATE;
  return tpl
    .split('\n')
    .filter((line) => {
      const keys = [...line.matchAll(/\{\{(\w+)\}\}/g)].map((x) => x[1]);
      return keys.every((k) => String(vars[k] ?? '').trim());
    })
    .map((line) => line.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? '')))
    .join('\n')
    .trim();
}

const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
// "2027-01-06" → "יום רביעי, 6.1.2027" (the day is read as a calendar date, not a time).
export function hebrewDay(day: string | null | undefined): string {
  const m = String(day || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return `יום ${WEEKDAYS[d.getUTCDay()]}, ${+m[3]}.${+m[2]}.${m[1]}`;
}

// The event this collection belongs to: the same couple, the closest date to today among the
// events of the last ~18 months and the next year (a collection is usually a past wedding).
export function matchEvent<T extends { couple_names?: string | null; date?: string | null }>(events: T[], couple: string, today: string): T | null {
  const hits = (events || []).filter((e) => e?.couple_names && sameCouple(e.couple_names, couple));
  if (!hits.length) return null;
  const dist = (e: T) => Math.abs(Date.parse(String(e.date).slice(0, 10)) - Date.parse(today));
  return hits.sort((a, b) => dist(a) - dist(b))[0];
}
