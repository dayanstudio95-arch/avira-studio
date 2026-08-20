-- Wedding Albums module — core schema. Fully separate from the pre-existing simple
-- album marker (events.album_status / album_sketch_link / album_reminder_sent(_at) /
-- runAlbumReminder() in automation-engine) — this migration does not touch, read from,
-- or write to any of those. See CLAUDE.md's "Wedding Albums module" section for the
-- full isolation/security/data-integrity rules this migration follows.
--
-- Design reference: the "Wedding Albums module" section of the project's working plan
-- (sketch upload -> tokenized public couple review -> purchase wizard -> admin
-- dashboard -> tokenized print-shop download). 12 new tables, all tenant_id + RLS.
--
-- RLS shape (per CLAUDE.md): every table gets the standard tenant-only policy with no
-- exceptions. Catalog tables (album_products/album_covers/album_addons) and
-- print_access_links additionally get the EXISTS-subquery role-gated WRITE policy
-- already established in 0018_admin_role_gated_writes.sql (open SELECT to any tenant
-- member, write restricted to owner/admin/studio_manager/album_manager) — this keeps
-- catalog data and print-access tokens from being casually edited/minted by
-- photographer/editor roles, while normal order/review/version rows stay open to any
-- tenant member exactly like leads/events do today (album_manager's own scoped-role
-- routing, added separately, is what actually limits which UI that role sees).
--
-- album_manager already exists in profiles.role's check constraint since 0001_init.sql
-- -- no constraint change needed here.

-- ---------------------------------------------------------------------------------
-- album_orders — root record. event_id is optional (a couple who wants an album for
-- a wedding no longer tracked as a live event can be entered via the manual fields
-- instead). current_version_id / approved_version_id reference album_versions, created
-- below -- added via ALTER TABLE after that table exists to avoid a forward reference.
-- ---------------------------------------------------------------------------------
create table album_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  event_id uuid references events(id) on delete set null,
  couple_names_manual text,
  wedding_date_manual date,
  phone_manual text,
  workflow_status text not null default 'draft' check (workflow_status in (
    'draft', 'sketch_uploaded', 'in_review', 'revision_requested', 'approved',
    'product_selected', 'awaiting_payment', 'paid', 'in_print', 'delivered', 'completed'
  )),
  -- Kept separate from workflow_status since an order can be approved-but-unpaid at
  -- the same time -- these are two independent axes, not one combined state machine.
  payment_status text not null default 'unpaid' check (payment_status in (
    'unpaid', 'transfer_pending_review', 'paid'
  )),
  -- SHA-256 hash only, never the raw token -- see CLAUDE.md "Security". Nullable until
  -- the portal link is first generated.
  portal_token_hash text,
  portal_token_revoked_at timestamptz,
  current_version_id uuid,
  approved_version_id uuid,
  total_amount numeric(10, 2) check (total_amount is null or total_amount >= 0),
  shipping_name text,
  shipping_phone text,
  shipping_address text,
  shipping_notes text,
  transfer_proof_file_key text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------
-- album_versions — one row per sketch upload round.
-- ---------------------------------------------------------------------------------
create table album_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  album_order_id uuid not null references album_orders(id) on delete cascade,
  version_number integer not null,
  uploaded_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, album_order_id, version_number)
);

-- Now that album_versions exists, wire up album_orders' forward references.
alter table album_orders
  add constraint album_orders_current_version_id_fkey
    foreign key (current_version_id) references album_versions(id) on delete set null,
  add constraint album_orders_approved_version_id_fkey
    foreign key (approved_version_id) references album_versions(id) on delete set null;

-- ---------------------------------------------------------------------------------
-- album_spreads — the base reviewable unit ("spread" / כפולה, shown to the couple as
-- "עמוד X מתוך Y"). Deliberately no approval-status column here -- approval lives
-- per-round, per-spread, in album_spread_decisions below, so the same spread can be
-- independently approved in round 1 and re-reviewed after a new version replaces it.
-- Single full-resolution file per spread serves both preview (via Storage's
-- resize-on-read image transformations) and print -- no watermark/preview pipeline
-- in v1, per CLAUDE.md's iron rules.
-- ---------------------------------------------------------------------------------
create table album_spreads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  version_id uuid not null references album_versions(id) on delete cascade,
  sequence_number integer not null,
  file_key text not null,
  processing_status text not null default 'uploaded' check (processing_status in (
    'uploaded', 'ready', 'failed'
  )),
  created_at timestamptz not null default now(),
  unique (tenant_id, version_id, sequence_number)
);

