// The video editor's own page (Avira, 2026-11-06, the owner's request) — the pure parts: the film message to the
// couple, the editor's password and sign-in token, and what of an event the editor may see. Tested in
// scripts/test-whatsapp-bot.mjs. The editor-portal Edge Function and send-to-couple use them.

export const FILM_TEMPLATE_KEY = 'template_film_link';

// The editor's own words, as he sent them with every film (the same text in all of them since 2026-09) — the owner
// forwarded them to the couple as they were. Mirrored in src/components/settings/MessageTemplatesTab.jsx.
export const DEFAULT_FILM_TEMPLATE = `{{link}}

🥂 הסרט הקולנועי שלכם מוכן.

הכנו עבורכם חדר הקרנה פרטי, שבו תוכלו לצפות בסרטים ולהוריד אותם למחשב במהלך 30 הימים הקרובים.

⏳ **חשוב לשמור אצלכם**
מומלץ להוריד את כל הסרטים למחשב וליצור גיבוי נוסף בכונן חיצוני או בענן.
לאחר 30 יום החדר הפרטי ייסגר והקישור לא יהיה זמין יותר.

🎞 **לצפייה הטובה ביותר**
לצפייה חלקה באיכות מלאה מהמחשב אנחנו ממליצים להשתמש ב-VLC — נגן וידאו חינמי ל-Mac ול-Windows:

👉 https://www.videolan.org/vlc/

ועכשיו נשאר רק להתרווח, ללחוץ Play ולחזור לרגעים האלה שוב. 🤍

תודה שבחרתם בנו לתעד את היום שלכם.
מאחלים לכם צפייה מרגשת בכל פעם מחדש. 🎬`;

// The corrected film (2026-11-06): the couple asked the editor for changes, he fixed them, the owner sends it.
// Mirrored in src/lib/videoEditing.js.
export const FILM_FIX_TEMPLATE_KEY = 'template_film_fix_link';
export const DEFAULT_FILM_FIX_TEMPLATE = `היי {{names}} 😊
הסרט שלכם עודכן עם התיקונים שביקשתם 🎬
לצפייה: {{link}}
צפייה מהנה! 🤍`;

// {{link}} {{names}} {{event_date}} {{venue}}. A line whose variable came out empty is dropped; an empty template
// falls back to the default. Blank lines stay — the editor's text is made of paragraphs.
export function renderFilmMessage(template: string | null | undefined, vars: Record<string, string>, fallback = DEFAULT_FILM_TEMPLATE): string {
  const tpl = String(template || '').trim() ? String(template) : fallback;
  return tpl
    .split('\n')
    .filter((line) => [...line.matchAll(/\{\{(\w+)\}\}/g)].every((x) => String(vars[x[1]] ?? '').trim()))
    .map((line) => line.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? '')))
    .join('\n')
    .trim();
}

/** The film's link as pasted — trimmed, http(s), at most 500 characters; null when it is not a link. */
export function cleanFilmLink(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s || s.length > 500 || /\s/.test(s)) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? s : null;
  } catch {
    return null;
  }
}

// ── corrections ──────────────────────────────────────────────────────────────────────────────────────────────────
export type FilmFix = { n: number; at: string; link: string | null; newLink: boolean; note: string; sentAt: string | null };

const fixesOf = (raw: unknown): FilmFix[] => (Array.isArray(raw) ? raw.filter((f) => f && typeof f === 'object') : []);

/** The round the editor finished and the couple did not get yet, or null. */
export function pendingFix(raw: unknown): FilmFix | null {
  const list = fixesOf(raw);
  const last = list[list.length - 1];
  return last && !last.sentAt ? last : null;
}

