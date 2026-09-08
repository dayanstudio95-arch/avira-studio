-- WhatsApp lead bot — DRY RUN. The decision layer, with no send path attached.
--
-- What this adds: on every inbound message the webhook now runs the full Stage 2 gate
-- chain and RECORDS its verdict ("I would have replied to this" / "I stayed silent
-- because X"). It still sends nothing, in any code path. The point is to measure the
-- gate against a week of real traffic before anyone is asked to trust it.
--
-- Why this exists at all
-- --------------------------------------------------------------------------------
-- Stage 1 ran for a day and immediately produced the thing it was built to catch: of
-- the 15 chats labelled `unknown`, only about a third were real photography inquiries.
-- The rest were a wedding photographer, a cake supplier, a saxophonist, two event
-- producers, and a couple of personal chats — every one of them a number the bot was
-- eligible to price-list. `contact_type` alone is therefore NOT a sufficient gate: it
-- can only recognise people we already have in the database, and a stranger pitching
-- us their own services looks exactly like a stranger asking about a wedding.
--
-- Two protection ideas were tried before this one and both were killed by a cheap
-- empirical check rather than by argument, which is why this one is being measured
-- instead of trusted:
--   1. "Only reply to numbers that are NOT in the studio's phonebook." Falsified by
--      querying the stored `raw` payloads: `senderContactName` came back empty for
--      14 of 15 unknown chats, including contacts Daniel definitely has saved. The
--      readable names in the inbox come from `senderName` — a self-set WhatsApp
--      profile name, not our phonebook.
--   2. "Then pull the phonebook directly via Green API's GetContacts." Falsified by
--      one API call: the records come back with an empty `id` and an empty
--      `contactName`, carrying only a `lid` (WhatsApp's privacy identifier), so they
--      cannot be matched to a phone number at all.
--
-- So the gate here is content-based, and it fails closed: silence unless the message
-- positively looks like someone asking about photographing their own event. See
-- supabase/functions/_shared/whatsappIntent.ts for the rules themselves.
--
-- ⚠️ Nothing in this migration, and nothing in the code that reads these columns,
-- sends a WhatsApp message. `bot_would_reply` is a note in a log. Switching the bot on
-- for real is Stage 2 and needs its own explicit go-ahead.

-- ---------------------------------------------------------------------------------
-- The verdict, recorded per message.
-- ---------------------------------------------------------------------------------
alter table whatsapp_messages
  -- true  = every gate passed; Stage 2 would have sent a greeting here.
  -- false = at least one gate said no.
  -- null  = not evaluated. Outbound messages, and any inbound row written before this
  --         migration — deliberately distinct from `false`, so "the bot decided to
  --         stay silent" is never confused with "nobody asked the bot".
  add column if not exists bot_would_reply boolean,
  -- Machine-readable code for WHICH gate stopped it (group / known_contact /
  -- bot_muted / not_first_message / not_text / quiet_hours / no_intent / ok).
  -- Rendered in Hebrew by src/components/whatsapp/whatsappInboxShared.js — kept as a
  -- stable code rather than a sentence so the wording can be reworded without a
  -- migration and so the counts can be grouped in SQL.
  add column if not exists bot_skip_reason text;

-- Partial index: the only query that touches these columns asks "show me everything
-- the bot would have answered", which is a small minority of rows. A partial index
-- keeps it cheap without paying for the 90%+ of rows that are false/null.
create index if not exists whatsapp_messages_would_reply_idx
  on whatsapp_messages(tenant_id, created_at desc)
  where bot_would_reply is true;

-- ---------------------------------------------------------------------------------
-- Conversation-level mirror of the latest verdict.
--
-- Denormalised on purpose. The inbox list renders ~50 conversations without loading
-- their messages, so without these the "the bot would have answered this one" chip
-- would require a second query per row. They are strictly a cache of the newest
-- inbound message's verdict; whatsapp_messages remains the record of what happened.
-- ---------------------------------------------------------------------------------
alter table whatsapp_conversations
  -- When the bot last WOULD have replied. Never cleared once set: it marks the
  -- conversation as one where the gate opened at least once, which is exactly the
  -- population worth reviewing by hand before Stage 2.
  add column if not exists bot_would_reply_at timestamptz,
  -- Verdict code for the most recent inbound message only (see above for values).
  add column if not exists bot_last_decision text;

create index if not exists whatsapp_conversations_would_reply_idx
  on whatsapp_conversations(tenant_id, bot_would_reply_at desc)
  where bot_would_reply_at is not null;

-- No RLS or grant changes: both tables already have their policies and grants from
-- 0054_whatsapp_bot.sql, and Postgres policies are per-table, not per-column.
