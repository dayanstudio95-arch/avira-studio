-- WhatsApp lead bot — Stage 1 schema (ingest + inbox screen only).
--
-- What this is for: today every first-contact WhatsApp message ("כמה עולה צילום?")
-- is answered manually and leaves no trace in the system. This migration adds the two
-- tables that let us (a) record every inbound/outbound WhatsApp message that Green API
-- reports, and (b) render them as a real conversation screen inside AVIRA.
--
-- IMPORTANT — Stage 1 sends NOTHING. The whatsapp-webhook Edge Function added
-- alongside this migration only records what arrives. The bot replying to anyone is
-- Stage 2 and needs its own explicit go-ahead. These tables already carry the Stage 2
-- columns (state / bot_enabled / the parsed detail fields) so the schema doesn't have
-- to change again later, but nothing writes a reply yet.
--
-- The central risk this schema is shaped around
-- --------------------------------------------------------------------------------
-- The studio runs ONE Green API instance, and it already sends contracts, payment
-- reminders, questionnaires, staff schedules and album sketches from 11+ Edge
-- Functions. The moment `incomingWebhook` is switched on at Green API, EVERY reply
-- from EVERYONE lands on our endpoint — existing couples mid-production, photographers,
-- editors, group chats. A bot that price-lists any of those would be actively harmful.
--
-- So `whatsapp_conversations.contact_type` is computed on every inbound message by
-- matching the sender's phone against leads / events / staff, and the bot is only ever
-- allowed to act on `unknown`. The match is done on a normalized phone on BOTH sides:
-- the DB stores `0501234567` while Green API delivers `972501234567@c.us`, so a naive
-- comparison matches nothing and would classify the whole studio as strangers. Hence
-- the dedicated `phone` column here (always normalized local form) rather than
-- comparing `chat_id` directly.
--
-- Idempotency: Green API resends any notification we don't answer with a 200 within
-- 180s, retrying every 60s for up to 24 hours (verified against Green API's official
-- webhook docs, 2026-09-08). `unique (tenant_id, id_message)` on whatsapp_messages is
-- what makes that safe — the webhook inserts the message row FIRST and treats a unique
-- violation as "already handled, exit". That constraint is the dedupe; do not drop it.

-- ---------------------------------------------------------------------------------
-- Conversations — one row per (tenant, chat), i.e. per phone number talking to us.
-- ---------------------------------------------------------------------------------
create table if not exists whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,

  -- Green API's chat identifier, e.g. '972501234567@c.us' (groups end in '@g.us').
  chat_id text not null,
  -- Same number in the local normalized form the rest of the DB uses ('0501234567'),
  -- so it can be compared against leads.phone_number / events.phone_number /
  -- staff_members.phone_number. Null for chats we couldn't normalize (e.g. groups).
  phone text,

  -- Stage 2 state machine. Stage 1 leaves every row at 'NEW' and never advances it.
  state text not null default 'NEW'
    check (state in ('NEW','AWAITING_DETAILS','PARTIAL_DETAILS','PRICELIST_SENT','HANDED_OFF','EXPIRED')),

  -- Per-conversation mute. Set to false automatically the moment Daniel answers from
  -- his own phone (Green API reports that as outgoingMessageReceived) or replies from
  -- the inbox screen. This is the single most important protection in the module:
  -- without it the bot talks over a human mid-conversation in front of a client.
  bot_enabled boolean not null default true,

  -- Who this number belongs to. Only 'unknown' is ever eligible for a bot reply.
  contact_type text not null default 'unknown'
    check (contact_type in ('unknown','lead','client','staff','group')),
  matched_lead_id uuid references leads(id) on delete set null,
  matched_event_id uuid references events(id) on delete set null,
  -- Whatever name WhatsApp itself reports (senderName / chatName) — display only.
  display_name text,

  -- Details parsed out of the conversation (Stage 3). Kept nullable and never
  -- overwritten with null, so a value confirmed in message 1 survives message 4.
  couple_names text,
  event_date date,
  venue text,
  guest_count integer,
  callback_phone text,

  -- Inbox ordering / preview.
  last_inbound_at timestamptz,
  last_message_at timestamptz,
  last_message_preview text,
  last_bot_message_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, chat_id)
);

