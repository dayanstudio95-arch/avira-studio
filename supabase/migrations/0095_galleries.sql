-- 0095 — Photo galleries (2026-10-30, the owner's request: "the galleries from Studio Plan, working here the same").
--
-- Studio Plan's films module (apps/films-worker + its tables), brought over for PHOTO galleries, face search and the
-- couple's album designer. Films (video), the studio page and its reviews stay off: tenant_has_module(…,'films') is
-- false here, the same switch Studio Plan uses for a studio without that module.
--
-- The tables, functions, policies and triggers below are Studio Plan's FINAL definitions (all its migrations applied
-- in PGlite and read back from the catalog — not retyped), under the same names, so changes can keep moving between
-- the two systems. Spec: docs/galleries-port/*.md. Only the service role (the gallery Worker) writes them.
--
-- Avira-only parts, before the copied schema:
--   1. Stand-ins for Studio Plan's billing/module helpers (Avira has one studio and no subscription).
--   2. tenants.slug (the studio's part of a gallery address) and tenants.accent_color, with Studio Plan's rules.
--   3. rate_hit (the Worker's limits) on Avira's existing rate_limit_hits table.
--   4. album_orders: the three columns the gallery album uses (phase 3 fills them; nullable/defaulted, nothing changes
--      now) and paid_at (+ its trigger) for the galleries summary's "paid this month".
-- Not here (phase 3, with Avira's album portal): films_album_design_bank, films_album_order_confirm_spreads, films_album_order_from_design, films_album_order_state.
-- Never here: films_insert_studio_lead, films_mit4mit_decide (studio page).
--
-- Only adds. Rollback: audit-reports/rollback/0095_rollback.sql.

-- 1. Module / access stand-ins ---------------------------------------------------------------------------------------
create or replace function public.tenant_has_module(tid uuid, module_key text)
returns boolean language sql stable security definer set search_path = public as $$
  -- Avira: photo galleries and the CRM on, films off.
  select module_key in ('photos', 'crm') and exists (
    select 1 from public.tenants t
     where t.id = tid
       and (coalesce(auth.role(), '') <> 'authenticated' or t.id = public.current_tenant_id()));
$$;

create or replace function public.tenant_access_state(tid uuid)
returns text language sql stable security definer set search_path = public as $$
  -- Avira has no subscription: a studio that exists is 'ok'.
  select case when exists (select 1 from public.tenants t where t.id = tid) then 'ok' else 'blocked' end
   where coalesce(auth.role(), '') <> 'authenticated' or tid = public.current_tenant_id();
$$;

create or replace function public.tenant_is_writable(tid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.tenant_access_state(tid) = 'ok', false);
$$;

create or replace function public.current_tenant_readable()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.tenant_id = public.current_tenant_id());
$$;

revoke all on function public.tenant_has_module(uuid, text) from public, anon;
revoke all on function public.tenant_access_state(uuid) from public, anon;
revoke all on function public.tenant_is_writable(uuid) from public, anon;
revoke all on function public.current_tenant_readable() from public, anon;
grant execute on function public.tenant_has_module(uuid, text) to authenticated, service_role;
grant execute on function public.tenant_access_state(uuid) to authenticated, service_role;
grant execute on function public.tenant_is_writable(uuid) to authenticated, service_role;
grant execute on function public.current_tenant_readable() to authenticated, service_role;

-- 2. The studio's address and colour ---------------------------------------------------------------------------------
alter table public.tenants
  add column if not exists accent_color text not null default '#FACC15',
  add column if not exists slug text;
alter table public.tenants
  drop constraint if exists tenants_accent_color_hex,
  add constraint tenants_accent_color_hex check (accent_color ~ '^#[0-9a-fA-F]{6}$');
alter table public.tenants
  drop constraint if exists tenants_slug_format,
  add constraint tenants_slug_format check (
    slug is null or (
      slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'
      and slug not in ('admin','api','assets','watch','join','demo','login','signup','films','app','www','static','accessibility','print','models')
    ));
create unique index if not exists tenants_slug_key on public.tenants (slug) where slug is not null;

create table if not exists public.tenant_slug_history (
  id bigserial primary key,
  slug text not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  released_at timestamptz not null default now()
);
create index if not exists tenant_slug_history_slug_idx on public.tenant_slug_history (slug, released_at desc);
create index if not exists tenant_slug_history_tenant_idx on public.tenant_slug_history (tenant_id, released_at desc);
alter table public.tenant_slug_history enable row level security;
revoke all on public.tenant_slug_history from anon, authenticated;
grant select, insert, delete on public.tenant_slug_history to service_role;
grant usage, select on sequence public.tenant_slug_history_id_seq to service_role;

create or replace function public.tenants_slug_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.slug is null or (tg_op = 'UPDATE' and new.slug is not distinct from old.slug) then
    if tg_op = 'UPDATE' and old.slug is not null and new.slug is null then
      insert into public.tenant_slug_history (slug, tenant_id) values (old.slug, old.id);
    end if;
    return new;
  end if;
  -- At most 3 changes of an address in 30 days (setting the first one is not a change).
  if tg_op = 'UPDATE' and old.slug is not null
     and (select count(*) from public.tenant_slug_history h
           where h.tenant_id = new.id and h.released_at > now() - interval '30 days') >= 3 then
    raise exception 'slug_change_limit: a studio changes its address at most 3 times in 30 days'
      using errcode = 'P0001';
  end if;
  -- An address another studio gave up in the last year stays that studio's.
  if exists (select 1 from public.tenant_slug_history h
              where h.slug = new.slug and h.tenant_id <> new.id
                and h.released_at > now() - interval '365 days') then
    raise exception 'slug_reserved: this address is kept for the studio that gave it up'
      using errcode = '23505';
  end if;
  if tg_op = 'UPDATE' and old.slug is not null then
    insert into public.tenant_slug_history (slug, tenant_id) values (old.slug, old.id);
  end if;
  return new;
end;
$$;
revoke all on function public.tenants_slug_guard() from public, anon, authenticated;
drop trigger if exists tenants_slug_guard on public.tenants;
create trigger tenants_slug_guard
  before insert or update of slug on public.tenants
  for each row execute function public.tenants_slug_guard();

-- 3. rate_hit on the existing rate_limit_hits ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rate_hit(p_key text, p_max integer, p_window_seconds integer, p_add boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_key text;
  n integer;
  oldest timestamptz;
begin
  if coalesce(p_key, '') = '' then
    raise exception 'rate_hit: a key is required' using errcode = '22023';
  end if;
  if p_max is null or p_max < 1 then
    raise exception 'rate_hit: max must be at least 1' using errcode = '22023';
  end if;
  if p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'rate_hit: window must be 1..86400 seconds' using errcode = '22023';
  end if;
  v_key := case when length(p_key) > 200
                then left(p_key, 100) || '#' || encode(sha256(convert_to(p_key, 'UTF8')), 'hex')
                else p_key end;
  perform pg_advisory_xact_lock(hashtext(v_key));
  select count(*), min(created_at) into n, oldest from public.rate_limit_hits
   where bucket_key = v_key and created_at >= now() - make_interval(secs => p_window_seconds);
  if n >= p_max then
    return jsonb_build_object('allowed', false, 'count', n,
      'retryAfter', greatest(1, ceil(extract(epoch from (oldest + make_interval(secs => p_window_seconds) - now()))))::int);
  end if;
  if coalesce(p_add, true) then
    insert into public.rate_limit_hits (bucket_key) values (v_key);
    n := n + 1;
  end if;
  return jsonb_build_object('allowed', true, 'count', n, 'retryAfter', 0);
end;
$function$;
revoke all on function public.rate_hit(text, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.rate_hit(text, integer, integer, boolean) to service_role;

-- 4. The gallery tables (Studio Plan's final definitions) ------------------------------------------------------------
create table if not exists public.films_galleries (
  id text not null,
  tenant_id uuid not null,
  couple_name text not null,
  studio_name_override text,
  event_date text default ''::text not null,
  venue text,
  days integer default 30 not null,
  expires_at timestamp with time zone not null,
  has_cover boolean default false not null,
  folder_url text,
  folder_provider text,
  films jsonb default '[]'::jsonb not null,
  views integer default 0 not null,
  downloads integer default 0 not null,
  lead_id uuid,
  event_id uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  kind text default 'films'::text not null,
  photo_count integer default 0 not null,
  linked_id text,
  music text,
  guest_id text,
  password text,
  download_pin text,
  print_token text,
  deleted_at timestamp with time zone,
  cover_key text,
  has_thumb boolean default false not null,
  purge_failed_at timestamp with time zone,
  guest_views integer default 0 not null,
  cover_version bigint,
  photos_version integer default 0 not null,
  photos_visible_version bigint default 0 not null,
  photos_gen bigint default 0 not null,
  faces_off_at timestamp with time zone,
  print_token_created_at timestamp with time zone,
  constraint films_galleries_pkey PRIMARY KEY (id),
  constraint films_galleries_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
  constraint films_galleries_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL,
  constraint films_galleries_linked_id_fkey FOREIGN KEY (linked_id) REFERENCES films_galleries(id) ON DELETE SET NULL,
  constraint films_galleries_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint films_galleries_cover_key_check CHECK (((cover_key IS NULL) OR (cover_key ~ '^[0-9a-f]{8}$'::text))),
  constraint films_galleries_folder_provider_check CHECK ((folder_provider = ANY (ARRAY['dropbox'::text, 'dropbox-link'::text, 'gdrive'::text, 'myairbridge'::text, 'pcloud'::text]))),
  constraint films_galleries_guest_id_check CHECK (((guest_id IS NULL) OR (guest_id ~ '^[a-f0-9]{16}$'::text))),
  constraint films_galleries_id_check CHECK ((id ~ '^[a-f0-9]{16}$'::text)),
  constraint films_galleries_kind_check CHECK ((kind = ANY (ARRAY['films'::text, 'photos'::text]))),
  constraint films_galleries_print_token_check CHECK (((print_token IS NULL) OR (print_token ~ '^[A-Za-z0-9_-]{20,64}$'::text))),
  constraint films_galleries_secrets_check CHECK (((char_length(COALESCE(password, ''::text)) <= 40) AND (char_length(COALESCE(download_pin, ''::text)) <= 40)))
);

create table if not exists public.films_albums (
  gallery_id text not null,
  tenant_id uuid not null,
  data jsonb not null,
  status text default 'draft'::text not null,
  updated_at timestamp with time zone default now() not null,
  submitted_at timestamp with time zone,
  rev bigint default 1 not null,
  print_data jsonb,
  print_submitted_at timestamp with time zone,
  constraint films_albums_pkey PRIMARY KEY (gallery_id),
  constraint films_albums_gallery_id_fkey FOREIGN KEY (gallery_id) REFERENCES films_galleries(id) ON DELETE CASCADE,
  constraint films_albums_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint films_albums_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text])))
);

create table if not exists public.films_cleanup_runs (
  id bigint generated always as identity not null,
  ran_at timestamp with time zone default now() not null,
  faces_removed integer default 0 not null,
  purged integer default 0 not null,
  errors jsonb default '[]'::jsonb not null,
  pending_faces integer default 0 not null,
  pending_trash integer default 0 not null,
  subrequests integer default 0 not null,
  stopped text,
  blocked integer default 0 not null,
  constraint films_cleanup_runs_pkey PRIMARY KEY (id)
);

create table if not exists public.films_face_searches (
  id bigint generated always as identity not null,
  gallery_id text not null,
  tenant_id uuid not null,
  role text not null,
  consent text not null,
  created_at timestamp with time zone default now() not null,
  constraint films_face_searches_pkey PRIMARY KEY (id),
  constraint films_face_searches_gallery_id_fkey FOREIGN KEY (gallery_id) REFERENCES films_galleries(id) ON DELETE CASCADE,
  constraint films_face_searches_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint films_face_searches_consent_check CHECK (((length(consent) >= 1) AND (length(consent) <= 40))),
  constraint films_face_searches_role_check CHECK ((role = ANY (ARRAY['couple'::text, 'guest'::text, 'studio'::text])))
);

create table if not exists public.films_faces (
  gallery_id text not null,
  tenant_id uuid not null,
  files text[] default '{}'::text[] not null,
  photos integer default 0 not null,
  faces integer default 0 not null,
  done text[] default '{}'::text[] not null,
  updated_at timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null,
  cleanup_failed_at timestamp with time zone,
  version bigint default 0 not null,
  dirty text[] default '{}'::text[] not null,
  constraint films_faces_pkey PRIMARY KEY (gallery_id),
  constraint films_faces_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint films_faces_faces_check CHECK ((faces >= 0)),
  constraint films_faces_gallery_id_check CHECK ((gallery_id ~ '^[a-f0-9]{16}$'::text)),
  constraint films_faces_photos_check CHECK ((photos >= 0))
);

create table if not exists public.films_faces_done (
  gallery_id text not null,
  key text not null,
  tenant_id uuid not null,
  file text,
  constraint films_faces_done_pkey PRIMARY KEY (gallery_id, key),
  constraint films_faces_done_gallery_id_fkey FOREIGN KEY (gallery_id) REFERENCES films_faces(gallery_id) ON DELETE CASCADE,
  constraint films_faces_done_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint films_faces_done_key_check CHECK ((key ~ '^[0-9a-f]{8}$'::text))
);

create table if not exists public.films_hearts (
  gallery_id text not null,
  tenant_id uuid not null,
  photo_key text not null,
  who text default ''::text not null,
  created_at timestamp with time zone default now() not null,
  constraint films_hearts_pkey PRIMARY KEY (gallery_id, photo_key, who),
  constraint films_hearts_gallery_id_fkey FOREIGN KEY (gallery_id) REFERENCES films_galleries(id) ON DELETE CASCADE,
  constraint films_hearts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint films_hearts_photo_key_check CHECK ((photo_key ~ '^[0-9a-f]{8}$'::text)),
  constraint films_hearts_who_check CHECK ((char_length(who) <= 30))
);

create table if not exists public.films_insta (
  gallery_id text not null,
  tenant_id uuid not null,
  photo_key text not null,
  created_at timestamp with time zone default now() not null,
  constraint films_insta_pkey PRIMARY KEY (gallery_id, photo_key),
  constraint films_insta_gallery_id_fkey FOREIGN KEY (gallery_id) REFERENCES films_galleries(id) ON DELETE CASCADE,
  constraint films_insta_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint films_insta_photo_key_check CHECK ((photo_key ~ '^[0-9a-f]{8}$'::text))
);

create table if not exists public.films_photo_lists (
  id text not null,
  gallery_id text not null,
  tenant_id uuid not null,
  name text not null,
  keys jsonb default '[]'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint films_photo_lists_pkey PRIMARY KEY (id),
  constraint films_photo_lists_gallery_id_fkey FOREIGN KEY (gallery_id) REFERENCES films_galleries(id) ON DELETE CASCADE,
  constraint films_photo_lists_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint films_photo_lists_id_check CHECK ((id ~ '^[0-9a-f]{12}$'::text)),
  constraint films_photo_lists_keys_check CHECK ((jsonb_typeof(keys) = 'array'::text)),
  constraint films_photo_lists_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 40)))
);

create table if not exists public.films_photos (
  gallery_id text not null,
  tenant_id uuid not null,
  data jsonb not null,
  updated_at timestamp with time zone default now() not null,
  version integer default 1 not null,
  constraint films_photos_pkey PRIMARY KEY (gallery_id),
  constraint films_photos_gallery_id_fkey FOREIGN KEY (gallery_id) REFERENCES films_galleries(id) ON DELETE CASCADE,
  constraint films_photos_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

create table if not exists public.films_studio_settings (
  tenant_id uuid not null,
  default_days integer default 30 not null,
  terms_text text,
  contact_line text default ''::text not null,
  vimeo_url text default ''::text not null,
  youtube_url text default ''::text not null,
  headline text default ''::text not null,
  about text default ''::text not null,
  page_enabled boolean default false not null,
  mit4mit_url text,
  showcase jsonb default '{"films": []}'::jsonb not null,
  reviews jsonb default '[]'::jsonb not null,
  dropbox_account_name text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  label_sets_on boolean default false not null,
  label_map jsonb,
  music jsonb default '[]'::jsonb not null,
  music_default text,
  album_layouts jsonb default '[]'::jsonb not null,
  design_default jsonb,
  access_version integer default 0 not null,
  mit4mit_biz_id text,
  mit4mit_removed jsonb default '[]'::jsonb not null,
  mit4mit_linked_at timestamp with time zone,
  mit4mit_approved_at timestamp with time zone,
  constraint films_studio_settings_pkey PRIMARY KEY (tenant_id),
  constraint films_studio_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint films_studio_settings_access_version_check CHECK ((access_version >= 0)),
  constraint films_studio_settings_default_days_check CHECK (((default_days >= 1) AND (default_days <= 3650))),
  constraint films_studio_settings_mit4mit_biz_id_check CHECK ((mit4mit_biz_id ~ '^[0-9]{1,12}$'::text)),
  constraint films_studio_settings_mit4mit_removed_check CHECK ((jsonb_typeof(mit4mit_removed) = 'array'::text))
);

create table if not exists public.films_terms_accepts (
  id bigserial not null,
  tenant_id uuid not null,
  gallery_id text not null,
  accepted_at timestamp with time zone default now() not null,
  terms_hash text not null,
  ip_hash text not null,
  user_agent text default ''::text not null,
  role text,
  link_id text,
  constraint films_terms_accepts_pkey PRIMARY KEY (id),
  constraint films_terms_accepts_gallery_id_fkey FOREIGN KEY (gallery_id) REFERENCES films_galleries(id) ON DELETE CASCADE,
  constraint films_terms_accepts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  constraint films_terms_accepts_link_id_check CHECK (((link_id IS NULL) OR (link_id ~ '^[a-f0-9]{16}$'::text))),
  constraint films_terms_accepts_role_check CHECK (((role IS NULL) OR (role = ANY (ARRAY['couple'::text, 'guest'::text]))))
);

create index if not exists films_galleries_tenant_created_idx ON public.films_galleries USING btree (tenant_id, created_at DESC);
create unique index if not exists films_galleries_guest_id_key ON public.films_galleries USING btree (guest_id) WHERE (guest_id IS NOT NULL);
create unique index if not exists films_galleries_print_token_key ON public.films_galleries USING btree (print_token) WHERE (print_token IS NOT NULL);
create index if not exists films_galleries_deleted_at_idx ON public.films_galleries USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);
create index if not exists films_galleries_lead_id_idx ON public.films_galleries USING btree (lead_id) WHERE (lead_id IS NOT NULL);
create index if not exists films_galleries_event_id_idx ON public.films_galleries USING btree (event_id) WHERE (event_id IS NOT NULL);
create index if not exists films_galleries_linked_id_idx ON public.films_galleries USING btree (linked_id) WHERE (linked_id IS NOT NULL);
create index if not exists films_galleries_print_token_created_idx ON public.films_galleries USING btree (print_token_created_at) WHERE (print_token IS NOT NULL);
create index if not exists films_face_searches_gallery_idx ON public.films_face_searches USING btree (gallery_id, created_at);
create index if not exists films_faces_done_file_idx ON public.films_faces_done USING btree (gallery_id, file);
create index if not exists films_hearts_gallery_idx ON public.films_hearts USING btree (gallery_id, created_at);
create index if not exists films_photo_lists_gallery_idx ON public.films_photo_lists USING btree (gallery_id, created_at);
create unique index if not exists films_photo_lists_gallery_name_key ON public.films_photo_lists USING btree (gallery_id, name);
create unique index if not exists films_studio_settings_mit4mit_biz_key ON public.films_studio_settings USING btree (mit4mit_biz_id) WHERE (mit4mit_biz_id IS NOT NULL);
create index if not exists films_terms_accepts_gallery_idx ON public.films_terms_accepts USING btree (gallery_id, accepted_at);

alter table public.album_orders
  add column if not exists source text not null default 'studio',
  add column if not exists films_gallery_id text,
  add column if not exists designed_spread_count integer;
alter table public.album_orders
  drop constraint if exists album_orders_source_check,
  add constraint album_orders_source_check check (source = any (array['studio'::text, 'couple_designer'::text])),
  drop constraint if exists album_orders_designed_spread_count_check,
  add constraint album_orders_designed_spread_count_check check (designed_spread_count is null or (designed_spread_count >= 0 and designed_spread_count <= 200)),
  drop constraint if exists album_orders_films_gallery_id_fkey,
  add constraint album_orders_films_gallery_id_fkey foreign key (films_gallery_id) references public.films_galleries(id) on delete set null;
create unique index if not exists album_orders_films_gallery_id_key on public.album_orders (films_gallery_id) where films_gallery_id is not null;

-- "התקבל החודש מאלבומים" on the galleries summary: when an album order was marked paid (Studio Plan 0082). Set by a
-- trigger whoever marks it, cleared if the payment is taken back. Avira: NO backfill — writing it on the orders
-- already paid would also move their updated_at; only payments from now on are dated.
alter table public.album_orders add column if not exists paid_at timestamptz;
create or replace function public.album_orders_paid_at()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.payment_status = 'paid' and (tg_op = 'INSERT' or old.payment_status is distinct from 'paid') then
    new.paid_at := coalesce(new.paid_at, now());
  elsif new.payment_status <> 'paid' then
    new.paid_at := null;
  end if;
  return new;
end;
$$;
revoke all on function public.album_orders_paid_at() from public, anon, authenticated;
drop trigger if exists album_orders_paid_at on public.album_orders;
create trigger album_orders_paid_at before insert or update of payment_status on public.album_orders
  for each row execute function public.album_orders_paid_at();

-- 5. Functions ------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.films_album_guards(p_tenant_id uuid, p_ids text[])
 RETURNS TABLE(gallery_id text, album_status text, workflow_status text, payment_status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select g.id, a.status, o.workflow_status, o.payment_status
    from public.films_galleries g
    left join public.films_albums a on a.gallery_id = g.id
    left join public.album_orders o on o.films_gallery_id = g.id and o.tenant_id = g.tenant_id
   where g.tenant_id = p_tenant_id
     and g.id = any(coalesce(p_ids, '{}'::text[]))
     and (a.gallery_id is not null or o.id is not null)
   order by g.id;
$function$;

CREATE OR REPLACE FUNCTION public.films_album_put(p_tenant_id uuid, p_gallery_id text, p_data jsonb, p_rev bigint, p_draft_only boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  a public.films_albums%rowtype;
  v_status text := case when p_data ->> 'status' = 'submitted' then 'submitted' else 'draft' end;
  v_submitted timestamptz;
begin
  if not exists (select 1 from public.films_galleries where id = p_gallery_id and tenant_id = p_tenant_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_status = 'submitted' then
    v_submitted := coalesce(nullif(p_data ->> 'submittedAt', '')::timestamptz, now());
  end if;
  select * into a from public.films_albums where gallery_id = p_gallery_id for update;
  if not found then
    -- The writer read an album that is not there any more: its copy is stale.
    if coalesce(p_rev, 0) <> 0 then
      return jsonb_build_object('ok', false, 'reason', 'conflict', 'rev', 0, 'data', null, 'status', null);
    end if;
    insert into public.films_albums (gallery_id, tenant_id, data, status, updated_at, submitted_at)
    values (p_gallery_id, p_tenant_id, p_data, v_status, now(), v_submitted)
    on conflict (gallery_id) do nothing
    returning * into a;
    if found then
      return jsonb_build_object('ok', true, 'rev', a.rev);
    end if;
    -- Someone made it at the same moment (the partner's first visit): theirs stays.
    select * into a from public.films_albums where gallery_id = p_gallery_id for update;
    if p_rev is not null or (p_draft_only and a.status = 'submitted') then
      return jsonb_build_object('ok', false, 'reason', case when p_draft_only and a.status = 'submitted' then 'submitted' else 'conflict' end,
                                'rev', a.rev, 'data', a.data, 'status', a.status);
    end if;
  end if;
  if a.tenant_id is distinct from p_tenant_id then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if p_draft_only and a.status = 'submitted' then
    return jsonb_build_object('ok', false, 'reason', 'submitted', 'rev', a.rev, 'data', a.data, 'status', a.status);
  end if;
  if p_rev is not null and a.rev <> p_rev then
    return jsonb_build_object('ok', false, 'reason', 'conflict', 'rev', a.rev, 'data', a.data, 'status', a.status);
  end if;
  update public.films_albums
     set data = p_data, status = v_status, updated_at = now(), submitted_at = v_submitted
   where gallery_id = p_gallery_id
  returning rev into a.rev;
  return jsonb_build_object('ok', true, 'rev', a.rev);
end;
$function$;

CREATE OR REPLACE FUNCTION public.films_albums_next_rev()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.rev := old.rev + 1;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.films_albums_print_copy()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.status = 'submitted'
     and (tg_op = 'INSERT' or old.status is distinct from 'submitted' or old.data is distinct from new.data) then
    new.print_data := new.data;
    new.print_submitted_at := coalesce(new.submitted_at, now());
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.films_bump_access_version(p_tenant_id uuid)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into public.films_studio_settings as s (tenant_id, access_version)
  values (p_tenant_id, 1)
  on conflict (tenant_id) do update
    set access_version = s.access_version + 1, updated_at = now()
  returning s.access_version;
$function$;

CREATE OR REPLACE FUNCTION public.films_cleanup_record(p_run jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.films_cleanup_runs (faces_removed, purged, errors, pending_faces, pending_trash, subrequests, stopped, blocked)
  values (
    coalesce((p_run ->> 'facesRemoved')::integer, 0),
    coalesce((p_run ->> 'purged')::integer, 0),
    coalesce(p_run -> 'errors', '[]'::jsonb),
    coalesce((p_run ->> 'pendingFaces')::integer, 0),
    coalesce((p_run ->> 'pendingTrash')::integer, 0),
    coalesce((p_run ->> 'subrequests')::integer, 0),
    p_run ->> 'stopped',
    coalesce((p_run ->> 'blocked')::integer, 0)
  );
  delete from public.films_cleanup_runs where ran_at < now() - interval '90 days';
end;
$function$;

CREATE OR REPLACE FUNCTION public.films_close_lapsed_studios(p_grace_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_studios integer := 0;
  v_galleries integer := 0;
  v_links integer := 0;
  lapsed uuid[];
begin
  select coalesce(array_agg(t.id), '{}') into lapsed
    from public.tenants t
   where false  -- Avira: no subscriptions, a studio never lapses (Studio Plan closes a cancelled studio's galleries here)
     and exists (select 1 from public.films_galleries g
                  where g.tenant_id = t.id
                    and ((g.deleted_at is null and g.expires_at > now()) or g.print_token is not null));
  if cardinality(lapsed) = 0 then
    return jsonb_build_object('studios', 0, 'galleries', 0, 'printLinks', 0);
  end if;
  v_studios := cardinality(lapsed);
  update public.films_galleries
     set expires_at = now(), days = greatest(coalesce(days, 1), 1), updated_at = now()
   where tenant_id = any (lapsed) and deleted_at is null and expires_at > now();
  get diagnostics v_galleries = row_count;
  update public.films_galleries set print_token = null, updated_at = now()
   where tenant_id = any (lapsed) and print_token is not null;
  get diagnostics v_links = row_count;
  return jsonb_build_object('studios', v_studios, 'galleries', v_galleries, 'printLinks', v_links);
end;
$function$;

CREATE OR REPLACE FUNCTION public.films_count_event(p_id text, p_type text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.films_galleries
     set views = views + (p_type = 'view')::int,
         guest_views = guest_views + (p_type = 'guest_view')::int,
         downloads = downloads + (p_type = 'download')::int
   where id = p_id;
$function$;

CREATE OR REPLACE FUNCTION public.films_dashboard(p_tenant_id uuid, p_films boolean, p_photos boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with mine_all as (
    select g.id, g.couple_name, g.kind, g.event_date, g.expires_at, g.created_at, g.deleted_at, g.views, g.downloads
      from public.films_galleries g
     where g.tenant_id = p_tenant_id
       and case when g.kind = 'photos' then coalesce(p_photos, false) else coalesce(p_films, false) end
  ),
  mine as (select * from mine_all where deleted_at is null),
  open as (
    select m.*, greatest(0, (m.expires_at at time zone 'Asia/Jerusalem')::date - (now() at time zone 'Asia/Jerusalem')::date) as days_left
      from mine m
     where m.expires_at > now()
  ),
  brief as (
    select o.*, jsonb_build_object('id', o.id, 'coupleName', o.couple_name, 'kind', o.kind, 'date', o.event_date, 'daysLeft', o.days_left,
             'views', o.views, 'downloads', o.downloads, 'expiresAt', o.expires_at) as j
      from open o
  )
  select jsonb_build_object(
    'open', (select count(*) from open),
    'closed', (select count(*) from mine) - (select count(*) from open),
    'trash', (select count(*) from mine_all where deleted_at is not null),
    'closing', coalesce((select jsonb_agg(x.j order by x.expires_at, x.created_at desc, x.id desc)
                           from (select * from brief where days_left <= 7 order by expires_at, created_at desc, id desc limit 12) x), '[]'::jsonb),
    'mostViewed', coalesce((select jsonb_agg(x.j order by x.views desc, x.created_at desc, x.id desc)
                              from (select * from brief where views > 0 order by views desc, created_at desc, id desc limit 5) x), '[]'::jsonb),
    'albumsSent', case when coalesce(p_photos, false) then coalesce((
        select jsonb_agg(jsonb_build_object('galleryId', x.gallery_id, 'coupleName', x.couple_name, 'submittedAt', coalesce(to_jsonb(x.submitted_at), '""'::jsonb))
                         order by x.submitted_at desc nulls last, x.gallery_id)
          from (select a.gallery_id, m.couple_name, a.submitted_at
                  from public.films_albums a
                  join mine m on m.id = a.gallery_id
                 where a.tenant_id = p_tenant_id and a.status = 'submitted'
                 order by a.submitted_at desc nulls last, a.gallery_id
                 limit 10) x), '[]'::jsonb)
      else '[]'::jsonb end
  );
$function$;

CREATE OR REPLACE FUNCTION public.films_dropbox_impact(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with open as (
    select g.id, g.kind, g.films
      from public.films_galleries g
     where g.tenant_id = p_tenant_id and g.deleted_at is null and g.expires_at > now()
  ),
  linked_films as (
    select o.id
      from open o
      cross join lateral jsonb_array_elements(case when jsonb_typeof(o.films) = 'array' then o.films else '[]'::jsonb end) f
     where o.kind = 'films' and f.value ->> 'provider' in ('dropbox-own', 'dropbox-link')
  )
  select jsonb_build_object(
    'photoGalleries', (select count(*)
                         from open o
                         join public.films_photos p on p.gallery_id = o.id
                        where o.kind = 'photos' and p.data ->> 'provider' in ('dropbox', 'dropbox-link')),
    'films', (select count(*) from linked_films),
    'filmGalleries', (select count(distinct id) from linked_films)
  );
$function$;

CREATE OR REPLACE FUNCTION public.films_faces_add(p_gallery_id text, p_tenant_id uuid, p_file text, p_keys text[], p_faces integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r public.films_faces%rowtype;
  n integer;
  asked integer;
begin
  insert into public.films_faces (gallery_id, tenant_id) values (p_gallery_id, p_tenant_id)
  on conflict (gallery_id) do nothing;
  select * into r from public.films_faces where gallery_id = p_gallery_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'face data belongs to another studio'; end if;
  select count(distinct k) into asked from unnest(coalesce(p_keys, '{}')) k;
  insert into public.films_faces_done (gallery_id, key, tenant_id, file)
  select p_gallery_id, k, p_tenant_id, p_file from (select distinct unnest(coalesce(p_keys, '{}')) as k) x
  on conflict (gallery_id, key) do nothing;
  get diagnostics n = row_count;
  if n = 0 then
    return jsonb_build_object('duplicate', true, 'chunks', cardinality(r.files), 'photos', r.photos, 'faces', r.faces, 'version', r.version);
  end if;
  update public.films_faces set
    files = array_append(files, p_file),
    dirty = case when n < asked then array_append(dirty, p_file) else dirty end,
    photos = photos + n,
    faces = faces + greatest(0, coalesce(p_faces, 0)),
    version = greatest(version + 1, (extract(epoch from clock_timestamp()) * 1000)::bigint),
    updated_at = now()
  where gallery_id = p_gallery_id
  returning * into r;
  return jsonb_build_object('chunks', cardinality(r.files), 'photos', r.photos, 'faces', r.faces, 'version', r.version);
end;
$function$;

CREATE OR REPLACE FUNCTION public.films_faces_chunk(p_gallery_id text, p_n integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'file', f.files[p_n + 1],
    'version', f.version,
    'keys', (select coalesce(jsonb_agg(d.key), '[]'::jsonb) from public.films_faces_done d
              where d.gallery_id = f.gallery_id and (d.file = f.files[p_n + 1] or d.file is null)))
    from public.films_faces f
   where f.gallery_id = p_gallery_id and p_n >= 0 and p_n < cardinality(f.files);
$function$;

CREATE OR REPLACE FUNCTION public.films_faces_cleanup_candidates(p_max_age_days integer DEFAULT 365, p_grace_days integer DEFAULT 30, p_limit integer DEFAULT 50)
 RETURNS TABLE(gallery_id text, reason text, total bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with rec as (
    select f.gallery_id, f.cleanup_failed_at,
      case
        when g.id is null then 'gone'
        when g.deleted_at is not null then 'trashed'
        when g.expires_at <= now() then 'closed'
        when g.kind is distinct from 'photos' or p.gallery_id is null
          or coalesce(p.data -> 'faceSearch', 'false'::jsonb) <> 'true'::jsonb then 'off'
        when f.created_at < now() - make_interval(days => p_max_age_days) then 'too_old'
        when false then 'studio_ended'  -- Avira: no subscriptions (Studio Plan: a cancelled studio after its grace days)
      end as reason
    from public.films_faces f
    left join public.films_galleries g on g.id = f.gallery_id
    left join public.films_photos p on p.gallery_id = f.gallery_id
    left join public.tenants t on t.id = f.tenant_id
  ),
  orphans as (
    select split_part(o.name, '/', 1) as gallery_id
    from storage.objects o
    where o.bucket_id = 'films-faces'
      and split_part(o.name, '/', 1) ~ '^[a-f0-9]{16}$'
      and not exists (select 1 from public.films_faces f where f.gallery_id = split_part(o.name, '/', 1))
    group by 1
    -- An upload in progress stores its file just before its record: only folders left for a day.
    having max(o.created_at) < now() - interval '1 day'
  ),
  todo as (
    select r.gallery_id, r.reason, 0 as grp, r.cleanup_failed_at from rec r where r.reason is not null
    union all
    select o.gallery_id, 'orphan_files', 1, null::timestamptz from orphans o
  )
  select todo.gallery_id, todo.reason, count(*) over () as total
  from todo
  order by (todo.cleanup_failed_at is not null), todo.grp, todo.cleanup_failed_at, todo.gallery_id
  limit greatest(coalesce(p_limit, 50), 0);
$function$;

CREATE OR REPLACE FUNCTION public.films_faces_dirty_candidates(p_limit integer DEFAULT 50)
 RETURNS TABLE(gallery_id text, total bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select f.gallery_id, count(*) over () as total
    from public.films_faces f
   where cardinality(f.dirty) > 0
   order by (f.cleanup_failed_at is not null), f.cleanup_failed_at, f.gallery_id
   limit greatest(coalesce(p_limit, 50), 0);
$function$;

CREATE OR REPLACE FUNCTION public.films_faces_done_keys(p_gallery_id text)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(array_agg(d.key order by d.key), '{}') from public.films_faces_done d where d.gallery_id = p_gallery_id;
$function$;

CREATE OR REPLACE FUNCTION public.films_faces_forget(p_gallery_id text, p_search_off boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  had boolean;
begin
  delete from public.films_faces where gallery_id = p_gallery_id;
  had := found;
  if p_search_off and had then
    update public.films_photos set data = data || '{"faceSearch": false}'::jsonb
     where gallery_id = p_gallery_id and data -> 'faceSearch' = 'true'::jsonb;
    if found then
      update public.films_galleries set faces_off_at = now() where id = p_gallery_id;
    end if;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.films_faces_off_clear()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.data -> 'faceSearch' = 'true'::jsonb
     and (tg_op = 'INSERT' or old.data -> 'faceSearch' is distinct from 'true'::jsonb) then
    update public.films_galleries set faces_off_at = null where id = new.gallery_id and faces_off_at is not null;
  end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.films_faces_plan(p_gallery_id text, p_keys text[] DEFAULT NULL::text[], p_limit integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r public.films_faces%rowtype;
  wanted text[];
  picked text[];
begin
  select * into r from public.films_faces where gallery_id = p_gallery_id;
  if not found then return jsonb_build_object('files', '[]'::jsonb, 'more', 0, 'version', 0); end if;
  if p_keys is null then
    wanted := (select coalesce(array_agg(x order by x), '{}') from unnest(r.dirty) x where x = any(r.files));
  elsif exists (select 1 from public.films_faces_done d where d.gallery_id = p_gallery_id and d.key = any(p_keys) and d.file is null) then
    wanted := r.files;
  else
    wanted := (select coalesce(array_agg(distinct d.file order by d.file), '{}') from public.films_faces_done d
                where d.gallery_id = p_gallery_id and d.key = any(p_keys) and d.file = any(r.files));
  end if;
  picked := wanted[1:greatest(coalesce(p_limit, 10), 0)];
  return jsonb_build_object(
    'version', r.version,
    'more', greatest(cardinality(wanted) - cardinality(picked), 0),
    'files', (select coalesce(jsonb_agg(jsonb_build_object('name', x,
               'keys', (select coalesce(jsonb_agg(d.key), '[]'::jsonb) from public.films_faces_done d
                         where d.gallery_id = p_gallery_id and (d.file = x or d.file is null)))), '[]'::jsonb)
                from unnest(picked) x));
end;
$function$;

CREATE OR REPLACE FUNCTION public.films_faces_remove(p_gallery_id text, p_keys text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r public.films_faces%rowtype;
  n integer;
  touched text[];
  unknown boolean;
begin
  select * into r from public.films_faces where gallery_id = p_gallery_id for update;
  if not found then return jsonb_build_object('removed', 0); end if;
  with gone as (
    delete from public.films_faces_done d where d.gallery_id = p_gallery_id and d.key = any(coalesce(p_keys, '{}')) returning d.file
  )
  select count(*), coalesce(array_agg(distinct g.file) filter (where g.file is not null), '{}'), coalesce(bool_or(g.file is null), false)
    into n, touched, unknown
    from gone g;
  if n = 0 then return jsonb_build_object('removed', 0, 'dirty', to_jsonb(r.dirty), 'version', r.version); end if;
  update public.films_faces set
    photos = greatest(0, photos - n),
    dirty = (select coalesce(array_agg(distinct x order by x), '{}') from unnest(dirty || case when unknown then files else touched end) x where x = any(files)),
    version = greatest(version + 1, (extract(epoch from clock_timestamp()) * 1000)::bigint),
    updated_at = now()
  where gallery_id = p_gallery_id
  returning * into r;
  return jsonb_build_object('removed', n, 'dirty', to_jsonb(r.dirty), 'version', r.version);
end;
$function$;

CREATE OR REPLACE FUNCTION public.films_faces_swap(p_gallery_id text, p_swaps jsonb)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r public.films_faces%rowtype;
  s jsonb;
  swapped text[] := '{}';
  dropped integer := 0;
begin
  select * into r from public.films_faces where gallery_id = p_gallery_id for update;
  if not found then return '{}'; end if;
  for s in select * from jsonb_array_elements(coalesce(p_swaps, '[]'::jsonb)) loop
    if not (s ->> 'old') = any(r.files) then continue; end if;
    if s ->> 'new' is null then
      r.files := array_remove(r.files, s ->> 'old');
      delete from public.films_faces_done d where d.gallery_id = p_gallery_id and d.file = s ->> 'old';
    else
      r.files := array_replace(r.files, s ->> 'old', s ->> 'new');
      update public.films_faces_done d set file = s ->> 'new'
       where d.gallery_id = p_gallery_id
         and (d.file = s ->> 'old' or (d.file is null and d.key in (select jsonb_array_elements_text(coalesce(s -> 'keys', '[]'::jsonb)))));
    end if;
    r.dirty := array_remove(r.dirty, s ->> 'old');
    dropped := dropped + greatest(coalesce((s ->> 'faces')::integer, 0), 0);
    swapped := array_append(swapped, s ->> 'old');
  end loop;
  if cardinality(swapped) = 0 then return swapped; end if;
  update public.films_faces set
    files = r.files,
    dirty = r.dirty,
    faces = greatest(0, faces - dropped),
    photos = (select count(*) from public.films_faces_done d where d.gallery_id = p_gallery_id),
    version = greatest(version + 1, (extract(epoch from clock_timestamp()) * 1000)::bigint),
    updated_at = now()
  where gallery_id = p_gallery_id;
  return swapped;
end;
$function$;

CREATE OR REPLACE FUNCTION public.films_galleries_event_same_tenant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.event_id is not null
     and (select tenant_id from public.events where id = new.event_id) is distinct from new.tenant_id then
    raise exception 'films_galleries: event_id must belong to the same studio' using errcode = '42501';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.films_galleries_extend(p_tenant_id uuid, p_items jsonb, p_days integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_out jsonb;
begin
  if p_days is null or p_days < 1 or p_days > 3650 then
    raise exception 'films_galleries_extend: days must be 1 to 3650' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 50 then
    raise exception 'films_galleries_extend: at most 50 galleries' using errcode = '22023';
  end if;
  with asked as (
    select distinct on (i.value ->> 'id') i.value ->> 'id' as id, (i.value ->> 'seen')::timestamptz as seen
      from jsonb_array_elements(p_items) i
     where i.value ->> 'id' ~ '^[a-f0-9]{16}$' and i.value ->> 'seen' is not null
  ),
  calc as (
    select g.id, g.created_at,
           ((least(greatest(now(), g.expires_at) + p_days * interval '24 hours', g.created_at + 3650 * interval '24 hours')
              at time zone 'Asia/Jerusalem')::date + time '23:59:59') at time zone 'Asia/Jerusalem' as close_at
      from public.films_galleries g
      join asked a on a.id = g.id
     where g.tenant_id = p_tenant_id and g.deleted_at is null and g.expires_at = a.seen
  ),
  done as (
    update public.films_galleries g
       set expires_at = c.close_at,
           days = round(extract(epoch from (c.close_at - c.created_at)) / 86400)::integer,
           updated_at = now()
      from calc c
      join asked a on a.id = c.id
     -- Checked again on the row itself: a click at the same moment that got there first wins.
     where g.id = c.id and g.tenant_id = p_tenant_id and g.deleted_at is null and g.expires_at = a.seen
    returning g.id, g.expires_at, g.days
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'expiresAt', d.expires_at, 'days', d.days) order by d.id), '[]'::jsonb)
    into v_out
    from done d;
  return v_out;
end;
$function$;

CREATE OR REPLACE FUNCTION public.films_galleries_print_token_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.print_token is null then
    new.print_token_created_at := null;
  elsif tg_op = 'INSERT' then
    new.print_token_created_at := coalesce(new.print_token_created_at, now());
  elsif new.print_token is distinct from old.print_token
        and new.print_token_created_at is not distinct from old.print_token_created_at then
    -- A new link written by a Worker that does not know the column.
    new.print_token_created_at := now();
  elsif new.print_token_created_at is null then
    new.print_token_created_at := coalesce(old.print_token_created_at, now());
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.films_link_check_candidates(p_after text, p_limit integer, p_start text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'tenantId', x.tenant_id, 'coupleName', x.couple_name, 'films', x.films) order by x.id), '[]'::jsonb)
    from (
      select g.id, g.tenant_id, g.couple_name, g.films
        from public.films_galleries g
       where g.kind = 'films'
         and g.deleted_at is null
         and g.expires_at > now()
         and jsonb_typeof(g.films) = 'array' and jsonb_array_length(g.films) > 0
         and case when p_start is not null and p_start <> '' then g.id >= p_start else g.id > coalesce(p_after, '') end
         and public.tenant_access_state(g.tenant_id) <> 'blocked'
         and public.tenant_has_module(g.tenant_id, 'films')
       order by g.id
       limit greatest(1, least(coalesce(p_limit, 10), 50))
    ) x;
$function$;

CREATE OR REPLACE FUNCTION public.films_photo_cover(p_data jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  with shown as (
    select i.value ->> 'key' as key, i.n
    from jsonb_array_elements(case when jsonb_typeof(p_data -> 'items') = 'array' then p_data -> 'items' else '[]'::jsonb end)
      with ordinality as i(value, n)
    -- Hidden as JavaScript reads it: any value but false / null / 0 / '' hides the photo.
    where coalesce(i.value -> 'hidden', 'null'::jsonb) in ('false'::jsonb, 'null'::jsonb, '0'::jsonb, '""'::jsonb)
  ),
  chosen as (
    select coalesce(
      (select s.key from shown s where s.key = p_data ->> 'cover' limit 1),
      (select s.key from shown s order by s.n limit 1)
    ) as key
  )
  select case when c.key ~ '^[0-9a-f]{8}$' then c.key end from chosen c;
$function$;

CREATE OR REPLACE FUNCTION public.films_photo_item(p_gallery_id text, p_tenant_id uuid, p_key text, p_copies boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with p as (
    select p.data, p.version, g.photos_visible_version as visible
      from public.films_photos p
      join public.films_galleries g on g.id = p.gallery_id
     where p.gallery_id = p_gallery_id and g.tenant_id = p_tenant_id and p.tenant_id = p_tenant_id
  ),
  items as (
    select e.value as v, e.n
      from p, jsonb_array_elements(case when jsonb_typeof(p.data -> 'items') = 'array' then p.data -> 'items' else '[]'::jsonb end)
        with ordinality as e(value, n)
  ),
  hit as (
    select i.v, i.n from items i where i.v ->> 'key' = p_key order by i.n limit 1
  )
  select jsonb_build_object(
    'item', (select h.v from hit h),
    'folder', jsonb_strip_nulls(jsonb_build_object(
      'folderUrl', p.data -> 'folderUrl',
      'provider', p.data -> 'provider',
      'pathRoot', p.data -> 'pathRoot',
      'timesV', p.data -> 'timesV'
    )),
    'copies', case when p_copies then coalesce((
      select jsonb_agg(c.v order by c.n)
        from (
          select i.v, i.n
            from items i, hit h
           where i.n <> h.n
             and (lower(i.v ->> 'name') = lower(h.v ->> 'name')
                  or (jsonb_typeof(h.v -> 't') = 'number' and i.v -> 't' = h.v -> 't'))
             and (jsonb_typeof(i.v -> 'ar') is distinct from 'number'
                  or jsonb_typeof(h.v -> 'ar') is distinct from 'number'
                  or abs((i.v ->> 'ar')::numeric - (h.v ->> 'ar')::numeric) < 0.03)
           order by i.n
           limit 50
        ) c
    ), '[]'::jsonb) else '[]'::jsonb end,
    'version', p.version,
    'visibleVersion', p.visible
  )
  from p;
$function$;

CREATE OR REPLACE FUNCTION public.films_photo_list_create(p_gallery_id text, p_id text, p_name text, p_keys text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  t uuid;
  r public.films_photo_lists%rowtype;
begin
  select tenant_id into t from public.films_galleries where id = p_gallery_id for no key update;
  if not found then return null; end if;
  select * into r from public.films_photo_lists where gallery_id = p_gallery_id and name = p_name;
  if found then
    return public.films_photo_list_toggle(p_gallery_id, r.id, p_keys, true) || jsonb_build_object('created', false);
  end if;
  if (select count(*) from public.films_photo_lists where gallery_id = p_gallery_id) >= 20 then
    return jsonb_build_object('error', 'too_many');
  end if;
  insert into public.films_photo_lists (id, gallery_id, tenant_id, name, keys)
  values (p_id, p_gallery_id, t, p_name, coalesce((
    select jsonb_agg(n.k order by n.i)
    from (select u.k, min(u.i) as i from unnest(coalesce(p_keys, '{}')) with ordinality as u(k, i) group by u.k) n
  ), '[]'::jsonb))
  returning * into r;
  return jsonb_build_object('id', r.id, 'name', r.name, 'keys', r.keys, 'created', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.films_photo_list_toggle(p_gallery_id text, p_list_id text, p_keys text[], p_on boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r public.films_photo_lists%rowtype;
begin
  update public.films_photo_lists l set
    keys = case
      when p_on then l.keys || coalesce((
        select jsonb_agg(n.k order by n.i)
        from (select u.k, min(u.i) as i from unnest(coalesce(p_keys, '{}')) with ordinality as u(k, i) where not (l.keys ? u.k) group by u.k) n
      ), '[]'::jsonb)
      else coalesce((
        select jsonb_agg(e.k order by e.i)
        from jsonb_array_elements_text(l.keys) with ordinality as e(k, i)
        where e.k <> all(coalesce(p_keys, '{}'))
      ), '[]'::jsonb)
    end,
    updated_at = now()
  where l.id = p_list_id and l.gallery_id = p_gallery_id
  returning * into r;
  if not found then return null; end if;
  return jsonb_build_object('id', r.id, 'name', r.name, 'keys', r.keys);
end;
$function$;

CREATE OR REPLACE FUNCTION public.films_photos_bump_version()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.version := old.version + 1;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.films_photos_follow()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(current_setting('films.photos_patch', true), '') = 'on' then
    return null;
  end if;
  update public.films_galleries g
     set photos_version = new.version,
         photos_visible_version = g.photos_visible_version + 1,
         photos_gen = case
           when jsonb_typeof(new.data -> 'gen') = 'number'
             then least(greatest(floor((new.data ->> 'gen')::numeric), 0), 9007199254740991)::bigint
           else 0
         end
   where g.id = new.gallery_id;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.films_photos_patch(p_gallery_id text, p_tenant_id uuid, p_expected integer, p_items jsonb, p_order text[], p_fields jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  cur public.films_photos%rowtype;
  items jsonb := coalesce(p_items, '{}'::jsonb);
  fields jsonb := coalesce(p_fields, '{}'::jsonb);
  n_items integer;
  n_keys integer;
  bad text;
  shown_changed boolean;
  next_items jsonb;
  next_data jsonb;
  g public.films_galleries%rowtype;
begin
  if not exists (select 1 from public.films_galleries where id = p_gallery_id and tenant_id = p_tenant_id) then
    return null;
  end if;
  select * into cur from public.films_photos where gallery_id = p_gallery_id and tenant_id = p_tenant_id for update;
  if not found then
    return null;
  end if;
  if cur.version is distinct from p_expected then
    return jsonb_build_object('conflict', true, 'version', cur.version);
  end if;
  if jsonb_typeof(items) <> 'object' or jsonb_typeof(fields) <> 'object' or jsonb_typeof(cur.data -> 'items') is distinct from 'array' then
    raise exception 'films_photos_patch: not a photo list edit' using errcode = '22023';
  end if;

  select k into bad from jsonb_object_keys(fields) k
   where k <> all (array['sets', 'cover', 'timeOrder', 'coverPos', 'faceSearch', 'design', 'timesV']) limit 1;
  if bad is not null then
    raise exception 'films_photos_patch: % is not an edit field', bad using errcode = '22023';
  end if;

  select count(*), count(distinct e.value ->> 'key') into n_items, n_keys from jsonb_array_elements(cur.data -> 'items') e;
  if n_items <> n_keys then
    raise exception 'films_photos_patch: two photos share a key; save the list whole' using errcode = '22023';
  end if;

  -- (Joins, not a search per photo: a list has up to 20,000 photos.)
  select x.key into bad
    from jsonb_each(items) x
    left join jsonb_array_elements(cur.data -> 'items') e on e.value ->> 'key' = x.key
   where e.value is null or jsonb_typeof(x.value) <> 'object' or x.value ->> 'key' is distinct from x.key
   limit 1;
  if bad is not null then
    raise exception 'films_photos_patch: photo % is not in the list', bad using errcode = '22023';
  end if;

  if p_order is not null and (
    cardinality(p_order) <> n_items
    or (select count(distinct k) from unnest(p_order) k) <> n_items
    or (select count(*) from unnest(p_order) k join jsonb_array_elements(cur.data -> 'items') e on e.value ->> 'key' = k) <> n_items
  ) then
    raise exception 'films_photos_patch: the order is not the list''s photos' using errcode = '22023';
  end if;

  -- Hidden as JavaScript reads it (the rule of films_photo_cover): any value but false / null / 0 / '' hides.
  select exists (
    select 1
      from jsonb_each(items) x
      join jsonb_array_elements(cur.data -> 'items') e on e.value ->> 'key' = x.key
     where (coalesce(e.value -> 'hidden', 'null'::jsonb) in ('false'::jsonb, 'null'::jsonb, '0'::jsonb, '""'::jsonb))
             is distinct from (coalesce(x.value -> 'hidden', 'null'::jsonb) in ('false'::jsonb, 'null'::jsonb, '0'::jsonb, '""'::jsonb))
        or (e.value ->> 'ref') is distinct from (x.value ->> 'ref')
  ) into shown_changed;

  select coalesce(jsonb_agg(coalesce(items -> (e.value ->> 'key'), e.value) order by coalesce(o.pos, e.n)), '[]'::jsonb)
    into next_items
    from jsonb_array_elements(cur.data -> 'items') with ordinality as e(value, n)
    left join unnest(p_order) with ordinality as o(k, pos) on o.k = e.value ->> 'key';

  next_data := (cur.data - array(select k from jsonb_each(fields) f(k, v) where f.v = 'null'::jsonb))
    || coalesce((select jsonb_object_agg(f.k, f.v) from jsonb_each(fields) f(k, v) where f.v <> 'null'::jsonb), '{}'::jsonb)
    || jsonb_build_object('items', next_items);

  -- films_photos_follow leaves the gallery to this function (the mark lasts until the end of the update).
  perform set_config('films.photos_patch', 'on', true);
  update public.films_photos set data = next_data, updated_at = now()
   where gallery_id = p_gallery_id
   returning * into cur;
  perform set_config('films.photos_patch', '', true);

  update public.films_galleries gg
     set photos_version = cur.version,
         photos_visible_version = gg.photos_visible_version + case when shown_changed then 1 else 0 end,
         photo_count = (
           select count(*) from jsonb_array_elements(next_items) e
            where coalesce(e.value -> 'hidden', 'null'::jsonb) in ('false'::jsonb, 'null'::jsonb, '0'::jsonb, '""'::jsonb)
         ),
         cover_key = public.films_photo_cover(next_data),
         updated_at = now()
   where gg.id = p_gallery_id
   returning * into g;

  return jsonb_build_object('version', cur.version, 'photoCount', g.photo_count, 'coverKey', g.cover_key, 'visibleVersion', g.photos_visible_version);
end;
$function$;

CREATE OR REPLACE FUNCTION public.films_print_links_expire(p_days integer DEFAULT 30)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n integer;
begin
  update public.films_galleries
     set print_token = null
   where print_token is not null
     and print_token_created_at < now() - make_interval(days => greatest(coalesce(p_days, 30), 1));
  get diagnostics n = row_count;
  return n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.films_rate_count(p_key text, p_window_seconds integer, p_add boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n integer;
begin
  if p_key is null or p_key !~ '^films:' then
    raise exception 'films_rate_count: films keys only';
  end if;
  if p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'films_rate_count: window must be 1..86400 seconds';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_key));
  if p_add then
    insert into public.rate_limit_hits (bucket_key) values (p_key);
  end if;
  select count(*) into n from public.rate_limit_hits
   where bucket_key = p_key and created_at >= now() - make_interval(secs => p_window_seconds);
  return n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.films_rate_hit(p_key text, p_max integer, p_window_seconds integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return coalesce((public.rate_hit(p_key, p_max, p_window_seconds, true) ->> 'allowed')::boolean, false);
end;
$function$;

CREATE OR REPLACE FUNCTION public.films_safe_date(p_value text)
 RETURNS date
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
begin
  if p_value is null or p_value !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  return p_value::date;
exception when others then
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.films_sweep_rate_hits()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n integer;
begin
  -- Every key (Edge Functions and films Worker alike): no window is longer than a day.
  delete from public.rate_limit_hits where created_at < now() - interval '2 days';
  get diagnostics n = row_count;
  return n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.films_tenant_info(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'id', t.id,
    'name', t.name,
    'display_name_to_clients', t.display_name_to_clients,
    'logo_url', t.logo_url,
    'phone', t.phone,
    'whatsapp_number', t.whatsapp_number,
    'instagram_url', t.instagram_url,
    'facebook_url', t.facebook_url,
    'slug', t.slug,
    'accent_color', t.accent_color,
    'access', public.tenant_access_state(t.id),
    'films', public.tenant_has_module(t.id, 'films'),
    'photos', public.tenant_has_module(t.id, 'photos'),
    'access_version', coalesce((select s.access_version from public.films_studio_settings s where s.tenant_id = t.id), 0)
  )
  from public.tenants t
  where t.id = p_tenant_id;
$function$;

CREATE OR REPLACE FUNCTION public.films_terms_summary(p_gallery_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'count', count(*) filter (where t.role = 'couple'),
    'first', coalesce(to_jsonb(min(t.accepted_at) filter (where t.role = 'couple')), '""'::jsonb),
    'last', coalesce(to_jsonb(max(t.accepted_at) filter (where t.role = 'couple')), '""'::jsonb),
    'guests', count(*) filter (where t.role = 'guest'),
    'unknown', count(*) filter (where t.role is null or t.role not in ('couple', 'guest'))
  )
  from public.films_terms_accepts t
  where t.gallery_id = p_gallery_id;
$function$;

CREATE OR REPLACE FUNCTION public.films_trash_candidates(p_before timestamp with time zone, p_limit integer DEFAULT 50)
 RETURNS TABLE(gallery_id text, total bigint, blocked text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with x as (
    select g.id, g.tenant_id, g.deleted_at, g.purge_failed_at,
      case
        when o.id is null then null
        when o.payment_status = 'paid' or o.workflow_status in ('paid', 'in_print') then 'album_paid'
        when o.workflow_status not in ('delivered', 'completed') then 'album_order'
      end as blocked
    from public.films_galleries g
    left join public.album_orders o on o.films_gallery_id = g.id and o.tenant_id = g.tenant_id
    where g.deleted_at < p_before
  ),
  free as (
    select x.id, x.deleted_at, x.purge_failed_at, count(*) over () as total,
      row_number() over (partition by x.tenant_id order by x.purge_failed_at nulls first, x.deleted_at, x.id) as turn
    from x where x.blocked is null
  ),
  picked as (
    select f.id, f.total, null::text as blocked, 0 as grp, (f.purge_failed_at is not null) as failed, f.turn, f.deleted_at
    from free f
    order by (f.purge_failed_at is not null), f.turn, f.deleted_at, f.id
    limit greatest(coalesce(p_limit, 50), 0)
  ),
  kept as (
    select x.id, count(*) over () as total, x.blocked, 1 as grp, false as failed, 0::bigint as turn, x.deleted_at
    from x where x.blocked is not null
    order by x.deleted_at, x.id
    limit 50
  )
  select u.id, u.total, u.blocked
  from (select * from picked union all select * from kept) u
  order by u.grp, u.failed, u.turn, u.deleted_at, u.id;
$function$;


-- 6. Row security (Studio Plan's policies; the restrictive "gate" ones use the stand-ins of part 1) --------------------
alter table public.films_galleries enable row level security;
drop policy if exists "films_galleries_gate_del" on public.films_galleries;
create policy "films_galleries_gate_del" on public.films_galleries as restrictive for delete to authenticated using (tenant_is_writable(tenant_id));
drop policy if exists "films_galleries_gate_ins" on public.films_galleries;
create policy "films_galleries_gate_ins" on public.films_galleries as restrictive for insert to authenticated with check (tenant_is_writable(tenant_id));
drop policy if exists "films_galleries_gate_sel" on public.films_galleries;
create policy "films_galleries_gate_sel" on public.films_galleries as restrictive for select to authenticated using (( SELECT current_tenant_readable() AS current_tenant_readable));
drop policy if exists "films_galleries_gate_upd" on public.films_galleries;
create policy "films_galleries_gate_upd" on public.films_galleries as restrictive for update to authenticated using (tenant_is_writable(tenant_id));
alter table public.films_albums enable row level security;
drop policy if exists "films_albums_gate_del" on public.films_albums;
create policy "films_albums_gate_del" on public.films_albums as restrictive for delete to authenticated using (tenant_is_writable(tenant_id));
drop policy if exists "films_albums_gate_ins" on public.films_albums;
create policy "films_albums_gate_ins" on public.films_albums as restrictive for insert to authenticated with check (tenant_is_writable(tenant_id));
drop policy if exists "films_albums_gate_sel" on public.films_albums;
create policy "films_albums_gate_sel" on public.films_albums as restrictive for select to authenticated using (( SELECT current_tenant_readable() AS current_tenant_readable));
drop policy if exists "films_albums_gate_upd" on public.films_albums;
create policy "films_albums_gate_upd" on public.films_albums as restrictive for update to authenticated using (tenant_is_writable(tenant_id));
drop policy if exists "films_albums_select" on public.films_albums;
create policy "films_albums_select" on public.films_albums as permissive for select to authenticated using ((tenant_id = current_tenant_id()));
alter table public.films_cleanup_runs enable row level security;
alter table public.films_face_searches enable row level security;
drop policy if exists "films_face_searches_gate_del" on public.films_face_searches;
create policy "films_face_searches_gate_del" on public.films_face_searches as restrictive for delete to authenticated using (tenant_is_writable(tenant_id));
drop policy if exists "films_face_searches_gate_ins" on public.films_face_searches;
create policy "films_face_searches_gate_ins" on public.films_face_searches as restrictive for insert to authenticated with check (tenant_is_writable(tenant_id));
drop policy if exists "films_face_searches_gate_sel" on public.films_face_searches;
create policy "films_face_searches_gate_sel" on public.films_face_searches as restrictive for select to authenticated using (( SELECT current_tenant_readable() AS current_tenant_readable));
drop policy if exists "films_face_searches_gate_upd" on public.films_face_searches;
create policy "films_face_searches_gate_upd" on public.films_face_searches as restrictive for update to authenticated using (tenant_is_writable(tenant_id));
drop policy if exists "films_face_searches_select" on public.films_face_searches;
create policy "films_face_searches_select" on public.films_face_searches as permissive for select to authenticated using ((tenant_id = current_tenant_id()));
alter table public.films_faces enable row level security;
drop policy if exists "films_faces_gate_del" on public.films_faces;
create policy "films_faces_gate_del" on public.films_faces as restrictive for delete to authenticated using (tenant_is_writable(tenant_id));
drop policy if exists "films_faces_gate_ins" on public.films_faces;
create policy "films_faces_gate_ins" on public.films_faces as restrictive for insert to authenticated with check (tenant_is_writable(tenant_id));
drop policy if exists "films_faces_gate_sel" on public.films_faces;
create policy "films_faces_gate_sel" on public.films_faces as restrictive for select to authenticated using (( SELECT current_tenant_readable() AS current_tenant_readable));
drop policy if exists "films_faces_gate_upd" on public.films_faces;
create policy "films_faces_gate_upd" on public.films_faces as restrictive for update to authenticated using (tenant_is_writable(tenant_id));
drop policy if exists "films_faces_select" on public.films_faces;
create policy "films_faces_select" on public.films_faces as permissive for select to authenticated using ((tenant_id = current_tenant_id()));
alter table public.films_faces_done enable row level security;
drop policy if exists "films_faces_done_gate_del" on public.films_faces_done;
create policy "films_faces_done_gate_del" on public.films_faces_done as restrictive for delete to authenticated using (tenant_is_writable(tenant_id));
drop policy if exists "films_faces_done_gate_ins" on public.films_faces_done;
create policy "films_faces_done_gate_ins" on public.films_faces_done as restrictive for insert to authenticated with check (tenant_is_writable(tenant_id));
drop policy if exists "films_faces_done_gate_sel" on public.films_faces_done;
create policy "films_faces_done_gate_sel" on public.films_faces_done as restrictive for select to authenticated using (( SELECT current_tenant_readable() AS current_tenant_readable));
drop policy if exists "films_faces_done_gate_upd" on public.films_faces_done;
create policy "films_faces_done_gate_upd" on public.films_faces_done as restrictive for update to authenticated using (tenant_is_writable(tenant_id));
drop policy if exists "films_faces_done_select" on public.films_faces_done;
create policy "films_faces_done_select" on public.films_faces_done as permissive for select to authenticated using ((tenant_id = current_tenant_id()));
alter table public.films_hearts enable row level security;
drop policy if exists "films_hearts_gate_del" on public.films_hearts;
create policy "films_hearts_gate_del" on public.films_hearts as restrictive for delete to authenticated using (tenant_is_writable(tenant_id));
drop policy if exists "films_hearts_gate_ins" on public.films_hearts;
create policy "films_hearts_gate_ins" on public.films_hearts as restrictive for insert to authenticated with check (tenant_is_writable(tenant_id));
drop policy if exists "films_hearts_gate_sel" on public.films_hearts;
create policy "films_hearts_gate_sel" on public.films_hearts as restrictive for select to authenticated using (( SELECT current_tenant_readable() AS current_tenant_readable));
drop policy if exists "films_hearts_gate_upd" on public.films_hearts;
create policy "films_hearts_gate_upd" on public.films_hearts as restrictive for update to authenticated using (tenant_is_writable(tenant_id));
alter table public.films_insta enable row level security;
drop policy if exists "films_insta_gate_del" on public.films_insta;
create policy "films_insta_gate_del" on public.films_insta as restrictive for delete to authenticated using (tenant_is_writable(tenant_id));
drop policy if exists "films_insta_gate_ins" on public.films_insta;
create policy "films_insta_gate_ins" on public.films_insta as restrictive for insert to authenticated with check (tenant_is_writable(tenant_id));
drop policy if exists "films_insta_gate_sel" on public.films_insta;
create policy "films_insta_gate_sel" on public.films_insta as restrictive for select to authenticated using (( SELECT current_tenant_readable() AS current_tenant_readable));
drop policy if exists "films_insta_gate_upd" on public.films_insta;
create policy "films_insta_gate_upd" on public.films_insta as restrictive for update to authenticated using (tenant_is_writable(tenant_id));
drop policy if exists "films_insta_select" on public.films_insta;
create policy "films_insta_select" on public.films_insta as permissive for select to authenticated using ((tenant_id = current_tenant_id()));
alter table public.films_photo_lists enable row level security;
drop policy if exists "films_photo_lists_gate_del" on public.films_photo_lists;
create policy "films_photo_lists_gate_del" on public.films_photo_lists as restrictive for delete to authenticated using (tenant_is_writable(tenant_id));
drop policy if exists "films_photo_lists_gate_ins" on public.films_photo_lists;
create policy "films_photo_lists_gate_ins" on public.films_photo_lists as restrictive for insert to authenticated with check (tenant_is_writable(tenant_id));
drop policy if exists "films_photo_lists_gate_sel" on public.films_photo_lists;
create policy "films_photo_lists_gate_sel" on public.films_photo_lists as restrictive for select to authenticated using (( SELECT current_tenant_readable() AS current_tenant_readable));
drop policy if exists "films_photo_lists_gate_upd" on public.films_photo_lists;
create policy "films_photo_lists_gate_upd" on public.films_photo_lists as restrictive for update to authenticated using (tenant_is_writable(tenant_id));
drop policy if exists "films_photo_lists_select" on public.films_photo_lists;
create policy "films_photo_lists_select" on public.films_photo_lists as permissive for select to authenticated using ((tenant_id = current_tenant_id()));
alter table public.films_photos enable row level security;
drop policy if exists "films_photos_gate_del" on public.films_photos;
create policy "films_photos_gate_del" on public.films_photos as restrictive for delete to authenticated using (tenant_is_writable(tenant_id));
drop policy if exists "films_photos_gate_ins" on public.films_photos;
create policy "films_photos_gate_ins" on public.films_photos as restrictive for insert to authenticated with check (tenant_is_writable(tenant_id));
drop policy if exists "films_photos_gate_sel" on public.films_photos;
create policy "films_photos_gate_sel" on public.films_photos as restrictive for select to authenticated using (( SELECT current_tenant_readable() AS current_tenant_readable));
drop policy if exists "films_photos_gate_upd" on public.films_photos;
create policy "films_photos_gate_upd" on public.films_photos as restrictive for update to authenticated using (tenant_is_writable(tenant_id));
alter table public.films_studio_settings enable row level security;
drop policy if exists "films_studio_settings_gate_del" on public.films_studio_settings;
create policy "films_studio_settings_gate_del" on public.films_studio_settings as restrictive for delete to authenticated using (tenant_is_writable(tenant_id));
drop policy if exists "films_studio_settings_gate_ins" on public.films_studio_settings;
create policy "films_studio_settings_gate_ins" on public.films_studio_settings as restrictive for insert to authenticated with check (tenant_is_writable(tenant_id));
drop policy if exists "films_studio_settings_gate_sel" on public.films_studio_settings;
create policy "films_studio_settings_gate_sel" on public.films_studio_settings as restrictive for select to authenticated using (( SELECT current_tenant_readable() AS current_tenant_readable));
drop policy if exists "films_studio_settings_gate_upd" on public.films_studio_settings;
create policy "films_studio_settings_gate_upd" on public.films_studio_settings as restrictive for update to authenticated using (tenant_is_writable(tenant_id));
drop policy if exists "films_studio_settings_select" on public.films_studio_settings;
create policy "films_studio_settings_select" on public.films_studio_settings as permissive for select to authenticated using ((tenant_id = current_tenant_id()));
alter table public.films_terms_accepts enable row level security;
drop policy if exists "films_terms_accepts_gate_del" on public.films_terms_accepts;
create policy "films_terms_accepts_gate_del" on public.films_terms_accepts as restrictive for delete to authenticated using (tenant_is_writable(tenant_id));
drop policy if exists "films_terms_accepts_gate_ins" on public.films_terms_accepts;
create policy "films_terms_accepts_gate_ins" on public.films_terms_accepts as restrictive for insert to authenticated with check (tenant_is_writable(tenant_id));
drop policy if exists "films_terms_accepts_gate_sel" on public.films_terms_accepts;
create policy "films_terms_accepts_gate_sel" on public.films_terms_accepts as restrictive for select to authenticated using (( SELECT current_tenant_readable() AS current_tenant_readable));
drop policy if exists "films_terms_accepts_gate_upd" on public.films_terms_accepts;
create policy "films_terms_accepts_gate_upd" on public.films_terms_accepts as restrictive for update to authenticated using (tenant_is_writable(tenant_id));
drop policy if exists "films_terms_accepts_select" on public.films_terms_accepts;
create policy "films_terms_accepts_select" on public.films_terms_accepts as permissive for select to authenticated using ((tenant_id = current_tenant_id()));

-- 7. Triggers -------------------------------------------------------------------------------------------------------
drop trigger if exists films_galleries_event_same_tenant on public.films_galleries;
CREATE TRIGGER films_galleries_event_same_tenant BEFORE INSERT OR UPDATE OF event_id, tenant_id ON public.films_galleries FOR EACH ROW EXECUTE FUNCTION films_galleries_event_same_tenant();
drop trigger if exists films_galleries_print_token_at on public.films_galleries;
CREATE TRIGGER films_galleries_print_token_at BEFORE INSERT OR UPDATE ON public.films_galleries FOR EACH ROW EXECUTE FUNCTION films_galleries_print_token_at();
drop trigger if exists films_albums_next_rev on public.films_albums;
CREATE TRIGGER films_albums_next_rev BEFORE UPDATE ON public.films_albums FOR EACH ROW EXECUTE FUNCTION films_albums_next_rev();
drop trigger if exists films_albums_print_copy on public.films_albums;
CREATE TRIGGER films_albums_print_copy BEFORE INSERT OR UPDATE ON public.films_albums FOR EACH ROW EXECUTE FUNCTION films_albums_print_copy();
drop trigger if exists films_faces_off_clear on public.films_photos;
CREATE TRIGGER films_faces_off_clear AFTER INSERT OR UPDATE OF data ON public.films_photos FOR EACH ROW EXECUTE FUNCTION films_faces_off_clear();
drop trigger if exists films_photos_bump_version on public.films_photos;
CREATE TRIGGER films_photos_bump_version BEFORE UPDATE ON public.films_photos FOR EACH ROW EXECUTE FUNCTION films_photos_bump_version();
drop trigger if exists films_photos_follow on public.films_photos;
CREATE TRIGGER films_photos_follow AFTER INSERT OR UPDATE ON public.films_photos FOR EACH ROW EXECUTE FUNCTION films_photos_follow();

-- 8. Grants: the Worker (service role) does the writing; signed-in studio users read their own rows ------------------
revoke all on public.films_galleries from anon, authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.films_galleries to service_role;
revoke all on public.films_albums from anon, authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.films_albums to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.films_albums to service_role;
revoke all on public.films_cleanup_runs from anon, authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.films_cleanup_runs to service_role;
revoke all on public.films_face_searches from anon, authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.films_face_searches to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.films_face_searches to service_role;
revoke all on public.films_faces from anon, authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.films_faces to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.films_faces to service_role;
revoke all on public.films_faces_done from anon, authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.films_faces_done to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.films_faces_done to service_role;
revoke all on public.films_hearts from anon, authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.films_hearts to service_role;
revoke all on public.films_insta from anon, authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.films_insta to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.films_insta to service_role;
revoke all on public.films_photo_lists from anon, authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.films_photo_lists to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.films_photo_lists to service_role;
revoke all on public.films_photos from anon, authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.films_photos to service_role;
revoke all on public.films_studio_settings from anon, authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.films_studio_settings to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.films_studio_settings to service_role;
revoke all on public.films_terms_accepts from anon, authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.films_terms_accepts to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.films_terms_accepts to service_role;
revoke all on function public.films_album_guards(p_tenant_id uuid, p_ids text[]) from public, anon, authenticated;
grant execute on function public.films_album_guards(p_tenant_id uuid, p_ids text[]) to service_role;
revoke all on function public.films_album_put(p_tenant_id uuid, p_gallery_id text, p_data jsonb, p_rev bigint, p_draft_only boolean) from public, anon, authenticated;
grant execute on function public.films_album_put(p_tenant_id uuid, p_gallery_id text, p_data jsonb, p_rev bigint, p_draft_only boolean) to service_role;
revoke all on function public.films_albums_next_rev() from public, anon, authenticated;
revoke all on function public.films_albums_print_copy() from public, anon, authenticated;
revoke all on function public.films_bump_access_version(p_tenant_id uuid) from public, anon, authenticated;
grant execute on function public.films_bump_access_version(p_tenant_id uuid) to service_role;
revoke all on function public.films_cleanup_record(p_run jsonb) from public, anon, authenticated;
grant execute on function public.films_cleanup_record(p_run jsonb) to service_role;
revoke all on function public.films_close_lapsed_studios(p_grace_days integer) from public, anon, authenticated;
grant execute on function public.films_close_lapsed_studios(p_grace_days integer) to service_role;
revoke all on function public.films_count_event(p_id text, p_type text) from public, anon, authenticated;
grant execute on function public.films_count_event(p_id text, p_type text) to service_role;
revoke all on function public.films_dashboard(p_tenant_id uuid, p_films boolean, p_photos boolean) from public, anon, authenticated;
grant execute on function public.films_dashboard(p_tenant_id uuid, p_films boolean, p_photos boolean) to service_role;
revoke all on function public.films_dropbox_impact(p_tenant_id uuid) from public, anon, authenticated;
grant execute on function public.films_dropbox_impact(p_tenant_id uuid) to service_role;
revoke all on function public.films_faces_add(p_gallery_id text, p_tenant_id uuid, p_file text, p_keys text[], p_faces integer) from public, anon, authenticated;
grant execute on function public.films_faces_add(p_gallery_id text, p_tenant_id uuid, p_file text, p_keys text[], p_faces integer) to service_role;
revoke all on function public.films_faces_chunk(p_gallery_id text, p_n integer) from public, anon, authenticated;
grant execute on function public.films_faces_chunk(p_gallery_id text, p_n integer) to service_role;
revoke all on function public.films_faces_cleanup_candidates(p_max_age_days integer, p_grace_days integer, p_limit integer) from public, anon, authenticated;
grant execute on function public.films_faces_cleanup_candidates(p_max_age_days integer, p_grace_days integer, p_limit integer) to service_role;
revoke all on function public.films_faces_dirty_candidates(p_limit integer) from public, anon, authenticated;
grant execute on function public.films_faces_dirty_candidates(p_limit integer) to service_role;
revoke all on function public.films_faces_done_keys(p_gallery_id text) from public, anon, authenticated;
grant execute on function public.films_faces_done_keys(p_gallery_id text) to service_role;
revoke all on function public.films_faces_forget(p_gallery_id text, p_search_off boolean) from public, anon, authenticated;
grant execute on function public.films_faces_forget(p_gallery_id text, p_search_off boolean) to service_role;
revoke all on function public.films_faces_off_clear() from public, anon, authenticated;
revoke all on function public.films_faces_plan(p_gallery_id text, p_keys text[], p_limit integer) from public, anon, authenticated;
grant execute on function public.films_faces_plan(p_gallery_id text, p_keys text[], p_limit integer) to service_role;
revoke all on function public.films_faces_remove(p_gallery_id text, p_keys text[]) from public, anon, authenticated;
grant execute on function public.films_faces_remove(p_gallery_id text, p_keys text[]) to service_role;
revoke all on function public.films_faces_swap(p_gallery_id text, p_swaps jsonb) from public, anon, authenticated;
grant execute on function public.films_faces_swap(p_gallery_id text, p_swaps jsonb) to service_role;
revoke all on function public.films_galleries_event_same_tenant() from public, anon, authenticated;
revoke all on function public.films_galleries_extend(p_tenant_id uuid, p_items jsonb, p_days integer) from public, anon, authenticated;
grant execute on function public.films_galleries_extend(p_tenant_id uuid, p_items jsonb, p_days integer) to service_role;
revoke all on function public.films_galleries_print_token_at() from public, anon, authenticated;
revoke all on function public.films_link_check_candidates(p_after text, p_limit integer, p_start text) from public, anon, authenticated;
grant execute on function public.films_link_check_candidates(p_after text, p_limit integer, p_start text) to service_role;
revoke all on function public.films_photo_cover(p_data jsonb) from public, anon, authenticated;
grant execute on function public.films_photo_cover(p_data jsonb) to service_role;
revoke all on function public.films_photo_item(p_gallery_id text, p_tenant_id uuid, p_key text, p_copies boolean) from public, anon, authenticated;
grant execute on function public.films_photo_item(p_gallery_id text, p_tenant_id uuid, p_key text, p_copies boolean) to service_role;
revoke all on function public.films_photo_list_create(p_gallery_id text, p_id text, p_name text, p_keys text[]) from public, anon, authenticated;
grant execute on function public.films_photo_list_create(p_gallery_id text, p_id text, p_name text, p_keys text[]) to service_role;
revoke all on function public.films_photo_list_toggle(p_gallery_id text, p_list_id text, p_keys text[], p_on boolean) from public, anon, authenticated;
grant execute on function public.films_photo_list_toggle(p_gallery_id text, p_list_id text, p_keys text[], p_on boolean) to service_role;
revoke all on function public.films_photos_bump_version() from public, anon, authenticated;
revoke all on function public.films_photos_follow() from public, anon, authenticated;
revoke all on function public.films_photos_patch(p_gallery_id text, p_tenant_id uuid, p_expected integer, p_items jsonb, p_order text[], p_fields jsonb) from public, anon, authenticated;
grant execute on function public.films_photos_patch(p_gallery_id text, p_tenant_id uuid, p_expected integer, p_items jsonb, p_order text[], p_fields jsonb) to service_role;
revoke all on function public.films_print_links_expire(p_days integer) from public, anon, authenticated;
grant execute on function public.films_print_links_expire(p_days integer) to service_role;
revoke all on function public.films_rate_count(p_key text, p_window_seconds integer, p_add boolean) from public, anon, authenticated;
grant execute on function public.films_rate_count(p_key text, p_window_seconds integer, p_add boolean) to service_role;
revoke all on function public.films_rate_hit(p_key text, p_max integer, p_window_seconds integer) from public, anon, authenticated;
grant execute on function public.films_rate_hit(p_key text, p_max integer, p_window_seconds integer) to service_role;
revoke all on function public.films_safe_date(p_value text) from public, anon, authenticated;
grant execute on function public.films_safe_date(p_value text) to service_role;
revoke all on function public.films_sweep_rate_hits() from public, anon, authenticated;
grant execute on function public.films_sweep_rate_hits() to service_role;
revoke all on function public.films_tenant_info(p_tenant_id uuid) from public, anon, authenticated;
grant execute on function public.films_tenant_info(p_tenant_id uuid) to service_role;
revoke all on function public.films_terms_summary(p_gallery_id text) from public, anon, authenticated;
grant execute on function public.films_terms_summary(p_gallery_id text) to service_role;
revoke all on function public.films_trash_candidates(p_before timestamp with time zone, p_limit integer) from public, anon, authenticated;
grant execute on function public.films_trash_candidates(p_before timestamp with time zone, p_limit integer) to service_role;

-- 9. Storage: private buckets, no policies — only the service role (the Worker) reads and writes them ---------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('films-music', 'films-music', false, 10485760,
        array['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/x-wav'])
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('films-faces', 'films-faces', false, 4194304, array['application/octet-stream'])
on conflict (id) do nothing;
