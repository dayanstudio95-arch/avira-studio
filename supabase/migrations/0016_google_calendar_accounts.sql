-- =========================================================
-- Real Google Calendar OAuth: two independently-connected accounts per
-- tenant (primary + backup), with per-event-per-account sync tracking.
--
-- Replaces the old fake flow where a Google access token was manually
-- pasted into app_settings.google_calendar_access_token (dead — access
-- tokens expire hourly and nothing refreshed it). See
-- supabase/functions/_shared/googleCalendarAuth.ts (OAuth + token refresh)
-- and supabase/functions/_shared/googleCalendarSync.ts (push/delete logic).
--
-- The legacy events.google_calendar_event_id / calendar_sync_status /
-- calendar_sync_error columns (0001_init.sql) are LEFT AS-IS and keep
-- mirroring the PRIMARY account only, so daily-event-brief,
-- send-staff-invite and submit-production-questionnaire (which read those
-- columns directly) keep working unmodified. The backup account's sync
-- state lives entirely in the new event_calendar_syncs table below.
--
-- IMPORTANT: 0002_grants.sql / 0008_service_role_grants.sql granted
-- privileges on "all tables in schema public" as one-time snapshots (not
-- `alter default privileges`) — brand new tables are NOT covered
-- automatically. This migration includes its own explicit grants; without
-- them every query against these two tables fails with 42501 "permission
-- denied" regardless of RLS (same failure mode 0008 itself documents).
-- =========================================================

create table google_calendar_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  account_role text not null check (account_role in ('primary', 'backup')),
  google_email text,
  calendar_id text not null default 'primary',
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  scope text,
  status text not null default 'disconnected'
    check (status in ('disconnected', 'connected', 'error', 'needs_reauth')),
  last_error text,
  last_synced_at timestamptz,
  connected_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, account_role)
);

create table event_calendar_syncs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  account_id uuid not null references google_calendar_accounts(id) on delete cascade,
  account_role text not null check (account_role in ('primary', 'backup')),
  google_event_id text,
  status text not null default 'pending'
    check (status in ('pending', 'success', 'failed', 'deleted')),
  last_error text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, account_id)
);

create index event_calendar_syncs_event_id_idx on event_calendar_syncs(event_id);
create index event_calendar_syncs_status_idx on event_calendar_syncs(tenant_id, status);
create index google_calendar_accounts_tenant_role_idx on google_calendar_accounts(tenant_id, account_role);

alter table google_calendar_accounts enable row level security;
alter table event_calendar_syncs enable row level security;

create policy google_calendar_accounts_tenant_isolation on google_calendar_accounts
  for all
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create policy event_calendar_syncs_tenant_isolation on event_calendar_syncs
  for all
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert, update, delete on google_calendar_accounts, event_calendar_syncs to authenticated;
grant select, insert, update, delete on google_calendar_accounts, event_calendar_syncs to service_role;

-- Enable pg_cron/pg_net so the reconciliation safety-net job
-- (reconcile-calendar-sync Edge Function) can be scheduled to run
-- periodically. The actual `select cron.schedule(...)` call needs a real
-- service-role key pasted in, so it is NOT committed here — see
-- DEPLOYMENT.md for the one-time copy-pasteable snippet to run via the
-- SQL Editor.
create extension if not exists pg_cron;
create extension if not exists pg_net;
