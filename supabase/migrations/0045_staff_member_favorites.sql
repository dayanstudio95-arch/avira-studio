-- Staff availability check ("זמינות צלם" popup, src/components/leads/StaffAvailabilityModal.jsx) --
-- lets the studio mark a subset of photographers/videographers as "favorites"
-- (crew members they book more regularly), so they can jump straight to sending an
-- availability check to just that shortlist instead of picking through the full
-- role list every time.
--
-- Single boolean column on staff_members, same simple pattern as every other flag
-- column in this table's original migration (0001_init.sql) -- no new table needed,
-- this is a per-staff-member studio preference, not per-event/per-order data.
--
-- No RLS change needed -- staff_members' existing role-gated write policy
-- (0018_admin_role_gated_writes.sql-style EXISTS-subquery pattern, already applied
-- to this table) covers UPDATE on this new column automatically; Postgres RLS has
-- no per-column granularity.
alter table staff_members
  add column if not exists is_favorite boolean not null default false;
