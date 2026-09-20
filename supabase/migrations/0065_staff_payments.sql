-- Lump-sum payments to staff ("תשלום על החשבון") — 2026-09-20.
--
-- What this is for
-- --------------------------------------------------------------------------------
-- Until now a staff payment could only be recorded as "this event: paid / not paid"
-- (events.team[].isPaid). The owner pays some people in cash, in round sums that do not
-- divide by the per-event rate: "שילמתי לרודי 6 אלף וזה לא מתחלק לפי 1800". Three events
-- could be ticked (5,400) and the other 600 lived in his head.
--
-- His two decisions:
--   * the money is counted against the ex-VAT cost (the 7,200, not the 8,496) — i.e.
--     against events.team[].cost exactly as stored;
--   * events are closed automatically, oldest first.
--
-- Model
-- --------------------------------------------------------------------------------
-- One row per real payment. `applied_amount` is how much of it (plus any credit carried
-- in) closed events; the staff member's running credit is therefore
--     sum(amount - applied_amount)
-- over their rows — derived, never stored as a balance that could drift. A payment of
-- 1,200 that, together with 600 of earlier credit, closes an 1,800 event has
-- applied_amount = 1,800, and the sum comes back to zero.
--
-- Staff are keyed by NAME because events.team[] has no staff id — every assignment,
-- conflict check and payment in this app already matches on staffMemberName.
--
-- Why an RPC and not client-side writes: closing N events and inserting the payment
-- must be one transaction. If it were N+1 separate requests, a failure half-way would
-- leave money that is neither credit nor applied — the one state this table exists to
-- make impossible.
--
-- Closing rule, mirrored in src/lib/staffPaymentAllocation.js (which draws the preview
-- the owner confirms): unpaid rows of this person with cost > 0 on events whose date
-- has passed, oldest first; STOP at the first row that does not fit. Never skip ahead —
-- leaving an older event open while closing a newer one is how balances become
-- impossible to reason about. What does not fit stays as credit.

create table if not exists staff_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  staff_member_name text not null,
  amount numeric(12,2) not null check (amount > 0),
  applied_amount numeric(12,2) not null default 0 check (applied_amount >= 0),
  method text not null default 'cash' check (method in ('cash', 'transfer', 'bit', 'check', 'other')),
  paid_on date not null default current_date,
  note text,
  -- Snapshot of what this payment closed: [{eventId, coupleNames, date, role, amount}]
  covered jsonb not null default '[]'::jsonb,
  credit_before numeric(12,2) not null default 0,
  credit_after numeric(12,2) not null default 0,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists staff_payments_staff_idx
  on staff_payments(tenant_id, staff_member_name, created_at desc);

alter table staff_payments enable row level security;

drop policy if exists staff_payments_admin_only on staff_payments;
create policy staff_payments_admin_only on staff_payments
  for all
  using (
    tenant_id = current_tenant_id()
    and exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role in ('owner', 'admin', 'studio_manager')
    )
  )
  with check (
    tenant_id = current_tenant_id()
    and exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role in ('owner', 'admin', 'studio_manager')
    )
  );

grant select, insert, update, delete on staff_payments to authenticated;
grant select, insert, update, delete on staff_payments to service_role;