-- ---------------------------------------------------------------------------------
-- album_review_rounds — one row per couple review pass over one version.
-- ---------------------------------------------------------------------------------
create table album_review_rounds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  album_order_id uuid not null references album_orders(id) on delete cascade,
  version_id uuid not null references album_versions(id) on delete cascade,
  round_number integer not null,
  status text not null default 'open' check (status in ('open', 'submitted')),
  opened_at timestamptz not null default now(),
  submitted_at timestamptz
);

-- ---------------------------------------------------------------------------------
-- album_spread_decisions — one row per spread per round. Immutable once the parent
-- round is submitted (enforced app-side, not by a DB constraint). point_x/point_y are
-- optional percentage-based pin coordinates for "click the exact spot" feedback.
-- ---------------------------------------------------------------------------------
create table album_spread_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  review_round_id uuid not null references album_review_rounds(id) on delete cascade,
  spread_id uuid not null references album_spreads(id) on delete cascade,
  decision text not null check (decision in ('approved', 'needs_revision')),
  comment text,
  point_x numeric(5, 2) check (point_x is null or (point_x between 0 and 100)),
  point_y numeric(5, 2) check (point_y is null or (point_y between 0 and 100)),
  created_at timestamptz not null default now(),
  unique (review_round_id, spread_id)
);

