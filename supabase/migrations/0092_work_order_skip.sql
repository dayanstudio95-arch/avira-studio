-- ספר הזמנות (2026-10-22, the owner's request): couples the owner decided need no work order
-- are taken off the "בלי הזמנה" list (e.g. weddings long past, couples from the old system).
-- Nothing is deleted — the couple stays as it is; the page shows them under "הוסרו" with
-- "החזר לרשימה". Additive only. Rollback: audit-reports/rollback/0092_rollback.sql.
alter table leads add column if not exists work_order_skipped_at timestamptz;
alter table leads add column if not exists work_order_skipped_by uuid references auth.users(id) on delete set null;

-- Only the owner / admin / studio manager may take couples off the list or bring them back
-- (leads_update lets every studio member update a lead; 0020 guards only the money columns).
-- Server code (service role, no auth.uid()) is not affected.
create or replace function enforce_work_order_skip_admin_only() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.work_order_skipped_at is distinct from old.work_order_skipped_at
      or new.work_order_skipped_by is distinct from old.work_order_skipped_by)
     and auth.uid() is not null
     and not exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager')) then
    raise exception 'only the owner, an admin or a studio manager may change the order-book list' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists enforce_work_order_skip_admin_only on leads;
create trigger enforce_work_order_skip_admin_only before update on leads
  for each row execute function enforce_work_order_skip_admin_only();
