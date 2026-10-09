-- AI sales help in the chat (2026-10-09, the owner's choices 1–5 and 7):
--   * a tag on what the lead wrote (asks for a discount / wants to talk / needs time / closed
--     with someone else / remove / question / ready) — set with the existing hot-lead rating;
--   * "come back to them": a reminder time (set by "needs time", or by hand) and when it fired;
--   * a short summary of the conversation, incl. what the studio already offered, cached
--     until a newer message arrives;
--   * a log of every AI call with its estimated cost, for the monthly cap and the counter.
-- Additive only. Rollback: audit-reports/rollback/0083_rollback.sql.

alter table whatsapp_conversations add column if not exists ai_tag text
  check (ai_tag in ('discount', 'wants_call', 'needs_time', 'closed_other', 'opt_out', 'question', 'ready', 'other'));
alter table whatsapp_conversations add column if not exists ai_tag_at timestamptz;
alter table whatsapp_conversations add column if not exists return_at timestamptz;
alter table whatsapp_conversations add column if not exists return_notified_at timestamptz;
alter table whatsapp_conversations add column if not exists ai_summary jsonb;
alter table whatsapp_conversations add column if not exists ai_summary_at timestamptz;
create index if not exists whatsapp_conversations_return_idx on whatsapp_conversations(tenant_id, return_at) where return_at is not null;

create table if not exists ai_usage (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_ils numeric(10,4) not null default 0,
  user_id uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_month_idx on ai_usage(tenant_id, created_at desc);

alter table ai_usage enable row level security;
drop policy if exists ai_usage_read on ai_usage;
create policy ai_usage_read on ai_usage
  for select
  using (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager', 'lead_coordinator'))
  );
-- rows are written only by the Edge Functions (service role)
grant select on ai_usage to authenticated;
grant select, insert, update, delete on ai_usage to service_role;
