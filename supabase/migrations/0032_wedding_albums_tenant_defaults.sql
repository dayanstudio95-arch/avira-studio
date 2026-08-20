-- Auto-fill tenant_id on insert for the Wedding Albums module's tables, same as
-- 0003_tenant_defaults.sql does for every other tenant-scoped table. Missed in
-- 0031_wedding_albums.sql -- without this, frontend .create() calls via
-- src/api/entities.js (which never pass tenantId explicitly, by established
-- convention across this whole codebase) would fail both the NOT NULL constraint
-- and the RLS WITH CHECK (tenant_id = current_tenant_id()) on every insert.
--
-- Safe to apply uniformly to all 12 tables even though some rows are only ever
-- inserted by the album-portal / album-print-access Edge Functions (service-role,
-- already setting tenant_id explicitly) -- set_tenant_id() only fills the column
-- `if new.tenant_id is null`, so it's a no-op when already supplied.
do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'album_orders', 'album_versions', 'album_spreads', 'album_review_rounds',
      'album_spread_decisions', 'album_products', 'album_covers', 'album_addons',
      'album_order_selections', 'album_order_addons', 'print_access_links',
      'print_access_events'
    ])
  loop
    execute format('drop trigger if exists set_tenant_id on %I;', t);
    execute format('create trigger set_tenant_id before insert on %I for each row execute function set_tenant_id();', t);
  end loop;
end $$;
