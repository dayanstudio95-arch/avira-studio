-- Galleries (Avira, 2026-11-02, the owner's request): the wedding's main photographer on the gallery (filled from the
-- event's "צלם 1", editable; the list shows and searches it), and the studio's own favourites (a star in the list —
-- later the photographer's landing page shows the starred ones). Only adds columns, empty by default.
alter table public.films_galleries
  add column if not exists photographer text,
  add column if not exists studio_favorite boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'films_galleries_photographer_check') then
    alter table public.films_galleries
      add constraint films_galleries_photographer_check check (photographer is null or char_length(photographer) <= 80);
  end if;
end $$;
