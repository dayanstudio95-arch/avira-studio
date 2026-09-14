-- Where a WhatsApp conversation came from — starting with Facebook/Instagram ads.
--
-- What this is for
-- --------------------------------------------------------------------------------
-- 2026-09-14, a real message the bot ignored: "Hello! Can I get more info on this?"
-- from a stranger. No Hebrew, no service word, no date — the reply gate said
-- `no_intent` and it was right about the words. But the stored payload showed the
-- message came through the studio's own Facebook ad for wedding photography
-- (extendedTextMessageData.sourceType = 'ad', with the ad id, title and copy). That is
-- a customer by construction, and the owner's instruction was direct:
-- "צריך שהבוט יענה גם לכאלה שמגיעים דרך המודעה".
--
-- Why it has to live on the conversation, not just be read off the message
-- --------------------------------------------------------------------------------
-- Only the FIRST message after the ad tap carries the attribution. If the bot cannot
-- reply to that one (quiet hours, hourly quota) and the person writes "hello?" later,
-- that second message looks like any stranger's. The webhook therefore stamps the
-- source on the conversation once, and the gate reads it back for every later message.
--
-- It also answers the question the owner asked on 2026-09-09 and deferred — "where do
-- the good leads come from" — for the WhatsApp channel at least. The `leads` table has
-- no source column yet; when a lead is created from an ad conversation the inbox writes
-- it into the notes.
--
-- The backfill at the bottom tags every existing ad conversation from its stored
-- payload, so the 2026-09-14 lead and any earlier ones are covered without re-sending.

alter table whatsapp_conversations
  add column if not exists source text
    check (source in ('facebook_ad')),
  add column if not exists source_ad_id text,
  add column if not exists source_ad_title text;

create index if not exists whatsapp_conversations_source_idx
  on whatsapp_conversations(tenant_id, source)
  where source is not null;

-- Backfill from the raw payloads already stored. `distinct on` keeps the earliest ad
-- message per conversation, which is the one that opened it.
update whatsapp_conversations c
set
  source = 'facebook_ad',
  source_ad_id = nullif(a.ext->>'sourceId', ''),
  source_ad_title = nullif(a.ext->>'title', '')
from (
  select distinct on (m.conversation_id)
    m.conversation_id,
    m.raw->'messageData'->'extendedTextMessageData' as ext
  from whatsapp_messages m
  where m.direction = 'inbound'
    and (
      m.raw->'messageData'->'extendedTextMessageData'->>'sourceType' = 'ad'
      or coalesce(m.raw->'messageData'->'extendedTextMessageData'->>'ctwaClid', '') <> ''
    )
  order by m.conversation_id, m.created_at asc
) a
where a.conversation_id = c.id
  and c.source is null;
