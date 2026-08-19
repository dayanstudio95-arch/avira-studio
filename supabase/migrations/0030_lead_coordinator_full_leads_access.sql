-- Expands the `lead_coordinator` role (introduced in 0029_scoped_roles.sql as a narrow
-- "create leads + share contract link, own-created-leads-only" role, routed through the
-- dedicated coordinator-leads edge function and a custom src/pages/LeadsCoordinator.jsx
-- page) per a follow-up product decision: lead_coordinator now gets the SAME full
-- src/pages/Leads.jsx page the admin roles use — sees every lead in the tenant
-- (including financial fields: final price, discount, payment status), can create and
-- edit leads — but must NEVER be able to delete a lead. The coordinator-leads edge
-- function and LeadsCoordinator.jsx page are left in place, unused, rather than deleted
-- in this pass.
--
-- Two changes to the `leads` table's RLS policies from 0029:
--
-- 1. leads_select: previously only owner/admin/studio_manager saw every tenant lead;
--    every other role (including lead_coordinator) was restricted to
--    `created_by_profile_id = auth.uid()`. Now lead_coordinator is added to the
--    full-visibility role list.
--
-- 2. leads_delete: previously had ZERO role restriction at all (any authenticated
--    tenant member, of any role, could delete any lead) -- purely an oversight carried
--    over unchanged from the original 0001_init.sql tenant-only policy loop. Now
--    explicitly restricted to owner/admin/studio_manager, which is what actually
--    enforces "lead_coordinator can never delete a lead" -- the UI hides the delete
--    buttons for this role too (src/pages/Leads.jsx), but per this migration series'
--    established philosophy (see 0018-0020, 0027, 0028), RLS is the layer that actually
--    enforces it, not UI-hiding alone.
--
-- leads_insert / leads_update are left unchanged (already unrestricted by role, which is
-- what lead_coordinator needs in order to create and edit leads with zero extra plumbing).

drop policy if exists leads_select on leads;
create policy leads_select on leads
for select using (
  tenant_id = current_tenant_id()
  and (
    exists (
      select 1 from profiles
      where id = auth.uid()
        and role in ('owner', 'admin', 'studio_manager', 'lead_coordinator')
    )
    or created_by_profile_id = auth.uid()
  )
);

drop policy if exists leads_delete on leads;
create policy leads_delete on leads
for delete using (
  tenant_id = current_tenant_id()
  and exists (
    select 1 from profiles
    where id = auth.uid()
      and role in ('owner', 'admin', 'studio_manager')
  )
);
