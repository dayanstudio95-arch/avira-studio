-- Manual follow-up flag on a WhatsApp conversation (2026-09-15).
--
-- The follow-up queue ("ממתינים לפולו-אפ") was derived only from the bot: state
-- PRICELIST_SENT, no reply, not yet nudged. When the owner sends the price list from his
-- own phone the bot is silent, the state never reaches PRICELIST_SENT, and that couple
-- is in no queue. He asked to mark a conversation for follow-up by hand.
--
-- A flag with a timestamp rather than a boolean: sending the follow-up stamps
-- followup_sent_at, and "flagged AFTER the last follow-up" is what keeps a conversation
-- in the queue — so re-flagging after a nudge works without clearing anything.
alter table whatsapp_conversations
  add column if not exists followup_flagged_at timestamptz;
