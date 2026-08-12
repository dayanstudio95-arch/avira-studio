-- RLS policies alone don't grant API access — Postgres still requires an explicit
-- GRANT before PostgREST (the anon/authenticated roles) can touch a table at all.
-- Without this, every request fails with "permission denied for table X" (42501)
-- before RLS even gets evaluated.

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- anon gets nothing directly: public pages (contract signing, questionnaire) go
-- through SECURITY DEFINER RPC functions instead (see bottom of 0001_init.sql).
