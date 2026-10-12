-- "לא נקראו" counts only what nobody has dealt with yet (2026-10-13, the owner's request).
--
-- Green API has no event for "the owner read this chat on his phone" (checked in its
-- notification list), so the system could not know a chat was read there — "לא נקראו"
-- kept growing. From now on a message counts as read when, after it arrived, the studio
-- answered (from the phone or from the system: an outbound_human message) or the chat was
-- marked "✓ טופל" — not only when it was opened in the system. The bot's own replies do
-- not count: they don't mean a person saw it.
create or replace function whatsapp_unread_counts()
returns table (conversation_id uuid, unread integer)
language sql stable security invoker set search_path = public as $$
  with seen as (
    select c.id,
           greatest(
             coalesce(c.last_read_at, '-infinity'::timestamptz),
             coalesce(c.handled_at, '-infinity'::timestamptz),
             coalesce((select max(o.created_at) from whatsapp_messages o
                        where o.conversation_id = c.id and o.direction = 'outbound_human'), '-infinity'::timestamptz)
           ) as at
    from whatsapp_conversations c
    where c.last_inbound_at is not null
  )
  select m.conversation_id, count(*)::int
  from whatsapp_messages m
  join seen s on s.id = m.conversation_id
  where m.direction = 'inbound'
    and m.created_at > s.at
  group by m.conversation_id
$$;

grant execute on function whatsapp_unread_counts() to authenticated;
