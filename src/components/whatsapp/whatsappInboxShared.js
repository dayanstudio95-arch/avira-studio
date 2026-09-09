// Shared labels/helpers for the WhatsApp inbox screen.
//
// contact_type is computed server-side by supabase/functions/whatsapp-webhook and is
// the module's safety boundary: only 'unknown' is ever eligible for an automated
// reply (Stage 2). It is surfaced prominently in the UI precisely so a wrong
// classification is visible to a human before the bot is ever switched on.

export const CONTACT_TYPE_LABELS = {
  unknown: "לא מוכר",
  lead: "ליד קיים",
  client: "לקוח קיים",
  staff: "צוות",
  group: "קבוצה",
};

export const CONTACT_TYPE_COLORS = {
  unknown: "border-yellow-500/40 bg-yellow-500/15 text-yellow-300",
  lead: "border-blue-500/40 bg-blue-500/15 text-blue-300",
  client: "border-green-500/40 bg-green-500/15 text-green-300",
  staff: "border-purple-500/40 bg-purple-500/15 text-purple-300",
  group: "border-gray-600 bg-gray-700/40 text-gray-300",
};

export const STATE_LABELS = {
  NEW: "חדש",
  AWAITING_DETAILS: "ממתין לפרטים",
  PARTIAL_DETAILS: "פרטים חלקיים",
  PRICELIST_SENT: "נשלח מחירון",
  HANDED_OFF: "עבר לטיפול אישי",
  EXPIRED: "פג תוקף",
};

// ---------------------------------------------------------------------------------
// Dry-run verdicts (migration 0056_whatsapp_bot_dry_run.sql).
//
// The webhook runs the full Stage 2 gate chain on every inbound message and records
// what it WOULD have done, without sending anything. These are the Hebrew renderings
// of the machine codes stored in whatsapp_messages.bot_skip_reason — the wording lives
// here, on purpose, so it can be reworded without a migration.
//
// Why this is shown in the UI at all: the gate is not asking to be trusted, it is
// asking to be checked. Each verdict sits next to the message that produced it, so a
// wrong one is found by reading the inbox rather than by reasoning about the code.
// ---------------------------------------------------------------------------------
export const BOT_DECISION_LABELS = {
  ok: "הבוט היה עונה כאן",
  group: "קבוצה — הבוט שותק",
  known_contact: "מספר מוכר (לקוח / ליד / צוות) — הבוט שותק",
  bot_muted: "הבוט מושתק בשיחה זו",
  not_first_message: "לא ההודעה הראשונה בשיחה",
  not_text: "הודעה שאינה טקסט — אי אפשר לבדוק תוכן",
  quiet_hours: "שעות שקט",
  no_intent: "לא זוהתה פנייה לצילום אירוע",
};

export function botDecisionLabel(reason) {
  if (!reason) return "";
  return BOT_DECISION_LABELS[reason] || reason;
}

// ---------------------------------------------------------------------------------
// Lead temperature (migration 0057).
//
// Rated by Claude from what the customer wrote AFTER receiving the price list — the
// one message in the conversation that says whether they are actually buying. Null
// means nobody has replied since the price list went out, which is a different thing
// from 'cold' and is what puts a conversation in the follow-up queue instead.
// ---------------------------------------------------------------------------------
export const TEMPERATURE_LABELS = {
  hot: "🔥 רוצה להתקדם",
  warm: "מתעניין",
  cold: "לא מתקדם",
};

export const TEMPERATURE_COLORS = {
  hot: "border-red-500/40 bg-red-500/15 text-red-300",
  warm: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  cold: "border-gray-600 bg-gray-700/40 text-gray-400",
};

// Whole days since `iso`. Returns null for a missing/invalid date so callers can leave
// the cell empty rather than rendering "לפני NaN ימים".
export function daysSince(iso) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const days = Math.floor((Date.now() - then) / 86400000);
  return days < 0 ? 0 : days;
}

// '972501234567@c.us' -> '0501234567' for display. Kept intentionally dumb: the
// authoritative normalization lives server-side (_shared/phone.ts) and is already
// stored on the conversation's `phone` column — this is only a fallback for rows
// where normalization failed (e.g. a non-Israeli number).
export function displayPhone(conversation) {
  if (!conversation) return "";
  if (conversation.phone) return conversation.phone;
  const raw = String(conversation.chatId || "").split("@")[0];
  return raw ? `+${raw}` : "";
}

export function conversationTitle(conversation) {
  if (!conversation) return "";
  return conversation.displayName || conversation.coupleNames || displayPhone(conversation) || "ללא שם";
}

// Israeli-local time formatting. Deliberately avoids date-fns/toISOString date math —
// these are display-only wall-clock timestamps, never used to build a date value.
export function formatMessageTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("he-IL", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Jerusalem",
    });
  } catch {
    return "";
  }
}

export function formatListTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return formatMessageTime(iso);
    return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", timeZone: "Asia/Jerusalem" });
  } catch {
    return "";
  }
}

export function formatDayDivider(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("he-IL", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: "Asia/Jerusalem",
    });
  } catch {
    return "";
  }
}

// Groups messages into day buckets for the date dividers in the thread.
export function groupMessagesByDay(messages) {
  const groups = [];
  let currentKey = null;
  for (const message of messages) {
    const key = String(message.createdDate || "").slice(0, 10);
    if (key !== currentKey) {
      groups.push({ key: key || `x-${groups.length}`, label: formatDayDivider(message.createdDate), messages: [] });
      currentKey = key;
    }
    groups[groups.length - 1].messages.push(message);
  }
  return groups;
}
