-- Recycle bin: nothing important gets deleted without a copy being kept first.
--
-- The problem
-- --------------------------------------------------------------------------------
-- There is no soft delete anywhere in this schema, and `leads` / `events` are NOT
-- covered by the audit trigger (0024 deliberately covers settings tables only). So
-- deleting a lead destroys its `invoices_list` (the record of real tax invoices), its
-- `total_paid`, its `signed_contract_pdf_url`, the couple's signature and their ID
-- number — permanently, behind a single window.confirm, with no trace that the row
-- ever existed. `events.source_lead_id` is `on delete set null`, so the linked event
-- doesn't even error; it just quietly becomes an orphan.
--
-- Why a trigger, and NOT a `deleted_at` column
-- --------------------------------------------------------------------------------
-- The obvious fix is soft delete: add `deleted_at` and filter it out on read. That
-- was the original plan, and surveying the call sites killed it. Over twenty Edge
-- Functions query `leads` / `events` directly with a service-role client — contracts,
-- payment reminders, questionnaires, the AI assistant, the automation engine, calendar
-- sync. Filtering in the frontend shim alone would hide a deleted lead from the screen
-- while every automation carried on messaging them, which is a worse failure than the
-- one being fixed. Filtering in all twenty means one missed spot has exactly that
-- effect, and service-role bypasses RLS so the database could not backstop it either.
--
-- A BEFORE DELETE trigger inverts the problem. The row is still really deleted, so
-- every existing read path stays correct with no change and no chance of drift — and
-- the data survives regardless of who issued the DELETE: the UI, an Edge Function, or
-- someone typing SQL into the dashboard. It is the one place that cannot be bypassed.
--
-- ⚠️ This is a safety net, not a substitute for PITR. It captures the row, not the
-- storage objects: a deleted lead's signed-contract PDF still lives in the
-- `signed-contracts` bucket and is recoverable via the stored URL, but album files
-- removed by AlbumOrders.jsx's own cleanup are not covered here.

create table if not exists deleted_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  table_name text not null,
  record_id uuid not null,
  -- The complete row as it was, so a restore needs no schema knowledge.
  data jsonb not null,
  -- A human-readable label, computed at delete time. Without it the recycle bin would
  -- be a list of UUIDs, and nobody can recognise the lead they meant to keep from one.
  label text,
  deleted_at timestamptz not null default now(),
  deleted_by uuid references profiles(id) on delete set null,
  deleted_by_name text,
  -- Set when the row is put back, so the bin keeps the history instead of losing it.
  restored_at timestamptz
);

create index if not exists deleted_records_tenant_idx
  on deleted_records(tenant_id, deleted_at desc);
-- The bin's own screen only ever asks for things not yet put back.
create index if not exists deleted_records_pending_idx
  on deleted_records(tenant_id, deleted_at desc)
  where restored_at is null;

alter table deleted_records enable row level security;

-- Same ADMIN_ROLES-only shape as audit_logs and tenant_secrets: these rows contain
-- everything a lead contained, including ID numbers and signatures, so photographers
-- and editors must not be able to read them.
create policy deleted_records_admin_only on deleted_records
  for all
  using (
    tenant_id = current_tenant_id()
    and exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and p.tenant_id = deleted_records.tenant_id
        and p.role in ('owner', 'admin', 'studio_manager')
    )
  )
  with check (
    tenant_id = current_tenant_id()
    and exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and p.tenant_id = deleted_records.tenant_id
        and p.role in ('owner', 'admin', 'studio_manager')
    )
  );

create or replace function capture_deleted_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_name text;
  v_label text;
begin
  if v_actor_id is not null then
    select full_name into v_actor_name from profiles where id = v_actor_id;
  end if;

  -- couple_names is the only field a human recognises a row by, and both tables have
  -- it. The date disambiguates the couples who share a first name.
  v_label := coalesce(OLD.couple_names, '(ללא שם)');
  if OLD.event_date is not null then
    v_label := v_label || ' · ' || to_char(OLD.event_date, 'DD/MM/YYYY');
  end if;

  insert into deleted_records (tenant_id, table_name, record_id, data, label, deleted_by, deleted_by_name)
  values (OLD.tenant_id, TG_TABLE_NAME, OLD.id, to_jsonb(OLD), v_label, v_actor_id, v_actor_name);

  return OLD;
end;
$$;

-- `events` names the column `date`, not `event_date`, so it gets its own function
-- rather than a fragile dynamic lookup inside a delete path.
create or replace function capture_deleted_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_name text;
  v_label text;
begin
  if v_actor_id is not null then
    select full_name into v_actor_name from profiles where id = v_actor_id;
  end if;

  v_label := coalesce(OLD.couple_names, '(ללא שם)');
  if OLD.date is not null then
    v_label := v_label || ' · ' || to_char(OLD.date, 'DD/MM/YYYY');
  end if;

  insert into deleted_records (tenant_id, table_name, record_id, data, label, deleted_by, deleted_by_name)
  values (OLD.tenant_id, TG_TABLE_NAME, OLD.id, to_jsonb(OLD), v_label, v_actor_id, v_actor_name);

  return OLD;
end;
$$;

drop trigger if exists capture_deleted_lead on leads;
create trigger capture_deleted_lead before delete on leads
  for each row execute function capture_deleted_record();

drop trigger if exists capture_deleted_event on events;
create trigger capture_deleted_event before delete on events
  for each row execute function capture_deleted_event();
