-- The studio's album-choice folder (Avira, 2026-11-02, the owner's request). His price list was copied into every
-- wedding's Drive folder to become the gallery's "בחירת אלבום" set; now it is one cloud folder in the gallery
-- settings, and the gallery Worker adds its photos to every photo gallery (gallery-worker/worker/albumSet.ts).
-- album_set: {url, provider, items: [{name, ref, size?, v?, ar?}], at} — the folder as last read.
alter table public.films_studio_settings
  add column if not exists album_set jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'films_studio_settings_album_set_check') then
    alter table public.films_studio_settings
      add constraint films_studio_settings_album_set_check check (
        album_set is null or (jsonb_typeof(album_set) = 'object' and jsonb_array_length(coalesce(album_set->'items', '[]'::jsonb)) <= 100)
      );
  end if;
end $$;

-- The owner's decision: guests (the link the couple shares) don't see the price list. A new gallery starts with its
-- "בחירת אלבום" set kept from the guests (the Worker, on the first folder load); the galleries there already get
-- it here once. The studio can still show it to guests in one gallery (סטים שהאורחים לא רואים).
update public.films_galleries g
set guest_hidden_sets = array_append(g.guest_hidden_sets, s.set_id)
from (
  select p.gallery_id, (select x->>'id' from jsonb_array_elements(p.data->'sets') x where btrim(x->>'name') = 'בחירת אלבום' limit 1) as set_id
  from public.films_photos p
) s
where s.gallery_id = g.id
  and g.kind = 'photos'
  and s.set_id is not null
  and not (s.set_id = any(g.guest_hidden_sets))
  and cardinality(g.guest_hidden_sets) < 40;
