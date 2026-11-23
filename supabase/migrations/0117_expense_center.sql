-- "מרכז הוצאות", step 1 (Avira, 2026-11-23, the owner approved a mockup and the plan): every expense document lands in
-- one place by itself — photos / PDFs / invoice links posted to the studio's WhatsApp group "קבלות" (the owner, his
-- wife, the studio number), invoices found by a small Google Apps Script in each of the two Gmail mailboxes, and files
-- dropped on the screen. AI reads each one, and it is sorted to the company, the עוסק מורשה or the home:
--   issued to the company's ח.פ. → the company; else the owner confirms ONCE per supplier and it is remembered (the
--   עוסק's number is the owner's ID number, the same one home bills carry, so "לכבוד" alone can't tell them apart).
-- A document already in Morning is marked (a READ-ONLY copy of both Morning accounts' expenses, morning_expenses).
-- Sending to Morning, the statements check and the recurring list are later steps (not here).
-- Only adds. Every table grants explicitly (production gives new tables no privileges — 0103).

-- ------------------------------------------------------------------ the mailboxes' scripts
-- One row per Gmail mailbox that runs the script (made on the screen). The script's credential is a random token shown
-- once; only its SHA-256 is kept — looking it up is also how the studio is found (expenses-mail, verify_jwt = false).
create table if not exists public.expense_mailboxes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 120),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamp with time zone not null default now(),
  last_seen_at timestamp with time zone,
  revoked_at timestamp with time zone
);
create index if not exists expense_mailboxes_tenant_idx on public.expense_mailboxes (tenant_id, created_at);

-- ------------------------------------------------------------------ the documents
create table if not exists public.expense_docs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source text not null check (source in ('whatsapp', 'email', 'upload')),
  -- Where it came from, once ('wa:<message id>', 'mail:<mailbox id>:<gmail id>:<part>', 'up:<uuid>'): the same
  -- message / mail part never makes a second row.
  source_ref text not null check (char_length(source_ref) between 3 and 300),
  message_id uuid references public.whatsapp_messages(id) on delete set null,
  mailbox_id uuid references public.expense_mailboxes(id) on delete set null,
  sender_name text check (sender_name is null or char_length(sender_name) <= 120),
  mail_from text check (mail_from is null or char_length(mail_from) <= 300),
  mail_subject text check (mail_subject is null or char_length(mail_subject) <= 300),
  received_at timestamp with time zone not null default now(),
  link_url text check (link_url is null or char_length(link_url) <= 2000),
  provider text check (provider is null or char_length(provider) <= 40),
  -- expense-docs/<tenant_id>/<id>.<ext> (the bucket below).
  file_path text check (file_path is null or char_length(file_path) <= 300),
  file_mime text check (file_mime is null or char_length(file_mime) <= 100),
  file_size integer check (file_size is null or file_size >= 0),
  -- SHA-256 of the file: the same file twice (WhatsApp and mail) is one expense.
  content_hash text check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  -- waiting_upload: a mail part the script is still uploading; pending: to download / read; done: read;
  -- manual: a link that opens a page, not a file; failed: could not be read (3 tries);
  -- not_expense: not a purchase document (a photo, a transfer screenshot, the studio's own invoice to a client);
  -- duplicate: the same document is already here (dup_of) or in "חשבוניות מהצוות" (staff_invoice_id).
  read_status text not null default 'pending'
    check (read_status in ('waiting_upload', 'pending', 'done', 'manual', 'failed', 'not_expense', 'duplicate')),
  read_tries smallint not null default 0 check (read_tries between 0 and 20),
  read_error text check (read_error is null or char_length(read_error) <= 300),
  doc_type text check (doc_type is null or char_length(doc_type) <= 60),
  doc_number text check (doc_number is null or char_length(doc_number) <= 60),
  issuer text check (issuer is null or char_length(issuer) <= 200),
  issuer_tax_id text check (issuer_tax_id is null or char_length(issuer_tax_id) <= 20),
  issued_to text check (issued_to is null or char_length(issued_to) <= 200),
  issued_to_id text check (issued_to_id is null or char_length(issued_to_id) <= 20),
  doc_date date,
  amount numeric(12, 2) check (amount is null or amount >= 0),
  vat numeric(12, 2) check (vat is null or vat >= 0),
  currency text check (currency is null or char_length(currency) <= 10),
  allocation_number text check (allocation_number is null or char_length(allocation_number) <= 40),
  description text check (description is null or char_length(description) <= 300),
  category text check (category is null or char_length(category) <= 40),
  -- The supplier as the rules know it: its tax id, else its normalised name.
  supplier_key text check (supplier_key is null or char_length(supplier_key) <= 200),
  entity text check (entity is null or entity in ('company', 'sole_prop', 'home')),
  -- issued_to: issued to the company; supplier: the owner's rule for this supplier; morning: found in that business's
  -- Morning; manual: the owner chose for this document.
  entity_by text check (entity_by is null or entity_by in ('issued_to', 'supplier', 'morning', 'manual')),
  suggested_entity text check (suggested_entity is null or suggested_entity in ('company', 'sole_prop', 'home')),
  warnings text[] not null default '{}' check (cardinality(warnings) <= 10),
  dup_of uuid references public.expense_docs(id) on delete set null,
  staff_invoice_id uuid references public.staff_invoices(id) on delete set null,
  morning_account text check (morning_account is null or morning_account in ('company', 'sole_prop')),
  morning_expense_id text check (morning_expense_id is null or char_length(morning_expense_id) <= 80),
  -- The short "✅ נקלט" answer in the group was sent (or was not to be).
  confirmed_at timestamp with time zone,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (tenant_id, source_ref)
);
create index if not exists expense_docs_date_idx on public.expense_docs (tenant_id, doc_date desc);
create index if not exists expense_docs_status_idx on public.expense_docs (tenant_id, read_status);
create index if not exists expense_docs_hash_idx on public.expense_docs (tenant_id, content_hash) where content_hash is not null;
create index if not exists expense_docs_supplier_idx on public.expense_docs (tenant_id, supplier_key) where supplier_key is not null;

