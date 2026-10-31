-- Galleries: the studio can keep the wedding's date or venue off the couple's and the guests' pages (Avira, 2026-10-31,
-- the owner's request — the date and venue now come from the event the gallery is linked to). The studio's own
-- screens keep showing both. Only adds two columns, false by default: every existing gallery shows both, as before.
alter table public.films_galleries
  add column if not exists hide_date boolean not null default false,
  add column if not exists hide_venue boolean not null default false;
