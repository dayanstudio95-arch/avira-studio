-- Fixes a critical cross-tenant / privilege-escalation gap found during the 2026-08-18
-- Settings-area audit: `profiles_self_update` (0001_init.sql) is `using (id = auth.uid())`
-- with no column-level restriction, so any authenticated user — any role, in any tenant —
-- can currently run:
--   supabase.from('profiles').update({ role: 'owner', tenant_id: '<other-tenant-uuid>' }).eq('id', auth.uid())
-- and both self-promote to owner AND hop into another tenant's data, since
-- `current_tenant_id()` (the basis of nearly every other RLS policy in the schema) is
-- read directly from this exact column.
--
-- Fix: reuse the exact trigger pattern already established and proven safe in
-- 0020_events_leads_financial_trigger.sql (`enforce_financial_column_admin_only`) — it
-- already does precisely what's needed here: block INSERT and any change to the listed
-- columns unless the caller is a current owner/admin/studio_manager, while transparently
-- allowing service-role/trusted-server contexts through via the `auth.uid() is null`
-- check (so invite-user/create-tenant's service-role profile inserts, and
-- update-tenant-user's service-role role/is_active updates, are all unaffected — verified
-- no frontend code path ever inserts into `profiles` directly; every insert goes through
-- those two service-role edge functions).
--
-- Columns guarded: `role` (the escalation vector), `tenant_id` (the cross-tenant vector),
-- `is_active` (prevents a user re-activating themselves after being disabled by an admin).
-- `full_name`/`phone` remain freely self-editable, unchanged.

drop trigger if exists enforce_profile_privileged_columns on profiles;

create trigger enforce_profile_privileged_columns
before insert or update on profiles
for each row execute function enforce_financial_column_admin_only(
  'role', 'tenant_id', 'is_active'
);
