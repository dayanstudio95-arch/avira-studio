-- Galleries: sets the guests' link doesn't show (Avira, 2026-10-31, the owner's request: "the couple asked that the
-- guests won't see the getting-ready and the outdoor photos"). The couple's own link still shows every set. Set ids
-- (films_photos.data.sets[].id), on the gallery row so a guest's photo request checks them without reading the photo
-- list. Only adds a column, empty by default: every existing gallery shows its guests every set, as before.
alter table public.films_galleries
  add column if not exists guest_hidden_sets text[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'films_galleries_guest_hidden_sets_check') then
    alter table public.films_galleries
      add constraint films_galleries_guest_hidden_sets_check check (cardinality(guest_hidden_sets) <= 40);
  end if;
end $$;
