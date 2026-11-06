// The video editor's page and the owner's "עריכת וידאו" (2026-11-06, the owner's request) — the pure parts, shared by
// both pages, work status and the menu count. Tested in scripts/test-whatsapp-bot.mjs.
//
// An event's film, step by step: the raw footage not here yet → with the editor → the editor pasted the film's link
// (waiting for the owner to send it) → sent to the couple. "Sent" is also the editor's square already green on work
// status (editorDone) — the weddings delivered before this page existed.

const truthy = (v) => v === true || v === "true";

/** The event's editor in its team ({ role: 'editor', staffMemberName, cost, isPaid, paidAt }) or null. */
export const editorOf = (team) => (Array.isArray(team) ? team.find((m) => m?.role === "editor") : null) || null;

/** 'no_raw' | 'editing' | 'ready' | 'sent' — `ev` is an event (camelCase) or the editor page's view of one. */
export function filmStateOf(ev) {
  if (!ev) return "no_raw";
  if (ev.filmSentAt || truthy(ev.editorDone)) return "sent";
  if (String(ev.filmLink || "").trim()) return "ready";
  if (String(ev.rawLink || "").trim() || truthy(ev.rawSent ?? ev.rawSentToEditor)) return "editing";
  return "no_raw";
}

/** A film the editor pasted — or corrected — that the couple did not get yet: the count beside "עריכת וידאו". */
export const isFilmWaiting = (ev) => filmStateOf(ev) === "ready" || Boolean(pendingFix(ev));

/** Sent from this page and not marked backed up (the weddings from before it are not asked about). */
export const needsBackup = (ev) => Boolean(ev?.filmSentAt) && !ev?.filmBackedUpAt;

/** The editor's pay for the event, as the payments page keeps it on team[]. */
export function editorPayOf(ev) {
  if (ev?.pay) return ev.pay;
  const me = editorOf(ev?.team) || {};
  return { cost: Number(me.cost) || 0, isPaid: truthy(me.isPaid), paidAt: me.paidAt || null };
}

/** "3/11" in Israel — '' for no date. */
export function dayMonth(iso) {
  const d = new Date(String(iso || ""));
  if (!iso || Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric" }).formatToParts(d);
  return `${Number(parts.find((p) => p.type === "day")?.value)}/${Number(parts.find((p) => p.type === "month")?.value)}`;
}

/** The film's link as pasted — trimmed, http(s), at most 500 characters; null when it is not a link. Same as the server. */
export function cleanFilmLink(raw) {
  const s = String(raw ?? "").trim();
  if (!s || s.length > 500 || /\s/.test(s)) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? s : null;
  } catch {
    return null;
  }
}

export const FILM_TEMPLATE_KEY = "template_film_link";

// The editor's own words, as he sent them with every film. Mirrors DEFAULT_FILM_TEMPLATE in
// supabase/functions/_shared/editorPortal.ts (the test checks the two are the same).
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

// The corrected film (2026-11-06). Mirrors DEFAULT_FILM_FIX_TEMPLATE in supabase/functions/_shared/editorPortal.ts.
export const FILM_FIX_TEMPLATE_KEY = "template_film_fix_link";
export const DEFAULT_FILM_FIX_TEMPLATE = `היי {{names}} 😊
הסרט שלכם עודכן עם התיקונים שביקשתם 🎬
לצפייה: {{link}}
צפייה מהנה! 🤍`;

/** The message the couple gets — for the preview; the server renders the same (renderFilmMessage). */
export function renderFilmMessage(template, vars, fallback = DEFAULT_FILM_TEMPLATE) {
  const tpl = String(template || "").trim() ? String(template) : fallback;
  return tpl
    .split("\n")
    .filter((line) => [...line.matchAll(/\{\{(\w+)\}\}/g)].every((x) => String(vars[x[1]] ?? "").trim()))
    .map((line) => line.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? "")))
    .join("\n")
    .trim();
}

// ── corrections (2026-11-06): [{ n, at, link, newLink, note, sentAt }] on the event (filmFixes) / the page's view (fixes)
const fixesOf = (ev) => (Array.isArray(ev?.fixes) ? ev.fixes : Array.isArray(ev?.filmFixes) ? ev.filmFixes : []);

/** The last correction round, or null. */
export const lastFix = (ev) => fixesOf(ev)[fixesOf(ev).length - 1] || null;

/** The round the editor finished and the couple did not get yet, or null. */
export const pendingFix = (ev) => {
  const f = lastFix(ev);
  return f && !f.sentAt ? f : null;
};

// ── months, as on work status ────────────────────────────────────────────────────────────────────────────────────
const HEBREW_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

/** "2026-11-04" → "נובמבר 2026" (the event's own day, no time zone involved). */
export function monthLabel(date) {
  const m = /^(\d{4})-(\d{2})/.exec(String(date || ""));
  return m ? `${HEBREW_MONTHS[Number(m[2]) - 1]} ${m[1]}` : "";
}

/** Rows (already in order) cut where the month changes: [{ key, label, items }]. */
export function monthGroups(rows) {
  const out = [];
  for (const ev of rows || []) {
    const key = String(ev?.date || "").slice(0, 7);
    if (!out.length || out[out.length - 1].key !== key) out.push({ key, label: monthLabel(ev?.date) || "בלי תאריך", items: [] });
    out[out.length - 1].items.push(ev);
  }
  return out;
}

/** "אירוע אחד" / "3 אירועים". */
export const eventsCount = (n) => (n === 1 ? "אירוע אחד" : `${n} אירועים`);

// ── before sending (2026-11-06, the owner: "ככה אני יוכל לדעת לפני שאני שולח לזוג") ─────────────────────────────
// Whether the couple paid — the events page's payment status (clientPaymentStatus) — and whether their photo gallery
// went out: work status "→ זוג" / "סופי" (finalDoneManual), from Pixieset or from the galleries ("שלח לזוג" there).
const PAY = {
  Paid: { label: "הזוג שילם", tone: "green" },
  "Partially Paid": { label: "הזוג שילם חלקית", tone: "amber" },
  Unpaid: { label: "הזוג לא שילם", tone: "red" },
};

export function couplePayOf(ev) {
  const key = PAY[ev?.clientPaymentStatus] ? ev.clientPaymentStatus : "Unpaid";
  return { key, ...PAY[key] };
}

export function galleryOf(ev) {
  const sent = truthy(ev?.finalDoneManual);
  if (!sent) return { sent: false, label: "הגלריה עוד לא נשלחה" };
  if (ev?.finalSentVia === "gallery") return { sent: true, label: `הגלריה נשלחה מהגלריות${ev.finalSentAt ? ` ${dayMonth(ev.finalSentAt)}` : ""}` };
  if (/pixieset\./i.test(String(ev?.finalLink || ""))) return { sent: true, label: "הגלריה נשלחה (פיקסיסט)" };
  return { sent: true, label: "הגלריה נשלחה" };
}
