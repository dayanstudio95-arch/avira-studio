-- WhatsApp bot housekeeping: deferred sends, the mid-flow nudge, the hot-lead alert.
--
-- What this is for
-- --------------------------------------------------------------------------------
-- 2026-09-15. Asked "how else can the bot help", a verified read of the code turned up
-- two real holes before any new idea:
--
--   1. Quiet hours DROPPED answers. A couple who replied to the bot's questions at
--      23:30 hit the quiet-hours stop in decideBotFollowUp, and the webhook wrote
--      nothing at all — no state change, no reply in the morning, no flag. They stayed
--      in AWAITING_DETAILS until they happened to write again. A first message at
--      night was dropped the same way, before intent was even evaluated.
--   2. Someone who stopped answering mid-flow was in no queue anywhere. Not the
--      follow-up queue (PRICELIST_SENT only), not the dashboard card.
--
-- Plus: a 'hot' rating only coloured a row — nothing told the owner — and a stranger
-- whose first message was a voice note got silence with nobody the wiser.
--
-- The owner approved seven items; this migration carries the schema for three.
--
-- whatsapp_deferred_sends
-- --------------------------------------------------------------------------------
-- What the bot WOULD have sent during quiet hours, held until they end. The webhook
-- composes the exact messages at decision time (greeting, follow-up question, price
-- list) and stores them; the hourly automation-engine tick drains rows whose
-- send_after has passed. No new cron, no new secret — it rides the tick that already
-- runs `0 * * * *`.
--
-- One pending row per conversation (partial unique index). A second message during the
-- night supersedes the first: the state has already advanced, so the second message is
-- processed as a real answer and its send replaces the greeting. At 08:00 the customer
-- gets the right question, or the price list, not a stale opener.
--
-- expected_state is the guard against staleness: if a human took the conversation over,
-- or it moved on, the row is cancelled rather than sent.
--
-- ⚠️ Nothing here sends by itself outside the rules that already govern the live path:
-- master switch, bot_enabled on the conversation, contact still unknown, hourly quota.

create table if not exists whatsapp_deferred_sends (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  conversation_id uuid not null references whatsapp_conversations(id) on delete cascade,
  kind text not null check (kind in ('greeting', 'flow')),
  expected_state text not null,
  -- [{type:'text', text}] | [{type:'file', url, caption}, {type:'text', text}?]
  payload jsonb not null,
  send_after timestamptz not null,
  sent_at timestamptz,
  cancelled_reason text,
  created_at timestamptz not null default now()
);

create unique index if not exists whatsapp_deferred_sends_one_pending_idx
  on whatsapp_deferred_sends(conversation_id)
  where sent_at is null and cancelled_reason is null;

create index if not exists whatsapp_deferred_sends_due_idx
  on whatsapp_deferred_sends(tenant_id, send_after)
  where sent_at is null and cancelled_reason is null;

alter table whatsapp_deferred_sends enable row level security;

-- Same shape as 0054: reads scoped to the tenant, writes to the roles that run the
-- inbox. The real writer is the service role (webhook + engine), which bypasses RLS.
drop policy if exists whatsapp_deferred_sends_tenant on whatsapp_deferred_sends;
create policy whatsapp_deferred_sends_tenant on whatsapp_deferred_sends
  for all
  using (
    tenant_id = current_tenant_id()
    and exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and p.role in ('owner', 'admin', 'studio_manager', 'lead_coordinator')
    )
  )
  with check (
    tenant_id = current_tenant_id()
    and exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and p.role in ('owner', 'admin', 'studio_manager', 'lead_coordinator')
    )
  );

grant select, insert, update, delete on whatsapp_deferred_sends to authenticated;
grant select, insert, update, delete on whatsapp_deferred_sends to service_role;

-- whatsapp_conversations
-- --------------------------------------------------------------------------------
-- nudge_sent_at    — the one-time "still here?" for a conversation that went quiet in
--                    AWAITING_DETAILS / PARTIAL_DETAILS. Once, never twice.
-- hot_alert_sent_at — the owner is told about a hot lead exactly once, however many
--                    more messages the customer sends afterwards.
alter table whatsapp_conversations
  add column if not exists nudge_sent_at timestamptz,
  add column if not exists hot_alert_sent_at timestamptz;

create index if not exists whatsapp_conversations_inflow_idx
  on whatsapp_conversations(tenant_id, last_bot_message_at)
  where state in ('AWAITING_DETAILS', 'PARTIAL_DETAILS') and nudge_sent_at is null;

-- The daily digest's "already sent today" marker lives in app_settings
-- (key whatsapp_digest_last_sent_on, unique (tenant_id, key) from 0001) — no column.
