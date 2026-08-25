-- Auto-fill tenant_id on insert for staff_availability_requests, same as
-- 0003_tenant_defaults.sql / 0032_wedding_albums_tenant_defaults.sql do for every
-- other tenant-scoped table. Missed in 0041_staff_availability_requests.sql -- without
-- this, StaffAvailabilityModal.jsx's .create() call (which never passes tenantId
-- explicitly, by established convention across this whole codebase) fails the NOT NULL
-- constraint on every insert.
create trigger set_tenant_id before insert on staff_availability_requests
  for each row execute function set_tenant_id();
