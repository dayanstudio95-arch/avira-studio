-- The service-role Edge Function client (createServiceRoleClient() in
-- supabase/functions/_shared/supabaseClients.ts) is used by every public/unauthenticated
-- endpoint (get-lead-public, save-signed-contract, sign-lead-public,
-- submit-production-questionnaire) and by the automation-engine cron job. It's meant to
-- bypass RLS entirely, but Postgres still requires an explicit GRANT before any query
-- succeeds — without this, every service-role query fails with "permission denied for
-- table X" (42501) before RLS is even evaluated. This is exactly what was happening:
-- the public questionnaire link showed a generic "invalid link" screen because
-- get-lead-public's service-role lookup was silently failing with this error.
--
-- Same reasoning as migration 0002_grants.sql, which granted to `authenticated` but
-- missed `service_role`.

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
