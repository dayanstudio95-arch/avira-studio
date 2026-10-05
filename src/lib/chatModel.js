// The rules of "אווירה צ'אט" (WhatsApp Pro stage 1א, 2026-10-05) — pure, tested in
// scripts/test-whatsapp-bot.mjs PART 16. No React, no Supabase.
//
// Three separate ways a conversation is sorted (agreed with the owner, plan "שלב 12"):
//   מי זה  — contactType (one).
//   שלב    — the lead stage, the CRM's own vocabulary. If the conversation has a linked
//            lead (matchedLeadId) the stage IS that lead's status in the CRM; otherwise
//            it lives on the conversation (leadStage). Nothing enters the CRM by itself.
//   תוויות — free labels, many.

import { isAwaitingFollowUp } from "./followUpQueue";

export const CONTACT_TYPES = [
  { key: "unknown", label: "לא מוכר" },
  { key: "lead", label: "ליד" },
  { key: "client", label: "לקוח" },
  { key: "past_client", label: "לקוח עבר" },
  { key: "staff", label: "צוות" },
  { key: "vendor", label: "ספק" },
  { key: "irrelevant", label: "לא רלוונטי" },
  // Not selectable: a chat id ending @g.us is a group whatever anyone says.
  { key: "group", label: "קבוצה", fixed: true },
];

export function contactTypeLabel(type) {
  return CONTACT_TYPES.find((t) => t.key === type)?.label || type || "לא מוכר";
}

// leads.status's CHECK (0001_init.sql) — the stage vocabulary must match it exactly,
// because for a linked conversation the stage is written to the lead.
export const STAGES = ["חדש", "נשלחה הצעה", "פולו-אפ", "נסגר/חתימה", "חוזה", "לא רלוונטי"];

// People with a sales stage. Staff, vendors, groups and irrelevant chats have none.
const STAGED_TYPES = ["unknown", "lead", "client", "past_client"];
export function hasStage(c) {
  return STAGED_TYPES.includes(c?.contactType || "unknown");
}

// What the stage chip shows. `lead` is the linked CRM lead (or null).
export function effectiveStage(c, lead) {
  if (!hasStage(c)) return null;
  if (c.matchedLeadId && lead && lead.status) return lead.status;
  if (c.leadStage) return c.leadStage;
  // The bot already sent the price list — shown, never written anywhere.
  if (c.state === "PRICELIST_SENT") return "נשלחה הצעה";
  if (["unknown", "lead"].includes(c.contactType || "unknown")) return "חדש";
  return null;
}

// Where a stage change is written: to the lead in the CRM when there is one, otherwise
// to the conversation only.
export function stageTarget(c) {
  return c?.matchedLeadId ? "lead" : "conversation";
}

const t = (iso) => {
  const n = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(n) ? n : null;
};

// Not people you answer from a sales inbox.
const NO_REPLY_TYPES = ["group", "staff", "vendor", "irrelevant"];

// They wrote last and nobody (you or the bot) has answered since.
export function needsReply(c) {
  if (!c || c.archivedAt || NO_REPLY_TYPES.includes(c.contactType)) return false;
  const inbound = t(c.lastInboundAt);
  if (inbound === null) return false;
  const last = t(c.lastMessageAt);
  const bot = t(c.lastBotMessageAt);
  if (last !== null && last > inbound) return false;
  if (bot !== null && bot >= inbound) return false;
  return true;
}

// "מחכה 18 דק׳" / "מחכה 3 ש׳" / "מחכה 2 ימים" — null when not waiting.
export function waitingLabel(c, now = Date.now()) {
  if (!needsReply(c)) return null;
  const mins = Math.max(0, Math.floor((now - t(c.lastInboundAt)) / 60000));
  if (mins < 60) return `מחכה ${mins} דק׳`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `מחכה ${hours} ש׳`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "מחכה יום" : `מחכה ${days} ימים`;
}

// Waiting more than two hours — drawn in red.
export function isLongWait(c, now = Date.now()) {
  return needsReply(c) && now - t(c.lastInboundAt) > 2 * 3600 * 1000;
}

export function lastActivity(c) {
  return Math.max(t(c.lastMessageAt) ?? 0, t(c.lastBotMessageAt) ?? 0, t(c.lastInboundAt) ?? 0);
}

// Pinned first (newest pin on top), then most recent activity.
export function sortConversations(list) {
  return [...list].sort((a, b) => {
    const pa = t(a.pinnedAt), pb = t(b.pinnedAt);
    if (pa !== null || pb !== null) {
      if (pa === null) return 1;
      if (pb === null) return -1;
      if (pa !== pb) return pb - pa;
    }
    return lastActivity(b) - lastActivity(a);
  });
}

