-- Album design editor, round 2 (2026-10-08):
--  - client_sources: extra photo sources the COUPLE added from the portal (a second Google Drive
--    folder — e.g. the magnets photographer — shown as its own tab with the name they chose).
--    The studio's own extra sources live inside the design document (doc.assets[].group).
--  - enlargements: photos marked "להגדלה" (canvas / glass, from the album_addons catalog), by the
--    couple or the studio, with orientation; once the studio prepares the files each entry gets a
--    file_key and the print-shop link (album-print-access) offers them as a separate download.
-- Written by the studio editor (RLS of 0079) and by album-portal (service role, portal token).
-- Additive only. Rollback: audit-reports/rollback/0081_rollback.sql. Re-runnable.

alter table album_designs
  add column if not exists client_sources jsonb not null default '[]'::jsonb,
  add column if not exists enlargements jsonb not null default '[]'::jsonb;
