-- Album design editor, stage 4 (2026-10-08): the couple edits the sketch from their portal link.
-- Their edits live in a SEPARATE draft (client_doc) — the studio's design (doc) is never touched by
-- the couple. When they press "שליחה לסטודיו" the studio sees a banner and chooses: take their
-- version into the editor, or dismiss it. Their own photos (client_uploads) go to the private
-- album-files bucket under <tenant>/<order>/client-uploads/, through the album-portal function.
-- Only the album-portal Edge Function (service role, validated portal token) writes these columns
-- for the couple; the studio writes them through the editor (RLS of 0079 unchanged).
-- Additive only. Rollback: audit-reports/rollback/0080_rollback.sql. Re-runnable.

alter table album_designs
  add column if not exists client_edit_enabled boolean not null default false,
  add column if not exists client_doc jsonb,
  add column if not exists client_doc_version integer not null default 0,
  add column if not exists client_uploads jsonb not null default '[]'::jsonb,
  add column if not exists client_submitted_at timestamptz,
  add column if not exists client_note text;