-- ---------------------------------------------------------------------------------
-- Catalog tables — album_products / album_covers / album_addons. No seed data (per
-- CLAUDE.md's iron rules) -- the user fills real prices in via the new admin UI.
-- Deliberately separate from the photography packages table (0001_init.sql) even
-- though it looks superficially similar -- that table is tightly coupled to
-- photography-specific columns and is never reused here.
-- ---------------------------------------------------------------------------------
create table album_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  description text,
  base_price numeric(10, 2) not null check (base_price >= 0),
  album_count integer not null default 1,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table album_covers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  price_delta numeric(10, 2) not null default 0,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table album_addons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  price numeric(10, 2) not null check (price >= 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------
-- album_order_selections / album_order_addons — snapshot every commercial selection
-- (name + price captured at selection time). Never join back to the live catalog to
-- compute a historical order's total -- editing a catalog price must never
-- retroactively change an existing order. product_id/cover_id/addon_id are kept as
-- nullable FKs (set null on catalog-row delete) purely for traceability/analytics;
-- the *_snapshot columns are always the source of truth for money.
-- ---------------------------------------------------------------------------------
create table album_order_selections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  album_order_id uuid not null references album_orders(id) on delete cascade,
  product_id uuid references album_products(id) on delete set null,
  product_name_snapshot text not null,
  product_price_snapshot numeric(10, 2) not null check (product_price_snapshot >= 0),
  cover_id uuid references album_covers(id) on delete set null,
  cover_name_snapshot text,
  cover_price_delta_snapshot numeric(10, 2),
  engraving_text text,
  created_at timestamptz not null default now()
);

-- Kept as its own table (not a JSON array on album_orders) specifically so future
-- analytics queries ("how many linen covers sold this year") are possible.
create table album_order_addons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  album_order_id uuid not null references album_orders(id) on delete cascade,
  addon_id uuid references album_addons(id) on delete set null,
  addon_name_snapshot text not null,
  addon_price_snapshot numeric(10, 2) not null check (addon_price_snapshot >= 0),
  quantity integer not null default 1 check (quantity > 0),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------
-- print_access_links / print_access_events — studio-generated, token-based print-shop
-- download links (SHA-256 hashed at rest, same as portal_token_hash). Multiple
-- simultaneous links allowed per order (e.g. reprints). Revocation
-- (revoked_at)/expiry (expires_at) must be checked on every lookup by the
-- album-print-access edge function, not just at creation time.
-- ---------------------------------------------------------------------------------
create table print_access_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  album_order_id uuid not null references album_orders(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table print_access_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  print_access_link_id uuid not null references print_access_links(id) on delete cascade,
  event_type text not null check (event_type in ('viewed', 'downloaded')),
  ip_address text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------
-- Indexes -- Postgres does not auto-index foreign keys.
-- ---------------------------------------------------------------------------------
create index album_orders_tenant_status_idx on album_orders(tenant_id, workflow_status);
create index album_orders_event_id_idx on album_orders(event_id);
create index album_versions_album_order_id_idx on album_versions(album_order_id);
create index album_spreads_version_id_idx on album_spreads(version_id);
create index album_review_rounds_album_order_id_idx on album_review_rounds(album_order_id);
create index album_review_rounds_version_id_idx on album_review_rounds(version_id);
create index album_spread_decisions_review_round_id_idx on album_spread_decisions(review_round_id);
create index album_spread_decisions_spread_id_idx on album_spread_decisions(spread_id);
create index album_order_selections_album_order_id_idx on album_order_selections(album_order_id);
create index album_order_addons_album_order_id_idx on album_order_addons(album_order_id);
create index print_access_links_album_order_id_idx on print_access_links(album_order_id);
create index print_access_events_print_access_link_id_idx on print_access_events(print_access_link_id);

-- ---------------------------------------------------------------------------------
-- updated_at triggers -- reuses the existing set_updated_at() function (0001_init.sql),
-- same as every other table with an updated_at column.
-- ---------------------------------------------------------------------------------
create trigger set_updated_at before update on album_orders
  for each row execute function set_updated_at();
create trigger set_updated_at before update on album_products
  for each row execute function set_updated_at();
create trigger set_updated_at before update on album_covers
  for each row execute function set_updated_at();
create trigger set_updated_at before update on album_addons
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------------
-- RLS -- standard tenant-only policy on every table (no exceptions, per CLAUDE.md).
-- ---------------------------------------------------------------------------------
alter table album_orders enable row level security;
alter table album_versions enable row level security;
alter table album_spreads enable row level security;
alter table album_review_rounds enable row level security;
alter table album_spread_decisions enable row level security;
alter table album_order_selections enable row level security;
alter table album_order_addons enable row level security;
alter table print_access_events enable row level security;

create policy album_orders_tenant_isolation on album_orders
  for all using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
create policy album_versions_tenant_isolation on album_versions
  for all using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
create policy album_spreads_tenant_isolation on album_spreads
  for all using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
create policy album_review_rounds_tenant_isolation on album_review_rounds
  for all using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
create policy album_spread_decisions_tenant_isolation on album_spread_decisions
  for all using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
create policy album_order_selections_tenant_isolation on album_order_selections
  for all using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
create policy album_order_addons_tenant_isolation on album_order_addons
  for all using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
create policy print_access_events_tenant_isolation on print_access_events
  for all using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());

-- Catalog tables + print_access_links: open SELECT to any tenant member, write
-- restricted to owner/admin/studio_manager/album_manager -- same EXISTS-subquery
-- split-policy shape as 0018_admin_role_gated_writes.sql.
alter table album_products enable row level security;
alter table album_covers enable row level security;
alter table album_addons enable row level security;
alter table print_access_links enable row level security;

create policy album_products_select on album_products
  for select using (tenant_id = current_tenant_id());
create policy album_products_write_by_admin on album_products
  for insert with check (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager', 'album_manager'))
  );
create policy album_products_update_by_admin on album_products
  for update using (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager', 'album_manager'))
  );
create policy album_products_delete_by_admin on album_products
  for delete using (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager', 'album_manager'))
  );

create policy album_covers_select on album_covers
  for select using (tenant_id = current_tenant_id());
create policy album_covers_write_by_admin on album_covers
  for insert with check (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager', 'album_manager'))
  );
create policy album_covers_update_by_admin on album_covers
  for update using (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager', 'album_manager'))
  );
create policy album_covers_delete_by_admin on album_covers
  for delete using (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager', 'album_manager'))
  );

create policy album_addons_select on album_addons
  for select using (tenant_id = current_tenant_id());
create policy album_addons_write_by_admin on album_addons
  for insert with check (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager', 'album_manager'))
  );
create policy album_addons_update_by_admin on album_addons
  for update using (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager', 'album_manager'))
  );
create policy album_addons_delete_by_admin on album_addons
  for delete using (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager', 'album_manager'))
  );

create policy print_access_links_select on print_access_links
  for select using (tenant_id = current_tenant_id());
create policy print_access_links_write_by_admin on print_access_links
  for insert with check (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager', 'album_manager'))
  );
create policy print_access_links_update_by_admin on print_access_links
  for update using (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager', 'album_manager'))
  );
create policy print_access_links_delete_by_admin on print_access_links
  for delete using (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager', 'album_manager'))
  );

-- ---------------------------------------------------------------------------------
-- Grants -- 0002_grants.sql / 0008_service_role_grants.sql were one-time snapshots
-- (not `alter default privileges`), so every table added since 0016 needs its own
-- explicit grants or every query fails with 42501 regardless of RLS.
-- ---------------------------------------------------------------------------------
grant select, insert, update, delete on
  album_orders, album_versions, album_spreads, album_review_rounds,
  album_spread_decisions, album_products, album_covers, album_addons,
  album_order_selections, album_order_addons, print_access_links, print_access_events
  to authenticated;
grant select, insert, update, delete on
  album_orders, album_versions, album_spreads, album_review_rounds,
  album_spread_decisions, album_products, album_covers, album_addons,
  album_order_selections, album_order_addons, print_access_links, print_access_events
  to service_role;

-- ---------------------------------------------------------------------------------
-- notifications (0026_notifications_trigger.sql) — add a dedicated, explicitly-typed
-- reference column for Albums events, matching that table's existing pattern
-- (related_lead_id) rather than introducing a polymorphic/generic reference. Unlike
-- the contract-signed notification, Albums notifications are not driven by a single
-- watched column via a DB trigger -- they're inserted directly by the album-portal
-- edge function (service-role) at the specific moments that matter (revision
-- requested, round approved, transfer proof uploaded, print link downloaded), since
-- those events span multiple tables/actors that don't reduce to one column watch.
-- ---------------------------------------------------------------------------------
alter table notifications
  add column if not exists related_album_order_id uuid references album_orders(id) on delete set null;

-- ---------------------------------------------------------------------------------
-- Storage — new PRIVATE bucket `album-files` (unlike studio-logos, this holds
-- unreleased wedding photos and must never be public). All reads by the public
-- couple portal / print-shop page go through the album-portal / album-print-access
-- edge functions using a service-role client + short-lived signed URLs -- they never
-- get a real Supabase session, so no public-read policy is defined here at all.
-- Studio-side reads (admin dashboard viewing sketches) use the authenticated user's
-- own session, hence the SELECT policy below. Path convention:
-- ${tenant_id}/${album_order_id}/${version_id}/spread-<sequence_number>-<filename>
-- -- the tenant-id-first-segment convention is what
-- (storage.foldername(name))[1] = current_tenant_id()::text checks against, same
-- pattern as 0021_studio_details.sql's studio-logos bucket.
-- ---------------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('album-files', 'album-files', false)
on conflict (id) do nothing;

create policy album_files_select on storage.objects
  for select using (
    bucket_id = 'album-files'
    and (storage.foldername(name))[1] = current_tenant_id()::text
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager', 'album_manager'))
  );

create policy album_files_insert on storage.objects
  for insert with check (
    bucket_id = 'album-files'
    and (storage.foldername(name))[1] = current_tenant_id()::text
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager', 'album_manager'))
  );

create policy album_files_update on storage.objects
  for update using (
    bucket_id = 'album-files'
    and (storage.foldername(name))[1] = current_tenant_id()::text
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager', 'album_manager'))
  );

create policy album_files_delete on storage.objects
  for delete using (
    bucket_id = 'album-files'
    and (storage.foldername(name))[1] = current_tenant_id()::text
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager', 'album_manager'))
  );
