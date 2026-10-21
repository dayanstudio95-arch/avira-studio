-- "הזמנת עבודה" (2026-10-21, the owner's request): the studio's order book (ספר הזמנות) kept
-- in Morning as document type 100 "הזמנה". One row per order issued through the system; the
-- document itself lives in Morning (number, PDF). Every חשבונית מס קבלה for the couple is
-- linked to the active order and names its number. An order cannot be edited or cancelled in
-- Morning — when the couple pays part of the work directly to a subcontractor, a replacement
-- order is issued (replaces_order_id) and the old one is closed and kept.
-- A row is written BEFORE Morning is called (status 'issuing', no morning_id yet) and the
-- order being replaced is claimed first ('replacing') — the unique index below then makes a
-- second, concurrent attempt fail before it reaches Morning, so two devices / a retry can
-- never issue two real orders. If the outcome is unknown (connection lost while Morning was
-- answering) the 'issuing' row stays and blocks new orders until it is checked against
-- Morning's document search (generate-morning-order action 'resolve').
-- The multi-row steps (reserve, release, finish) are SQL functions (security invoker, so RLS
-- still applies) — each runs all-or-nothing. A trigger allows only the real transitions and
-- keeps an issued order unchanged (its lines, total, Morning id), so the book cannot drift.
-- Additive only. Rollback: audit-reports/rollback/0091_rollback.sql. Re-runnable.

create table if not exists work_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  business_type text not null check (business_type in ('sole_prop', 'company')),
  morning_id text,             -- null only while 'issuing'
  morning_number integer,
  morning_client_id text,
  morning_url text,
  document_date date not null,
  -- the order was received (contract signed) on this day — printed in the remarks when the
  -- document date is later (orders for couples who signed before this feature existed)
  received_on date,
  couple_names text not null,
  event_date date,
  -- snapshot at issue time: [{ description, price }] — never recomputed from packages
  lines jsonb not null default '[]'::jsonb,
  total numeric not null check (total > 0),
  remarks_text text,
  status text not null default 'issuing'
    check (status in ('issuing', 'active', 'replacing', 'replaced', 'closed')),
  replaces_order_id uuid references work_orders(id) on delete set null,
  replace_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- only a reservation may lack its Morning document
  constraint work_orders_issued_has_doc check (status = 'issuing' or morning_id is not null)
);

create index if not exists work_orders_lead_idx on work_orders(tenant_id, lead_id, created_at desc);
create unique index if not exists work_orders_morning_id_idx on work_orders(tenant_id, morning_id);
-- one active (or being issued) order per couple per business
create unique index if not exists work_orders_one_active_idx
  on work_orders(tenant_id, lead_id, business_type) where status in ('active', 'issuing');

alter table work_orders enable row level security;
-- Owner / admin / studio manager of the studio — the same test in every policy.
drop policy if exists work_orders_select on work_orders;
create policy work_orders_select on work_orders for select using (
  tenant_id = current_tenant_id()
  and exists (select 1 from profiles where id = auth.uid()
              and role in ('owner','admin','studio_manager'))
);
drop policy if exists work_orders_write on work_orders;
-- A row is only ever created as a reservation; it becomes an order through work_order_finish.
drop policy if exists work_orders_insert on work_orders;
create policy work_orders_insert on work_orders for insert with check (
  status = 'issuing' and morning_id is null
  and tenant_id = current_tenant_id()
  and exists (select 1 from profiles where id = auth.uid()
              and role in ('owner','admin','studio_manager'))
);
drop policy if exists work_orders_update on work_orders;
create policy work_orders_update on work_orders for update using (
  tenant_id = current_tenant_id()
  and exists (select 1 from profiles where id = auth.uid()
              and role in ('owner','admin','studio_manager'))
) with check (
  tenant_id = current_tenant_id()
  and exists (select 1 from profiles where id = auth.uid()
              and role in ('owner','admin','studio_manager'))
);
-- Delete ONLY a reservation that never reached Morning. An issued order is never removed —
-- it is replaced/closed. Rows otherwise go only with their studio (tenant cascade).
drop policy if exists work_orders_delete_reservation on work_orders;
create policy work_orders_delete_reservation on work_orders for delete using (
  status = 'issuing' and morning_id is null
  and tenant_id = current_tenant_id()
  and exists (select 1 from profiles where id = auth.uid()
              and role in ('owner','admin','studio_manager'))
);
-- Only what the app needs: no anon access, no truncate.
revoke all on work_orders from anon, authenticated;
grant select, insert, update, delete on work_orders to authenticated;
grant select, insert, update, delete on work_orders to service_role;

