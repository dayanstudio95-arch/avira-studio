-- Step 4 of the 2026-08-17 security audit's remediation plan (CRITICAL finding #1):
-- tenant secrets (WhatsApp/Green API token, Morning API key+secret pairs for both
-- business entities) lived in `app_settings` — a generic key/value table whose RLS
-- policy (0001_init.sql, tightened for writes only by 0018) is tenant-only, with no
-- role check. Because RLS is row-level, not column-level, any authenticated member of
-- the tenant — including photographer/editor/album_manager — could SELECT these raw
-- credential values directly (`supabase.from('app_settings').select('*')`), even
-- though the frontend never does this itself. This migration closes that gap by
-- moving the 5 actual secret values into a dedicated table with ADMIN_ROLES-only RLS
-- covering SELECT too (unlike 0018's tables, secrets must not be openly readable).
--
-- Non-secret integration config (whatsapp_gateway_url, whatsapp_instance_id — a URL
-- and an identifier, not credentials) stays in app_settings; only the 5 true secrets
-- move: whatsapp_api_key, morning_api_key_sole_prop, morning_api_secret_sole_prop,
-- morning_api_key_company, morning_api_secret_company.
--
-- Also tightens google_calendar_accounts (0016_google_calendar_accounts.sql), whose
-- access_token/refresh_token columns are the same class of secret but live in a
-- structured table with several non-secret UI-facing columns (google_email,
-- calendar_id, status, last_error, last_synced_at) that GoogleCalendarSync.jsx /
-- GoogleCalendarAccountCard.jsx read/write directly as entity calls — rather than
-- migrating that data into tenant_secrets (a structural mismatch), its own existing
-- tenant-only policy is replaced with an ADMIN_ROLES-gated one directly.
--
-- Verified safe against current legitimate usage: every backend reader of these 5
-- app_settings keys (_shared/whatsapp.ts's loadWhatsAppSettings, whatsapp-manager,
-- generate-morning-invoice, check-morning-connection, get-latest-morning-document-date)
-- uses createUserClient(req) — i.e. runs RLS-scoped as the calling user — and every
-- one of those functions is only ever invoked from the already admin-gated frontend
-- (src/App.jsx's hard block prevents any non-admin-equivalent role from reaching any
-- page that calls them). google_calendar_accounts is likewise only ever read/written
-- directly by GoogleCalendarSync.jsx / GoogleCalendarAccountCard.jsx, both admin-only
-- pages. Server-to-server callers (automation-engine, calendar-sync-webhook, and every
-- public/unauthenticated endpoint) all use createServiceRoleClient(), which bypasses
-- RLS entirely and is unaffected by either change in this migration.

create table tenant_secrets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  key text not null,
  value text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, key)
);

alter table tenant_secrets enable row level security;

-- Single policy covering select/insert/update/delete alike — unlike 0018's tables,
-- secrets must not be openly readable by every tenant member.
create policy tenant_secrets_admin_only on tenant_secrets
  for all
  using (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
  )
  with check (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
  );

-- 0002_grants.sql / 0008_service_role_grants.sql granted privileges on "all tables in
-- schema public" as one-time snapshots (not `alter default privileges`) — this new
-- table needs its own explicit grants, same reasoning as 0016.
grant select, insert, update, delete on tenant_secrets to authenticated;
grant select, insert, update, delete on tenant_secrets to service_role;

create trigger set_updated_at before update on tenant_secrets
  for each row execute function set_updated_at();

-- Migrate the 5 existing secret rows out of app_settings.
insert into tenant_secrets (tenant_id, key, value, created_at, updated_at)
select tenant_id, key, value, created_at, updated_at
from app_settings
where key in (
  'whatsapp_api_key',
  'morning_api_key_sole_prop',
  'morning_api_secret_sole_prop',
  'morning_api_key_company',
  'morning_api_secret_company'
)
on conflict (tenant_id, key) do update set value = excluded.value, updated_at = excluded.updated_at;

delete from app_settings
where key in (
  'whatsapp_api_key',
  'morning_api_key_sole_prop',
  'morning_api_secret_sole_prop',
  'morning_api_key_company',
  'morning_api_secret_company'
);

-- Tighten google_calendar_accounts: replace the tenant-only policy with an
-- ADMIN_ROLES-gated one (same pattern as tenant_secrets above).
drop policy if exists google_calendar_accounts_tenant_isolation on google_calendar_accounts;

create policy google_calendar_accounts_admin_only on google_calendar_accounts
  for all
  using (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
  )
  with check (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
  );
