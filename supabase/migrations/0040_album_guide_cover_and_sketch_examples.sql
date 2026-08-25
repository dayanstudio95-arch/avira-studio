-- Album Guide Page enhancements: per-cover preview images (shown in a
-- collapsible accordion) and multiple full sketch examples (each a
-- sequence of images, ~30 per example). Purely additive to the
-- album_guide_* tables from 0039_album_guide.sql -- does not touch
-- album_products/album_covers/album_addons (read-only reference, per
-- CLAUDE.md's Wedding Albums module isolation rule), and does not touch
-- the legacy events.album_status marker. Reuses the existing
-- album-guide-assets public Storage bucket -- no new bucket needed.

create table album_guide_cover_previews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  cover_id uuid not null references album_covers(id) on delete cascade,
  image_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, cover_id)
);

create table album_guide_sketch_examples (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  title text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table album_guide_sketch_example_images (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  example_id uuid not null references album_guide_sketch_examples(id) on delete cascade,
  sequence_number integer not null,
  image_url text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, example_id, sequence_number)
);

create index album_guide_cover_previews_tenant_idx
  on album_guide_cover_previews (tenant_id);
create index album_guide_sketch_examples_tenant_order_idx
  on album_guide_sketch_examples (tenant_id, sort_order);
create index album_guide_sketch_example_images_example_idx
  on album_guide_sketch_example_images (tenant_id, example_id, sequence_number);

alter table album_guide_cover_previews enable row level security;
alter table album_guide_sketch_examples enable row level security;
alter table album_guide_sketch_example_images enable row level security;

-- Read: any authenticated tenant member. Write: admin-role-gated, same
-- EXISTS-subquery pattern as 0018_admin_role_gated_writes.sql /
-- 0039_album_guide.sql.
create policy album_guide_cover_previews_select on album_guide_cover_previews
  for select using (tenant_id = current_tenant_id());
create policy album_guide_cover_previews_write_by_admin on album_guide_cover_previews
  for all using (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner','admin','studio_manager','album_manager'))
  ) with check (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner','admin','studio_manager','album_manager'))
  );

create policy album_guide_sketch_examples_select on album_guide_sketch_examples
  for select using (tenant_id = current_tenant_id());
create policy album_guide_sketch_examples_write_by_admin on album_guide_sketch_examples
  for all using (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner','admin','studio_manager','album_manager'))
  ) with check (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner','admin','studio_manager','album_manager'))
  );

create policy album_guide_sketch_example_images_select on album_guide_sketch_example_images
  for select using (tenant_id = current_tenant_id());
create policy album_guide_sketch_example_images_write_by_admin on album_guide_sketch_example_images
  for all using (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner','admin','studio_manager','album_manager'))
  ) with check (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner','admin','studio_manager','album_manager'))
  );

grant select, insert, update, delete on album_guide_cover_previews, album_guide_sketch_examples, album_guide_sketch_example_images to authenticated;
grant select, insert, update, delete on album_guide_cover_previews, album_guide_sketch_examples, album_guide_sketch_example_images to service_role;

create trigger set_updated_at before update on album_guide_cover_previews
  for each row execute function set_updated_at();
create trigger set_updated_at before update on album_guide_sketch_examples
  for each row execute function set_updated_at();
