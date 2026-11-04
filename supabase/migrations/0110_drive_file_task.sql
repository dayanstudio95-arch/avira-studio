-- A gallery's Drive folder filed where the owner keeps his galleries (Avira, 2026-11-04, the owner's decision): the
-- upload from the gallery page makes the event's folder ("ויקה ואיליה 1/11/26") in the system's own folder, and the
-- Drive helper (his Apps Script, full access to his Drive) moves it into "גלריות אווירה 2026 › גלריות 11/2026" —
-- made the first time, used when they are there. The system's own access (drive.file) reaches only what it made, so
-- it cannot write there itself. Only adds.
alter table public.drive_tasks drop constraint if exists drive_tasks_kind_check;
alter table public.drive_tasks add constraint drive_tasks_kind_check check (kind in ('trash', 'to_favorites', 'restore', 'file'));
-- file: the folders from the top of My Drive, by name (["גלריות אווירה 2026", "גלריות 11/2026"]).
alter table public.drive_tasks
  add column if not exists path jsonb check (path is null or (jsonb_typeof(path) = 'array' and jsonb_array_length(path) between 1 and 3));
