-- Wedding Albums module — "extra pages" pricing rule, confirmed with the user:
-- every album product is priced for 30 included spreads/pages (already baked into
-- each product's base_price, no schema change needed there); a couple can add more
-- pages at a flat ₪45/page. Modeled as a per-unit line item in the *existing*
-- album_addons/album_order_addons mechanism (per CLAUDE.md's rule against inventing
-- a parallel concept when an existing one already fits) — album_order_addons already
-- supports a `quantity` column and album_addons.price_type already had a 'per_unit'
-- value reserved (0033_album_catalog_richness.sql) for exactly this kind of case, just
-- never populated with a real row yet.
--
-- See CLAUDE.md's "Wedding Albums module" section — no seed data is normally shipped,
-- but per explicit user confirmation this is real business pricing, same exception
-- already made for the CSV-imported catalog data in 0033.

-- 1. Widen the category check constraint to add a dedicated 'extra_pages' category
--    (kept distinct from 'other' so the admin catalog UI and portal can group/label
--    it clearly, matching the pattern of the other real categories).
alter table album_addons drop constraint if exists album_addons_category_check;
alter table album_addons add constraint album_addons_category_check
  check (category is null or category in ('glass', 'canvas', 'mini_album', 'parent_album', 'extra_pages', 'other'));

-- 2. One idempotent, per-tenant catalog row for the extra-page addon — same
--    cross-join/where-not-exists pattern as 0033's real-data import, scoped so it
--    only inserts where this exact addon doesn't already exist for a tenant (keyed
--    by name + category, since there's no natural unique business key otherwise).
insert into album_addons (
  tenant_id, name, description, category, price, price_type,
  allows_multiple_images, requires_upload, active, sort_order
)
select t.id, 'עמוד נוסף לאלבום', 'כל האלבומים כוללים 30 עמודים במחיר הבסיס. ניתן להוסיף עמודים נוספים בתשלום.',
  'extra_pages', 45::numeric, 'per_unit', false, false, true, 5
from tenants t
where not exists (
  select 1 from album_addons x
  where x.tenant_id = t.id and x.category = 'extra_pages'
);
