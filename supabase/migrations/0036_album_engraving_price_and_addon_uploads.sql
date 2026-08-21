-- Wedding Albums module: engraving now has a real price (was entirely free/unpriced
-- until now), snapshotted per-order like every other commercial selection (see
-- CLAUDE.md's "Snapshot every commercial selection" rule) -- never joined back to a
-- live price table. Also adds storage for the image(s) a couple uploads for an addon
-- that requires one (e.g. canvas/glass enlargement source photo), so the studio can
-- later view/download it or hand a link to the print shop.

alter table album_order_selections
  add column if not exists engraving_price_snapshot numeric(10,2) check (engraving_price_snapshot >= 0);

alter table album_order_addons
  add column if not exists uploaded_file_keys jsonb not null default '[]'::jsonb;
