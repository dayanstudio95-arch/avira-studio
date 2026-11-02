-- "חשבוניות מהצוות" (Avira, 2026-11-02, the owner's request). Every transfer to a team member stays open until its
-- invoice / receipt arrives: the owner pays by bank transfer and asks for the document on WhatsApp; some forget, he
-- forgets, and a missing document is VAT he can't deduct and more tax. A transfer opens itself from the owner's bank
-- screenshot in the staff chat (read by AI), from a "שולם" mark on the work, or by hand; a document comes as a link from
-- the staff member's invoicing software (Morning, SmartBee, iCount… downloaded at once), a PDF / photo in the chat, or
-- an upload. AI reads it; it is matched to the transfer(s), checked (amount, issued to the paying business, allocation
-- number), and the staff member is reminded after 3 and 7 days (supabase/functions/_shared/staffInvoices*.ts).
-- Only adds. Every table grants explicitly (production gives new tables no privileges — 0103).

-- The team member's kind of business: an authorized dealer issues a tax invoice (VAT comes back), an exempt one a
-- receipt, and 'none' issues nothing by agreement (no reminders, nothing missing). How he is paid: monthly or per event.
alter table public.staff_members
  add column if not exists invoice_type text check (invoice_type is null or invoice_type in ('authorized', 'exempt', 'none')),
  add column if not exists pay_cycle text check (pay_cycle is null or pay_cycle in ('monthly', 'per_event'));

create table if not exists public.staff_transfers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  staff_member_name text not null check (char_length(staff_member_name) between 1 and 120),
  amount numeric(12, 2) not null check (amount > 0),
  paid_on date not null,
  -- The paying business, from the account on the bank screenshot (src/lib/paymentEntity: sole_prop / company).
  entity text check (entity is null or entity in ('company', 'sole_prop')),
  source text not null check (source in ('screenshot', 'paid_mark', 'manual')),
  bank_reference text check (bank_reference is null or char_length(bank_reference) <= 60),
  description text check (description is null or char_length(description) <= 200),
  -- The owner's screenshot in the staff chat it was read from.
  message_id uuid references public.whatsapp_messages(id) on delete set null,
  -- What it paid for: [{eventId, role, date, venue, amount}] (from "שולם" marks).
  events jsonb not null default '[]'::jsonb check (jsonb_typeof(events) = 'array'),
  status text not null default 'waiting' check (status in ('waiting', 'received', 'not_needed')),
  -- Transfers found from before the feature started get no reminders.
  reminders_on boolean not null default true,
  reminders_sent integer not null default 0 check (reminders_sent between 0 and 5),
  last_reminder_at timestamp with time zone,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
create unique index if not exists staff_transfers_message_idx on public.staff_transfers (tenant_id, message_id) where message_id is not null;
create index if not exists staff_transfers_open_idx on public.staff_transfers (tenant_id, status, paid_on desc);

create table if not exists public.staff_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  staff_member_name text not null check (char_length(staff_member_name) between 1 and 120),
  source text not null check (source in ('whatsapp_file', 'whatsapp_link', 'upload', 'email')),
  message_id uuid references public.whatsapp_messages(id) on delete set null,
  link_url text check (link_url is null or char_length(link_url) <= 2000),
  provider text check (provider is null or char_length(provider) <= 40),
  -- staff-invoices/<tenant_id>/<id>.<ext> (the bucket below).
  file_path text check (file_path is null or char_length(file_path) <= 300),
  file_mime text check (file_mime is null or char_length(file_mime) <= 100),
  -- pending: to download / read; done: read; manual: a link that opens a page, not a file (save the PDF by hand);
  -- failed: could not be read; not_invoice: the file turned out not to be one.
  read_status text not null default 'pending' check (read_status in ('pending', 'done', 'manual', 'failed', 'not_invoice')),
  doc_type text check (doc_type is null or char_length(doc_type) <= 60),
  doc_number text check (doc_number is null or char_length(doc_number) <= 60),
  amount numeric(12, 2) check (amount is null or amount >= 0),
  vat numeric(12, 2) check (vat is null or vat >= 0),
  allocation_number text check (allocation_number is null or char_length(allocation_number) <= 40),
  issued_to text check (issued_to is null or char_length(issued_to) <= 200),
  issued_to_id text check (issued_to_id is null or char_length(issued_to_id) <= 20),
  issuer text check (issuer is null or char_length(issuer) <= 200),
  issued_on date,
  -- What the checks found (amount, business, allocation number…), in the screen's words.
  warnings text[] not null default '{}' check (cardinality(warnings) <= 10),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
create unique index if not exists staff_invoices_message_idx on public.staff_invoices (tenant_id, message_id) where message_id is not null;
create index if not exists staff_invoices_staff_idx on public.staff_invoices (tenant_id, staff_member_name, created_at desc);

-- Which document closes which transfer: one invoice can cover two transfers (a VAT top-up), one transfer two invoices.
create table if not exists public.staff_invoice_transfers (
  invoice_id uuid not null references public.staff_invoices(id) on delete cascade,
  transfer_id uuid not null references public.staff_transfers(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_at timestamp with time zone not null default now(),
  primary key (invoice_id, transfer_id)
);
create index if not exists staff_invoice_transfers_transfer_idx on public.staff_invoice_transfers (transfer_id);

-- Every staff-chat message the scan looked at, so a photo is read by AI once (what it was: a transfer, an invoice, neither).
create table if not exists public.staff_doc_scans (
  message_id uuid primary key references public.whatsapp_messages(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('transfer', 'invoice', 'other', 'failed')),
  created_at timestamp with time zone not null default now()
);

alter table public.staff_transfers enable row level security;
alter table public.staff_invoices enable row level security;
alter table public.staff_invoice_transfers enable row level security;
alter table public.staff_doc_scans enable row level security;

-- Money: the studio's owner / admin / studio manager only (like payments).
do $$
declare t text;
begin
  foreach t in array array['staff_transfers', 'staff_invoices', 'staff_invoice_transfers', 'staff_doc_scans'] loop
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

grant select, insert, update, delete on public.staff_transfers to authenticated, service_role;
grant select, insert, update, delete on public.staff_invoices to authenticated, service_role;
grant select, insert, update, delete on public.staff_invoice_transfers to authenticated, service_role;
grant select, insert, update, delete on public.staff_doc_scans to authenticated, service_role;

-- The documents: a PRIVATE bucket, <tenant_id>/<invoice id>.<ext>; the studio reads and uploads its own, the scan
-- (service role) saves what it downloads.
insert into storage.buckets (id, name, public)
values ('staff-invoices', 'staff-invoices', false)
on conflict (id) do nothing;

drop policy if exists staff_invoices_files_select on storage.objects;
create policy staff_invoices_files_select on storage.objects for select using (
  bucket_id = 'staff-invoices'
  and (storage.foldername(name))[1] = current_tenant_id()::text
  and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
);
drop policy if exists staff_invoices_files_insert on storage.objects;
create policy staff_invoices_files_insert on storage.objects for insert with check (
  bucket_id = 'staff-invoices'
  and (storage.foldername(name))[1] = current_tenant_id()::text
  and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
);
drop policy if exists staff_invoices_files_delete on storage.objects;
create policy staff_invoices_files_delete on storage.objects for delete using (
  bucket_id = 'staff-invoices'
  and (storage.foldername(name))[1] = current_tenant_id()::text
  and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
);
