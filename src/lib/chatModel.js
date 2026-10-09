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
import { isReturnDue } from "./aiAssist";

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
  if (type === "bot_lead") return "ליד (מהבוט)";
  return CONTACT_TYPES.find((t) => t.key === type)?.label || type || "לא מוכר";
}

// A stranger the bot recognised as a wedding/photography inquiry (it asked for details or
// sent the price list, or rated their reply). Shown with the leads (2026-10-07, the owner's
// choice) — display only: contact_type stays 'unknown' in the database, so the bot keeps
// working exactly as before and nothing enters the CRM until "צור ליד".
export function isBotLead(c) {
  if ((c?.contactType || "unknown") !== "unknown") return false;
  return !!(c.botWouldReplyAt || c.leadTemperature || (c.state && c.state !== "NEW"));
}

// The type a row shows: 'bot_lead' for the above, otherwise the stored one.
export function displayType(c) {
  return isBotLead(c) ? "bot_lead" : c?.contactType || "unknown";
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

// They wrote last and nobody (you or the bot) has answered since — unless the owner
// marked it "טופל" after their last message (handledAt, 0070). Writing again brings it
// back by itself.
function waitingOnUs(c) {
  if (!c || c.archivedAt || NO_REPLY_TYPES.includes(c.contactType)) return false;
  const inbound = t(c.lastInboundAt);
  if (inbound === null) return false;
  const handled = t(c.handledAt);
  if (handled !== null && handled >= inbound) return false;
  const last = t(c.lastMessageAt);
  const bot = t(c.lastBotMessageAt);
  if (last !== null && last > inbound) return false;
  if (bot !== null && bot >= inbound) return false;
  return true;
}

// …or a "⏰ לחזור אליהם" reminder came due (AI sales help, 2026-10-09).
export function needsReply(c) {
  if (waitingOnUs(c)) return true;
  return !!c && !c.archivedAt && !NO_REPLY_TYPES.includes(c.contactType) && isReturnDue(c);
}

// "מחכה 18 דק׳" / "מחכה 3 ש׳" / "מחכה 2 ימים" — null when not waiting.
export function waitingLabel(c, now = Date.now()) {
  if (!waitingOnUs(c)) return needsReply(c) ? "⏰ לחזור אליהם" : null;
  const mins = Math.max(0, Math.floor((now - t(c.lastInboundAt)) / 60000));
  if (mins < 1) return "מחכה עכשיו";
  if (mins < 60) return `מחכה ${mins} דק׳`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `מחכה ${hours} ש׳`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "מחכה יום" : `מחכה ${days} ימים`;
}

// Waiting more than two hours — drawn in red.
export function isLongWait(c, now = Date.now()) {
  return waitingOnUs(c) && now - t(c.lastInboundAt) > 2 * 3600 * 1000;
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

// The boxes. `ctx` = { unread: {id: n}, labelsByConv: {id: [labelId]}, followUpAfterDays }.
// 2026-10-07 (the old inbox merged in, the owner's choice): the primary row is what he works
// from — strangers first, then leads, follow-ups, hot leads; everything else sits under
// "עוד". "הכל" = leads and strangers only (no clients, groups, staff).
export const BOXES = [
  { key: "unknown", label: "לא מוכר", primary: true },
  { key: "lead", label: "לידים", primary: true },
  { key: "followup", label: "פולו אפ", primary: true },
  { key: "hot", label: "ליד חם", primary: true },
  { key: "unread", label: "לא נקראו", primary: true },
  { key: "all", label: "הכל", primary: true },
  { key: "needs", label: "דורש מענה" },
  { key: "followup_noreply", label: "פולו-אפ · לא ענו" },
  { key: "followup_replied", label: "ענו אחרי פולו-אפ" },
  { key: "pricelist_sent", label: "נשלח מחירון" },
  // AI sales help (2026-10-09): the reminder and the reply topics.
  { key: "return", label: "⏰ לחזור אליהם" },
  { key: "tag:discount", label: "💸 ביקשו הנחה" },
  { key: "tag:wants_call", label: "📞 רוצים שיחה" },
  { key: "tag:needs_time", label: "⏳ צריכים זמן" },
  { key: "tag:ready", label: "✅ מוכנים לסגור" },
  { key: "client", label: "לקוחות" },
  { key: "staff", label: "צוות" },
  { key: "vendor", label: "ספקים" },
  { key: "group", label: "קבוצות" },
  { key: "irrelevant", label: "לא רלוונטי" },
  { key: "optedout", label: "ביקשו הסרה" },
  { key: "archive", label: "ארכיון" },
];

// Opens on "לידים" (the owner, 2026-10-07 — after the bot-recognised strangers moved there).
export const DEFAULT_BOX = "lead";

// "ליד חם" is a lead still being won (2026-10-07: couples who had signed stayed in the box).
// A client, or a conversation whose CRM lead is closed / signed, is no longer hot.
export function isClosedDeal(c, lead) {
  if (["client", "past_client"].includes(c?.contactType)) return true;
  return !!lead && (lead.signed || ["נסגר/חתימה", "חוזה"].includes(lead.status));
}
export function isHotLead(c, lead) {
  return c?.leadTemperature === "hot" && !["group", "staff"].includes(c?.contactType || "unknown") && !isClosedDeal(c, lead);
}

// After a follow-up (2026-10-07): null = none sent; "sent" = sent, no answer since;
// "replied" = the couple wrote after it.
export function followUpOutcome(c) {
  if (!c?.followupSentAt) return null;
  const sent = new Date(c.followupSentAt).getTime();
  return c.lastInboundAt && new Date(c.lastInboundAt).getTime() > sent ? "replied" : "sent";
}

export function matchesBox(c, box, ctx = {}) {
  if (box === "archive") return !!c.archivedAt;
  if (c.archivedAt) return false;
  const type = c.contactType || "unknown";
  switch (box) {
    case "all": return type === "lead" || type === "unknown";
    // Strangers the bot recognised as inquiries count as leads (isBotLead).
    case "unknown": return type === "unknown" && !isBotLead(c);
    case "lead": return type === "lead" || isBotLead(c);
    case "needs": return needsReply(c);
    case "unread": return (ctx.unread?.[c.id] || 0) > 0;
    case "client": return type === "client" || type === "past_client";
    case "followup": return isAwaitingFollowUp(c, ctx.followUpAfterDays || 0) && !c.optedOutAt;
    case "optedout": return !!c.optedOutAt;
    // From the old inbox (WhatsAppInbox.jsx), same rules — groups and staff never count.
    case "hot": return isHotLead(c, c.matchedLeadId ? ctx.leadsById?.[c.matchedLeadId] : null);
    case "followup_sent": return !!c.followupSentAt && !["group", "staff"].includes(type);
    case "followup_noreply": return followUpOutcome(c) === "sent" && !["group", "staff"].includes(type);
    case "followup_replied": return followUpOutcome(c) === "replied" && !["group", "staff"].includes(type);
    case "pricelist_sent": return c.state === "PRICELIST_SENT" && !["group", "staff"].includes(type);
    case "return": return !!c.returnAt && (isReturnDue(c) || new Date(c.returnAt).getTime() > Date.now());
    default:
      if (box.startsWith("label:")) return (ctx.labelsByConv?.[c.id] || []).includes(box.slice(6));
      if (box.startsWith("tag:")) return c.aiTag === box.slice(4) && !isClosedDeal(c, c.matchedLeadId ? ctx.leadsById?.[c.matchedLeadId] : null);
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
    case "handled":
      return { kind: "conversation", id: row.conversationId, values: { handledAt: b.handledAt ?? null } };
    case "followup_flag":
      return { kind: "conversation", id: row.conversationId, values: { followupFlaggedAt: b.followupFlaggedAt ?? null, followupDismissedAt: b.followupDismissedAt ?? null } };
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

// ---------------------------------------------------------------------------------
// "Is that date free?" (2026-10-05, the owner's request): the event date of a
// conversation, and where it came from — the linked CRM lead, what the bot collected,
// or (failing both) the newest date the customer wrote in a message.
// ---------------------------------------------------------------------------------

const HEB_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

const pad = (n) => String(n).padStart(2, "0");

function makeDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function expandYear(s) {
  if (!s) return null;
  const n = Number(s);
  if (s.length === 2) return 2000 + n;
  if (s.length === 4) return n;
  return null;
}

// Every plausible FUTURE date written in `text` (within 3 years), in order of
// appearance. "30/6/27", "30.6.2027", "30-6", "30 ביוני", "30 ליוני 2027".
// A day.month without a year takes the next time that day comes round. Prices ("5.500"),
// times ("14.30") and phone numbers are rejected by the day/month bounds and the digit
// boundaries.
export function findDatesInText(text, today = new Date()) {
  const s = String(text || "");
  const todayIso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const maxIso = `${today.getFullYear() + 3}-12-31`;
  const found = [];
  const push = (iso, index) => {
    if (iso && iso >= todayIso && iso <= maxIso) found.push({ iso, index });
  };
  const withoutYear = (d, m, index) => {
    for (let y = today.getFullYear(); y <= today.getFullYear() + 1; y++) {
      const iso = makeDate(y, m, d);
      if (iso && iso >= todayIso) return push(iso, index);
    }
  };
  // Latin letters around the digits mean a code or a file name, not a date: "6b1-6e5e"
  // (a voice note's file name) once read as 1 June (2026-10-07). Hebrew letters are fine
  // ("ב30/6").
  const num = /(^|[^\dA-Za-z])(\d{1,2})[./-](\d{1,2})(?:[./-](\d{4}|\d{2}))?(?![\dA-Za-z])/g;
  let mt;
  while ((mt = num.exec(s))) {
    const d = Number(mt[2]), m = Number(mt[3]);
    if (d < 1 || d > 31 || m < 1 || m > 12) continue;
    const idx = mt.index + mt[1].length;
    if (mt[4]) push(makeDate(expandYear(mt[4]), m, d), idx);
    else withoutYear(d, m, idx);
  }
  const heb = new RegExp(`(^|[^\\d])(\\d{1,2})\\s*[-–]?\\s*[בל]?\\s*(${HEB_MONTHS.join("|")})(?:\\s+(\\d{4}|\\d{2}))?`, "g");
  while ((mt = heb.exec(s))) {
    const d = Number(mt[2]), m = HEB_MONTHS.indexOf(mt[3]) + 1;
    const idx = mt.index + mt[1].length;
    if (mt[4]) push(makeDate(expandYear(mt[4]), m, d), idx);
    else withoutYear(d, m, idx);
  }
  return found.sort((a, b) => a.index - b.index).map((f) => f.iso);
}

// The date to check, and its source. `messages` = the thread's messages (oldest first).
export function eventDateFor(c, lead, messages = [], today = new Date()) {
  const iso = (v) => (v ? String(v).slice(0, 10) : null);
  if (lead?.eventDate) return { date: iso(lead.eventDate), source: "lead" };
  if (c?.eventDate) return { date: iso(c.eventDate), source: "bot" };
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.kind === "note" || m.direction !== "inbound" || !m.bodyText) continue;
    const dates = findDatesInText(m.bodyText, today);
    if (dates.length) return { date: dates[0], source: "message" };
  }
  return null;
}

// The date shown on a list row (2026-10-07) — the same order as eventDateFor, but without
// the thread: the linked lead, what the bot collected, else a date in the last message
// preview. Inside the conversation eventDateFor also searches older messages.
// `msgDate` — the newest date found in the customer's messages (dateAvailability.js
// fetchMessageDates), the same search the thread does. Until it has loaded (undefined) the
// last message preview stands in; a file name never counts.
export function rowEventDate(c, lead, today = new Date(), msgDate = undefined) {
  const iso = (v) => (v ? String(v).slice(0, 10) : null);
  if (lead?.eventDate) return iso(lead.eventDate);
  if (c?.eventDate) return iso(c.eventDate);
  if (msgDate !== undefined) return msgDate;
  if (c?.lastMessagePreview && !/^\S+\.[A-Za-z0-9]{2,5}$/.test(c.lastMessagePreview.trim())) {
    const dates = findDatesInText(c.lastMessagePreview, today);
    if (dates.length) return dates[0];
  }
  return null;
}

const HEB_WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

// "יום שישי, 14.8.2026" for "2026-08-14" (the calendar date itself, no time-zone shift).
export function formatDateWithWeekday(isoDate) {
  const [y, m, d] = String(isoDate || "").slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "";
  return `יום ${HEB_WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${d}.${m}.${y}`;
}

// The open stages of a lead — someone still deciding (for "עוד לידים על התאריך").
export const OPEN_LEAD_STATUSES = ["חדש", "נשלחה הצעה", "פולו-אפ"];

// Builds the per-date answer from raw rows (pure; lib/dateAvailability.js fetches them).
// 2026-10-09 (the owner): "בתהליך סגירה" counted every signed lead whose event is already in
// the calendar — each couple twice. Now `closing` = signed leads with NO event yet, and
// `interested` = other leads still deciding on the same date (open CRM leads + lead/unknown
// chats whose date the bot collected), one entry per couple.
// → { "2026-11-26": { events: [{id, leadId, name, venue}], closing: [{id, name, venue}],
//                     interested: [{key, leadId, convId, name}] } }
// A chat linked to a CRM lead counts on the LEAD's date (the bot's date may be older), and
// the lead's entry carries that chat (convIdByLeadId) so it opens the conversation.
export function buildDateMap({ events = [], closing = [], leadIdsWithEvent = [], openLeads = [], convs = [], leadStatusById = {}, convIdByLeadId = {} }) {
  const out = {};
  const day = (v) => String(v || "").slice(0, 10);
  const at = (d) => (out[d] ||= { events: [], closing: [], interested: [] });
  const hasEvent = new Set([...leadIdsWithEvent, ...events.map((e) => e.source_lead_id).filter(Boolean)]);
  for (const e of events) at(day(e.date)).events.push({ id: e.id, leadId: e.source_lead_id || null, name: e.couple_names || "", venue: e.venue || "" });
  for (const l of closing) if (!hasEvent.has(l.id)) at(day(l.event_date)).closing.push({ id: l.id, name: l.couple_names || "", venue: l.venue_name || "" });
  const seen = {};
  const add = (d, item) => {
    const k = `${d}|${item.key}`;
    if (seen[k]) {
      seen[k].convId ||= item.convId;
      return;
    }
    seen[k] = item;
    at(d).interested.push(item);
  };
  for (const l of openLeads) add(day(l.event_date), { key: l.id, leadId: l.id, convId: convIdByLeadId[l.id] || null, name: l.couple_names || "" });
  for (const c of convs) {
    // Linked to a known lead → that lead's own date and status decide (above).
    if (c.matched_lead_id && leadStatusById[c.matched_lead_id]) continue;
    if (["closed_other", "opt_out"].includes(c.ai_tag)) continue;
    add(day(c.event_date), { key: c.matched_lead_id || `c:${c.id}`, leadId: c.matched_lead_id || null, convId: c.id, name: c.couple_names || c.display_name || "" });
  }
  return out;
}

// One date as seen from one conversation. The couple's own event is counted and marked
// (the owner, 2026-10-09: "3 events, theirs included"), but only OTHER couples make the
// date busy. → { total, others, ownEvent, otherEvents, closing, interested }
export function dateStatus(map, date, { ownLeadId = null, ownConvId = null } = {}) {
  const info = map?.[date] || { events: [], closing: [], interested: [] };
  const isOwnLead = (id) => !!ownLeadId && id === ownLeadId;
  const ownEvent = info.events.find((e) => isOwnLead(e.leadId)) || null;
  const otherEvents = info.events.filter((e) => !isOwnLead(e.leadId));
  return {
    total: info.events.length,
    others: otherEvents.length,
    ownEvent,
    otherEvents,
    closing: info.closing.filter((l) => !isOwnLead(l.id)),
    interested: info.interested.filter((i) => !isOwnLead(i.leadId) && !(ownConvId && i.convId === ownConvId)),
  };
}

// "Adi (עדי ואור)" (2026-10-07, the owner's request): the WhatsApp name, and in brackets the
// names the couple gave the bot — first names only, so "דניאל דיין וסבינה גויכמן" becomes
// "דניאל וסבינה". Short names (up to three words) are kept as written: a single name that
// starts with ו (ויקטוריה) must not be split.
export function shortCoupleNames(names) {
  const s = String(names || "").trim().replace(/\s+/g, " ");
  if (!s) return "";
  if (s.split(" ").length <= 3) return s;
  const parts = s.split(/\s*(?:&|,|\+)\s*|\s+ו(?=\S)/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return s;
  return parts.map((p) => p.split(" ")[0]).join(" ו");
}

export function chatTitle(c) {
  const wa = String(c?.displayName || "").trim();
  const names = shortCoupleNames(c?.coupleNames);
  const phone = c?.phone || String(c?.chatId || "").split("@")[0];
  if (wa && names && wa !== names && !wa.includes(names)) return `${wa} (${names})`;
  return wa || names || phone || "שיחה";
}
