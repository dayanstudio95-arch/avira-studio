-- "זמינות צלם" per role (2026-10-07). When asking several crew members at once the owner
-- picks a slot for each (צלם ראשי / צלם ערב / צלם וידאו / צלם וידאו 2); the slot goes into
-- that person's message and is kept here, so a "פנוי" answer is assigned straight to it.
-- NULL = asked without a slot (as before). Additive only.
-- Rollback: audit-reports/rollback/0077_rollback.sql. Re-runnable.

alter table staff_availability_requests add column if not exists team_role text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'staff_availability_requests_team_role_check') then
    alter table staff_availability_requests add constraint staff_availability_requests_team_role_check
      check (team_role is null or team_role in ('photographer1', 'photographer2', 'videographer', 'videographer2'));
  end if;
end $$;
