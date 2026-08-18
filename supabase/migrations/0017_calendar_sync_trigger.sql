-- Global auto-sync trigger for Google Calendar: fires on every insert/update
-- of an event's calendar-relevant columns and pushes the change to
-- calendar-sync-webhook (async, via pg_net), which calls the same
-- syncEventToAllAccounts() helper used everywhere else events get pushed to
-- Google. This replaces the old requirement of every mutation site (lead
-- closing a deal, staff scheduling, payments, bulk edits, etc — 11+ call
-- sites, none of which called the calendar sync themselves) remembering to
-- trigger a resync; now it's automatic and impossible to miss for any future
-- call site too, since it's driven by the table, not the code path.
--
-- Watched columns: couple_names, date, venue, phone_number, team,
-- required_crew, notes — the exact set of fields buildEventPayload() (in
-- supabase/functions/_shared/googleCalendarSync.ts) actually reads to build
-- the calendar description/color/attendees. Deliberately does NOT watch
-- calendar_sync_status / calendar_sync_error / google_calendar_event_id —
-- syncEventToAllAccounts writes those back onto the same events row after a
-- push (see mirrorPrimaryOntoLegacyColumns), and if the trigger watched them
-- too, every successful sync would immediately re-trigger itself forever.
--
-- pg_net is already enabled (migration 0016_google_calendar_accounts.sql).
--
-- IMPORTANT — one-time manual step required after `supabase db push`:
-- the placeholder secret below must be replaced with the real
-- CALENDAR_RECONCILE_CRON_SECRET value via `create or replace function`, run
-- once through the Supabase SQL Editor. See DEPLOYMENT.md section 4 for the
-- exact copy-pasteable snippet — same one-time-paste requirement the two
-- existing pg_cron jobs (automation-engine-hourly, calendar-reconcile-20min)
-- already have, for the same reason: real secrets don't belong committed to
-- version control.

create or replace function public.trigger_calendar_sync_webhook()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if  new.couple_names   is not distinct from old.couple_names
    and new.date           is not distinct from old.date
    and new.venue          is not distinct from old.venue
    and new.phone_number   is not distinct from old.phone_number
    and new.team           is not distinct from old.team
    and new.required_crew  is not distinct from old.required_crew
    and new.notes          is not distinct from old.notes
    then
      return new;
    end if;
  end if;

  perform net.http_post(
    url := 'https://yzurelfhjkgqrluifszz.supabase.co/functions/v1/calendar-sync-webhook',
    headers := jsonb_build_object(
      'x-cron-secret', '<CALENDAR_RECONCILE_CRON_SECRET — replace via create or replace function after db push>',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('tenantId', new.tenant_id, 'eventId', new.id)
  );

  return new;
end;
$$;

drop trigger if exists calendar_sync_webhook_trigger on public.events;

create trigger calendar_sync_webhook_trigger
  after insert or update of couple_names, date, venue, phone_number, team, required_crew, notes
  on public.events
  for each row
  execute function public.trigger_calendar_sync_webhook();
