-- Google Drive helper (Avira, 2026-11-02, the owner's request). The system only reads Drive (a public folder link + an
-- API key), so it can't move or delete anything there. A small Google Apps Script in the owner's own Google account
-- (Settings ← חיבורים ← גוגל דרייב, like the Pixieset one) asks drive-helper every 5 minutes for work and does it:
--   trash         a gallery removed for good from the system → its Drive folder to the Drive trash (30 days to restore);
--   to_favorites  a starred gallery → its folder into "גלריות מועדפים" (the folder id stays, so the gallery still works);
--   restore       the star taken off → the folder back where it was (films_galleries.drive_prev_parent).
-- The script also reports the Drive's used / total space (app_settings drive_storage_used / drive_storage_limit).
-- Tasks are written by the gallery Worker (service role) and read by drive-helper; the studio's screens read them.

create table if not exists public.drive_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- No foreign key: a "trash" task outlives its gallery (removed for good just before).
  gallery_id text,
  couple_name text,
  folder_id text not null check (folder_id ~ '^[A-Za-z0-9_-]{10,100}$'),
  kind text not null check (kind in ('trash', 'to_favorites', 'restore')),
  -- restore: the folder it goes back to.
  parent_id text check (parent_id is null or parent_id ~ '^[A-Za-z0-9_-]{10,100}$'),
  status text not null default 'pending' check (status in ('pending', 'done', 'failed', 'cancelled')),
  error text check (error is null or char_length(error) <= 300),
  created_at timestamp with time zone not null default now(),
  done_at timestamp with time zone
);

create index if not exists drive_tasks_pending_idx on public.drive_tasks (tenant_id, created_at) where status = 'pending';
create index if not exists drive_tasks_gallery_idx on public.drive_tasks (gallery_id, created_at desc);

alter table public.drive_tasks enable row level security;

-- The studio's screens read their own tasks (the galleries list, Settings); only the service role writes.
drop policy if exists drive_tasks_read on public.drive_tasks;
create policy drive_tasks_read on public.drive_tasks for select using (
  tenant_id = current_tenant_id()
  and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
);

-- Where a starred gallery's folder was before it moved into "גלריות מועדפים" (set by drive-helper when it moved).
alter table public.films_galleries
  add column if not exists drive_prev_parent text;
