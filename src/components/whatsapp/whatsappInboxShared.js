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
