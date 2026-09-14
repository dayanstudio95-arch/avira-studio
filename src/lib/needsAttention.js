import { daysSince } from "@/components/whatsapp/whatsappInboxShared";

// "Who do I chase today" — the merge behind the dashboard's צריך טיפול card.
//
// Kept here rather than in the component so it can be tested without React: every way
// this can be wrong is in the merge itself, not in the rendering. See
// scripts/test-whatsapp-bot.mjs, PART 6.
//
// Until now the question was split across three places that don't talk to each other:
// the WhatsApp follow-up queue (conversations at PRICELIST_SENT), the CRM's `פולו-אפ`
// status, and the Leads page's "dormant" view. A couple who got a price list over
// WhatsApp, became a lead, and never received a contract fell between all three — past
// the WhatsApp flow, not yet in the contract flow, and not dormant by the CRM's clock.
//
// Merging them is the point. A lead appears exactly once, under the most urgent reason
// that applies, so this is a work queue rather than three lists to reconcile.

// 7 days because Daniel said so: asked when a silent lead counts as lost, he answered
// "after a week". The rest of the app hardcodes 48 hours in three places (Leads.jsx
// DORMANT_HOURS, its no_contact_48h filter, sync-lead-followups' FOLLOW_UP_HOURS) —
// that clock governs the contract-signature chase, which is a different and faster
// question, so it is deliberately left alone rather than unified into a single number
// that would be wrong for both.
export const STALE_DAYS = 7;

// Terminal statuses. Chasing a signed couple or one who already said no is noise, and
// noise is what makes a queue get ignored.
export const CLOSED_STATUSES = ["נסגר/חתימה", "חוזה", "לא רלוונטי"];

export const REASON_RANK = {
  hot: 0,
  media_from_stranger: 1,
  silent_pricelist: 2,
  stalled_flow: 3,
  stale_lead: 4,
};

// Two more reasons since 2026-09-15, both found by reading the code rather than by a
// complaint — which is the point of putting them here, where they get seen.
//
// A stranger whose first message the bot could not read (voice note, photo): the gate
// says not_text and the conversation sits at NEW, in no queue at all. The bot must not
// guess at a voice note; a human should listen to it.
export function isMediaFromStranger(c) {
  if (!c || c.contactType !== "unknown" || c.state !== "NEW") return false;
  if (c.botLastDecision !== "not_text" || c.botEnabled === false) return false;
  const days = daysSince(c.lastInboundAt);
  return days !== null && days <= 7;
}

// Mid-flow and silent: the bot asked for details, a day passed, no answer. Mirrors
// isStalledInFlow in supabase/functions/_shared/whatsappHousekeeping.ts, which sends
// the one-time nudge; this is the human-side view of the same population.
export function isStalledFlow(c) {
  if (!c || !["AWAITING_DETAILS", "PARTIAL_DETAILS"].includes(c.state)) return false;
  if (c.botEnabled === false || !c.lastBotMessageAt) return false;
  const days = daysSince(c.lastBotMessageAt);
  if (days === null || days < 1) return false;
  if (!c.lastInboundAt) return true;
  return new Date(c.lastInboundAt).getTime() < new Date(c.lastBotMessageAt).getTime();
}

export function buildAttentionList(conversations, leads) {
  const rows = [];
  // Phones already represented from the WhatsApp side, so a lead created from a
  // conversation doesn't appear twice under two different reasons.
  const seenPhones = new Set();

  for (const c of conversations || []) {
    if (c.leadTemperature === "hot") {
      rows.push({
        key: `c-${c.id}`,
        reason: "hot",
        target: "/WhatsAppInbox",
        name: c.coupleNames || c.displayName || c.phone,
        detail: c.leadTemperatureReason || "",
        days: daysSince(c.leadTemperatureAt),
      });
      if (c.phone) seenPhones.add(c.phone);
    } else if (isMediaFromStranger(c)) {
      rows.push({
        key: `c-${c.id}`,
        reason: "media_from_stranger",
        target: "/WhatsAppInbox",
        name: c.displayName || c.phone,
        detail: "שלחו הודעה קולית או תמונה — הבוט לא יכול לקרוא",
        days: daysSince(c.lastInboundAt),
      });
      if (c.phone) seenPhones.add(c.phone);
    } else if (isStalledFlow(c)) {
      rows.push({
        key: `c-${c.id}`,
        reason: "stalled_flow",
        target: "/WhatsAppInbox",
        name: c.coupleNames || c.displayName || c.phone,
        detail: c.nudgeSentAt ? "נשלחה תזכורת, עדיין שקט" : "התחילו ולא סיימו למסור פרטים",
        days: daysSince(c.lastBotMessageAt),
      });
      if (c.phone) seenPhones.add(c.phone);
    } else if (c.state === "PRICELIST_SENT" && !c.followupSentAt) {
      const days = daysSince(c.lastBotMessageAt);
      if (days !== null && days >= STALE_DAYS) {
        rows.push({
          key: `c-${c.id}`,
          reason: "silent_pricelist",
          target: "/WhatsAppInbox",
          name: c.coupleNames || c.displayName || c.phone,
          detail: c.venue || "",
          days,
        });
        if (c.phone) seenPhones.add(c.phone);
      }
    }
  }

  for (const l of leads || []) {
    if (CLOSED_STATUSES.includes(l.status)) continue;
    if (l.phoneNumber && seenPhones.has(l.phoneNumber)) continue;
    // lastContactDate is the CRM's own recency signal; falling back to updatedDate keeps
    // a lead nobody has ever logged contact on from being invisible here.
    const days = daysSince(l.lastContactDate || l.updatedDate || l.createdDate);
    if (days !== null && days >= STALE_DAYS) {
      rows.push({
        key: `l-${l.id}`,
        reason: "stale_lead",
        target: "/Leads",
        name: l.coupleNames,
        detail: l.status || "",
        days,
      });
    }
  }

  // Hot first, then longest-ignored — the two things that actually decide who to call
  // next.
  rows.sort((a, b) => REASON_RANK[a.reason] - REASON_RANK[b.reason] || (b.days ?? 0) - (a.days ?? 0));
  return rows;
}
