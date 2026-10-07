-- "תשובות זמינות" in staff scheduling (2026-10-07): a "פנוי" answer the owner will not use
-- ("לא צריך") leaves the "צריך החלטה" list. Display state only — the crew member is not told.
-- Additive only. Rollback: audit-reports/rollback/0078_rollback.sql. Re-runnable.
alter table staff_availability_requests add column if not exists decision_dismissed_at timestamptz;
