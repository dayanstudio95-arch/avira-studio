-- Wedding Albums module -- lets the studio enter its real bank transfer details
-- once (in Settings), so the couple sees them directly on the album portal's
-- payment step instead of being told to "contact the studio by WhatsApp or
-- phone" for account details. This does not change the payment MODEL at all --
-- CLAUDE.md's iron rule ("Payment in v1 is manual bank transfer only, no real
-- Green Invoice payment-form/webhook integration") is untouched: this is still
-- a manual transfer the couple performs themselves in their own banking app,
-- just with the account details displayed instead of requested out-of-band.
--
-- Columns added to `tenants` (same table/pattern as 0021_studio_details.sql's
-- identity/contact fields) rather than a new table -- one set of bank details
-- per studio/tenant, not per-order, matching how phone/email/address etc.
-- already work there.
--
-- No RLS change needed -- `tenants_update_by_admin` (0018_admin_role_gated_writes.sql)
-- already gates UPDATE to owner/admin/studio_manager, and RLS has no per-column
-- granularity, so these new columns are automatically covered by the existing
-- row-level policy. Read access for the couple-facing public portal is via
-- album-portal's service-role client (never a real session), scoped explicitly
-- to the validated token's tenant_id -- exactly like every other lookup there.
alter table tenants
  add column if not exists bank_name text,
  add column if not exists bank_branch_number text,
  add column if not exists bank_account_number text,
  add column if not exists bank_account_holder_name text,
  add column if not exists bank_transfer_notes text;
