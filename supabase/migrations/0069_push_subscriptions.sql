-- "אווירה צ'אט" push notifications (WhatsApp Pro stage 1ב, 2026-10-05). ADDITIVE, re-runnable.
--
-- One row per device that switched notifications on (an iPhone with the app on its home
-- screen, a computer's browser). `prefs` are that device's own switches — the owner's
-- choice: "all notifications, and I can change them from the page whenever I want".
-- A device belongs to the user who turned it on; a user can see and change only their
-- own devices. The webhook sends with the service role.
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  device_label text,
  prefs jsonb not null default '{}'::jsonb,
  failure_count integer not null default 0,
  last_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_tenant_idx on push_subscriptions(tenant_id);

alter table push_subscriptions enable row level security;
drop policy if exists push_subscriptions_own on push_subscriptions;
create policy push_subscriptions_own on push_subscriptions
  for all using (
    tenant_id = current_tenant_id()
    and user_id = auth.uid()
    and exists (select 1 from profiles where id = auth.uid()
                and role in ('owner','admin','studio_manager','lead_coordinator'))
  ) with check (
    tenant_id = current_tenant_id()
    and user_id = auth.uid()
    and exists (select 1 from profiles where id = auth.uid()
                and role in ('owner','admin','studio_manager','lead_coordinator'))
  );
grant select, insert, update, delete on push_subscriptions to authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_tenant_id') then
    drop trigger if exists set_tenant_id on push_subscriptions;
    create trigger set_tenant_id before insert on push_subscriptions for each row execute function set_tenant_id();
  end if;
end $$;