-- ---------------------------------------------------------------------------------
-- record_staff_payment — one transaction: close what fits, keep the rest as credit.
-- SECURITY INVOKER on purpose: RLS and the events financial-columns trigger (0020)
-- apply to the caller exactly as if the page had made the writes itself.
-- ---------------------------------------------------------------------------------
create or replace function record_staff_payment(
  p_staff_name text,
  p_amount numeric,
  p_method text default 'cash',
  p_paid_on date default current_date,
  p_note text default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_payment_id uuid := gen_random_uuid();
  v_credit numeric := 0;
  v_available numeric;
  v_applied numeric := 0;
  v_covered jsonb := '[]'::jsonb;
  r record;
begin
  if v_tenant is null then
    raise exception 'no tenant for caller';
  end if;
  if p_staff_name is null or btrim(p_staff_name) = '' then
    raise exception 'staff name required';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;

  select coalesce(sum(amount - applied_amount), 0) into v_credit
  from staff_payments
  where tenant_id = v_tenant and staff_member_name = p_staff_name;

  v_available := v_credit + p_amount;

  for r in
    select e.id, e.couple_names, e.date, (t.ord - 1)::int as idx,
           t.m->>'role' as role,
           coalesce(nullif(t.m->>'cost', '')::numeric, 0) as cost
    from events e,
         jsonb_array_elements(e.team) with ordinality as t(m, ord)
    where e.tenant_id = v_tenant
      and e.date <= current_date
      and t.m->>'staffMemberName' = p_staff_name
      and coalesce((t.m->>'isPaid')::boolean, false) = false
      and coalesce(nullif(t.m->>'cost', '')::numeric, 0) > 0
    order by e.date asc, e.id, t.ord
  loop
    exit when r.cost > v_available;

    update events
    set team = jsonb_set(
      team,
      array[r.idx::text],
      (team -> r.idx) || jsonb_build_object(
        'isPaid', true,
        'paidAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'paidVia', v_payment_id::text
      )
    )
    where id = r.id;

    v_available := v_available - r.cost;
    v_applied := v_applied + r.cost;
    v_covered := v_covered || jsonb_build_array(jsonb_build_object(
      'eventId', r.id, 'coupleNames', r.couple_names, 'date', r.date,
      'role', r.role, 'amount', r.cost
    ));
  end loop;

  insert into staff_payments (
    id, tenant_id, staff_member_name, amount, applied_amount, method, paid_on, note,
    covered, credit_before, credit_after, created_by
  ) values (
    v_payment_id, v_tenant, p_staff_name, p_amount, v_applied,
    coalesce(p_method, 'cash'), coalesce(p_paid_on, current_date), nullif(btrim(coalesce(p_note, '')), ''),
    v_covered, v_credit, v_available, auth.uid()
  );

  return jsonb_build_object(
    'paymentId', v_payment_id,
    'applied', v_applied,
    'covered', v_covered,
    'creditBefore', v_credit,
    'creditAfter', v_available
  );
end;
$$;

-- ---------------------------------------------------------------------------------
-- undo_staff_payment — only the person's MOST RECENT payment can be undone. Undoing an
-- older one would pull credit out from under the payments that came after it.
-- Re-opens exactly the rows this payment closed (matched by paidVia), then deletes it.
-- ---------------------------------------------------------------------------------
create or replace function undo_staff_payment(p_payment_id uuid) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_row staff_payments%rowtype;
  v_latest uuid;
  v_reopened int := 0;
begin
  select * into v_row from staff_payments where id = p_payment_id and tenant_id = v_tenant;
  if not found then
    raise exception 'payment not found';
  end if;

  select id into v_latest
  from staff_payments
  where tenant_id = v_tenant and staff_member_name = v_row.staff_member_name
  order by created_at desc, id desc
  limit 1;
  if v_latest <> p_payment_id then
    raise exception 'only the most recent payment can be undone';
  end if;

  with touched as (
    update events e
    set team = (
      select jsonb_agg(
        case when t.m->>'paidVia' = p_payment_id::text
          then (t.m - 'paidAt' - 'paidVia') || jsonb_build_object('isPaid', false)
          else t.m
        end
        order by t.ord
      )
      from jsonb_array_elements(e.team) with ordinality as t(m, ord)
    )
    where e.tenant_id = v_tenant
      and exists (
        select 1 from jsonb_array_elements(e.team) m where m->>'paidVia' = p_payment_id::text
      )
    returning 1
  )
  select count(*) into v_reopened from touched;

  delete from staff_payments where id = p_payment_id;

  return jsonb_build_object('reopenedEvents', v_reopened, 'amount', v_row.amount);
end;
$$;

grant execute on function record_staff_payment(text, numeric, text, date, text) to authenticated;
grant execute on function undo_staff_payment(uuid) to authenticated;
