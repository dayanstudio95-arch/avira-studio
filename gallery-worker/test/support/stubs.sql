-- Minimal stand-ins for what Supabase provides, so the migrations can run.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  last_sign_in_at timestamptz,
  -- Supabase sets it when the email is confirmed (fix plan P12). The stand-in's users are confirmed unless a test
  -- (or the demo's signup) inserts null, like signup-tenant's unconfirmed owner.
  email_confirmed_at timestamptz default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.role', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')), '')::text
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now());
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, metadata jsonb, created_at timestamptz default now());
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1]
$$;
grant usage on schema storage to anon, authenticated, service_role;
-- As Supabase grants them (fix plan P14): every role may touch the tables, the RLS policies decide the rows.
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;

create schema net;
create table net.calls (id bigserial primary key, url text, headers jsonb, body jsonb, at timestamptz default now());
create function net.http_post(url text, headers jsonb default '{}'::jsonb, body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb, timeout_milliseconds int default 5000) returns bigint
language plpgsql security definer as $$
declare i bigint; begin insert into net.calls(url, headers, body) values (url, headers, body) returning id into i; return i; end $$;
grant usage on schema net to anon, authenticated, service_role;

create schema cron;
create function cron.schedule(a text, b text, c text) returns bigint language sql as $$ select 1::bigint $$;
create function cron.unschedule(a text) returns boolean language sql as $$ select true $$;

-- pg_net keeps responses for a few hours in net._http_response (id = the request id http_post returned).
create table net._http_response (id bigint primary key, status_code integer, content text, timed_out boolean default false, error_msg text, created timestamptz default now());

-- As the production project does (seen 2026-10-02, readonly check grants-on-sensitive-tables): every new
-- public table, sequence and function is granted to anon / authenticated / service_role, and RLS decides
-- the rows. So a migration that wants "only these columns" must revoke the table-level grant first.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- Supabase Realtime's publication (empty on a new project); the inbox's tables join it in 0168 (work order item 8).
create publication supabase_realtime;
