-- Staff payments are recorded ON A PERIOD, not against all history (2026-09-20).
--
-- 0065 closed a payment against the person's oldest unpaid events across every month.
-- The owner's first real payment showed why that is wrong for him: he owes Rudi 7,200 for
-- August, pays 6,000, and expects August to say "נשאר 1,200". Instead the 6,000 went to
-- Rudi's older months, all four August events stayed open, and August still showed 7,200.
--
-- A payment now carries the period it was made for (the month or year the Payments page
-- was showing). It closes that period's events, oldest first, and only that period's.
-- Its remainder is credit FOR THAT PERIOD:
--   - the credit a new payment starts from is the credit of payments with the exact same
--     period (period_from / period_to IS NOT DISTINCT FROM), so August's leftover never
--     silently pays September;
--   - only the most recent payment of a person AND period can be undone.
--
-- period_from / period_to NULL means "no period" — the rows written by 0065. They are
-- treated as one group of their own, exactly as before; the owner is expected to undo
-- the one test payment he made and record it again.
--
-- The rule is mirrored in src/lib/staffPaymentAllocation.js (preview) and tested there.

alter table staff_payments
  add column if not exists period_from date,
  add column if not exists period_to date;

-- Replaced, not overloaded: the old 5-argument version must not stay callable, because
-- calling it would silently reintroduce the all-history behaviour.
drop function if exists record_staff_payment(text, numeric, text, date, text);

create or replace function record_staff_payment(
  p_staff_name text,
  p_amount numeric,
  p_method text default 'cash',
  p_paid_on date default current_date,
  p_note text default null,
  p_period_from date default null,
  p_period_to date default null
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
  if (p_period_from is null) <> (p_period_to is null) then
    raise exception 'period_from and period_to go together';
  end if;

  -- Credit of THIS period only.
  select coalesce(sum(amount - applied_amount), 0) into v_credit
  from staff_payments
  where tenant_id = v_tenant
    and staff_member_name = p_staff_name
    and period_from is not distinct from p_period_from
    and period_to is not distinct from p_period_to;

  v_available := v_credit + p_amount;

  for r in
    select e.id, e.couple_names, e.date, (t.ord - 1)::int as idx,
           t.m->>'role' as role,
           coalesce(nullif(t.m->>'cost', '')::numeric, 0) as cost
    from events e,
         jsonb_array_elements(e.team) with ordinality as t(m, ord)
    where e.tenant_id = v_tenant
      and e.date <= current_date
      and (p_period_from is null or e.date >= p_period_from)
      and (p_period_to is null or e.date <= p_period_to)
      and t.m->>'staffMemberName' = p_staff_name
      and coalesce((t.m->>'isPaid')::boolean, false) = false
      and coalesce(nullif(t.m->>'cost', '')::numeric, 0) > 0
    order by e.date asc, e.id, t.ord
  loop
    -- Stop at the first that does not fit; never skip ahead to a cheaper, newer event.
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
    covered, credit_before, credit_after, created_by, period_from, period_to
  ) values (
    v_payment_id, v_tenant, p_staff_name, p_amount, v_applied,
    coalesce(p_method, 'cash'), coalesce(p_paid_on, current_date), nullif(btrim(coalesce(p_note, '')), ''),
    v_covered, v_credit, v_available, auth.uid(), p_period_from, p_period_to
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

-- Undo: the most recent payment of the same person AND period. Payments of other periods
-- are independent, so fixing August does not require undoing September first.
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
  where tenant_id = v_tenant
    and staff_member_name = v_row.staff_member_name
    and period_from is not distinct from v_row.period_from
    and period_to is not distinct from v_row.period_to
  order by created_at desc, id desc
  limit 1;
  if v_latest <> p_payment_id then
    raise exception 'only the most recent payment of this period can be undone';
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

grant execute on function record_staff_payment(text, numeric, text, date, text, date, date) to authenticated;
grant execute on function undo_staff_payment(uuid) to authenticated;
