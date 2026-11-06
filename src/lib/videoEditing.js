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

/** A film the editor pasted that the couple did not get yet — the count beside "עריכת וידאו". */
export const isFilmWaiting = (ev) => filmStateOf(ev) === "ready";

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

/** The message the couple gets — for the preview; the server renders the same (renderFilmMessage). */
export function renderFilmMessage(template, vars) {
  const tpl = String(template || "").trim() ? String(template) : DEFAULT_FILM_TEMPLATE;
  return tpl
    .split("\n")
    .filter((line) => [...line.matchAll(/\{\{(\w+)\}\}/g)].every((x) => String(vars[x[1]] ?? "").trim()))
    .map((line) => line.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? "")))
    .join("\n")
    .trim();
}
