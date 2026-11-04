-- A full-quality download link for one version of the sketch, before the couple approves it (Avira, 2026-11-05, the
-- owner's decision). "🔗 קישור להורדה באיכות מלאה" in the album editor makes a print_access_links row pinned to the
-- version it just exported, and album-print-access serves THAT version's spreads (same page, same ZIP). A link
-- without a version is the print shop's link, exactly as before: the order's approved version only. Only adds.
alter table public.print_access_links
  add column if not exists version_id uuid references public.album_versions(id) on delete cascade;

comment on column public.print_access_links.version_id is
  'Set = a download link for this one version (the album editor, before approval). Null = the print shop''s link: the order''s approved version.';
