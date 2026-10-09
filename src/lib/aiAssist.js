// AI sales help in the chat (2026-10-09) — the screen's side, pure and tested
// (scripts/test-whatsapp-bot.mjs PART 48). The drafting itself lives in the
// whatsapp-ai-assist Edge Function; the rules for prices and style in
// supabase/functions/_shared/aiSalesRules.ts.

// The topic the webhook tags on each lead reply (whatsapp_conversations.ai_tag).
export const AI_TAGS = {
  discount: { label: "ביקשו הנחה", icon: "💸", cls: "bg-rose-900/60 text-rose-200" },
  wants_call: { label: "רוצים שיחה", icon: "📞", cls: "bg-sky-900/60 text-sky-200" },
  needs_time: { label: "צריכים זמן", icon: "⏳", cls: "bg-amber-900/60 text-amber-200" },
  closed_other: { label: "סגרו עם אחר", icon: "🚪", cls: "bg-gray-800 text-gray-400" },
  opt_out: { label: "ביקשו הסרה", icon: "🚫", cls: "bg-gray-800 text-gray-400" },
  question: { label: "שאלה", icon: "❓", cls: "bg-violet-900/60 text-violet-200" },
  ready: { label: "מוכנים לסגור", icon: "✅", cls: "bg-emerald-900/60 text-emerald-200" },
};

export function aiTagInfo(tag) {
  return AI_TAGS[tag] || null;
}

const ms = (iso) => {
  const n = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(n) ? n : null;
};

// "⏰ לחזור אליהם" is due: the time has come, and nobody has answered or marked it
// handled since.
export function isReturnDue(c, now = Date.now()) {
  const r = ms(c?.returnAt);
  if (r === null || r > now) return false;
  const handled = ms(c.handledAt);
  if (handled !== null && handled >= r) return false;
  const ours = ms(c.lastMessageAt);
  if (ours !== null && ours >= r && ms(c.lastInboundAt) !== ours) return false;
  return true;
}

// The chip: "⏰ לחזור היום" / "⏰ לחזור מחר" / "⏰ לחזור 14.10" — null when nothing is set.
export function returnChip(c, now = Date.now()) {
  const r = ms(c?.returnAt);
  if (r === null) return null;
  if (isReturnDue(c, now)) return "⏰ לחזור עכשיו";
  if (r <= now) return null; // done
  const day = (x) => new Date(x).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  if (day(r) === day(now)) return "⏰ לחזור היום";
  if (day(r) === day(now + 86400000)) return "⏰ לחזור מחר";
  return `⏰ לחזור ${new Date(r).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric" })}`;
}

// The manual choices. At 10:00 Israel time on the chosen day.
export const RETURN_OPTIONS = [
  { key: "tomorrow", label: "מחר", days: 1 },
  { key: "3days", label: "בעוד 3 ימים", days: 3 },
  { key: "week", label: "בעוד שבוע", days: 7 },
];

export function returnAtFor(days, now = new Date()) {
  const ymd = new Date(now.getTime() + days * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  // 10:00 in Israel = 07:00 or 08:00 UTC; find the one that reads 10 locally.
  for (const utcHour of [7, 8]) {
    const d = new Date(`${ymd}T${String(utcHour).padStart(2, "0")}:00:00Z`);
    const hh = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", hour12: false }).format(d);
    if (Number(hh) === 10) return d.toISOString();
  }
  return new Date(`${ymd}T07:00:00Z`).toISOString();
}

// "13,000 ₪ (30.9) → 12,500 ₪ (2.10)" — what the studio already offered, from the summary.
export function offersLine(summary) {
  const offers = Array.isArray(summary?.offers) ? summary.offers : [];
  return offers
    .filter((o) => Number(o?.price) > 0)
    .map((o) => `${Number(o.price).toLocaleString("en-US")} ₪${o.date ? ` (${o.date})` : ""}`)
    .join(" → ");
}

// A summary written before the last message is out of date.
export function summaryIsStale(c) {
  const at = ms(c?.aiSummaryAt);
  if (at === null) return true;
  const last = Math.max(ms(c.lastMessageAt) ?? 0, ms(c.lastInboundAt) ?? 0, ms(c.lastBotMessageAt) ?? 0);
  return last > at;
}
