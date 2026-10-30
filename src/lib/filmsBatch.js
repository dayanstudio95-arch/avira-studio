// Several galleries at once and the whole galleries list, against the films Worker (fix plan P70).
// Plain logic (no React, no network of its own): the screens pass `send` / `get` (filmsApi).

/** Galleries per page of the list (the Worker answers `{ items, total }` for `limit`/`offset`). */
export const GALLERIES_PAGE = 500;

/**
 * Every gallery of the studio, a page at a time, newest first. A gallery made while reading shifts the pages
 * by one: the same gallery read twice is kept once. A failed page throws — never a partial list.
 */
export async function readAllGalleries(get, pageSize = GALLERIES_PAGE) {
  const byId = new Map();
  for (let offset = 0, round = 0; round < 1000; round++) {
    const { items = [], total = 0 } = (await get(`/api/admin/galleries?limit=${pageSize}&offset=${offset}`)) || {};
    for (const g of items) byId.set(g.id, g);
    offset += items.length;
    if (items.length === 0 || offset >= total) break;
  }
  return [...byId.values()];
}

/** At most this many requests for one batch (50 galleries, 6 photo galleries' face data per request: 9). */
const MAX_ROUNDS = 12;

/**
 * Sends one batch (`send(body)` → the Worker's answer) and, while it leaves photo galleries for the next
 * request (`remaining`: their face data is deleted a few per request), sends those again by itself.
 * Answers the sums: `done`, `doneIds`, `skipped` ({ id, reason }).
 */
export async function runBatch(send, action, ids, extra = {}) {
  const out = { done: 0, doneIds: [], skipped: [], faceSearchOff: [] };
  let todo = [...ids];
  for (let round = 0; todo.length > 0; round++) {
    if (round === MAX_ROUNDS) {
      out.skipped.push(...todo.map((id) => ({ id, reason: "changed" })));
      break;
    }
    const r = await send({ action, ids: todo, ...extra });
    out.done += Number(r?.done) || 0;
    out.doneIds.push(...(r?.doneIds || []));
    out.skipped.push(...(r?.skipped || []));
    // Extended or restored galleries whose face search went off when its data was deleted (fix plan P68).
    out.faceSearchOff.push(...(r?.faceSearchOff || []));
    const next = Array.isArray(r?.remaining) ? r.remaining : [];
    // Nothing moved: say so instead of asking forever.
    if (next.length >= todo.length && !(Number(r?.done) > 0)) {
      out.skipped.push(...next.map((id) => ({ id, reason: "changed" })));
      break;
    }
    todo = next;
  }
  return out;
}

const DONE_WORDS = { extend: "הוארכו", close: "נסגרו", trash: "הועברו לסל המחזור", restore: "שוחזרו", purge: "נמחקו לצמיתות" };
const DONE_ONE = { extend: "הוארכה", close: "נסגרה", trash: "הועברה לסל המחזור", restore: "שוחזרה", purge: "נמחקה לצמיתות" };

const REASONS = {
  not_found: "לא נמצאו (אולי נמחקו בינתיים)",
  module: "שייכות למודול שאינו כלול במנוי",
  in_trash: "נמצאות בסל המחזור",
  not_in_trash: "כבר לא בסל המחזור",
  changed: "השתנו בינתיים (למשל תאריך הסגירה). רעננו את הדף ונסו שוב",
  faces_failed: "נתוני זיהוי הפנים שלהן לא נמחקו, ולכן הן לא טופלו. נסו שוב בעוד רגע",
  // P71: a designed album keeps its gallery.
  album_submitted: "הזוג כבר שלח אלבום שעיצב בהן. צריך לאשר במפורש",
  album_order: "יש להן הזמנת אלבום פתוחה. אפשר רק אחרי שההזמנה נמסרה או הושלמה",
  album_paid: "יש להן הזמנת אלבום ששולמה או בהדפסה, ולכן לא נמחקות לצמיתות",
};

/** The galleries a batch skipped only for want of the studio's yes (a sent album): the screen asks, then sends them with `force`. */
export function needsConfirm(result) {
  return result.skipped.filter((s) => s.reason === "album_submitted").map((s) => s.id);
}

/** A batch result without the galleries of `reason` among its skipped ones (they are asked about apart). */
export function withoutSkipped(result, reason) {
  return { ...result, skipped: result.skipped.filter((s) => s.reason !== reason) };
}

/**
 * What to tell the studio: `success` (how many were done, '' when none) and `warning` (which were skipped
 * and why, by couple name when known; '' when none).
 */
export function batchMessages(result, action, namesById = {}) {
  const n = result.done;
  const success = n === 1 ? `גלריה אחת ${DONE_ONE[action]}` : n > 1 ? `${n} גלריות ${DONE_WORDS[action]}` : "";
  const byReason = new Map();
  for (const s of result.skipped) {
    if (!byReason.has(s.reason)) byReason.set(s.reason, []);
    byReason.get(s.reason).push(namesById[s.id] || s.id);
  }
  const lines = [...byReason].map(([reason, names]) => {
    const shown = names.slice(0, 3).join(", ") + (names.length > 3 ? ` ועוד ${names.length - 3}` : "");
    return `${names.length === 1 ? "גלריה אחת דולגה" : `${names.length} גלריות דולגו`} (${shown}): ${REASONS[reason] || "לא טופלו"}`;
  });
  return { success, warning: lines.join("\n") };
}
