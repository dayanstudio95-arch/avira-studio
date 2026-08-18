-- "פרטי הסטודיו" (Studio Details) settings feature — adds tenant identity/contact
-- fields requested by the user: logo, phone, WhatsApp number, email, address,
-- business registration numbers (split sole_prop/company to match the existing
-- Morning/חשבונית ירוקה dual-entity model), website, Instagram/Facebook, a
-- client-facing display name, and a text auto-signature for outgoing messages.
--
-- Explicitly v1/settings-only per the user's choice: these columns are captured
-- and saved from a new Settings card, but nothing else in the app (contract PDF,
-- WhatsApp sends, invoice descriptions, app header) reads them yet — that's a
-- deliberate follow-up, not done here.
--
-- No RLS change needed on `tenants` — `tenants_update_by_admin`
-- (0018_admin_role_gated_writes.sql) already gates UPDATE to
-- owner/admin/studio_manager, and RLS has no per-column granularity, so these
-- new columns are automatically covered by the existing row-level policy.
alter table tenants
  add column if not exists logo_url text,
  add column if not exists display_name_to_clients text,
  add column if not exists phone text,
  add column if not exists whatsapp_number text,
  add column if not exists email text,
  add column if not exists address text,
  add column if not exists business_number_sole_prop text,
  add column if not exists business_number_company text,
  add column if not exists website text,
  add column if not exists instagram_url text,
  add column if not exists facebook_url text,
  add column if not exists auto_signature_text text;

-- First Supabase Storage bucket in this project. Public (not because the logo
-- is sensitive — it isn't — but so it can later be embedded directly, e.g. in
-- the contract PDF or an invoice header, via a plain public URL with no signed-
-- URL plumbing needed). Write access is scoped to the uploader's own tenant via
-- a tenant-id-first-path-segment convention, gated to owner/admin/studio_manager
-- via the same EXISTS-subquery pattern used throughout this migration series
-- (0012, 0018, 0019, 0020).
insert into storage.buckets (id, name, public)
values ('studio-logos', 'studio-logos', true)
on conflict (id) do nothing;

drop policy if exists studio_logos_public_read on storage.objects;
create policy studio_logos_public_read on storage.objects
  for select using (bucket_id = 'studio-logos');

drop policy if exists studio_logos_admin_insert on storage.objects;
create policy studio_logos_admin_insert on storage.objects
  for insert with check (
    bucket_id = 'studio-logos'
    and (storage.foldername(name))[1] = current_tenant_id()::text
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
  );

drop policy if exists studio_logos_admin_update on storage.objects;
create policy studio_logos_admin_update on storage.objects
  for update using (
    bucket_id = 'studio-logos'
    and (storage.foldername(name))[1] = current_tenant_id()::text
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
  );

drop policy if exists studio_logos_admin_delete on storage.objects;
create policy studio_logos_admin_delete on storage.objects
  for delete using (
    bucket_id = 'studio-logos'
    and (storage.foldername(name))[1] = current_tenant_id()::text
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
  );
