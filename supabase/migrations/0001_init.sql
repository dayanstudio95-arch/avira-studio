-- Avira Studio — initial multi-tenant schema
-- Replaces Base44's hosted entity storage with a self-owned Postgres schema.
-- One "tenant" = one photography studio (the SaaS resale unit).

create extension if not exists pgcrypto;

-- =========================================================
-- TENANTS & USERS
-- =========================================================

create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- One row per authenticated user, 1:1 with auth.users.
-- role controls in-app permissions; tenant_id scopes every query via RLS below.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  role text not null check (role in ('owner','admin','studio_manager','photographer','editor','album_manager')),
  full_name text,
  phone text,
  created_at timestamptz not null default now()
);

create index profiles_tenant_id_idx on profiles(tenant_id);

-- Helper used by every RLS policy below: the tenant of the currently logged-in user.
create or replace function current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from profiles where id = auth.uid();
$$;

-- =========================================================
-- CORE ENTITIES (mirrors base44/entities/*.jsonc)
-- =========================================================

create table packages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  description text,
  price numeric(12,2) not null,
  default_price numeric(12,2),
  photographers integer not null default 1,
  videographers integer not null default 1,
  total_crew_count integer,
  quantity_stills integer not null default 0,
  quantity_video integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table discount_presets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  amount numeric(12,2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table staff_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  role text not null check (role in ('photographer','videographer','editor','graphic_designer')),
  default_rate numeric(12,2) not null default 0,
  -- [{ role: 'photographer1'|'photographer2'|'videographer'|'videographer2'|'editor', rate: number }]
  rates_by_role jsonb not null default '[]'::jsonb,
  phone_number text,
  email text,
  order_index integer not null default 999,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  couple_names text not null,
  event_date date,
  phone_number text,
  email text,
  id_number text,
  couple_notes_signed text,
  signed_couple_names text,
  signed_phone_number text,
  signed_email text,
  signed_id_number text,
  venue_name text,
  package_choice text check (package_choice in ('חבילה 1','חבילה 2','חבילה 3','חבילה 4')),
  package_id uuid references packages(id) on delete set null,
  package_details text,
  base_price numeric(12,2),
  discount numeric(12,2) not null default 0,
  final_price numeric(12,2),
  required_crew integer not null default 3,
  status text not null default 'חדש' check (status in ('חדש','נשלחה הצעה','פולו-אפ','נסגר/חתימה','חוזה','לא רלוונטי')),
  last_contact_date timestamptz,
  notes text,
  contract_terms text,
  signed_at timestamptz,
  contract_sent boolean not null default false,
  signed_contract_pdf_url text,
  total_paid numeric(12,2) not null default 0,
  remaining_balance numeric(12,2) not null default 0,
  last_invoice_url text,
  deposit_invoice_issued boolean not null default false,
  -- [{ id, number, date, description, amount, url }]
  invoices_list jsonb not null default '[]'::jsonb,
  manual_payment numeric(12,2) not null default 0,
  manual_payment_note text,
  google_calendar_status text,
  google_calendar_event_id text,
  linked_event_id uuid,
  production_bride_phone text,
  production_groom_phone text,
  production_bride_prep_location text,
  production_instagram text,
  production_special_requests text,
  production_form_filled_at timestamptz,
  production_brief text,
  final_technical_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index leads_tenant_id_idx on leads(tenant_id);
create index leads_status_idx on leads(tenant_id, status);

create table events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  date date not null,
  couple_names text not null,
  phone_number text,
  package_id uuid references packages(id) on delete set null,
  venue text,
  -- source_lead_id is canonical; lead_id kept only for backward-compat reads during migration.
  source_lead_id uuid references leads(id) on delete set null,
  lead_id text,
  required_crew integer not null default 3,
  total_amount_gross numeric(12,2) not null,
  vatable_amount numeric(12,2),
  vat_percent numeric(5,2) not null default 18,
  vat_amount numeric(12,2),
  selected_discount_id uuid references discount_presets(id) on delete set null,
  manual_discount numeric(12,2),
  -- [{ role, staff_member_id, cost, isPaid, progressStatus, calendarEventId, calendarStatus }]
  team jsonb not null default '[]'::jsonb,
  photographer1_done boolean not null default false,
  photographer2_done boolean not null default false,
  video1_done boolean not null default false,
  editor_done boolean not null default false,
  raw_link text,
  raw_done_manual boolean not null default false,
  raw_sent_to_editor boolean not null default false,
  raw_sent_at timestamptz,
  final_link text,
  final_done_manual boolean not null default false,
  album_sketch_link text,
  album_sketch_graphic_notified boolean not null default false,
  album_sketch_couple_notified boolean not null default false,
  client_payment_status text not null default 'Unpaid' check (client_payment_status in ('Paid','Partially Paid','Unpaid')),
  profit_net numeric(12,2),
  notes text,
  album_status text not null default 'pending' check (album_status in ('pending','sent')),
  album_reminder_sent boolean not null default false,
  album_reminder_sent_at timestamptz,
  signed_at timestamptz,
  google_calendar_event_id text,
  questionnaire_sent_at timestamptz,
  calendar_sync_status text check (calendar_sync_status in ('pending','success','failed')),
  calendar_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index events_tenant_id_idx on events(tenant_id);
create index events_date_idx on events(tenant_id, date);
create index events_source_lead_id_idx on events(source_lead_id);

alter table leads add constraint leads_linked_event_id_fkey
  foreign key (linked_event_id) references events(id) on delete set null;

create table app_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  key text not null,
  value text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, key)
);

-- =========================================================
-- AUTOMATIONS
-- =========================================================

create table automations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  type text not null check (type in ('monthly_staff_summary','daily_event_brief','questionnaire_reminder','album_reminder','payment_reminder','questionnaire_send','custom')),
  emoji text,
  is_active boolean not null default true,
  frequency text not null check (frequency in ('monthly_1st','daily','manual')),
  run_day integer not null default 1,
  run_time text not null default '09:00',
  target_month_mode text not null default 'next_month' check (target_month_mode in ('next_month','current_month')),
  channel text not null default 'whatsapp' check (channel in ('whatsapp','email')),
  message_template text not null,
  filter_logic text,
  media_file_url text,
  test_mode boolean not null default false,
  test_phone text,
  last_run_at timestamptz,
  next_run_at timestamptz,
  last_run_results jsonb,
  selected_staff_ids uuid[] not null default '{}',
  months_ahead integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table automation_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  automation_id uuid not null references automations(id) on delete cascade,
  automation_name text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running' check (status in ('running','completed','error')),
  messages_sent integer not null default 0,
  messages_failed integer not null default 0,
  error_message text,
  triggered_by text not null default 'scheduler' check (triggered_by in ('scheduler','manual'))
);

create table automation_message_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  automation_run_id uuid references automation_runs(id) on delete cascade,
  automation_id uuid not null references automations(id) on delete cascade,
  automation_name text not null,
  recipient_name text not null,
  recipient_contact text,
  channel text check (channel in ('whatsapp','email')),
  message_content text,
  status text not null default 'sent' check (status in ('sent','failed','skipped')),
  sent_at timestamptz not null default now(),
  error text
);

create table event_automations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  is_active boolean not null default false,
  trigger_type text not null check (trigger_type in ('days_after_proposal','days_after_event','status_based')),
  trigger_days integer,
  trigger_status text check (trigger_status in ('proposal_sent','event_completed','album_pending')),
  trigger_description text,
  message_template text not null,
  -- [{ key, label }]
  variables jsonb not null default '[]'::jsonb,
  last_executed timestamptz,
  target_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table pending_automations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  automation_type text not null,
  automation_name text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  messages jsonb not null default '[]'::jsonb,
  total_count integer not null default 0,
  approved_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================
-- updated_at auto-touch trigger (applied to every tenant-scoped table)
-- =========================================================

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  for t in
    select unnest(array['packages','discount_presets','staff_members','leads','events',
                         'app_settings','automations','event_automations','pending_automations'])
  loop
    execute format('create trigger set_updated_at before update on %I for each row execute function set_updated_at();', t);
  end loop;
end $$;

-- =========================================================
-- ROW LEVEL SECURITY — every table is scoped to the caller's tenant
-- =========================================================

alter table profiles enable row level security;
alter table packages enable row level security;
alter table discount_presets enable row level security;
alter table staff_members enable row level security;
alter table leads enable row level security;
alter table events enable row level security;
alter table app_settings enable row level security;
alter table automations enable row level security;
alter table automation_runs enable row level security;
alter table automation_message_logs enable row level security;
alter table event_automations enable row level security;
alter table pending_automations enable row level security;

create policy profiles_self_select on profiles for select using (id = auth.uid());
create policy profiles_self_update on profiles for update using (id = auth.uid());

do $$
declare
  t text;
begin
  for t in
    select unnest(array['packages','discount_presets','staff_members','leads','events','app_settings',
                         'automations','automation_runs','automation_message_logs',
                         'event_automations','pending_automations'])
  loop
    execute format('create policy %I_tenant_isolation on %I for all using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());', t, t);
  end loop;
end $$;

-- Public pages (contract signing, production questionnaire) read/write specific rows
-- WITHOUT a logged-in user. They must go through SECURITY DEFINER RPC functions
-- (e.g. get_lead_public(id), sign_lead_public(id, ...)) that validate a token/id
-- and touch only the allowed columns — never direct table grants to the anon role.
-- These RPCs are implemented in a later migration once the public routes are ported.
