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

export const REASON_RANK = { hot: 0, silent_pricelist: 1, stale_lead: 2 };

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
