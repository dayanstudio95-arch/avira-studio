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
export function isManuallyFlagged(c) {
  if (!c?.followupFlaggedAt) return false;
  if (!c.followupSentAt) return true;
  return new Date(c.followupFlaggedAt).getTime() > new Date(c.followupSentAt).getTime();
}

export function isAwaitingFollowUp(c, afterDays = 0) {
  if (!c) return false;
  if (isManuallyFlagged(c)) return true;
  if (c.state !== "PRICELIST_SENT" || c.followupSentAt || c.leadTemperature) return false;
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
