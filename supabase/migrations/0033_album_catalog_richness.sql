-- Wedding Albums module -- catalog richness extension + one-time real-data import.
--
-- Context: the studio has a real, richer catalog from their previous system (covers
-- with type/color/engraving-render-config, and dedicated engraving-color/font
-- catalogs) that the flat album_covers/album_addons schema from 0031 cannot express.
-- User explicitly asked (after being shown the gap and asked to choose) for the full
-- schema-extension + full-data-import option -- see the project's working plan,
-- "Wedding Albums module" section addendum. The CLAUDE.md "no seed data" iron rule
-- was about *inventing placeholder prices*; this is the opposite -- real business data
-- the user supplied, imported once, deliberately.
--
-- Import is idempotent and scoped per-tenant (guarded by "where not exists" against
-- that tenant already having rows), not a blanket seed for every future tenant --
-- consistent with every other tenant-scoped table in this schema.

-- ---------------------------------------------------------------------------------
-- album_covers -- add color/type/engraving-render-config support.
-- ---------------------------------------------------------------------------------
alter table album_covers
  add column if not exists description text,
  add column if not exists cover_type text check (cover_type is null or cover_type in ('denim', 'linen', 'faux_leather', 'other')),
  add column if not exists custom_category text,
  add column if not exists preview_image_url text,
  add column if not exists engraving_styles jsonb;

-- ---------------------------------------------------------------------------------
-- album_addons -- add category/behavior-flags/pricing-type support.
-- ---------------------------------------------------------------------------------
alter table album_addons
  add column if not exists description text,
  add column if not exists category text check (category is null or category in ('glass', 'canvas', 'mini_album', 'parent_album', 'other')),
  add column if not exists allows_multiple_images boolean not null default false,
  add column if not exists requires_upload boolean not null default false,
  add column if not exists price_type text not null default 'fixed' check (price_type in ('fixed', 'per_unit')),
  add column if not exists preview_image_url text,
  add column if not exists variants jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------------
-- album_engraving_colors / album_engraving_fonts -- new dedicated catalogs (previously
-- engraving was a single free-text field on the order, no catalog at all). Same
-- tenant-isolation + admin-role-gated-write RLS shape as the other 3 catalog tables.
-- ---------------------------------------------------------------------------------
create table album_engraving_colors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  description text,
  hex_color text,
  preview_image_url text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table album_engraving_fonts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  description text,
  css_font_family text,
  preview_image_url text,
  preview_image_deboss text,
  preview_image_color text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index album_engraving_colors_tenant_idx on album_engraving_colors(tenant_id, sort_order);
create index album_engraving_fonts_tenant_idx on album_engraving_fonts(tenant_id, sort_order);

create trigger set_updated_at before update on album_engraving_colors
  for each row execute function set_updated_at();
create trigger set_updated_at before update on album_engraving_fonts
  for each row execute function set_updated_at();

create trigger set_tenant_id before insert on album_engraving_colors
  for each row execute function set_tenant_id();
create trigger set_tenant_id before insert on album_engraving_fonts
  for each row execute function set_tenant_id();

alter table album_engraving_colors enable row level security;
alter table album_engraving_fonts enable row level security;

create policy album_engraving_colors_select on album_engraving_colors
  for select using (tenant_id = current_tenant_id());
create policy album_engraving_colors_write_by_admin on album_engraving_colors
  for insert with check (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager', 'album_manager'))
  );
create policy album_engraving_colors_update_by_admin on album_engraving_colors
  for update using (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager', 'album_manager'))
  );
create policy album_engraving_colors_delete_by_admin on album_engraving_colors
  for delete using (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager', 'album_manager'))
  );

create policy album_engraving_fonts_select on album_engraving_fonts
  for select using (tenant_id = current_tenant_id());
create policy album_engraving_fonts_write_by_admin on album_engraving_fonts
  for insert with check (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager', 'album_manager'))
  );
create policy album_engraving_fonts_update_by_admin on album_engraving_fonts
  for update using (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager', 'album_manager'))
  );
create policy album_engraving_fonts_delete_by_admin on album_engraving_fonts
  for delete using (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager', 'album_manager'))
  );

grant select, insert, update, delete on album_engraving_colors, album_engraving_fonts to authenticated;
grant select, insert, update, delete on album_engraving_colors, album_engraving_fonts to service_role;

