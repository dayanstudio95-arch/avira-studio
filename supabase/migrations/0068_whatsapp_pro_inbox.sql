-- WhatsApp Pro, stage 1א — the "אווירה צ'אט" inbox (2026-10-05). ADDITIVE ONLY, re-runnable.
--
-- The owner's model for sorting conversations (agreed with him, plan "שלב 12"): three
-- separate questions, so they can never contradict each other.
--   מי זה  — contact_type (exists). Extended with past_client / vendor / irrelevant.
--            Any value other than 'unknown' keeps the bot silent, so tagging a vendor
--            or an irrelevant chat also silences the bot for them — intended.
--   שלב    — the lead stage. The SAME vocabulary as leads.status in the CRM. While a
--            conversation has no linked lead it lives here (lead_stage); once it has one
--            (matched_lead_id) the CRM's leads.status IS the stage and lead_stage is not
--            used. ⚠️ The owner's rule (2026-10-05): nothing enters the CRM by itself —
--            a lead is created only by pressing "צור ליד" and saving.
--   תוויות — free, many per conversation (whatsapp_labels + whatsapp_conversation_labels).
--            Internal only: Green API has no access to WhatsApp Business labels.
--
-- Plus: archive / pin / read state / opt-out, internal notes, an activity log that makes
-- every change (and every bulk change) undoable, quick-reply templates, and Realtime.

-- ---------------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------------
alter table whatsapp_conversations
  add column if not exists lead_stage text
    check (lead_stage is null or lead_stage in ('חדש','נשלחה הצעה','פולו-אפ','נסגר/חתימה','חוזה','לא רלוונטי')),
  add column if not exists archived_at timestamptz,
  add column if not exists pinned_at timestamptz,
  add column if not exists last_read_at timestamptz,
  add column if not exists opted_out_at timestamptz,
  add column if not exists opted_out_reason text;

-- Start every existing conversation as "read": otherwise the first day of the new inbox
-- would show the whole history as unread.
update whatsapp_conversations set last_read_at = now() where last_read_at is null;

-- contact_type: the inline CHECK from 0054 is named by Postgres
-- whatsapp_conversations_contact_type_check. Replaced with the wider list.
alter table whatsapp_conversations drop constraint if exists whatsapp_conversations_contact_type_check;
alter table whatsapp_conversations add constraint whatsapp_conversations_contact_type_check
  check (contact_type in ('unknown','lead','client','past_client','staff','vendor','group','irrelevant'));

