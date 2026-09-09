-- Lead temperature + the follow-up queue.
--
-- What this is for
-- --------------------------------------------------------------------------------
-- Stage 3 went live on 2026-09-09 and within the hour the bot had handled real leads
-- end to end — greeting, details, price list. That immediately produced the next
-- question, which is the one that actually makes the studio money: of the people who
-- got a price list, who is ready to book, and who has gone quiet and needs a nudge?
--
-- Those are two different populations and they are told apart by one fact: did they
-- reply after the price list.
--   - They replied  -> read the reply and rate it (hot / warm / cold).
--   - They didn't   -> they belong in the follow-up queue.
--
-- ⚠️ Nothing here sends a message. The temperature is a label on a row in the inbox,
-- and the follow-up is sent only when Daniel presses send (his explicit choice on
-- 2026-09-09, after a paid third-party bot had been improvising at his customers).
--
-- Why the rating is allowed to use AI when the reply gate is not
-- --------------------------------------------------------------------------------
-- The gate in _shared/whatsappIntent.ts had to fail closed and had to be a readable
-- word list, because a mistake there SENDS A PRICE LIST TO A COLLEAGUE. This rating
-- sends nothing — a wrong "hot" costs Daniel one glance at a row he didn't need to
-- look at. The costs are not remotely symmetric, so the tools shouldn't be either.
-- Do not later "harmonise" these two into the same level of suspicion.
--
-- The stored reason is the same idea as bot_skip_reason: a wrong rating should be
-- findable by reading the screen, not by reasoning about the model.

alter table whatsapp_conversations
  -- null = never rated. Distinct from 'cold': nobody has replied since the price
  -- list, which is exactly what puts them in the follow-up queue instead.
  add column if not exists lead_temperature text
    check (lead_temperature in ('hot','warm','cold')),
  -- One short Hebrew sentence, shown under the name in the inbox.
  add column if not exists lead_temperature_reason text,
  add column if not exists lead_temperature_at timestamptz,
  -- Set when Daniel sends a follow-up from the inbox, so a conversation he has
  -- already nudged drops out of the queue instead of resurfacing every day.
  add column if not exists followup_sent_at timestamptz;

-- Partial index: "show me the hot ones" is the query this exists for, and hot is a
-- small minority of rows. Same shape as whatsapp_conversations_would_reply_idx.
create index if not exists whatsapp_conversations_hot_idx
  on whatsapp_conversations(tenant_id, lead_temperature_at desc)
  where lead_temperature = 'hot';

-- The follow-up queue: price list sent, not yet nudged. Ordered by when the price
-- list went out, because the oldest silence is the most urgent.
create index if not exists whatsapp_conversations_followup_idx
  on whatsapp_conversations(tenant_id, last_bot_message_at)
  where state = 'PRICELIST_SENT' and followup_sent_at is null;

-- No RLS or grant changes: whatsapp_conversations already has its policies from
-- 0054_whatsapp_bot.sql, and Postgres policies are per-table, not per-column.
