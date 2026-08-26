-- Makes automation message logging actually work. It has never worked.
--
-- `automation_message_logs.tenant_id` is NOT NULL with no default, but every one of the 8 insert sites
-- across two Edge Functions builds its payload WITHOUT tenant_id:
--   automation-engine/index.ts      -- 6 `logEntry` objects (lines ~245, 435, 706, 829, 928, 1096)
--   approve-pending-automation/index.ts -- 2 inline inserts (lines ~85, ~104)
-- None of them checks the returned error (`await supabase.from(...).insert({...})`, result discarded), so
-- every insert has failed on the not-null violation and no one has ever been told.
--
-- Census on 2026-08-26 (production, as `postgres`, so RLS is not hiding anything -- relforcerowsecurity is
-- false): automation_message_logs = 0 rows, while automation_runs = 15 rows recording 12 messages actually
-- sent between 2026-08-17 and 2026-08-26. Messages are going out; nothing is being recorded.
--
-- Three live consequences:
--   1. src/pages/AutomationLogs.jsx renders permanently empty -- no record of what was sent, to whom, when.
--   2. _shared/automationGuards.ts's wasAlreadySentToday() -- the cross-run duplicate guard -- reads this
--      table, so it can never fire. Duplicate protection across runs is inert. (See also 0051.)
--   3. src/pages/SystemAdvisor.jsx draws conclusions from an empty set.
--
-- Fixed here in the DB rather than in the Edge Functions on purpose: an Edge Function deploy is the highest
-- risk action available on this project (unverifiable locally -- no deno binary -- and the failure mode is
-- wrong WhatsApp messages to real customers), and the deployed automation-engine is already 2 commits
-- behind the repo, so deploying to fix this would ship unrelated changes at the same time. A BEFORE INSERT
-- trigger fixes all 8 sites at once against the code that is running in production right now.
--
-- automation_id is NOT NULL and a real FK into automations(id), and automations carries tenant_id, so the
-- tenant is always derivable. BEFORE INSERT triggers run ahead of constraint checks, so filling the column
-- here is enough to let the insert through.
create or replace function set_automation_message_log_tenant()
returns trigger
language plpgsql
as $$
begin
  -- Only ever fills a gap. An explicitly supplied tenant_id is left alone, so if the Edge Functions are
  -- later corrected to pass it (the proper fix, deferred to whenever automation-engine is next deployed)
  -- this trigger silently becomes a no-op rather than fighting them.
  if new.tenant_id is null then
    select a.tenant_id into new.tenant_id
    from automations a
    where a.id = new.automation_id;
  end if;
  return new;
end;
$$;

drop trigger if exists set_automation_message_log_tenant_trigger on automation_message_logs;
create trigger set_automation_message_log_tenant_trigger
  before insert on automation_message_logs
  for each row
  execute function set_automation_message_log_tenant();

-- No backfill: the table is empty, precisely because of the bug being fixed. Nothing to repair.
--
-- Cannot regress: if the lookup somehow yields nothing, tenant_id stays null and the insert fails exactly
-- as it does today. The trigger can only turn a failing insert into a succeeding one, never the reverse.
