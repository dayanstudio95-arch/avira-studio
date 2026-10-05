-- WhatsApp Pro, stage 0 — foundations (2026-10-05). ADDITIVE ONLY: no column, table or
-- policy that exists today is changed or dropped. Re-runnable.
--
-- Why each piece exists (all found while planning "אווירה צ'אט"):
--
-- 1. whatsapp_message_status — delivery receipts (✓ sent / ✓✓ delivered / read / failed).
--    Green API sends them as `outgoingMessageStatus` and the webhook dropped them, which is
--    how a gallery message sat on one grey tick for weeks with nobody knowing. A separate
--    table, not columns on whatsapp_messages, because a status can arrive BEFORE the
--    message row exists (the echo of our own send and its receipt race), and because a
--    receipt for a message sent by any of our other functions must be recorded too.
--    Keyed by (tenant_id, id_message) — the same id Green API uses everywhere.
--    Payload verified against
--    https://green-api.com/en/docs/api/receiving/notifications-format/outgoing-message/OutgoingMessageStatus/
--    on 2026-10-05: top-level chatId, idMessage, status, timestamp, sendByApi, description.
--
-- 2. whatsapp_messages: who wrote it inside a group (sender_*), which message a reply
--    quotes (quoted_id_message = extendedTextMessageData.stanzaId, verified against the
--    QuotedMessage doc the same day), and our own copy of the media (media_path/_mime/_size).
--    Green API's downloadUrl is temporary; the inbox's old images would stop opening.
--
-- 3. Storage bucket `whatsapp-media` — PRIVATE. Customer photos and voice notes are
--    personal data; they are read through short-lived signed URLs only. Path:
--    <tenant_id>/<conversation_id>/<id_message>.<ext>. The webhook writes with the service
--    role; the read policy below is the same role set that can read the inbox (0054).
--    No retention deletion yet — the owner decides the period before that is built.

-- ---------------------------------------------------------------------------------
-- 1. Delivery status
-- ---------------------------------------------------------------------------------
create table if not exists whatsapp_message_status (
  tenant_id uuid not null references tenants(id) on delete cascade,
  id_message text not null,
  chat_id text,
  status text not null,
  -- sent=1 < delivered=2 < read=3; failure states 9. A receipt may arrive late or twice;
  -- the webhook only ever moves a row forward (see statusRank in _shared/whatsappStatus.ts).
  status_rank smallint not null default 0,
  description text,
  status_at timestamptz,
  updated_at timestamptz not null default now(),
  -- Set once when the studio was told "this message has not been delivered for 24h".
  stuck_alerted_at timestamptz,
  primary key (tenant_id, id_message)
);

create index if not exists whatsapp_message_status_stuck_idx
  on whatsapp_message_status(tenant_id, updated_at)
  where status = 'sent' and stuck_alerted_at is null;

alter table whatsapp_message_status enable row level security;

drop policy if exists whatsapp_message_status_select on whatsapp_message_status;
create policy whatsapp_message_status_select on whatsapp_message_status
  for select using (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid()
                and role in ('owner','admin','studio_manager','lead_coordinator'))
  );
-- No write policy for `authenticated`: only the webhook (service role) writes receipts.

grant select on whatsapp_message_status to authenticated;
grant select, insert, update, delete on whatsapp_message_status to service_role;

-- ---------------------------------------------------------------------------------
-- 2. Message columns
-- ---------------------------------------------------------------------------------
alter table whatsapp_messages
  add column if not exists sender_chat_id text,
  add column if not exists sender_name text,
  add column if not exists quoted_id_message text,
  add column if not exists media_path text,
  add column if not exists media_mime text,
  add column if not exists media_size bigint;

-- ---------------------------------------------------------------------------------
-- 3. Private media bucket
-- ---------------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('whatsapp-media', 'whatsapp-media', false)
on conflict (id) do nothing;

drop policy if exists whatsapp_media_select on storage.objects;
create policy whatsapp_media_select on storage.objects
  for select to authenticated using (
    bucket_id = 'whatsapp-media'
    and (storage.foldername(name))[1] = current_tenant_id()::text
    and exists (select 1 from profiles where id = auth.uid()
                and role in ('owner','admin','studio_manager','lead_coordinator'))
  );
-- No insert/update/delete policy: the webhook writes with the service role.
