-- "טופל" — the owner's way to say "this one doesn't need an answer" (2026-10-05).
--
-- "דורש מענה" is computed: the customer wrote last and nobody (he or the bot) answered
-- since. Plenty of those need nothing — "תודה", "מושלם", a thumbs-up. Marking one as handled
-- stamps the time; it stays out of "דורש מענה" until the person writes AGAIN (a newer
-- inbound message), then it comes back by itself. Additive, re-runnable.
alter table whatsapp_conversations add column if not exists handled_at timestamptz;
