-- =========================================================
-- Guard: swapping the Google account (or the Calendar ID) behind a
-- google_calendar_accounts slot must not leave 271 orphaned sync rows
-- claiming everything is synced.
--
-- WHY THIS IS NEEDED
-- google-calendar-oauth-disconnect KEEPS the account row (it only nulls the
-- tokens, so the (tenant_id, account_role) unique slot and the audit trail
-- survive), and google-calendar-oauth-callback reconnects by
-- `.update(row).eq('id', existing.id)`. So connecting a DIFFERENT Google
-- email to the same slot reuses the same google_calendar_accounts.id, and
-- every event_calendar_syncs row keeps pointing at it while its
-- google_event_id refers to an event that exists only in the OLD calendar.
--
-- Those rows are status='success', and reconcile-calendar-sync only picks up
-- 'failed' / stale-'pending' rows plus events not covered by a connected
-- account (where "covered" also means status='success'). So nothing would
-- ever revisit them: the UI would show a green "271 מתוך 271 מסונכרנים"
-- while the new calendar stayed completely empty. Same class of lie as the
-- calendar badge fixed earlier (see the plan's §28).
--
-- WHY A TRIGGER AND NOT CODE
-- The sync logic lives in _shared/googleCalendarSync.ts, which is imported by
-- 9 Edge Functions, each bundling its own copy at deploy time — a code fix
-- would need 9 deploys. A trigger fixes it against the code already running
-- in production, exactly like 0050_automation_message_logs_tenant_trigger.sql.
--
-- WHY google_event_id IS DELIBERATELY *NOT* NULLED
-- pushEventToAccount() already self-heals a stale id: PATCH -> 404/410 ->
-- action 'cleared_missing_id' -> google_event_id=null, status='pending' ->
-- next reconciler pass creates it fresh. All this trigger has to do is
-- nominate the rows for re-push. Keeping the id makes a FALSE POSITIVE
-- harmless: if the account did not really change, the PATCH simply succeeds
-- and the row returns to 'success' with nothing duplicated. Nulling the id
-- would instead force a create on every row, and one spurious fire would
-- produce 271 duplicate events in a live calendar.
--
-- WHY 'pending' AND NOT 'failed'
-- 'failed' would trip the red "הסנכרון נכשל" badge, whose Hebrew text tells
-- the owner to reconnect — the wrong remedy, since the account is fine.
-- 'pending' with last_synced_at = null is picked up by the reconciler just as
-- immediately (a null last_synced_at counts as stale) and shows honest
-- yellow partial ratios in the meantime.
-- =========================================================

create or replace function public.reset_calendar_syncs_on_account_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- coalesce(old.google_email,'') <> '' : only act when there genuinely WAS a
  --   previous account. A first-ever connect is an INSERT and never reaches
  --   this trigger anyway.
  -- lower(trim(...)) : casing/whitespace drift in what Google returns must not
  --   be mistaken for a swap.
  if coalesce(old.google_email, '') <> ''
     and (
       lower(trim(coalesce(old.google_email, ''))) is distinct from lower(trim(coalesce(new.google_email, '')))
       or coalesce(old.calendar_id, 'primary') is distinct from coalesce(new.calendar_id, 'primary')
     )
  then
    update event_calendar_syncs
       set status         = 'pending',
           last_synced_at = null,
           last_error     = null,
           updated_at     = now()
     -- scoped to this one account: the other slot (primary/backup) is untouched.
     where account_id = new.id
       -- 'deleted' is excluded on purpose: that row means the event was
       -- deliberately removed from the calendar, and resetting it would
       -- resurrect it. Rows already 'pending' are excluded so re-firing
       -- churns nothing.
       and status in ('success', 'failed');
  end if;

  return new;
end;
$$;

-- Column-scoped ON PURPOSE. The OAuth callback also rewrites access_token,
-- token_expires_at, scope, status and last_error on every hourly token
-- refresh; disconnect never touches google_email. Scoping to these two
-- columns makes a refresh, a reconnect to the SAME email, and a disconnect
-- all no-ops.
create trigger reset_calendar_syncs_on_account_change_trigger
  after update of google_email, calendar_id on public.google_calendar_accounts
  for each row execute function public.reset_calendar_syncs_on_account_change();
