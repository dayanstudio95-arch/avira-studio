-- Backing store for a lightweight rate limiter on the 4 fully public, unauthenticated
-- Edge Functions (get-lead-public, save-signed-contract, sign-lead-public,
-- submit-production-questionnaire) -- see supabase/functions/_shared/rateLimit.ts.
-- These endpoints have no login at all (a couple clicking their contract/questionnaire
-- link) and rely on an unguessable leadId UUID as their only security boundary; today
-- there is no limit at all on how many times they can be called per IP, per second.
--
-- Edge Functions are stateless across invocations (isolates aren't guaranteed to stick
-- around, and there's no shared in-memory store you can trust), so this uses Postgres --
-- already the source of truth for everything else in this codebase -- instead of
-- reaching for external infra (Redis/Upstash) the project doesn't have set up.
create table rate_limit_hits (
  id bigserial primary key,
  bucket_key text not null,
  created_at timestamptz not null default now()
);

-- Every check does a "count hits in bucket since window start" query, so this is the
-- one index that matters; a plain btree on (bucket_key, created_at) covers it.
create index rate_limit_hits_bucket_created_idx on rate_limit_hits (bucket_key, created_at);

alter table rate_limit_hits enable row level security;
-- No policies created: this table is read/written exclusively by the service-role
-- client inside _shared/rateLimit.ts (service_role bypasses RLS by design in
-- Supabase), and — unlike every tenant-scoped table elsewhere in this schema — it is
-- deliberately NOT granted to `authenticated`/`anon` at all, so no logged-in tenant
-- member and no public caller can read or tamper with rate-limit bookkeeping directly.
grant select, insert, delete on rate_limit_hits to service_role;
