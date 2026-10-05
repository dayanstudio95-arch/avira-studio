-- SEC-01 (audit 2026-10-05): a signed-in user may never change their own studio, role or
-- active flag — not even an owner/admin/studio_manager.
--
-- Before: profiles_self_update let every user update their own row, and the column guard
-- from 0020 (enforce_financial_column_admin_only('role','tenant_id','is_active')) exempts
-- owner/admin/studio_manager. So an admin of ANY studio could set their own tenant_id to
-- another studio and get full access to it (leads, contracts, tenant_secrets).
--
-- After: a BEFORE UPDATE trigger rejects any change to id / tenant_id / role / is_active
-- when the caller is a signed-in user (auth.uid() is set). User management keeps working
-- because it already goes through Edge Functions with the service-role client
-- (update-tenant-user, invite-user, create-tenant, delete-tenant-user), where auth.uid()
-- is null. No screen writes these columns from the browser (verified 2026-10-06).
-- Name and phone stay self-editable. The 0020 trigger is left as is (defence in depth).
--
-- Rollback: 0072_rollback.sql (in audit-reports/rollback/). Re-runnable.

create or replace function public.block_self_profile_escalation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Service role / trusted server code: no JWT subject.
  if auth.uid() is null then
    return new;
  end if;

  if new.id        is distinct from old.id
  or new.tenant_id is distinct from old.tenant_id
  or new.role      is distinct from old.role
  or new.is_active is distinct from old.is_active then
    raise exception 'insufficient_privilege: studio, role and active status are changed only through user management'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists block_self_profile_escalation on public.profiles;
create trigger block_self_profile_escalation
  before update on public.profiles
  for each row execute function public.block_self_profile_escalation();

-- The row a user updates must still be their own row afterwards.
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