-- The only status changes, and nothing else changes once the row left 'issuing':
--   issuing → active (Morning id/number/client/url set once)
--   active → replacing → replaced | active (released)      active → closed
create or replace function work_orders_guard() returns trigger language plpgsql as $$
declare
  ok boolean;
  fixed text[] := array['status', 'morning_url'];
begin
  ok := (old.status = new.status)
     or (old.status = 'issuing' and new.status = 'active')
     or (old.status = 'active' and new.status in ('replacing', 'closed'))
     or (old.status = 'replacing' and new.status in ('replaced', 'active'));
  if not ok then
    raise exception 'work_orders: status % → % is not allowed', old.status, new.status using errcode = 'P0001';
  end if;
  if old.status = 'issuing' then
    fixed := fixed || array['morning_id', 'morning_number', 'morning_client_id'];
  end if;
  if (to_jsonb(new) - fixed) is distinct from (to_jsonb(old) - fixed) then
    raise exception 'work_orders: an issued order cannot be edited' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists work_orders_guard on work_orders;
create trigger work_orders_guard before update on work_orders for each row execute function work_orders_guard();

-- Reserve, all-or-nothing: claim the order being replaced (active → replacing) and insert the
-- 'issuing' row. The unique index makes a concurrent reservation fail (23505).
create or replace function work_order_reserve(
  p_lead_id uuid, p_business_type text, p_replaces uuid, p_document_date date, p_received_on date,
  p_couple_names text, p_event_date date, p_lines jsonb, p_total numeric, p_remarks text, p_replace_reason text
) returns work_orders language plpgsql security invoker set search_path = public as $$
declare r work_orders;
begin
  if p_replaces is not null then
    update work_orders set status = 'replacing'
     where id = p_replaces and status = 'active' and lead_id = p_lead_id and business_type = p_business_type;
    if not found then
      raise exception 'work_order_replace_conflict' using errcode = 'P0001';
    end if;
  end if;
  insert into work_orders (lead_id, business_type, morning_id, document_date, received_on, couple_names,
                           event_date, lines, total, remarks_text, status, replaces_order_id, replace_reason, created_by)
  values (p_lead_id, p_business_type, null, p_document_date, p_received_on, p_couple_names,
          p_event_date, coalesce(p_lines, '[]'::jsonb), p_total, p_remarks, 'issuing', p_replaces, p_replace_reason, auth.uid())
  returning * into r;
  return r;
end $$;

-- Release, all-or-nothing: drop a reservation that never reached Morning and give back the
-- order it was replacing. false = nothing to release.
create or replace function work_order_release(p_slot uuid)
returns boolean language plpgsql security invoker set search_path = public as $$
declare v_rep uuid;
begin
  delete from work_orders where id = p_slot and status = 'issuing' and morning_id is null
  returning replaces_order_id into v_rep;
  if not found then return false; end if;
  if v_rep is not null then
    update work_orders set status = 'active' where id = v_rep and status = 'replacing';
  end if;
  return true;
end $$;

-- Finish, all-or-nothing: the document exists in Morning — the reservation becomes the order
-- and the order it replaces becomes 'replaced'.
create or replace function work_order_finish(
  p_slot uuid, p_morning_id text, p_morning_number integer, p_morning_client_id text, p_morning_url text
) returns work_orders language plpgsql security invoker set search_path = public as $$
declare r work_orders;
begin
  update work_orders
     set morning_id = p_morning_id, morning_number = p_morning_number,
         morning_client_id = p_morning_client_id, morning_url = p_morning_url, status = 'active'
   where id = p_slot and status = 'issuing'
  returning * into r;
  if not found then
    raise exception 'work_order_slot_gone' using errcode = 'P0001';
  end if;
  if r.replaces_order_id is not null then
    update work_orders set status = 'replaced' where id = r.replaces_order_id and status = 'replacing';
  end if;
  return r;
end $$;

revoke all on function work_order_reserve(uuid, text, uuid, date, date, text, date, jsonb, numeric, text, text) from public, anon;
revoke all on function work_order_release(uuid) from public, anon;
revoke all on function work_order_finish(uuid, text, integer, text, text) from public, anon;
grant execute on function work_order_reserve(uuid, text, uuid, date, date, text, date, jsonb, numeric, text, text) to authenticated;
grant execute on function work_order_release(uuid) to authenticated;
grant execute on function work_order_finish(uuid, text, integer, text, text) to authenticated;

do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_tenant_id') then
    drop trigger if exists set_tenant_id on work_orders;
    create trigger set_tenant_id before insert on work_orders for each row execute function set_tenant_id();
  end if;
end $$;

-- The split of a package's price for the order lines (the owner fills these in; no seed values).
alter table packages add column if not exists stills_price numeric check (stills_price is null or stills_price >= 0);
alter table packages add column if not exists video_price numeric check (video_price is null or video_price >= 0);