// The boxes in the sidebar. `ctx` = { unread: {id: n}, labelsByConv: {id: [labelId]},
// followUpAfterDays }.
export const BOXES = [
  { key: "all", label: "כל השיחות" },
  { key: "needs", label: "דורש מענה" },
  { key: "unread", label: "לא נקראו" },
  { key: "lead", label: "לידים" },
  { key: "client", label: "לקוחות" },
  { key: "staff", label: "צוות" },
  { key: "vendor", label: "ספקים" },
  { key: "group", label: "קבוצות" },
  { key: "followup", label: "ממתינים לפולו-אפ" },
  { key: "irrelevant", label: "לא רלוונטי" },
  { key: "optedout", label: "ביקשו הסרה" },
  { key: "archive", label: "ארכיון" },
];

export function matchesBox(c, box, ctx = {}) {
  if (box === "archive") return !!c.archivedAt;
  if (c.archivedAt) return false;
  const type = c.contactType || "unknown";
  switch (box) {
    // "All" keeps the owner's earlier choice: groups, staff and irrelevant chats only in
    // their own boxes.
    case "all": return !["group", "staff", "irrelevant"].includes(type);
    case "needs": return needsReply(c);
    case "unread": return (ctx.unread?.[c.id] || 0) > 0;
    case "lead": return type === "lead" || type === "unknown";
    case "client": return type === "client" || type === "past_client";
    case "followup": return isAwaitingFollowUp(c, ctx.followUpAfterDays || 0) && !c.optedOutAt;
    case "optedout": return !!c.optedOutAt;
    default:
      if (box.startsWith("label:")) return (ctx.labelsByConv?.[c.id] || []).includes(box.slice(6));
      return type === box;
  }
}

export function boxCounts(conversations, ctx, labelIds = []) {
  const out = {};
  for (const b of BOXES) out[b.key] = 0;
  for (const id of labelIds) out["label:" + id] = 0;
  for (const c of conversations) {
    for (const key of Object.keys(out)) if (matchesBox(c, key, ctx)) out[key]++;
  }
  return out;
}

// Digits-only phone match ("+972 54-425-1272" finds 0544251272) or a name substring.
export function matchesSearch(c, q) {
  const s = String(q || "").trim().toLowerCase();
  if (!s) return true;
  const digits = s.replace(/\D/g, "");
  if (digits.length >= 3) {
    const local = digits.startsWith("972") ? "0" + digits.slice(3) : digits;
    const hay = String(c.phone || "") + " " + String(c.chatId || "").replace(/\D/g, "");
    if (hay.includes(local) || hay.includes(digits)) return true;
  }
  return [c.displayName, c.coupleNames].some((v) => String(v || "").toLowerCase().includes(s));
}

// Fill a quick reply for this conversation. A value nobody knows stays visible as
// [תאריך] so it is noticed before sending instead of leaving a hole.
export function renderTemplate(body, c, lead) {
  const names = lead?.coupleNames || c?.coupleNames || (c?.contactType !== "unknown" ? c?.displayName : "") || "";
  const date = lead?.eventDate || c?.eventDate || "";
  const venue = lead?.venueName || c?.venue || "";
  const fmtDate = date ? new Date(date).toLocaleDateString("he-IL") : "";
  return String(body || "")
    .replace(/\{\{\s*names\s*\}\}/g, names || "[שמות]")
    .replace(/\{\{\s*event_date\s*\}\}/g, fmtDate || "[תאריך]")
    .replace(/\{\{\s*venue\s*\}\}/g, venue || "[אולם]");
}

// Undo: the change that reverses one activity row. Returns a description the caller
// executes: { kind: 'conversation', id, values } | { kind: 'lead', id, values } |
// { kind: 'label_add' | 'label_remove', conversationId, labelId } | null.
export function reverseOf(row) {
  const b = row?.before || {};
  const a = row?.after || {};
  switch (row?.action) {
    case "set_type":
      return { kind: "conversation", id: row.conversationId, values: { contactType: b.contactType ?? "unknown", contactTypeManualAt: b.contactTypeManualAt ?? null } };
    case "set_stage":
      if (b.leadId) return { kind: "lead", id: b.leadId, values: { status: b.leadStatus } };
      return { kind: "conversation", id: row.conversationId, values: { leadStage: b.leadStage ?? null } };
    case "archive":
      return { kind: "conversation", id: row.conversationId, values: { archivedAt: b.archivedAt ?? null } };
    case "pin":
      return { kind: "conversation", id: row.conversationId, values: { pinnedAt: b.pinnedAt ?? null } };
    case "opt_out":
      return { kind: "conversation", id: row.conversationId, values: { optedOutAt: b.optedOutAt ?? null, optedOutReason: b.optedOutReason ?? null } };
    case "label_add":
      return { kind: "label_remove", conversationId: row.conversationId, labelId: a.labelId };
    case "label_remove":
      return { kind: "label_add", conversationId: row.conversationId, labelId: b.labelId };
    default:
      return null;
  }
}
