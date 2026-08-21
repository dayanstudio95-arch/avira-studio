// Small, dependency-free retry-with-backoff wrapper around `fetch`, shared by
// every outbound integration call (Google Calendar, Green API WhatsApp) that
// previously did a single fetch with no retry at all -- a transient 429/5xx
// or a dropped connection was treated identically to a permanent failure.
//
// Bounded at 3 attempts / ~1.2s max added latency total, safely inside the
// ~2s CPU budget documented in CLAUDE.md for Supabase Edge Functions.
//
// Deliberately conservative about *what* gets retried: only 429 and 5xx HTTP
// responses, or a network-level throw, are retryable. Any other status
// (400/401/403/404/410/...) is returned to the caller immediately and
// unmodified on the very first attempt -- callers that inspect specific
// status codes (e.g. googleCalendarSync.ts's 404/410-clears-id self-heal
// logic) keep working with zero changes.
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts?: { maxAttempts?: number },
): Promise<Response> {
  const maxAttempts = opts?.maxAttempts ?? 3;
  const delaysMs = [300, 900]; // between attempt 1→2 and 2→3 respectively
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, init);
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === maxAttempts) return res;
      await new Promise((r) => setTimeout(r, delaysMs[attempt - 1]));
    } catch (err) {
      lastErr = err; // network-level throw -- always retryable
      if (attempt === maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, delaysMs[attempt - 1]));
    }
  }

  // Unreachable in practice (the loop above always returns or throws on the
  // final attempt), but keeps TypeScript's control-flow analysis happy.
  throw lastErr;
}
