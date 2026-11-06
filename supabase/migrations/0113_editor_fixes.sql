-- The video editor's corrections (Avira, 2026-11-06, the owner's request): when a couple asks the editor for changes,
-- he presses "עשיתי תיקונים" on his page — the same link or a new one, and what was fixed — and the owner sends it to
-- the couple from "עריכת וידאו". Every round is kept on the event: [{ n, at, link, newLink, note, sentAt }].
-- Only adds (a column with a constant default — no table rewrite).
alter table public.events
  add column if not exists film_fixes jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'events_film_fixes_check') then
    alter table public.events add constraint events_film_fixes_check
      check (jsonb_typeof(film_fixes) = 'array' and jsonb_array_length(film_fixes) <= 30);
  end if;
end $$;
