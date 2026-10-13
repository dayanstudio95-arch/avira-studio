// Reactions in the chat (2026-10-13, the owner's request): a 👍 / ❤️ that someone put on a
// message — or that the owner put from his phone — is shown on that message, like
// WhatsApp, instead of as a message of its own. Pure — PART 58.
//
// A reaction row: typeMessage 'reactionMessage', bodyText = the emoji ('' = removed),
// quotedIdMessage = the message it is on. Each person has one reaction per message; a
// newer one replaces it, an empty one removes it.

const key = (m) => (m.direction === "inbound" ? `in:${m.senderChatId || ""}` : "me");

// messages: oldest first. Returns { messages, reactionsByTarget }.
//   messages — everything except reactions that are shown on their message (a reaction to
//              a message that is not loaded stays, as a small line).
//   reactionsByTarget — { idMessage: [{ emoji, mine, by }] }
export function groupReactions(messages) {
  const list = messages || [];
  const loaded = new Set(list.map((m) => m.idMessage).filter(Boolean));
  const latest = {}; // target → { personKey → reaction row }
  const out = [];
  for (const m of list) {
    if (m.typeMessage !== "reactionMessage") {
      out.push(m);
      continue;
    }
    const target = m.quotedIdMessage;
    if (target && loaded.has(target)) {
      (latest[target] ||= {})[key(m)] = m;
      continue;
    }
    // Its message is older than what is loaded (or unknown): a small line, unless removed.
    if (String(m.bodyText || "").trim()) out.push(m);
  }
  const reactionsByTarget = {};
  for (const [target, byPerson] of Object.entries(latest)) {
    const items = Object.values(byPerson)
      .map((m) => ({ emoji: String(m.bodyText || "").trim(), mine: m.direction !== "inbound", by: m.senderName || null }))
      .filter((r) => r.emoji);
    if (items.length) reactionsByTarget[target] = items;
  }
  return { messages: out, reactionsByTarget };
}

// The chat list's last line for a reaction (the webhook stores the emoji as the preview
// when the owner reacts from his phone).
export function reactionLine(m) {
  const e = String(m?.bodyText || "").trim();
  return m?.direction === "inbound" ? `הגיבו ${e} להודעה קודמת` : `הגבת ${e} להודעה קודמת`;
}
