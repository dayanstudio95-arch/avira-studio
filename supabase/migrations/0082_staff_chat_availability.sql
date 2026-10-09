-- Staff in the chat app (2026-10-09, the owner's design):
--   * a crew member's slots (צלם 1 ראשי / צלם 2 ערב / וידאו 1 יום מלא / וידאו 2 ערב) and area;
--   * one availability link for several events (a "batch") — the staff member marks each
--     event free / not free on one page;
--   * per request: when the studio assigned from it, and when the "you're booked" message
--     went out (so a later visit can offer to send what was assigned but not yet told).
-- Additive only. Rollback: audit-reports/rollback/0082_rollback.sql.

alter table staff_members add column if not exists team_slots text[] not null default '{}';
alter table staff_members add column if not exists area text;

create table if not exists staff_availability_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  staff_member_id uuid not null references staff_members(id) on delete cascade,
  team_role text,
  token_hash text not null,
  revoked_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists staff_availability_batches_token_idx on staff_availability_batches(token_hash);
create index if not exists staff_availability_batches_staff_idx on staff_availability_batches(tenant_id, staff_member_id, created_at desc);

alter table staff_availability_batches enable row level security;
drop policy if exists staff_availability_batches_admin_only on staff_availability_batches;
create policy staff_availability_batches_admin_only on staff_availability_batches
  for all
  using (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
  )
  with check (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
  );
grant select, insert, update, delete on staff_availability_batches to authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_tenant_id') then
    drop trigger if exists set_tenant_id on staff_availability_batches;
    create trigger set_tenant_id before insert on staff_availability_batches for each row execute function set_tenant_id();
  end if;
end $$;

alter table staff_availability_requests add column if not exists batch_id uuid references staff_availability_batches(id) on delete set null;
alter table staff_availability_requests add column if not exists assigned_at timestamptz;
alter table staff_availability_requests add column if not exists booking_notified_at timestamptz;
create index if not exists staff_availability_requests_batch_idx on staff_availability_requests(batch_id) where batch_id is not null;
