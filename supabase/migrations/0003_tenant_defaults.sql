-- Auto-fill tenant_id on insert so frontend .create() calls don't need to pass it explicitly.
-- Required for RLS WITH CHECK (tenant_id = current_tenant_id()) to pass on client-side inserts.

create or replace function set_tenant_id()
returns trigger
language plpgsql
as $$
begin
  if new.tenant_id is null then
    new.tenant_id := current_tenant_id();
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  for t in
    select unnest(array['packages','discount_presets','staff_members','leads','events',
                         'app_settings','automations','event_automations','pending_automations',
                         'automation_runs','automation_message_logs'])
  loop
    execute format('drop trigger if exists set_tenant_id on %I;', t);
    execute format('create trigger set_tenant_id before insert on %I for each row execute function set_tenant_id();', t);
  end loop;
end $$;
