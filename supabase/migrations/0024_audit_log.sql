-- Basic audit log for user-management and settings changes -- Top-5 finding #4 from
-- the 2026-08-18 Settings-page CTO audit ("Audit Log בסיסי למשתמשים/הגדרות"): today
-- nothing records who invited/edited a user, changed a role, or edited
-- workspace/pricing/integration config. Implemented as one generic trigger function
-- attached to the specific tables that make up "users + settings", following the
-- same "global trigger over patching every call site" approach already used for
-- calendar sync (0017) and the financial-field guard (0020) in this codebase --
-- deliberately NOT a blanket audit of every table: events/leads/automation_runs are
-- high-volume operational tables, not admin/settings config, and logging every
-- event/lead write would make this table grow far faster for far less admin value.
--
-- Audited tables: profiles (role/active changes, new invites), tenants
-- (workspace/studio details), app_settings, tenant_secrets, staff_members (pay
-- rates), packages, discount_presets, automations.
--
-- Secret values are redacted before being persisted, even though this table is
-- already admin-only: tenant_secrets.value is always a credential (0019), and
-- google_calendar_accounts.access_token/refresh_token are OAuth tokens -- but
-- google_calendar_accounts itself is deliberately NOT attached to this trigger at
-- all in this pass (connect/disconnect status changes aren't "settings" in the same
-- sense, and the redaction-by-table-name approach below is reserved for
-- tenant_secrets, the one table in this list that's ever fully composed of secrets).
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null,
  actor_name text,
  actor_role text,
  action text not null check (action in ('insert', 'update', 'delete')),
  table_name text not null,
  record_id text,
  changed_fields jsonb,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_tenant_created_idx on audit_logs (tenant_id, created_at desc);
create index audit_logs_tenant_table_idx on audit_logs (tenant_id, table_name, created_at desc);

alter table audit_logs enable row level security;

-- Same ADMIN_ROLES set as tenant_secrets (0019) -- owner/admin/studio_manager can
-- view the log; nobody gets a direct write policy -- rows are only ever created by
-- the security-definer trigger function below (or service_role, for completeness).
create policy audit_logs_admin_select on audit_logs
  for select using (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
  );

grant select on audit_logs to authenticated;
grant select, insert on audit_logs to service_role;

-- security definer so it can insert into audit_logs even though `authenticated` has
-- no insert policy on it at all -- the only path in is through this trigger (or the
-- service_role grant above, for any future server-side backfill/cleanup job).
create or replace function log_audit_event() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_actor_id uuid := auth.uid();
  v_actor_name text;
  v_actor_role text;
  v_old jsonb;
  v_new jsonb;
  v_changed jsonb;
  v_record_id text;
begin
  -- `tenants` IS the tenant -- its own id is the tenant id, it has no tenant_id
  -- column of its own, unlike every other table this trigger is attached to.
  if TG_TABLE_NAME = 'tenants' then
    v_tenant_id := coalesce(NEW.id, OLD.id);
  elsif TG_OP = 'DELETE' then
    v_tenant_id := OLD.tenant_id;
  else
    v_tenant_id := NEW.tenant_id;
  end if;

  v_record_id := case when TG_OP = 'DELETE' then OLD.id::text else NEW.id::text end;

  if v_actor_id is not null then
    select full_name, role into v_actor_name, v_actor_role from profiles where id = v_actor_id;
  end if;

  v_old := case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(OLD) else null end;
  v_new := case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(NEW) else null end;

  if TG_TABLE_NAME = 'tenant_secrets' then
    if v_old is not null then v_old := v_old || jsonb_build_object('value', '***REDACTED***'); end if;
    if v_new is not null then v_new := v_new || jsonb_build_object('value', '***REDACTED***'); end if;
  end if;

  if TG_OP = 'UPDATE' then
    select jsonb_object_agg(key, v_new -> key)
    into v_changed
    from jsonb_object_keys(v_new) as key
    where (v_old -> key) is distinct from (v_new -> key);
  end if;

  insert into audit_logs (tenant_id, actor_id, actor_name, actor_role, action, table_name, record_id, changed_fields, old_data, new_data)
  values (v_tenant_id, v_actor_id, v_actor_name, v_actor_role, lower(TG_OP), TG_TABLE_NAME, v_record_id, v_changed, v_old, v_new);

  return coalesce(NEW, OLD);
end;
$$;

create trigger audit_profiles after insert or update or delete on profiles
  for each row execute function log_audit_event();
create trigger audit_tenants after update on tenants
  for each row execute function log_audit_event();
create trigger audit_app_settings after insert or update or delete on app_settings
  for each row execute function log_audit_event();
create trigger audit_tenant_secrets after insert or update or delete on tenant_secrets
  for each row execute function log_audit_event();
create trigger audit_staff_members after insert or update or delete on staff_members
  for each row execute function log_audit_event();
create trigger audit_packages after insert or update or delete on packages
  for each row execute function log_audit_event();
create trigger audit_discount_presets after insert or update or delete on discount_presets
  for each row execute function log_audit_event();
create trigger audit_automations after insert or update or delete on automations
  for each row execute function log_audit_event();
