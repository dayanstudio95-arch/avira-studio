-- Two owner requests (2026-10-13). Additive / data-only — no column is dropped.
--
-- 1. Reactions (👍 / ❤️ on a message) are shown on the message they belong to.
--    Green API names that message in messageData.quotedMessage.stanzaId; the webhook
--    stored only extendedTextMessageData.stanzaId, so every reaction so far has no target.
update whatsapp_messages
   set quoted_id_message = raw->'messageData'->'quotedMessage'->>'stanzaId'
 where type_message = 'reactionMessage'
   and quoted_id_message is null
   and raw->'messageData'->'quotedMessage'->>'stanzaId' is not null;

--    A reaction is not a new message: it no longer counts as unread...
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
    and coalesce(m.type_message, '') <> 'reactionMessage'
    and m.created_at > s.at
  group by m.conversation_id
$$;
grant execute on function whatsapp_unread_counts() to authenticated;

--    ...and does not make a chat "waiting for an answer". Chats whose newest incoming row
--    is a reaction get their last-message fields back from the newest real message
--    (from now on the webhook leaves them alone on a reaction).
with fix as (
  select c.id,
         (select max(m.created_at) from whatsapp_messages m
           where m.conversation_id = c.id and m.direction = 'inbound'
             and coalesce(m.type_message, '') <> 'reactionMessage') as last_in,
         (select m.id from whatsapp_messages m
           where m.conversation_id = c.id
             and not (m.direction = 'inbound' and coalesce(m.type_message, '') = 'reactionMessage')
           order by m.created_at desc limit 1) as last_msg_id
    from whatsapp_conversations c
   where (select m.type_message from whatsapp_messages m
           where m.conversation_id = c.id and m.direction = 'inbound'
           order by m.created_at desc limit 1) = 'reactionMessage'
)
update whatsapp_conversations c
   set last_inbound_at = f.last_in,
       last_message_at = coalesce(lm.created_at, c.last_message_at),
       last_message_preview = coalesce(left(lm.body_text, 200), lm.type_message, c.last_message_preview)
  from fix f
  left join whatsapp_messages lm on lm.id = f.last_msg_id
 where c.id = f.id;

-- 2. "הסר" → "לא רלוונטי". From now on the webhook does it; these are the chats that
--    already asked. Team and groups keep their type. Logged as a normal type change.
with moved as (
  update whatsapp_conversations c
     set contact_type = 'irrelevant',
         contact_type_manual_at = now()
    from (select id, contact_type as old_type, contact_type_manual_at as old_manual
            from whatsapp_conversations
           where opted_out_at is not null
             and contact_type not in ('staff', 'group', 'irrelevant')) o
   where c.id = o.id
  returning c.tenant_id, c.id, o.old_type, o.old_manual
)
insert into whatsapp_activity (tenant_id, conversation_id, action, before, after)
select tenant_id, id, 'set_type',
       jsonb_build_object('contactType', old_type, 'contactTypeManualAt', old_manual),
       jsonb_build_object('contactType', 'irrelevant', 'reason', 'opt_out')
  from moved;
