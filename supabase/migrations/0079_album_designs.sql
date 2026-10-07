-- Album design editor, stage 1 (2026-10-08). The studio designs the album sketch inside AVIRA
-- (instead of SmartAlbums) from the couple's Google Drive folder. One design per album order:
-- the whole design is one JSON document (pages / slots / crops / title text — see
-- src/lib/albumDesign.js); album_design_revisions keeps snapshots so nothing is ever lost.
-- The photos themselves stay in Drive — nothing here stores image files.
-- Stage 3 will export the design as flattened 80×30 spreads into a normal album_version, so the
-- existing review / approval / print flow is unchanged. Nothing reads these tables yet except
-- the editor page (src/pages/AlbumDesignEditor.jsx).
-- Additive only. Rollback: audit-reports/rollback/0079_rollback.sql. Re-runnable.

create table if not exists album_designs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  album_order_id uuid not null references album_orders(id) on delete cascade,
  drive_folder_url text,
  drive_folder_id text,
  doc jsonb not null default '{}'::jsonb,
  -- Optimistic lock: every save is "update … where doc_version = <what I loaded>", so two open
  -- tabs can't silently overwrite each other.
  doc_version integer not null default 1,
  status text not null default 'draft' check (status in ('draft', 'exported')),
  last_exported_version_id uuid references album_versions(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, album_order_id)
);

create table if not exists album_design_revisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  design_id uuid not null references album_designs(id) on delete cascade,
  doc jsonb not null,
  doc_version integer,
  label text not null default 'autosave' check (label in ('autosave', 'manual', 'before_restore', 'exported', 'client_edits')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists album_design_revisions_design_idx on album_design_revisions(design_id, created_at desc);

-- Same roles as the album screens (owner/admin/studio_manager/album_manager), read and write.
alter table album_designs enable row level security;
alter table album_design_revisions enable row level security;

drop policy if exists album_designs_rw on album_designs;
create policy album_designs_rw on album_designs for all using (
  tenant_id = current_tenant_id()
  and exists (select 1 from profiles where id = auth.uid()
              and role in ('owner','admin','studio_manager','album_manager'))
) with check (
  tenant_id = current_tenant_id()
  and exists (select 1 from profiles where id = auth.uid()
              and role in ('owner','admin','studio_manager','album_manager'))
);

drop policy if exists album_design_revisions_rw on album_design_revisions;
create policy album_design_revisions_rw on album_design_revisions for all using (
  tenant_id = current_tenant_id()
  and exists (select 1 from profiles where id = auth.uid()
              and role in ('owner','admin','studio_manager','album_manager'))
) with check (
  tenant_id = current_tenant_id()
  and exists (select 1 from profiles where id = auth.uid()
              and role in ('owner','admin','studio_manager','album_manager'))
);

grant select, insert, update, delete on album_designs, album_design_revisions to authenticated, service_role;

drop trigger if exists set_updated_at on album_designs;
create trigger set_updated_at before update on album_designs for each row execute function set_updated_at();

do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_tenant_id') then
    drop trigger if exists set_tenant_id on album_designs;
    create trigger set_tenant_id before insert on album_designs for each row execute function set_tenant_id();
    drop trigger if exists set_tenant_id on album_design_revisions;
    create trigger set_tenant_id before insert on album_design_revisions for each row execute function set_tenant_id();
  end if;
end $$;