/** "עשיתי תיקונים": a new round — or, while the last one was not sent yet, that round again with the new details. */
export function applyFix(raw: unknown, fix: { at: string; link: string | null; newLink: boolean; note?: string }): FilmFix[] {
  const list = fixesOf(raw);
  const open = pendingFix(list);
  const base = open ? list.slice(0, -1) : list;
  const n = open ? open.n : (list[list.length - 1]?.n || 0) + 1;
  return [...base, { n, at: fix.at, link: fix.link || null, newLink: Boolean(fix.newLink), note: String(fix.note || '').trim().slice(0, 300), sentAt: null }].slice(-30);
}

/** After the owner sent it: the open round gets its day. */
export function markFixSent(raw: unknown, at: string): FilmFix[] {
  const list = fixesOf(raw);
  if (!pendingFix(list)) return list;
  return list.map((f, i) => (i === list.length - 1 ? { ...f, sentAt: at } : f));
}

// ── sign-in ──────────────────────────────────────────────────────────────────────────────────────────────────────
export const SESSION_DAYS = 180;
export const MAX_FAILED = 8;
export const LOCK_MINUTES = 15;
const ITERATIONS = 300_000;

/** What is wrong with a new password ('' = fine). */
export function passwordProblem(pw: unknown): string {
  const s = String(pw ?? '');
  if (s.length < 6) return 'סיסמה של 6 תווים לפחות';
  if (s.length > 100) return 'סיסמה ארוכה מדי';
  return '';
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

/** "pbkdf2$sha256$<iterations>$<salt>$<hash>" — the iterations travel with the hash, so they can grow later. */
export async function hashPassword(password: string, iterations = ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$sha256$${iterations}$${b64(salt)}$${b64(await pbkdf2(password, salt, iterations))}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const parts = String(stored || '').split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2' || parts[1] !== 'sha256') return false;
  const iterations = Number(parts[2]);
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 5_000_000) return false;
  let salt: Uint8Array, want: Uint8Array;
  try {
    salt = unb64(parts[3]);
    want = unb64(parts[4]);
  } catch {
    return false;
  }
  const got = await pbkdf2(String(password ?? ''), salt, iterations);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

/** A new sign-in token: 32 random bytes, base64url. Only its SHA-256 is stored. */
export function newSessionToken(): string {
  return b64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── what the editor sees ─────────────────────────────────────────────────────────────────────────────────────────
const truthy = (v: unknown) => v === true || v === 'true';

/** Is `name` this event's editor (team[].role 'editor')? */
export function isEditorOf(team: unknown, name: string): boolean {
  return Array.isArray(team) && team.some((m) => m?.role === 'editor' && String(m?.staffMemberName || '').trim() === String(name || '').trim());
}

const VIDEO_ROLES: [string, string][] = [['videographer', 'וידאו 1'], ['videographer2', 'וידאו 2']];

// The event as the editor gets it — a whitelist: no couple phone, no prices but his own pay, nothing of the others.
export function portalEventView(ev: Record<string, any>, editorName: string) {
  const team = Array.isArray(ev?.team) ? ev.team : [];
  const me = team.find((m: any) => m?.role === 'editor' && String(m?.staffMemberName || '').trim() === String(editorName || '').trim()) || {};
  return {
    id: ev.id,
    date: ev.date || null,
    coupleNames: ev.couple_names || '',
    venue: ev.venue || '',
    videographers: VIDEO_ROLES.map(([role, label]) => ({ label, name: team.find((m: any) => m?.role === role)?.staffMemberName || '' })).filter((v) => v.name),
    rawLink: ev.raw_link || '',
    rawSent: truthy(ev.raw_sent_to_editor),
    filmLink: ev.film_link || '',
    filmLinkAt: ev.film_link_at || null,
    filmSentAt: ev.film_sent_at || null,
    filmBackedUpAt: ev.film_backed_up_at || null,
    editorDone: truthy(ev.editor_done),
    fixes: fixesOf(ev.film_fixes).map((f) => ({ n: f.n, at: f.at, link: f.link, newLink: f.newLink, note: f.note, sentAt: f.sentAt })),
    pay: { cost: Number(me.cost) || 0, isPaid: truthy(me.isPaid), paidAt: me.paidAt || null },
  };
}
