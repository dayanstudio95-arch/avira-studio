-- Step 3 of the 2026-08-17 security audit's remediation plan: role-gate writes on the
-- lowest-blast-radius tables. Per that audit's finding #4/#6, every one of these tables
-- (plus staff_members / packages / discount_presets, finding #3) previously had ZERO
-- role awareness at the RLS layer — the blanket `<table>_tenant_isolation` policy from
-- 0001_init.sql ("for all using (tenant_id = current_tenant_id())") let ANY authenticated
-- member of a tenant (including photographer/editor/album_manager) insert/update/delete
-- rows here, not just owner/admin/studio_manager. The frontend already hides these
-- actions behind role checks (App.jsx's admin-panel gate currently blocks
-- photographer/editor/album_manager from the app entirely, and Settings-tab UI is
-- role-gated on top of that), but RLS — not UI — is the actual security boundary, and
-- until now it did not distinguish roles for these tables.
--
-- Fix: split each table's single "for all" policy into two permissive policies —
--   1. `<table>_select`      — for select, unchanged (any tenant member may still read).
--   2. `<table>_write_by_admin` — for all (in practice only reachable for
--      insert/update/delete, since the _select policy already covers select and
--      permissive policies OR together), gated to owner/admin/studio_manager via the
--      same EXISTS-subquery pattern already live on `tenants_update_by_admin`
--      (0012_workspace_and_users.sql).
--
-- Verified safe against current legitimate usage: every frontend write call site for
-- these 9 tables lives in Settings tabs / AutomationsDashboard / PendingApprovals, all
-- of which are already unreachable by non-admin-equivalent roles today (App.jsx's own
-- hard block only lets owner/admin/studio_manager into the app UI at all — see
-- src/App.jsx). Every legitimate backend write (automation-engine, cron jobs) runs via
-- createServiceRoleClient(), which bypasses RLS entirely and is unaffected by this
-- migration.
--
-- app_settings still holds some tenant secrets (WhatsApp/Morning API keys) at this
-- point — this migration does NOT restrict SELECT on it (that's Step 4: moving secrets
-- into a dedicated, more tightly-scoped table). This migration only closes the write
-- side for now.

do $$
declare
  t text;
begin
  for t in
    select unnest(array['packages','discount_presets','staff_members','app_settings',
                         'automations','automation_runs','automation_message_logs',
                         'event_automations','pending_automations'])
  loop
    execute format('drop policy if exists %I_tenant_isolation on %I;', t, t);

    execute format(
      'create policy %I_select on %I for select using (tenant_id = current_tenant_id());',
      t, t
    );

    execute format(
      'create policy %I_write_by_admin on %I for all ' ||
      'using (tenant_id = current_tenant_id() and exists (select 1 from profiles where id = auth.uid() and role in (''owner'',''admin'',''studio_manager''))) ' ||
      'with check (tenant_id = current_tenant_id() and exists (select 1 from profiles where id = auth.uid() and role in (''owner'',''admin'',''studio_manager'')));',
      t, t
    );
  end loop;
end $$;

-- Also bring the pre-existing tenants_update_by_admin policy (0012) in line with the
-- studio_manager-is-admin-equivalent product decision (2026-08-17 security audit,
-- question 1) — it previously only allowed owner/admin, inconsistent with every other
-- admin gate in the app (App.jsx's panel gate already includes studio_manager).
drop policy if exists tenants_update_by_admin on tenants;

create policy tenants_update_by_admin on tenants
  for update using (
    id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
  )
  with check (id = current_tenant_id());
