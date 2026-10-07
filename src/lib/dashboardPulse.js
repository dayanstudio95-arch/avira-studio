// The daily numbers on the dashboard (2026-10-07) — pure, tested in PART 33.
import { needsReply, waitingLabel, chatTitle, isHotLead } from "@/lib/chatModel";
import { leadForPhone } from "@/lib/leadPhoneIndex";
import { isAwaitingFollowUp } from "@/lib/followUpQueue";
import { buildAttentionList } from "@/lib/needsAttention";

const t = (iso) => (iso ? new Date(iso).getTime() : 0);

// WhatsApp: who is waiting for an answer (longest first) and the hot leads. `phoneIndex`
// (src/lib/leadPhoneIndex.js) drops couples whose CRM lead is already closed / signed.
export function whatsappPulse(conversations, now = Date.now(), phoneIndex = null) {
  const live = (conversations || []).filter((c) => !c.archivedAt);
  const waiting = live.filter(needsReply).sort((a, b) => t(a.lastInboundAt) - t(b.lastInboundAt));
  const hot = live
    .filter((c) => isHotLead(c, phoneIndex ? leadForPhone(phoneIndex, c.phone || String(c.chatId || "").split("@")[0]) : null))
    .sort((a, b) => t(b.leadTemperatureAt || b.lastMessageAt) - t(a.leadTemperatureAt || a.lastMessageAt));
  return {
    waitingCount: waiting.length,
    oldest: waiting[0] ? { id: waiting[0].id, title: chatTitle(waiting[0]), label: waitingLabel(waiting[0], now) } : null,
    hot: hot.map((c) => ({ id: c.id, title: chatTitle(c), reason: c.leadTemperatureReason || "" })),
  };
}

// Follow-up: WhatsApp conversations waiting for a nudge + CRM leads nobody has contacted
// for a week (the dashboard's old "צריך טיפול" rule).
export function followUpSummary(conversations, leads, afterDays = 0) {
  const awaiting = (conversations || []).filter((c) => !c.archivedAt && isAwaitingFollowUp(c, afterDays));
  const stale = buildAttentionList([], leads || []).filter((r) => r.reason === "stale_lead");
  return { awaitingCount: awaiting.length, staleLeads: stale };
}