-- ---------------------------------------------------------------------------------
-- New tables. Same RLS as 0054: owner/admin/studio_manager/lead_coordinator, own tenant.
-- ---------------------------------------------------------------------------------
create table if not exists whatsapp_labels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  color text not null default '#3E63DD',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table if not exists whatsapp_conversation_labels (
  tenant_id uuid not null references tenants(id) on delete cascade,
  conversation_id uuid not null references whatsapp_conversations(id) on delete cascade,
  label_id uuid not null references whatsapp_labels(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (conversation_id, label_id)
);
create index if not exists whatsapp_conversation_labels_label_idx
  on whatsapp_conversation_labels(tenant_id, label_id);

-- Internal notes — visible only inside the system, never sent.
create table if not exists whatsapp_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  conversation_id uuid not null references whatsapp_conversations(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists whatsapp_notes_conversation_idx on whatsapp_notes(conversation_id, created_at);

-- Every change a person (or the webhook) makes to a conversation's sorting. `before` /
-- `after` hold exactly the fields changed, so undo is "apply `before`". `batch_id` groups
-- one bulk action ("mark these 30 as leads") so it is undone as one.
create table if not exists whatsapp_activity (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  conversation_id uuid not null references whatsapp_conversations(id) on delete cascade,
  action text not null,
  before jsonb,
  after jsonb,
  batch_id uuid,
  actor uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists whatsapp_activity_conversation_idx on whatsapp_activity(conversation_id, created_at desc);
create index if not exists whatsapp_activity_batch_idx on whatsapp_activity(tenant_id, batch_id) where batch_id is not null;

-- Quick replies ("/" in the composer).
create table if not exists whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['whatsapp_labels','whatsapp_conversation_labels','whatsapp_notes','whatsapp_activity','whatsapp_templates']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_rw', t);
    execute format($p$
      create policy %I on %I for all using (
        tenant_id = current_tenant_id()
        and exists (select 1 from profiles where id = auth.uid()
                    and role in ('owner','admin','studio_manager','lead_coordinator'))
      ) with check (
        tenant_id = current_tenant_id()
        and exists (select 1 from profiles where id = auth.uid()
                    and role in ('owner','admin','studio_manager','lead_coordinator'))
      )$p$, t || '_rw', t);
    execute format('grant select, insert, update, delete on %I to authenticated, service_role', t);
    -- tenant_id filled from the caller when the client omits it (0055's trigger).
    if exists (select 1 from pg_proc where proname = 'set_tenant_id') then
      execute format('drop trigger if exists set_tenant_id on %I', t);
      execute format('create trigger set_tenant_id before insert on %I for each row execute function set_tenant_id()', t);
    end if;
  end loop;
end $$;

-- Starting labels and the existing follow-up wording as the first quick reply — per
-- tenant, only when the tenant has none yet.
insert into whatsapp_labels (tenant_id, name, color, sort_order)
select t.id, v.name, v.color, v.sort_order
from tenants t
cross join (values ('דחוף', '#E5484D', 10), ('VIP', '#8E4EC6', 20), ('לחזור בטלפון', '#3E63DD', 30)) as v(name, color, sort_order)
where not exists (select 1 from whatsapp_labels l where l.tenant_id = t.id);

insert into whatsapp_templates (tenant_id, name, body, sort_order)
select t.id, 'פולו-אפ אחרי מחירון',
       coalesce(
         (select s.value from app_settings s where s.tenant_id = t.id and s.key = 'template_whatsapp_followup' and btrim(coalesce(s.value, '')) <> ''),
         'היי {{names}}, רצינו לוודא שקיבלתם את המחירון ולבדוק אם יש שאלות. זמינים לכל שאלה!'
       ),
       10
from tenants t
where not exists (select 1 from whatsapp_templates w where w.tenant_id = t.id);

-- ---------------------------------------------------------------------------------
-- Unread counts and message search — SECURITY INVOKER, so RLS decides what is counted.
-- ---------------------------------------------------------------------------------
create or replace function whatsapp_unread_counts()
returns table (conversation_id uuid, unread integer)
language sql stable security invoker set search_path = public as $$
  select m.conversation_id, count(*)::int
  from whatsapp_messages m
  join whatsapp_conversations c on c.id = m.conversation_id
  where m.direction = 'inbound'
    and c.last_inbound_at > coalesce(c.last_read_at, '-infinity'::timestamptz)
    and m.created_at > coalesce(c.last_read_at, '-infinity'::timestamptz)
  group by m.conversation_id
$$;

create or replace function whatsapp_search_messages(q text)
returns table (conversation_id uuid, message_id uuid, body_text text, created_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select m.conversation_id, m.id, m.body_text, m.created_at
  from whatsapp_messages m
  where char_length(btrim(q)) >= 2
    and m.body_text ilike '%' || replace(replace(replace(btrim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  order by m.created_at desc
  limit 60
$$;

grant execute on function whatsapp_unread_counts() to authenticated;
grant execute on function whatsapp_search_messages(text) to authenticated;

-- ---------------------------------------------------------------------------------
-- Realtime — new messages appear without waiting for a poll. RLS still applies to what
-- each viewer receives. Never fails the migration (a project without the publication,
-- or a table already in it, just leaves polling in charge).
-- ---------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['whatsapp_conversations','whatsapp_messages','whatsapp_message_status','whatsapp_notes','whatsapp_conversation_labels']
  loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when others then
      raise notice 'realtime: % not added (%)', t, sqlerrm;
    end;
  end loop;
end $$;
