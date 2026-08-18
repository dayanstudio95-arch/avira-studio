-- Closes the last open item from the 2026-08-17 security audit's "MEDIUM" findings
-- (finding #3 in the deep security audit): 0018_admin_role_gated_writes.sql already
-- role-gated INSERT/UPDATE/DELETE on staff_members to owner/admin/studio_manager, but
-- deliberately left staff_members_select tenant-wide ("SELECT can plausibly stay open
-- if staff are expected to see their own rate... needs a product decision"). Re-checked
-- the schema: staff_members has no linkage at all to profiles/auth.users (it's a plain
-- name-keyed roster, not accounts — confirmed via 0001_init.sql's table definition), so
-- there is no way for a staff member to see only "their own" rate — any SELECT access
-- necessarily exposes every colleague's default_rate/rates_by_role. Also confirmed
-- App.jsx's admin-panel gate already blocks every non-owner/admin/studio_manager role
-- from reaching any UI that would call this table, so this closes a real RLS gap with
-- zero impact on any currently-reachable frontend flow.
--
-- Fix: same split-select/write pattern as 0018, but now role-gating SELECT too.
--
-- Trade-off, noted for future reference: ai-assistant/index.ts's get_staff_schedule /
-- send_whatsapp_message tools read staff_members via the caller's own user-scoped
-- client (RLS-enforced, not service-role) to resolve name/phone_number/role — none of
-- the sensitive rate columns. Today this is moot (App.jsx blocks every non-admin role
-- from reaching any UI, including the AI assistant, and no non-admin profiles exist in
-- production). If a non-admin role is ever given app access in the future, those two AI
-- tools would then also lose staff-lookup capability under this policy (RLS has no
-- per-column granularity) — the correct follow-up at that point would be a narrow
-- SECURITY DEFINER function exposing only name/phone_number/role, not reopening SELECT
-- on the whole table.

drop policy if exists staff_members_select on staff_members;

create policy staff_members_select on staff_members
  for select using (
    tenant_id = current_tenant_id()
    and exists (
      select 1 from profiles
      where id = auth.uid() and role in ('owner', 'admin', 'studio_manager')
    )
  );

-- staff_members_write_by_admin (from 0018) is untouched — already correctly role-gated.
