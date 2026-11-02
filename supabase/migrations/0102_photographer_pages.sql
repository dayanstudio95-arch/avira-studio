-- Photographer landing pages (Avira, 2026-11-02, the owner's request). One page per photographer of the team: a photo,
-- a few words, the weddings he shot that the studio starred (films_galleries.studio_favorite, photographer = his name;
-- each shows its teaser set, or the whole gallery when the studio opens it), and what couples said (typed, or a
-- screenshot of their WhatsApp message). Sent to a couple who asks to see a photographer's work, by one unlisted link
-- (the gallery Worker serves /photographer/<token>; the token is the link, like a print link). The studio edits the
-- page in "דפי צלמים"; the Worker reads it with the service role. Only adds.

create table if not exists public.photographer_pages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- The name as the team and the galleries write it ("צלם 1" of the event, films_galleries.photographer).
  staff_name text not null check (char_length(staff_name) between 1 and 80),
  display_name text check (display_name is null or char_length(display_name) <= 80),
  bio text check (bio is null or char_length(bio) <= 600),
  -- photographer-pages/<tenant_id>/<page id>/… (the bucket below).
  photo_path text check (photo_path is null or char_length(photo_path) <= 300),
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{20,64}$'),
  published boolean not null default true,
  -- Starred weddings the studio took off this page (a couple asked), and those shown whole instead of their teaser.
  hidden_galleries text[] not null default '{}' check (cardinality(hidden_galleries) <= 500),
  full_galleries text[] not null default '{}' check (cardinality(full_galleries) <= 500),
  views integer not null default 0,
  last_viewed_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (tenant_id, staff_name)
);

create table if not exists public.photographer_testimonials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  page_id uuid not null references public.photographer_pages(id) on delete cascade,
  body text check (body is null or char_length(body) <= 1000),
  couple_name text check (couple_name is null or char_length(couple_name) <= 80),
  -- A screenshot of the couple's message (the same bucket).
  image_path text check (image_path is null or char_length(image_path) <= 300),
  sort integer not null default 0,
  created_at timestamp with time zone not null default now(),
  check (coalesce(body, '') <> '' or image_path is not null)
);

create index if not exists photographer_testimonials_page_idx on public.photographer_testimonials (page_id, sort);

alter table public.photographer_pages enable row level security;
alter table public.photographer_testimonials enable row level security;

-- The studio's admins edit their own pages; the Worker reads with the service role.
drop policy if exists photographer_pages_rw on public.photographer_pages;
create policy photographer_pages_rw on public.photographer_pages for all using (
  tenant_id = current_tenant_id()
  and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
) with check (
  tenant_id = current_tenant_id()
  and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
);

-- The lead coordinator sends a page from the chat ("שליחת דף צלם"): reads the published ones only, changes nothing.
drop policy if exists photographer_pages_coordinator_read on public.photographer_pages;
create policy photographer_pages_coordinator_read on public.photographer_pages for select using (
  tenant_id = current_tenant_id()
  and published
  and exists (select 1 from profiles where id = auth.uid() and role = 'lead_coordinator')
);

drop policy if exists photographer_testimonials_rw on public.photographer_testimonials;
create policy photographer_testimonials_rw on public.photographer_testimonials for all using (
  tenant_id = current_tenant_id()
  and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
) with check (
  tenant_id = current_tenant_id()
  and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
);

-- A view of the page (the Worker, service role): counted in one statement.
create or replace function public.photographer_page_seen(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update public.photographer_pages set views = views + 1, last_viewed_at = now() where id = p_id;
$$;
revoke all on function public.photographer_page_seen(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.photographer_page_seen(uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.photographer_page_seen(uuid) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.photographer_page_seen(uuid) to service_role';
  end if;
end $$;

-- Storage: a PRIVATE bucket for the photographers' photos and the testimonial screenshots. The page's visitors get
-- them through the Worker (service role); the studio uploads with its own session. Path: <tenant_id>/<page id>/<file>.
insert into storage.buckets (id, name, public)
values ('photographer-pages', 'photographer-pages', false)
on conflict (id) do nothing;

drop policy if exists photographer_pages_files_select on storage.objects;
create policy photographer_pages_files_select on storage.objects
  for select using (
    bucket_id = 'photographer-pages'
    and (storage.foldername(name))[1] = current_tenant_id()::text
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
  );

drop policy if exists photographer_pages_files_insert on storage.objects;
create policy photographer_pages_files_insert on storage.objects
  for insert with check (
    bucket_id = 'photographer-pages'
    and (storage.foldername(name))[1] = current_tenant_id()::text
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
  );

drop policy if exists photographer_pages_files_delete on storage.objects;
create policy photographer_pages_files_delete on storage.objects
  for delete using (
    bucket_id = 'photographer-pages'
    and (storage.foldername(name))[1] = current_tenant_id()::text
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
  );
