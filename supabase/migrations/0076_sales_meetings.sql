-- Sales meetings (2026-10-07). The owner books a call / zoom / in-person meeting with a lead
-- — usually from the WhatsApp conversation — and gets a push 10 minutes before, and a second
-- one 5 minutes later unless he tapped "ראיתי" (supabase/functions/meeting-reminders, run
-- every minute by pg_cron). Screens: src/components/meetings/*, /Meetings, the chat app.
-- Additive only. Rollback: audit-reports/rollback/0076_rollback.sql. Re-runnable.

create table if not exists sales_meetings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  conversation_id uuid references whatsapp_conversations(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  phone text,
  kind text not null default 'call' check (kind in ('call', 'zoom', 'in_person')),
  starts_at timestamptz not null,
  duration_min integer not null default 30 check (duration_min between 5 and 480),
  zoom_url text,
  location text,
  notes text,
  status text not null default 'scheduled' check (status in ('scheduled', 'done', 'cancelled')),
  reminder_sent_at timestamptz,
  second_reminder_sent_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sales_meetings_due_idx on sales_meetings(status, starts_at);
create index if not exists sales_meetings_tenant_idx on sales_meetings(tenant_id, starts_at);

alter table sales_meetings enable row level security;
drop policy if exists sales_meetings_rw on sales_meetings;
create policy sales_meetings_rw on sales_meetings for all using (
  tenant_id = current_tenant_id()
  and exists (select 1 from profiles where id = auth.uid()
              and role in ('owner','admin','studio_manager','lead_coordinator'))
) with check (
  tenant_id = current_tenant_id()
  and exists (select 1 from profiles where id = auth.uid()
              and role in ('owner','admin','studio_manager','lead_coordinator'))
);
grant select, insert, update, delete on sales_meetings to authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_tenant_id') then
    drop trigger if exists set_tenant_id on sales_meetings;
    create trigger set_tenant_id before insert on sales_meetings for each row execute function set_tenant_id();
  end if;
end $$;
