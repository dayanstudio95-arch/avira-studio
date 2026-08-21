-- Settings-page upgrade #2 (4 selected items): adds tenant-level Quiet Hours
-- config (for the automation-engine send-guard feature) and tenant-level
-- financial defaults (VAT %, deposit amount), used to prefill new
-- events/payments instead of the app-wide hardcoded 18%/500 ILS fallbacks.
--
-- No RLS change needed on `tenants` — `tenants_update_by_admin`
-- (0018_admin_role_gated_writes.sql) already gates UPDATE to
-- owner/admin/studio_manager, and RLS has no per-column granularity, so these
-- new columns are automatically covered by the existing row-level policy.
-- Same precedent as 0021_studio_details.sql.
alter table tenants
  add column if not exists quiet_hours_enabled boolean not null default false,
  add column if not exists quiet_hours_start text, -- 'HH:MM', Asia/Jerusalem wall-clock
  add column if not exists quiet_hours_end text,    -- 'HH:MM', Asia/Jerusalem wall-clock
  add column if not exists default_vat_percent numeric not null default 18,
  add column if not exists default_deposit_amount numeric not null default 500;
