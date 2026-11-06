-- The video editor's own page (Avira, 2026-11-06, the owner's request): the editor signs in with his phone and a
-- password the owner sets, sees his weddings (names, date, venue, videographers, the raw link, his pay), and pastes the
-- final film's link; the owner sends it to the couple from "עריכת וידאו" and marks it backed up. The editor never gets
-- a user in the system — the editor-portal Edge Function (service role) is his only door, so no table opens to him.
-- Only adds. The new tables grant explicitly (production gives new tables no privileges — 0103).

-- The film, on the event. "שלח לזוג" of the film lights the editor's square (editor_done), not "סופי" / "→ זוג" —
-- those are the photo gallery's (final_link, final_done_manual).
alter table public.events
  add column if not exists film_link text check (film_link is null or (char_length(film_link) <= 500 and film_link ~ '^https?://')),
  add column if not exists film_link_at timestamp with time zone,
  add column if not exists film_sent_at timestamp with time zone,
  add column if not exists film_backed_up_at timestamp with time zone;

-- Who may sign in: one row per team member, his password as a PBKDF2 hash ("pbkdf2$sha256$<iterations>$<salt>$<hash>").
-- The phone he signs in with is his own staff_members phone, so changing it there changes it here.
create table if not exists public.staff_portal_access (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  staff_member_id uuid not null unique references public.staff_members(id) on delete cascade,
  password_hash text not null check (char_length(password_hash) <= 300),
  failed_count integer not null default 0 check (failed_count >= 0),
  locked_until timestamp with time zone,
  last_login_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.staff_portal_access enable row level security;
revoke all on public.staff_portal_access from anon, authenticated;
grant select, insert, update, delete on public.staff_portal_access to service_role;

-- A signed-in device: the token's SHA-256 only (the raw token lives in that browser), checked on every request.
create table if not exists public.staff_portal_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  staff_member_id uuid not null references public.staff_members(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  created_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone not null,
  last_seen_at timestamp with time zone,
  revoked_at timestamp with time zone
);
create index if not exists staff_portal_sessions_staff_idx on public.staff_portal_sessions (staff_member_id);
alter table public.staff_portal_sessions enable row level security;
revoke all on public.staff_portal_sessions from anon, authenticated;
grant select, insert, update, delete on public.staff_portal_sessions to service_role;
