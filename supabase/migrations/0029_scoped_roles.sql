-- Adds/activates two narrow, non-admin roles, per explicit product decision (2026-08-20):
--   - lead_coordinator ("רכז לידים"): a NEW role that can only create leads and share the
--     contract link with a couple — everything else in the admin panel stays fully
--     blocked, same as today's photographer/editor/album_manager.
--   - photographer: for the first time ever gets a real, working login into the app
--     (previously 100% blocked by App.jsx's admin-only gate) — but strictly READ-ONLY,
--     scoped to only the events they're personally assigned to as crew, and explicitly
--     WITHOUT any financial/pricing field (per user's confirmed choice).
--
-- Both roles reach the app ONLY through two new, dedicated edge functions
-- (coordinator-leads, photographer-events) using the service-role client, returning a
-- hand-picked safe field subset — never direct table access from the browser, mirroring
-- every other narrow-scope feature already in this codebase.
--
-- HOWEVER: unlike staff_members (0028) and profiles (0027), `leads`/`events` RLS was,
-- until now, still the original blanket tenant-only `for all` policy from 0001_init.sql
-- (`leads_tenant_isolation` / `events_tenant_isolation`) — explicitly deferred in the
-- 2026-08-17 security audit's HIGH finding #2, specifically because *no non-admin role had
-- a working login yet*, so it was unreachable in practice. That precondition just changed:
-- photographer and lead_coordinator are about to get real, working sessions. Leaving
-- SELECT wide open on these two tables would let a technically sophisticated
-- photographer/lead_coordinator bypass the new edge functions entirely via a direct
-- Supabase client call from devtools and read every other event/lead's financial fields —
-- defeating the "no prices" requirement at the one layer (RLS) that can actually enforce
-- it. So this migration also splits both blanket policies into per-operation policies and
-- adds a role-scoped SELECT policy for exactly these two roles' legitimate scope, using the
-- same EXISTS-subquery pattern already proven in 0012/0018/0020/0027/0028.
-- INSERT/UPDATE/DELETE keep their exact original tenant-only behavior, unchanged (write-
-- side lockdown for events/leads is still its own separate, not-yet-done design pass — see
-- 0020's header comment; not attempted here, scope stays limited to closing the new SELECT
-- exposure this feature would otherwise introduce).

-- 1. Extend profiles.role to add lead_coordinator.
alter table profiles drop constraint profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('owner','admin','studio_manager','photographer','editor','album_manager','lead_coordinator'));

-- 2. New linkage columns — neither existed before now (confirmed: no FK between profiles
--    and staff_members anywhere in the schema; leads had no "created by" column at all).
alter table leads add column if not exists created_by_profile_id uuid references profiles(id) on delete set null;
create index if not exists leads_created_by_profile_id_idx on leads(created_by_profile_id);

alter table staff_members add column if not exists profile_id uuid references profiles(id) on delete set null;
create unique index if not exists staff_members_profile_id_unique_idx on staff_members(profile_id) where profile_id is not null;

-- 3. Split `leads_tenant_isolation` into per-operation policies; SELECT becomes role-aware:
--    admin-equivalent roles keep full tenant access; lead_coordinator sees only leads they
--    personally created. Every other role (photographer/editor/album_manager) gets zero
--    rows here, same as their current (unused) reality.
drop policy if exists leads_tenant_isolation on leads;

create policy leads_select on leads
for select using (
  tenant_id = current_tenant_id()
  and (
    exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
    or created_by_profile_id = auth.uid()
  )
);

create policy leads_insert on leads
for insert with check (tenant_id = current_tenant_id());

create policy leads_update on leads
for update using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());

create policy leads_delete on leads
for delete using (tenant_id = current_tenant_id());

-- 4. Split `events_tenant_isolation` the same way; SELECT scoped to admin roles, or a
--    photographer whose linked staff_members.name appears as a crew member inside team[].
drop policy if exists events_tenant_isolation on events;

create policy events_select on events
for select using (
  tenant_id = current_tenant_id()
  and (
    exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
    or exists (
      select 1 from staff_members sm
      where sm.tenant_id = current_tenant_id()
        and sm.profile_id = auth.uid()
        and exists (
          select 1 from jsonb_array_elements(events.team) as elem
          where elem ->> 'staffMemberName' = sm.name
        )
    )
  )
);

create policy events_insert on events
for insert with check (tenant_id = current_tenant_id());

create policy events_update on events
for update using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());

create policy events_delete on events
for delete using (tenant_id = current_tenant_id());