-- ------------------------------------------------------------------ the owner's rule per supplier
create table if not exists public.expense_supplier_rules (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  supplier_key text not null check (char_length(supplier_key) between 1 and 200),
  supplier_name text check (supplier_name is null or char_length(supplier_name) <= 200),
  entity text not null check (entity in ('company', 'sole_prop', 'home')),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (tenant_id, supplier_key)
);

-- ------------------------------------------------------------------ Morning's expenses (read-only copy)
-- What is already in each business's Morning, from its expenses search (read only, never written there).
create table if not exists public.morning_expenses (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  account text not null check (account in ('company', 'sole_prop')),
  morning_id text not null check (char_length(morning_id) between 1 and 80),
  doc_date date,
  number text check (number is null or char_length(number) <= 60),
  amount numeric(12, 2),
  vat numeric(12, 2),
  supplier_name text check (supplier_name is null or char_length(supplier_name) <= 200),
  document_type integer,
  status integer,
  synced_at timestamp with time zone not null default now(),
  primary key (tenant_id, account, morning_id)
);
create index if not exists morning_expenses_date_idx on public.morning_expenses (tenant_id, account, doc_date);

alter table public.expense_mailboxes enable row level security;
alter table public.expense_docs enable row level security;
alter table public.expense_supplier_rules enable row level security;
alter table public.morning_expenses enable row level security;

-- Money: the studio's owner / admin / studio manager only (like "חשבוניות מהצוות").
do $$
declare t text;
begin
  foreach t in array array['expense_mailboxes', 'expense_docs', 'expense_supplier_rules'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format($p$create policy %I on public.%I for all using (
      tenant_id = current_tenant_id()
      and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
    ) with check (
      tenant_id = current_tenant_id()
      and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
    )$p$, t || '_admin', t);
  end loop;
end $$;
-- Morning's copy is written only by the server (service role); the screen reads it.
drop policy if exists morning_expenses_admin_read on public.morning_expenses;
create policy morning_expenses_admin_read on public.morning_expenses for select using (
  tenant_id = current_tenant_id()
  and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
);

grant select, insert, update, delete on public.expense_mailboxes to authenticated, service_role;
grant select, insert, update, delete on public.expense_docs to authenticated, service_role;
grant select, insert, update, delete on public.expense_supplier_rules to authenticated, service_role;
grant select on public.morning_expenses to authenticated;
grant select, insert, update, delete on public.morning_expenses to service_role;

-- The documents: a PRIVATE bucket, <tenant_id>/<doc id>.<ext>; the studio reads and uploads its own, the server
-- (service role) saves what it collects.
insert into storage.buckets (id, name, public)
values ('expense-docs', 'expense-docs', false)
on conflict (id) do nothing;

drop policy if exists expense_docs_files_select on storage.objects;
create policy expense_docs_files_select on storage.objects for select using (
  bucket_id = 'expense-docs'
  and (storage.foldername(name))[1] = current_tenant_id()::text
  and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
);
drop policy if exists expense_docs_files_insert on storage.objects;
create policy expense_docs_files_insert on storage.objects for insert with check (
  bucket_id = 'expense-docs'
  and (storage.foldername(name))[1] = current_tenant_id()::text
  and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
);
drop policy if exists expense_docs_files_delete on storage.objects;
create policy expense_docs_files_delete on storage.objects for delete using (
  bucket_id = 'expense-docs'
  and (storage.foldername(name))[1] = current_tenant_id()::text
  and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
);
