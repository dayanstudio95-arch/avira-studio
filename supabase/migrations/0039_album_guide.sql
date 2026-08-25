-- Album Guide Page — a studio-owner-editable, generic (one row per tenant,
-- identical for every couple) informational page explaining the album-
-- ordering process: how to choose photos, how to submit a selection,
-- pricing/covers/add-ons (read-only reference to the existing Wedding Albums
-- catalog tables — never duplicated here), an example sketch preview image,
-- cancellation policy, and an FAQ list. Sent as a companion link alongside
-- the gallery link whenever the studio sends a couple their final gallery
-- (see send-to-couple/index.ts).
--
-- Deliberately isolated per CLAUDE.md's Wedding Albums module rules: new
-- tables, a new Storage bucket, a new public route/page, a new admin page.
-- Reads (never writes) album_products/album_covers/album_addons. Does not
-- read or write the legacy events.album_status/album_sketch_link/
-- album_reminder_sent(_at) marker or runAlbumReminder() at all.

create table album_guide_content (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade unique,
  photo_selection_intro text,
  submission_instructions text,
  sketch_example_image_url text,
  cancellation_policy text,
  is_published boolean not null default true,
  updated_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table album_guide_faq_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  question text not null,
  answer text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index album_guide_faq_items_tenant_order_idx
  on album_guide_faq_items (tenant_id, sort_order);

alter table album_guide_content enable row level security;
alter table album_guide_faq_items enable row level security;

-- Read: any authenticated tenant member (matches every other tenant-scoped
-- read policy in the schema). Write: admin-role-gated (owner/admin/
-- studio_manager/album_manager — album_manager included since this is
-- squarely inside that role's existing scope alongside AlbumCatalogSettings),
-- same EXISTS-subquery pattern as 0018_admin_role_gated_writes.sql.
drop policy if exists album_guide_content_select on album_guide_content;
create policy album_guide_content_select on album_guide_content
  for select using (tenant_id = current_tenant_id());

drop policy if exists album_guide_content_write_by_admin on album_guide_content;
create policy album_guide_content_write_by_admin on album_guide_content
  for insert with check (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager', 'album_manager'))
  );

drop policy if exists album_guide_content_update_by_admin on album_guide_content;
create policy album_guide_content_update_by_admin on album_guide_content
  for update using (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager', 'album_manager'))
  );

drop policy if exists album_guide_faq_select on album_guide_faq_items;
create policy album_guide_faq_select on album_guide_faq_items
  for select using (tenant_id = current_tenant_id());

drop policy if exists album_guide_faq_write_by_admin on album_guide_faq_items;
create policy album_guide_faq_write_by_admin on album_guide_faq_items
  for all using (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager', 'album_manager'))
  ) with check (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager', 'album_manager'))
  );

-- 0002_grants.sql/0008_service_role_grants.sql were one-time snapshots, not
-- `alter default privileges` — every migration since 0012 grants explicitly.
grant select, insert, update, delete on album_guide_content, album_guide_faq_items to authenticated;
grant select, insert, update, delete on album_guide_content, album_guide_faq_items to service_role;

drop trigger if exists set_updated_at on album_guide_content;
create trigger set_updated_at before update on album_guide_content
  for each row execute function set_updated_at();

drop trigger if exists set_updated_at on album_guide_faq_items;
create trigger set_updated_at before update on album_guide_faq_items
  for each row execute function set_updated_at();

-- New Storage bucket, mirroring studio-logos' (0021_studio_details.sql)
-- exact public-read / admin-write / tenant-prefixed-path shape.
insert into storage.buckets (id, name, public)
values ('album-guide-assets', 'album-guide-assets', true)
on conflict (id) do nothing;

drop policy if exists album_guide_assets_public_read on storage.objects;
create policy album_guide_assets_public_read on storage.objects
  for select using (bucket_id = 'album-guide-assets');

drop policy if exists album_guide_assets_admin_insert on storage.objects;
create policy album_guide_assets_admin_insert on storage.objects
  for insert with check (
    bucket_id = 'album-guide-assets'
    and (storage.foldername(name))[1] = current_tenant_id()::text
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager', 'album_manager'))
  );

drop policy if exists album_guide_assets_admin_update on storage.objects;
create policy album_guide_assets_admin_update on storage.objects
  for update using (
    bucket_id = 'album-guide-assets'
    and (storage.foldername(name))[1] = current_tenant_id()::text
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager', 'album_manager'))
  );

drop policy if exists album_guide_assets_admin_delete on storage.objects;
create policy album_guide_assets_admin_delete on storage.objects
  for delete using (
    bucket_id = 'album-guide-assets'
    and (storage.foldername(name))[1] = current_tenant_id()::text
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager', 'album_manager'))
  );