-- ---------------------------------------------------------------------------------
-- album_order_selections -- snapshot columns for the couple's engraving color/font
-- choice, same snapshot-at-selection-time pattern as product/cover (CLAUDE.md
-- "Data integrity"). Nullable -- engraving color/font remain optional, same as the
-- existing engraving_text field.
-- ---------------------------------------------------------------------------------
alter table album_order_selections
  add column if not exists engraving_color_id uuid references album_engraving_colors(id) on delete set null,
  add column if not exists engraving_color_name_snapshot text,
  add column if not exists engraving_font_id uuid references album_engraving_fonts(id) on delete set null,
  add column if not exists engraving_font_name_snapshot text;

-- ---------------------------------------------------------------------------------
-- One-time real-data import, per-tenant, idempotent (guarded so re-running this
-- migration on a tenant that already has rows in the target table is a no-op --
-- protects any manual edits already made via the admin UI from being duplicated).
-- Source: the studio's own previous-system CSV exports (Cover/Extra/EngravingColor/
-- EngravingFont), reproduced verbatim.
-- ---------------------------------------------------------------------------------

-- Covers (18 rows: 5 denim, 7 linen, 2 other, 4 faux_leather)
insert into album_covers (tenant_id, name, description, cover_type, price_delta, preview_image_url, engraving_styles, sort_order, active)
select t.id, v.name, nullif(v.description, ''), v.cover_type, v.price_delta::numeric, v.preview_image_url, v.engraving_styles::jsonb, v.sort_order::int, true
from tenants t
cross join (values
  ('אגוז', '', 'denim', '140', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/2d72ae5f9_2026-04-20-234525.png', '{"textPositionX":11,"textPositionY":-24,"goldFoilStyle":"none","rotation":25,"scale":1,"shadowPreset":"none","embossDebossStyle":"none"}', '180'),
  ('בזלת', '', 'denim', '140', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/6b572a96a_2026-04-20-234428.png', '{"textPositionX":13,"textPositionY":-25,"goldFoilStyle":"none","rotation":25,"scale":1,"shadowPreset":"none","embossDebossStyle":"none"}', '170'),
  ('לגונה', '', 'denim', '140', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/e5ec74e82_2026-04-20-234318.png', '{"textPositionX":13,"textPositionY":-25,"goldFoilStyle":"none","rotation":22,"scale":1,"shadowPreset":"none","embossDebossStyle":"none"}', '160'),
  ('מעושן', '', 'denim', '140', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/57acb6148_2026-04-20-234237.png', '{"textPositionX":11,"textPositionY":-23,"goldFoilStyle":"none","rotation":26,"scale":1,"shadowPreset":"none","embossDebossStyle":"none"}', '150'),
  ('שנהב', '', 'denim', '140', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/9289cba62_2026-04-20-234156.png', '{"textPositionX":11,"textPositionY":-26,"goldFoilStyle":"none","rotation":24,"scale":1,"shadowPreset":"none","embossDebossStyle":"none"}', '140'),
  ('פחם', '', 'linen', '140', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/b916f30ad_2026-04-20-234114.png', '{"textPositionX":11,"textPositionY":-24,"goldFoilStyle":"none","rotation":24,"scale":1,"shadowPreset":"none","embossDebossStyle":"none"}', '130'),
  ('אגם', '', 'linen', '140', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/6e14b499b_2026-04-20-234027.png', '{"textPositionX":11,"textPositionY":-22,"goldFoilStyle":"none","rotation":21,"scale":1,"shadowPreset":"none","embossDebossStyle":"none"}', '120'),
  ('קפוצ''ינו', '', 'linen', '140', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/80aaeaffd_2026-04-20-233926.png', '{"textPositionX":11,"textPositionY":-23,"goldFoilStyle":"none","rotation":22,"scale":1,"shadowPreset":"none","embossDebossStyle":"none"}', '110'),
  ('זית', '', 'linen', '140', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/20486b46b_2026-04-20-233846.png', '{"textPositionX":10,"textPositionY":-21,"goldFoilStyle":"none","rotation":23,"scale":1,"shadowPreset":"none","embossDebossStyle":"none"}', '100'),
  ('עכבר', '', 'linen', '140', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/ceda6d963_2026-04-20-233805.png', '{"textPositionX":10,"textPositionY":-23,"goldFoilStyle":"none","rotation":24,"scale":1,"shadowPreset":"none","embossDebossStyle":"none"}', '90'),
  ('מרווה', '', 'linen', '140', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/4a1469c19_2026-04-20-233708.png', '{"textPositionX":11,"textPositionY":-24,"goldFoilStyle":"none","rotation":24,"scale":1,"shadowPreset":"none","embossDebossStyle":"none"}', '80'),
  ('פשתן טבעי', '', 'linen', '140', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/d84a220d4_2026-04-20-233616.png', '{"textPositionX":14,"textPositionY":-23,"goldFoilStyle":"none","rotation":23,"scale":1,"shadowPreset":"none","embossDebossStyle":"none"}', '70'),
  ('HM403', 'בד קלאסי חום', 'other', '0', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/ed16436dc_2026-04-20-233343.png', '{"textPositionX":10,"textPositionY":-24,"goldFoilStyle":"none","rotation":25,"scale":1,"shadowPreset":"none","embossDebossStyle":"none"}', '60'),
  ('HM404', 'בד קלאסי שמנת מלוכלך', 'other', '100', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/4160dac13_2026-04-20-233217.png', '{"textPositionX":11,"textPositionY":-24,"goldFoilStyle":"none","rotation":24,"scale":1,"shadowPreset":"none","embossDebossStyle":"none"}', '50'),
  ('HM203', 'דמוי אספלט אפור', 'faux_leather', '0', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/6c5e3a59d_2026-04-20-233056.png', '{"textPositionX":10,"textPositionY":-20,"goldFoilStyle":"none","rotation":27,"scale":1,"shadowPreset":"none","embossDebossStyle":"none"}', '40'),
  ('HM101', 'דמוי עור חום', 'faux_leather', '0', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/8efc09005_2026-04-20-232737.png', '{"textPositionX":10,"textPositionY":-21,"goldFoilStyle":"none","rotation":24,"scale":1,"shadowPreset":"none","embossDebossStyle":"none"}', '30'),
  ('HM111', 'דמוי עור לבן', 'faux_leather', '0', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/f7c4c9913_2026-04-20-232633.png', '{"textPositionX":14,"textPositionY":-24,"goldFoilStyle":"none","rotation":25,"scale":1,"shadowPreset":"none","embossDebossStyle":"none"}', '20'),
  ('HM103', 'דמוי עור שחור', 'faux_leather', '0', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/a10c7120e_2026-04-20-232415.png', '{"textPositionX":11,"textPositionY":-21,"goldFoilStyle":"none","rotation":20,"scale":1,"shadowPreset":"none","embossDebossStyle":"none"}', '10')
) as v(name, description, cover_type, price_delta, preview_image_url, engraving_styles, sort_order)
where not exists (select 1 from album_covers ac where ac.tenant_id = t.id);

-- Addons (10 rows: 4 glass sizes, 4 canvas sizes, mini-album, parent-album)
insert into album_addons (tenant_id, name, description, category, price, allows_multiple_images, requires_upload, price_type, preview_image_url, sort_order, active)
select t.id, v.name, nullif(v.description, ''), v.category, v.price::numeric, v.allows_multiple_images::boolean, v.requires_upload::boolean, 'fixed', v.preview_image_url, v.sort_order::int, true
from tenants t
cross join (values
  ('הדפסה זכוכית 60/90', E'יש להעלות את הקובץ המקורי באיכות מלאה\n*איסוף מהסניף בלבד - אין משלוח*\nהסניף נמצא ביבנה', 'glass', '490', 'true', 'true', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/0a6ac5e67_2026-04-21-45858.png', '10'),
  ('הגדלה זכוכית 50/70', E'יש להעלות את הקובץ המקורי באיכות מלאה\n*איסוף מהסניף בלבד - אין משלוח*\nהסניף נמצא ביבנה', 'glass', '390', 'true', 'true', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/b159895c5_2026-04-21-45858.png', '20'),
  ('הגדלה זכוכית 40/60', 'יש להעלות את הקובץ המקורי באיכות מלאה', 'glass', '270', 'true', 'true', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/4170b8020_2026-04-21-45858.png', '30'),
  ('הגדלה זכוכית 30/45', 'יש להעלות את הקובץ המקורי באיכות מלאה', 'glass', '200', 'true', 'true', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/c3d6664ac_2026-04-21-45858.png', '40'),
  ('הגדלה קנבס 60/90', 'יש להעלות את הקובץ המקורי באיכות מלאה', 'canvas', '290', 'true', 'true', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/419f22b87_Gemini_Generated_Image_32tnko32tnko32tn.png', '50'),
  ('הגדלה קנבס 50/70', 'יש להעלות את הקובץ המקורי באיכות מלאה', 'canvas', '170', 'true', 'true', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/0f3154adf_Gemini_Generated_Image_32tnko32tnko32tn.png', '60'),
  ('הגדלה קנבס 40/60', 'יש להעלות את הקובץ המקורי באיכות מלאה', 'canvas', '150', 'true', 'true', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/740142913_Gemini_Generated_Image_32tnko32tnko32tn.png', '70'),
  ('הגדלה קנבס 30/45', 'יש להעלות את הקובץ המקורי באיכות מלאה', 'canvas', '100', 'true', 'true', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/830e3e66f_Gemini_Generated_Image_32tnko32tnko32tn.png', '80'),
  ('תוספת משביצון', '', 'mini_album', '130', 'false', 'false', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/6716b463d_2026-04-21-45912.png', '90'),
  ('תוספת אלבום הורים', 'תוספת של אלבום הורים נוסף (זהה) בגודל 20/54', 'parent_album', '350', 'false', 'false', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/2c2220f83_2026-04-21-45903.png', '100')
) as v(name, description, category, price, allows_multiple_images, requires_upload, preview_image_url, sort_order)
where not exists (select 1 from album_addons aa where aa.tenant_id = t.id);

-- Engraving colors (6 rows)
insert into album_engraving_colors (tenant_id, name, description, hex_color, preview_image_url, sort_order, active)
select t.id, v.name, v.description, v.hex_color, v.preview_image_url, v.sort_order::int, true
from tenants t
cross join (values
  ('לבן', 'לבן', '#FFFFFF', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/179f5c30b_2026-04-21-30606.png', '60'),
  ('תכלת', 'תכלת', '#87CEEB', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/da39f419a_2026-04-21-30333.png', '50'),
  ('שחור', 'שחור', '#000000', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/167782513_2026-04-21-30303.png', '40'),
  ('סגול', 'סגול', '#E6E6FA', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/97282c224_2026-04-21-30227.png', '30'),
  ('כסף', 'כסף', '#C0C0C0', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/f97f7bf2c_2026-04-21-30155.png', '20'),
  ('זהב', 'זהב', '#D4AF37', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/95cd5fd7d_2026-04-21-30056.png', '10')
) as v(name, description, hex_color, preview_image_url, sort_order)
where not exists (select 1 from album_engraving_colors aec where aec.tenant_id = t.id);

-- Engraving fonts (6 rows)
insert into album_engraving_fonts (tenant_id, name, description, css_font_family, preview_image_url, preview_image_deboss, preview_image_color, sort_order, active)
select t.id, v.name, v.description, nullif(v.css_font_family, ''), v.preview_image_url, v.preview_image_deboss, v.preview_image_color, v.sort_order::int, true
from tenants t
cross join (values
  ('סמלים מיוחדים', 'הטבעה ללא צבע -  סמלים מיוחדים', '', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/681380868_2026-04-21-25706.png', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/3b29a1d62_2026-04-21-25706.png', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/4d4cc0f20_2026-04-21-33948.png', '60'),
  ('כתב עברית', 'הטבעה ללא צבע -  כתב עברית', 'Gveret Levin', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/f41070565_2026-04-21-33509.png', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/aaa09610e_2026-04-21-33509.png', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/cef615404_2026-04-21-33811.png', '50'),
  ('דפוס עברית', 'הטבעה ללא צבע -  דפוס עברית', 'Frank Ruhl', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/bfa375a12_2026-04-21-33357.png', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/aefcc6285_2026-04-21-33357.png', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/111c080d4_2026-04-21-33343.png', '40'),
  ('אנגלית מעוטר', 'הטבעה ללא צבע -  אנגלית מעוטר', 'Cochin', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/a2acefc38_2026-04-21-33143.png', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/53ac8bd52_2026-04-21-33143.png', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/0c8ae09c3_2026-04-21-33203.png', '30'),
  ('אנגלית מחובר', 'הטבעה ללא צבע -  אנגלית מחובר', 'Great Vibes', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/41ab983d9_2026-04-21-32913.png', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/7590d2602_2026-04-21-32913.png', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/f2d911a6c_2026-04-21-32810.png', '20'),
  ('דפוס אנגלית', 'הטבעה ללא צבע - דפוס אנגלית', 'Adobe Garamond Pro', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/a5ee93092_2026-04-21-33045.png', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/fdbee68bd_2026-04-21-25141.png', 'https://base44.app/api/apps/69e665b1ca86b3dc89485f31/files/mp/public/69e665b1ca86b3dc89485f31/7010a23ba_2026-04-21-30706.png', '10')
) as v(name, description, css_font_family, preview_image_url, preview_image_deboss, preview_image_color, sort_order)
where not exists (select 1 from album_engraving_fonts aef where aef.tenant_id = t.id);
