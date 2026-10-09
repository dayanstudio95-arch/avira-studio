-- A couple who signed is a client, not a lead (2026-10-09, the owner's decision).
--
-- The webhook only classifies a chat while it is still "לא מוכר", so a chat that was
-- "ליד" stayed "ליד" after the contract — in the leads box, in "דורש מענה", with the AI
-- sales button. From now on: when a lead signs (signed_at set) or its status becomes
-- נסגר/חתימה or חוזה — from the contract page, the leads page, the wizard or the chat —
-- its WhatsApp conversations become "לקוח".
--
-- Matched by the linked lead (matched_lead_id) or by phone (last 9 digits of the lead's
-- phone or signed phone). Only chats that are "ליד" or "לא מוכר" move — also when the
-- owner set "ליד" by hand (the usual way a stranger becomes a lead; signing is the next
-- step, not a contradiction). Staff, vendors, groups, irrelevant, clients: never. It
-- runs only when the lead's status CHANGES to closed/signed, so a chat the owner moves
-- back to "ליד" afterwards stays there. Each change
-- is written to whatsapp_activity as a normal "set_type", so it shows in the chat's
-- history and "בטל" works. Going back to an open status does NOT turn the chat back into
-- a lead — that is one click in the chat.

create or replace function whatsapp_move_lead_chats_to_client(p_lead_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  l record;
  p1 text;
  p2 text;
  n integer;
begin
  select id, tenant_id, phone_number, signed_phone_number into l from leads where id = p_lead_id;
  if not found then
    return 0;
  end if;
  p1 := right(regexp_replace(coalesce(l.phone_number, ''), '\D', '', 'g'), 9);
  p2 := right(regexp_replace(coalesce(l.signed_phone_number, ''), '\D', '', 'g'), 9);

  with targets as (
    select c.id, c.tenant_id, c.contact_type as old_type, c.contact_type_manual_at as old_manual
      from whatsapp_conversations c
     where c.tenant_id = l.tenant_id
       and c.contact_type in ('lead', 'unknown')
       and c.chat_id not like '%@g.us'
       and (
         c.matched_lead_id = l.id
         or (length(p1) = 9 and right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 9) = p1)
         or (length(p2) = 9 and right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 9) = p2)
       )
  ), moved as (
    update whatsapp_conversations c
       set contact_type = 'client',
           matched_lead_id = coalesce(c.matched_lead_id, l.id)
      from targets t
     where c.id = t.id
    returning t.id, t.tenant_id, t.old_type, t.old_manual
  ), logged as (
    insert into whatsapp_activity (tenant_id, conversation_id, action, before, after)
    select m.tenant_id, m.id, 'set_type',
           jsonb_build_object('contactType', m.old_type, 'contactTypeManualAt', m.old_manual),
           jsonb_build_object('contactType', 'client', 'reason', 'signed')
      from moved m
    returning 1
  )
  select count(*) into n from logged;
  return n;
end;
$$;

create or replace function whatsapp_signed_lead_to_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.signed_at is not null and (tg_op = 'INSERT' or old.signed_at is null))
     or (new.status in ('נסגר/חתימה', 'חוזה') and (tg_op = 'INSERT' or old.status is distinct from new.status)) then
    perform whatsapp_move_lead_chats_to_client(new.id);
  end if;
  return new;
end;
$$;

-- Server-side only: not callable from the browser.
revoke all on function whatsapp_move_lead_chats_to_client(uuid) from public, anon, authenticated;

drop trigger if exists whatsapp_signed_lead_to_client on leads;
create trigger whatsapp_signed_lead_to_client
  after insert or update of signed_at, status on leads
  for each row execute function whatsapp_signed_lead_to_client();

-- The couples who already signed (3 chats on 9.10.2026).
select whatsapp_move_lead_chats_to_client(id)
  from leads
 where signed_at is not null or status in ('נסגר/חתימה', 'חוזה');
