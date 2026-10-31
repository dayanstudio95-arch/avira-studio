-- Galleries: the couple says "we finished choosing" (Avira, 2026-10-31, the owner's request): their hearts lock until the
-- studio reopens them, the studio's list shows how many they chose, and a private link lets the album designer see and
-- download just those photos (the album group on WhatsApp gets it at once, gallery-choice-notify). Only adds columns,
-- empty by default: no gallery changes.
--   choice_done_at        when the couple pressed it (null = still choosing, or the studio reopened it)
--   choice_done_count     how many photos they had chosen then
--   choice_token          the private link (/choice/<token>): until the gallery closes, renewed or stopped by the studio
--   choice_group_sent_at  the last time the album group was sent the link
alter table public.films_galleries
  add column if not exists choice_done_at timestamp with time zone,
  add column if not exists choice_done_count integer,
  add column if not exists choice_token text,
  add column if not exists choice_group_sent_at timestamp with time zone;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'films_galleries_choice_token_check') then
    alter table public.films_galleries
      add constraint films_galleries_choice_token_check check (choice_token is null or choice_token ~ '^[A-Za-z0-9_-]{20,64}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'films_galleries_choice_done_count_check') then
    alter table public.films_galleries
      add constraint films_galleries_choice_done_count_check check (choice_done_count is null or choice_done_count >= 0);
  end if;
end $$;

-- The private link is looked up by its token (like print_token).
create unique index if not exists films_galleries_choice_token_key on public.films_galleries using btree (choice_token) where (choice_token is not null);
