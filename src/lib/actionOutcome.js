// E2 (BUG-03..07, audit 2026-10-05): screens must report what really happened.
// Several screens showed "בהצלחה" / "נשלחו N" when the action failed, was skipped, or
// partly failed — the worst kind of bug: the owner believes something was done. These pure
// helpers turn a server answer into an honest message + level (success / warning / error).
// Tested in scripts/test-whatsapp-bot.mjs (PART 27).

// { sent, failed, skipped } from automation-engine / approve-pending-automation.
export function sendSummary(r = {}) {
  const sent = Number(r.sent) || 0;
  const failed = Number(r.failed) || 0;
  const skipped = Number(r.skipped) || 0;
  const parts = [`נשלחו ${sent}`];
  if (skipped) parts.push(`דולגו ${skipped} (הסיבה ביומן האוטומציות)`);
  if (failed) parts.push(`נכשלו ${failed}`);
  const level = failed && !sent ? "error" : failed || (skipped && !sent) ? "warning" : "success";
  return { text: parts.join(" · "), level };
}

// Answer of sync-event-to-calendar: { success, results: [{ accountRole, status, error }] }.
// HTTP 200 with success:false means every connected account failed or was skipped.
export function calendarSyncOutcome(data) {
  if (data?.success) return { ok: true, text: "האירוע סונכרן ליומן" };
  const r = (data?.results || []).find((x) => x.status !== "success") || {};
  if (r.status === "skipped") return { ok: false, text: "הסנכרון ליומן כבר בתהליך — נסה שוב בעוד דקה" };
  return { ok: false, text: `הסנכרון ליומן נכשל${r.error ? `: ${String(r.error).slice(0, 120)}` : ""}` };
}

// Answer of sync-lead-to-event: { success, eventId } or { skipped: '...' }.
export function leadSyncOutcome(data) {
  if (data?.success) return { ok: true };
  if (data?.skipped) return { ok: false, text: "הליד לא סונכרן לאירוע (הסטטוס לא 'נסגר/חתימה')" };
  return { ok: false, text: `הסנכרון לאירוע נכשל${data?.error ? `: ${data.error}` : ""}` };
}

// Promise.allSettled results of several invocations → how many really succeeded.
export function settledCounts(results, isOk = (v) => !v?.data?.error) {
  let ok = 0;
  let failed = 0;
  for (const r of results) {
    if (r.status === "fulfilled" && isOk(r.value)) ok++;
    else failed++;
  }
  return { ok, failed };
}
