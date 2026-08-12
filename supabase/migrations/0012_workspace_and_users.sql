-- Adds real backing for two new Settings tabs:
--   1. "סביבת עבודה" (Workspace) — studio name / timezone / currency, stored on `tenants`.
--   2. "משתמשים" (Users) — invite/list/activate teammates, stored on `profiles`.
--
-- tenants currently has zero RLS policies at all (see 0001_init.sql) — any authenticated
-- user of ANY tenant can read/write ANY tenant's row today, because RLS was never enabled
-- on this table. We close that gap here now that the frontend will actually read/write it.

alter table tenants
  add column if not exists timezone text not null default 'Asia/Jerusalem',
  add column if not exists currency text not null default 'ILS';

alter table tenants enable row level security;

create policy tenants_select on tenants
  for select using (id = current_tenant_id());

-- Only owner/admin may rename the studio or change timezone/currency.
create policy tenants_update_by_admin on tenants
  for update using (
    id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin'))
  )
  with check (id = current_tenant_id());

-- Users tab: teammates need to see each other (name/role/status) to populate the list.
-- This mirrors the coarse tenant-wide access every other table already grants (see the
-- `_tenant_isolation` policies in 0001_init.sql) — profiles holds no secrets (no password,
-- no auth tokens), just name/role/phone/active-flag.
alter table profiles
  add column if not exists is_active boolean not null default true;

create policy profiles_tenant_select on profiles
  for select using (tenant_id = current_tenant_id());

-- Role/active-status changes and new-user creation are intentionally NOT opened up via RLS
-- here — they go through the invite-user / update-tenant-user Edge Functions, which run
-- with the service role and explicitly check the caller is owner/admin before writing.
