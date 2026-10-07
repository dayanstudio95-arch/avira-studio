import { daysSince } from "@/components/whatsapp/whatsappInboxShared";

// Who is waiting for a follow-up nudge. Two ways in (2026-09-15):
//   - the bot sent the price list and nobody replied (state PRICELIST_SENT, no rated
//     reply, not yet nudged, and — if the studio set a threshold — enough silent days);
//   - the owner flagged the conversation by hand, e.g. after sending the price list
//     from his own phone where the bot never saw it. A flag newer than the last
//     follow-up counts; older ones were already acted on.
//
// Pure, tested in scripts/test-whatsapp-bot.mjs (PART 9). The inbox chip, the header
// counter and the send dialog all read this one function.
//
// "הסר מפולו-אפ" (2026-10-07): followupDismissedAt takes a conversation out — the bot path
// for good, a hand flag until the owner flags it again (a flag newer than the dismissal).
export function isManuallyFlagged(c) {
  if (!c?.followupFlaggedAt) return false;
  const flagged = new Date(c.followupFlaggedAt).getTime();
  const after = (iso) => !iso || flagged > new Date(iso).getTime();
  return after(c.followupSentAt) && after(c.followupDismissedAt);
}

export function isAwaitingFollowUp(c, afterDays = 0) {
  if (!c) return false;
  // AUTO-07: someone who asked to be removed is never offered for a follow-up.
  if (c.optedOutAt) return false;
  if (isManuallyFlagged(c)) return true;
  if (c.state !== "PRICELIST_SENT" || c.followupSentAt || c.followupDismissedAt || c.leadTemperature) return false;
  if (afterDays === 0) return true;
  // A row with no lastBotMessageAt can't be measured, so it stays in — fail open here
  // is harmless: nothing sends without a click.
  return (daysSince(c.lastBotMessageAt) ?? afterDays) >= afterDays;
}

// The date the wait is measured from: the price list for bot-driven rows, the flag
// for manual ones.
export function followUpReferenceDate(c) {
  if (!c) return null;
  if (isManuallyFlagged(c) && !c.lastBotMessageAt) return c.followupFlaggedAt;
  return c.lastBotMessageAt || c.followupFlaggedAt || null;
}

// How long to wait between two follow-up messages, by how many are going out in one go
// (the owner's tiered idea, 2026-10-07): a few messages go quickly, a big batch slowly —
// a burst from the studio's single number is what gets a WhatsApp number blocked.
// → [minMs, maxMs]
export function followUpPaceRange(count) {
  if (count <= 10) return [2000, 4000];
  if (count <= 20) return [4000, 7000];
  if (count <= 40) return [8000, 12000];
  return [15000, 25000];
}

// Rough total time for `count` messages, in seconds (the average pause, plus ~1s a send).
export function followUpEstimateSeconds(count) {
  if (count <= 1) return count;
  const [a, b] = followUpPaceRange(count);
  return Math.round((count - 1) * ((a + b) / 2 / 1000) + count);
}
