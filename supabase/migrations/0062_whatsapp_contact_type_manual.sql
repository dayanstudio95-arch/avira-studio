-- Manual contact-type override on WhatsApp conversations (2026-09-15).
--
-- The owner asked to click the "לקוח קיים / צוות / לא מוכר" tag on a conversation and
-- change it by hand. That is a bigger deal than a label: contact_type is the bot's
-- first gate, and 'unknown' is the only type it ever answers. Tagging a colleague as
-- staff silences the bot for them; tagging a mis-filed couple back to unknown lets it
-- help them.
--
-- The webhook re-classifies a conversation whose type is 'unknown' on every inbound
-- message (so a lead created since gets recognised). Without this column a manual
-- change back to 'unknown' would be silently undone by the next message from a number
-- that still matches an old lead row. The webhook now skips re-classification when
-- contact_type_manual_at is set.
alter table whatsapp_conversations
  add column if not exists contact_type_manual_at timestamptz;
