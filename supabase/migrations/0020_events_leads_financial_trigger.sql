-- Step 5 (final step) of the 2026-08-17 security audit's remediation plan: protect the
-- financial columns on `events` and `leads` — the two largest, most-used tables, and the
-- audit's highest-blast-radius finding (#2, HIGH). Both tables' RLS is still tenant-only
-- (`events_tenant_isolation` / `leads_tenant_isolation` from 0001_init.sql) — deliberately
-- NOT changed here, unlike Step 3's tables. Reason: photographers/editors legitimately
-- need to write plenty of non-financial fields on these two tables as part of their normal
-- day-to-day work (raw/final links, progress checkboxes, album status, notes, calendar
-- sync bookkeeping, questionnaire fields, etc. — see the full 53-call-site mapping done
-- before this migration was written), so a blanket admin-only RLS policy (Step 3's
-- pattern) would break legitimate non-admin workflows. Postgres RLS is row-level only —
-- there's no native column-level RLS — so this uses a BEFORE INSERT/UPDATE trigger
-- instead, which CAN inspect individual OLD/NEW column values.
--
-- Column selection: every column in the two lists below carries a real money amount, a
-- payment/invoice fact, or (for `team` / `invoices_list`) a JSONB array whose entries
-- embed a per-line-item cost/paid-status. `team` and `invoices_list` are protected as
-- whole columns rather than diffed sub-field-by-sub-field: every current writer of these
-- two JSONB columns (StaffPickerCell, MobileStaffAssignmentSheet, Payments.jsx,
-- TeamPayments.jsx, StaffScheduling.jsx, EventExpensesEditor.jsx, generate-morning-invoice,
-- send-staff-invite) is already only reachable through routes gated by App.jsx's
-- owner/admin/studio_manager check, so protecting the whole column costs nothing today
-- and avoids fragile per-key JSON diffing (team[] also carries operational fields like
-- role/staffId/progressStatus/calendarStatus in the same array, which would otherwise need
-- a much more complex trigger to separate from cost/isPaid).
--
-- INSERT is always admin-only for both tables (not just protected-column inserts): no
-- currently-legitimate creation flow for either table is reachable by a non-admin-
-- equivalent role (confirmed via full call-site mapping — every create call site sits
-- under Leads.jsx/Events.jsx, both behind App.jsx's gate), and `events.total_amount_gross`
-- is NOT NULL, so virtually every insert is inherently financial anyway.
--
-- Verified safe against current legitimate usage (full mapping: 33 events + 20 leads
-- frontend call sites, plus every edge-function write statement against these two
-- tables): every `createUserClient`-based write that touches a protected column below is
-- reachable only via src/pages/Leads.jsx or src/pages/Events.jsx, both gated by
-- App.jsx:63's isAdmin(user) check (owner/admin/studio_manager — src/lib/permissions.js).
-- The only routes that bypass App.jsx's gate (ContractPage.jsx, EventQuestionnaire.jsx —
-- both public, unauthenticated) do not import any component that writes a protected
-- column, and their backing edge functions (sign-lead-public, save-signed-contract,
-- submit-production-questionnaire, get-lead-public) all use createServiceRoleClient()
-- and never touch a protected column. Every automation/cron path (automation-engine,
-- reconcile-calendar-sync's cron mode, calendar-sync-webhook) also uses
-- createServiceRoleClient() throughout.
--
-- service_role bypasses RLS entirely but does NOT bypass triggers, so this trigger must
-- explicitly allow service-role/unauthenticated contexts through: auth.uid() is NULL for
-- those calls (no JWT `sub` claim), which is what the `if auth.uid() is null then return`
-- guard below is for. Without it, automation-engine, the calendar sync/reconcile jobs, and
-- every public-facing endpoint above would start failing.

create or replace function enforce_financial_column_admin_only()
returns trigger
language plpgsql
as $$
declare
  col text;
  is_caller_admin boolean;
begin
  -- No JWT subject => service-role or another trusted server-side caller (RLS is
  -- already bypassed for these; the trigger must not add a restriction RLS itself
  -- doesn't impose). Real end users always have auth.uid() set.
  if auth.uid() is null then
    return new;
  end if;

  is_caller_admin := exists (
    select 1 from profiles
    where id = auth.uid() and role in ('owner', 'admin', 'studio_manager')
  );

  if is_caller_admin then
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception 'insufficient_privilege: only owner/admin/studio_manager may create rows in %', tg_table_name
      using errcode = '42501';
  end if;

  foreach col in array tg_argv loop
    if (to_jsonb(old) ->> col) is distinct from (to_jsonb(new) ->> col) then
      raise exception 'insufficient_privilege: only owner/admin/studio_manager may change column "%" on %', col, tg_table_name
        using errcode = '42501';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists enforce_financial_columns_events on events;

create trigger enforce_financial_columns_events
before insert or update on events
for each row execute function enforce_financial_column_admin_only(
  'total_amount_gross', 'vatable_amount', 'vat_percent', 'vat_amount',
  'manual_discount', 'team', 'client_payment_status', 'profit_net'
);

drop trigger if exists enforce_financial_columns_leads on leads;

create trigger enforce_financial_columns_leads
before insert or update on leads
for each row execute function enforce_financial_column_admin_only(
  'base_price', 'discount', 'final_price', 'total_paid', 'remaining_balance',
  'last_invoice_url', 'deposit_invoice_issued', 'invoices_list',
  'manual_payment', 'manual_payment_note'
);
