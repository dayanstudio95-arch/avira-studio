-- Post-sign wizard (2026-10-07). After a couple signs (status 'חוזה') the app walks the owner
-- through: status → נסגר/חתימה, deposit invoice, schedule message, staff availability, staff
-- assignment (src/components/postSign/PostSignWizard.jsx). Two columns on the lead itself so
-- progress and "remind me on the 10th" follow him between computer and phone:
--   post_sign_flow           {step, done: {<step>: 'done'|'skipped'}, startedAt, completedAt}
--   post_sign_snoozed_until  the wizard does not pop up for this lead before this moment
-- Additive only: no row changes, existing RLS on leads covers both columns, and neither is one
-- of the financial columns guarded by 0020. Rollback: audit-reports/rollback/0074_rollback.sql.
-- Re-runnable.

alter table leads add column if not exists post_sign_flow jsonb;
alter table leads add column if not exists post_sign_snoozed_until timestamptz;
