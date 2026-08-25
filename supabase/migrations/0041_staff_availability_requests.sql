-- Two-way staff availability confirmation. Upgrades the existing one-way WhatsApp
-- "is this staff member free on this date" check (StaffAvailabilityModal.jsx, which
-- until now only sent a message with no response tracking) into a real flow: the
-- studio sends a link, the staff member taps available/declined with no login, and
-- the studio sees the result back in the lead/event panel.
--
-- Append-only: each ask creates a new row rather than mutating a prior one, so asking
-- again after a decline (or after time passes) preserves full history instead of
-- overwriting it.
--
-- Token security follows the exact pattern already established for
-- album_orders.portal_token_hash / print_access_links.token_hash (see CLAUDE.md's
-- "Wedding Albums module" section): SHA-256 hash stored at rest, raw token only ever
-- shown once client-side, revoked_at checked on every lookup (public Edge Function),
-- not just at creation.
--
-- Commercial-context columns (event_date/venue/couple_names) are snapshotted at
-- request time, not live-joined, per the same snapshot discipline used for
-- album_order_selections -- a lead's date/venue changing later must not retroactively
-- alter what an already-sent link displays to the staff member.

create table staff_availability_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  event_id uuid references events(id) on delete set null,
  staff_member_id uuid not null references staff_members(id) on delete cascade,
  staff_name_snapshot text not null,
  role text not null check (role in ('photographer', 'videographer')),
  event_date_snapshot date,
  venue_snapshot text,
  couple_names_snapshot text,
  token_hash text not null,
  status text not null default 'pending' check (status in ('pending', 'available', 'declined')),
  requested_at timestamptz not null default now(),
  responded_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index staff_availability_requests_token_hash_idx on staff_availability_requests(token_hash);
create index staff_availability_requests_lead_idx on staff_availability_requests(tenant_id, lead_id);
create index staff_availability_requests_staff_latest_idx
  on staff_availability_requests(tenant_id, staff_member_id, requested_at desc);

alter table staff_availability_requests enable row level security;

-- Same ADMIN_ROLES-only pattern as notifications_admin_only (0026) -- these rows carry
-- the same business-sensitive context (couple names, venue, staff phone linkage).
create policy staff_availability_requests_admin_only on staff_availability_requests
  for all
  using (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
  )
  with check (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
  );

grant select, insert, update, delete on staff_availability_requests to authenticated;
grant select, insert, update, delete on staff_availability_requests to service_role;
