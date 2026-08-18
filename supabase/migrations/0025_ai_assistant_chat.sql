-- Persisted per-user AI Assistant chat history + pending WhatsApp-action proposals.
-- Backs the real Claude-powered rebuild of src/components/AIAssistant.jsx and
-- src/components/systemAdvisor/AskSystemPanelV2.jsx (both previously called the
-- unported "aiAssistant" Base44 function, which threw synchronously).
--
-- This is a personal assistant chat, not a shared team log -- unlike audit_logs
-- (0024_audit_log.sql), which is tenant-wide/admin-visible, RLS here is scoped to
-- BOTH tenant_id AND user_id = auth.uid(), so each user only ever sees their own
-- conversation. Own explicit grants are required, same as every migration since
-- 0012 -- 0002_grants.sql's "grant ... on all tables" was a one-time snapshot, not
-- `alter default privileges`, so new tables get nothing without an explicit grant.
create table ai_assistant_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text,
  -- Optional richer payload for staff-schedule / unpaid-events style answers, so
  -- AIAssistantStructuredAnswer.jsx can re-render it after a page refresh instead
  -- of only ever showing it once, live.
  structured_data jsonb,
  -- { name: 'send_to_editor'|'send_to_couple'|'send_whatsapp_message', params,
  --   description, confirmText } -- set only on assistant rows proposing an action.
  -- Params are always server-resolved (never trusted from the LLM directly) by
  -- supabase/functions/ai-assistant/index.ts before being stored here.
  pending_action jsonb,
  action_status text check (action_status in ('pending','executed','failed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ai_assistant_messages_user_created_idx
  on ai_assistant_messages (tenant_id, user_id, created_at desc);

alter table ai_assistant_messages enable row level security;

create policy ai_assistant_messages_own_rows on ai_assistant_messages
  for all using (tenant_id = current_tenant_id() and user_id = auth.uid())
  with check (tenant_id = current_tenant_id() and user_id = auth.uid());

grant select, insert, update, delete on ai_assistant_messages to authenticated;
grant select, insert, update, delete on ai_assistant_messages to service_role;

create trigger ai_assistant_messages_set_updated_at before update on ai_assistant_messages
  for each row execute function set_updated_at();
