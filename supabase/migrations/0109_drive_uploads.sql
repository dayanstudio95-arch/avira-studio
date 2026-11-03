-- Photos uploaded to Google Drive from the gallery page (Avira, 2026-11-03, the owner's request): the studio connects its
-- Google Drive once (scope drive.file — only the folders the system makes), drops the wedding's folder on the gallery,
-- and the browser uploads the photos straight to Drive; the folder is shared by link, saved on the gallery and loaded.
-- The photographers chosen are marked "done" on work status. And work status shows a gallery sent from the galleries.
-- Only adds. The new table grants explicitly (production gives new tables no privileges — 0103).

-- One Drive per studio. The tokens never reach the browser's own reads: no policy for authenticated — only the
-- google-drive Edge Function (service role) reads them, and hands out a short-lived access token to the studio's admins.
create table if not exists public.google_drive_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  google_email text check (google_email is null or char_length(google_email) <= 320),
  access_token text,
  refresh_token text,
  token_expires_at timestamp with time zone,
  scope text,
  -- "גלריות אווירה": the folder the system made, every gallery's folder goes in it.
  root_folder_id text check (root_folder_id is null or char_length(root_folder_id) <= 200),
  status text not null default 'connected' check (status in ('connected', 'error')),
  last_error text check (last_error is null or char_length(last_error) <= 500),
  connected_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.google_drive_accounts enable row level security;
revoke all on public.google_drive_accounts from anon, authenticated;
grant select, insert, update, delete on public.google_drive_accounts to service_role;

-- "נשלח מהגלריות" on work status: when the final link went to the couple, from where, and which gallery.
alter table public.events
  add column if not exists final_sent_at timestamp with time zone,
  add column if not exists final_sent_via text check (final_sent_via is null or final_sent_via in ('gallery', 'status')),
  -- The gallery's page in the app ("photos/<id>" or "films/<id>").
  add column if not exists final_sent_gallery text check (final_sent_gallery is null or final_sent_gallery ~ '^(photos|films)/[A-Za-z0-9_-]{1,64}$');