create index if not exists whatsapp_conversations_tenant_idx
  on whatsapp_conversations(tenant_id, last_message_at desc);
create index if not exists whatsapp_conversations_phone_idx
  on whatsapp_conversations(tenant_id, phone);

-- ---------------------------------------------------------------------------------
-- Messages — full append-only log, and the dedupe key for webhook retries.
-- ---------------------------------------------------------------------------------
create table if not exists whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  conversation_id uuid not null references whatsapp_conversations(id) on delete cascade,

  -- Green API's idMessage. Unique per tenant — see the idempotency note in the header.
  id_message text not null,

  -- 'inbound'        — the other side wrote to us
  -- 'outbound_bot'   — this module sent it (Stage 2+; nothing writes this yet)
  -- 'outbound_human' — Daniel sent it, either from his phone or from the inbox screen
  direction text not null check (direction in ('inbound','outbound_bot','outbound_human')),

  type_webhook text,
  -- Green API's messageData.typeMessage: textMessage / extendedTextMessage /
  -- imageMessage / audioMessage / ... Anything that isn't text is shown as a link.
  type_message text,
  body_text text,
  media_url text,
  -- The complete payload exactly as received, so a message shape we didn't anticipate
  -- is still recoverable without re-asking Green API.
  raw jsonb,

  created_at timestamptz not null default now(),

  unique (tenant_id, id_message)
);

create index if not exists whatsapp_messages_conversation_idx
  on whatsapp_messages(conversation_id, created_at);
create index if not exists whatsapp_messages_tenant_idx
  on whatsapp_messages(tenant_id, created_at desc);

-- updated_at auto-touch — reuses set_updated_at() from 0001_init.sql. Only
-- whatsapp_conversations needs it; whatsapp_messages is append-only.
drop trigger if exists set_updated_at on whatsapp_conversations;
create trigger set_updated_at before update on whatsapp_conversations
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------------
-- RLS
--
-- These rows are real customer conversations, so unlike leads/events they are NOT
-- open to every tenant member: photographers and editors have no business reading
-- them. Both read and write are gated to owner/admin/studio_manager (ADMIN_ROLES) plus
-- lead_coordinator, matching the route/nav gating in App.jsx + permissions.js — which
-- is UI only and never sufficient on its own.
--
-- The webhook itself writes with a service-role client and bypasses RLS entirely; the
-- policies here protect reads from the frontend.
-- ---------------------------------------------------------------------------------
alter table whatsapp_conversations enable row level security;
alter table whatsapp_messages enable row level security;

-- Every object above this point is created with `if not exists`; policies have no such
-- form, so they're dropped first to keep the whole migration re-runnable.
drop policy if exists whatsapp_conversations_select on whatsapp_conversations;
drop policy if exists whatsapp_conversations_write_by_admin on whatsapp_conversations;
drop policy if exists whatsapp_messages_select on whatsapp_messages;
drop policy if exists whatsapp_messages_write_by_admin on whatsapp_messages;

create policy whatsapp_conversations_select on whatsapp_conversations
  for select using (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid()
                and role in ('owner','admin','studio_manager','lead_coordinator'))
  );
create policy whatsapp_conversations_write_by_admin on whatsapp_conversations
  for all using (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid()
                and role in ('owner','admin','studio_manager','lead_coordinator'))
  ) with check (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid()
                and role in ('owner','admin','studio_manager','lead_coordinator'))
  );

create policy whatsapp_messages_select on whatsapp_messages
  for select using (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid()
                and role in ('owner','admin','studio_manager','lead_coordinator'))
  );
create policy whatsapp_messages_write_by_admin on whatsapp_messages
  for all using (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid()
                and role in ('owner','admin','studio_manager','lead_coordinator'))
  ) with check (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid()
                and role in ('owner','admin','studio_manager','lead_coordinator'))
  );

-- ---------------------------------------------------------------------------------
-- Grants — 0002_grants.sql / 0008_service_role_grants.sql were one-time snapshots
-- (not `alter default privileges`), so every table added since 0016 needs its own
-- explicit grants or every query fails with 42501 regardless of RLS.
-- ---------------------------------------------------------------------------------
grant select, insert, update, delete on
  whatsapp_conversations, whatsapp_messages
  to authenticated;
grant select, insert, update, delete on
  whatsapp_conversations, whatsapp_messages
  to service_role;
