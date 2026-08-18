// Lightweight, DB-backed rate limiter for the fully public, unauthenticated Edge
// Functions (get-lead-public, save-signed-contract, sign-lead-public,
// submit-production-questionnaire). Those 4 endpoints have no login at all -- a couple
// just clicking their own contract/questionnaire link -- and rely entirely on an
// unguessable leadId UUID as their security boundary (see supabaseClients.ts's
// createServiceRoleClient doc comment). Today nothing stops a script from hammering
// them thousands of times a second, either to brute-force/enumerate leadIds or just to
// run up Supabase usage. See migration 0023_rate_limiting.sql for the backing table.
//
// Bucketed per (endpoint name + caller IP), NOT per leadId -- a per-leadId bucket would
// only stop someone spamming ONE couple's own link, not someone scanning many different
// leadIds, which is the more realistic risk given leadId is the actual secret here.
import { createServiceRoleClient } from './supabaseClients.ts';

function getClientIp(req: Request): string {
  // Supabase's edge runtime (like most platforms behind a proxy) passes the real
  // client IP via x-forwarded-for (first entry in the list); cf-connecting-ip is a
  // fallback for the Cloudflare-fronted case. Falls back to a constant so requests
  // without either header still land in one shared bucket rather than bypassing the
  // limiter entirely.
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  const cf = req.headers.get('cf-connecting-ip');
  if (cf) return cf.trim();
  return 'unknown';
}

export type RateLimitResult = { allowed: boolean; retryAfterSeconds?: number };

// Core bucket check/record, keyed by an arbitrary caller-supplied bucketKey — used
// directly by authenticated, per-user callers (e.g. ai-assistant, bucketed by
// `ai-assistant:${user.id}` instead of by IP, since office staff can share an IP).
// checkRateLimit() below is a thin per-IP wrapper over this for the original public,
// unauthenticated call sites — same table, same fail-open behavior either way.
export async function checkRateLimitForKey(
  bucketKey: string,
  { maxHits = 30, windowSeconds = 600 }: { maxHits?: number; windowSeconds?: number } = {}
): Promise<RateLimitResult> {
  const windowStartIso = new Date(Date.now() - windowSeconds * 1000).toISOString();

  try {
    const supabase = createServiceRoleClient();

    const { count, error: countError } = await supabase
      .from('rate_limit_hits')
      .select('id', { count: 'exact', head: true })
      .eq('bucket_key', bucketKey)
      .gte('created_at', windowStartIso);

    if (countError) {
      // Fail OPEN: a hiccup reading the rate-limit table must never block a real
      // couple from signing their contract. Logged so it's visible in function logs
      // rather than silently degrading protection forever.
      console.error(`[rateLimit:${bucketKey}] count failed, allowing request:`, countError.message);
      return { allowed: true };
    }

    if ((count ?? 0) >= maxHits) {
      console.warn(`[rateLimit:${bucketKey}] blocked count=${count}`);
      return { allowed: false, retryAfterSeconds: windowSeconds };
    }

    // Record this hit. Best-effort — an insert failure shouldn't block the request
    // that's already been allowed through the count check above.
    const { error: insertError } = await supabase.from('rate_limit_hits').insert({ bucket_key: bucketKey });
    if (insertError) {
      console.error(`[rateLimit:${bucketKey}] failed to record hit:`, insertError.message);
    }

    // Opportunistic cleanup of this bucket's stale rows (best-effort, ~5% of calls) so
    // the table doesn't grow unbounded without needing a separate cron job. Cheap: it's
    // an indexed delete scoped to one bucket_key.
    if (Math.random() < 0.05) {
      supabase
        .from('rate_limit_hits')
        .delete()
        .eq('bucket_key', bucketKey)
        .lt('created_at', windowStartIso)
        .then(({ error }) => {
          if (error) console.error(`[rateLimit:${bucketKey}] cleanup failed:`, error.message);
        });
    }

    return { allowed: true };
  } catch (e) {
    console.error(`[rateLimit:${bucketKey}] unexpected error, allowing request:`, e?.message || e);
    return { allowed: true };
  }
}

// maxHits/windowSeconds defaults: generous enough that a real couple retrying a failed
// submit a few times, or reloading the page repeatedly, never gets blocked (confirmed
// against the existing step-tracked retry flow in ContractPage.jsx's handleSign), but
// tight enough to stop a scripted hammering/enumeration attempt.
export async function checkRateLimit(
  req: Request,
  endpointName: string,
  opts: { maxHits?: number; windowSeconds?: number } = {}
): Promise<RateLimitResult> {
  return checkRateLimitForKey(`${endpointName}:${getClientIp(req)}`, opts);
}
