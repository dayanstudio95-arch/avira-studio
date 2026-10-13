// "העבר" (2026-10-13). Mirrors supabase/functions/_shared/whatsappForward.ts — the server
// decides; this only hides the button where it would be refused. Pure — PART 59.
export const MAX_FORWARD_TARGETS = 5;
const NOT_FORWARDABLE_TYPES = ["reactionMessage", "missedCall"];

export function isForwardableMessage(m) {
  if (!m?.idMessage) return false;
  if (/^(bot-|call-|test-)/.test(m.idMessage)) return false;
  return !NOT_FORWARDABLE_TYPES.includes(m.typeMessage || "");
}

// Chats to offer: not the source, not archived first… newest first; filtered by the search.
export function forwardCandidates(conversations, sourceId, search, titleOf) {
  const q = String(search || "").trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  return (conversations || [])
    .filter((c) => c.id !== sourceId && c.chatId)
    .filter((c) => {
      if (!q) return true;
      const title = String(titleOf(c) || "").toLowerCase();
      if (title.includes(q)) return true;
      return digits.length >= 3 && String(c.phone || "").replace(/\D/g, "").includes(digits);
    })
    .sort((a, b) => (!!a.archivedAt - !!b.archivedAt) || String(b.lastMessageAt || "").localeCompare(String(a.lastMessageAt || "")));
}
