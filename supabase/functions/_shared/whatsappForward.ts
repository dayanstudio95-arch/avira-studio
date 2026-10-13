// "העבר" in the chat (2026-10-13, the owner's request): which forwards are allowed.
// Pure — tested in scripts/test-whatsapp-bot.mjs PART 59.
//
// One message at a time, to up to five chats (like WhatsApp). Only a message that
// WhatsApp itself knows: rows the system made up (a missed-call line, a bot row whose
// send id never came back) and reactions cannot be forwarded.
export const MAX_FORWARD_TARGETS = 5;
const NOT_FORWARDABLE_TYPES = ['reactionMessage', 'missedCall'];

export function isForwardableMessage(m: { idMessage?: string | null; typeMessage?: string | null } | null | undefined): boolean {
  if (!m?.idMessage) return false;
  if (/^(bot-|call-|test-)/.test(m.idMessage)) return false;
  return !NOT_FORWARDABLE_TYPES.includes(m.typeMessage || '');
}

export type ForwardPlan =
  | { ok: true; targets: string[] }
  | { ok: false; error: string };

// targetIds: what the screen asked for; known: the target chat ids found in this studio.
export function planForward(
  { sourceConversationId, targetIds, knownTargetIds }:
  { sourceConversationId: string; targetIds: unknown; knownTargetIds: string[] },
): ForwardPlan {
  if (!Array.isArray(targetIds)) return { ok: false, error: 'בחרו לאן להעביר' };
  const unique = [...new Set(targetIds.map((t) => String(t || '').trim()).filter(Boolean))]
    .filter((t) => t !== sourceConversationId);
  if (unique.length === 0) return { ok: false, error: 'בחרו לאן להעביר' };
  if (unique.length > MAX_FORWARD_TARGETS) return { ok: false, error: `אפשר להעביר לעד ${MAX_FORWARD_TARGETS} שיחות בכל פעם` };
  const known = new Set(knownTargetIds);
  if (unique.some((t) => !known.has(t))) return { ok: false, error: 'שיחה לא נמצאה' };
  return { ok: true, targets: unique };
}
