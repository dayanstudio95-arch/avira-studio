-- Account swap: also clear the legacy per-event calendar columns.
--
-- 0053 already handles the hard part of switching Google accounts — it resets
-- event_calendar_syncs to 'pending' so the reconciler re-creates every event on the new
-- calendar, deliberately keeping google_event_id so a stale-id PATCH 404s and self-heals
-- rather than risking mass duplicates.
--
-- What it does NOT reset is the legacy mirror on `events` itself:
--   google_calendar_event_id · calendar_sync_status · calendar_sync_error
-- written by mirrorPrimaryOntoLegacyColumns() in _shared/googleCalendarSync.ts for the
-- primary account only. After a swap those hold ids belonging to the OLD calendar, and
-- three places read them directly instead of going through event_calendar_syncs:
--
--   supabase/functions/send-staff-invite/index.ts:66   — PATCHes that id to add a crew
--       member as an attendee. Against the new calendar it targets an event that does
--       not exist there.
--   supabase/functions/daily-event-brief/index.ts:83   — same shape.
--   src/pages/GoogleCalendarSync.jsx isEventSyncedToPrimary() — gates the invite
--       checkbox on this column, so every event looks green and already-synced the
--       moment the new account is connected, before a single event has been created
--       on it. That is the one that misleads a human rather than just erroring.
--
-- Clearing them is the safe direction: mirrorPrimaryOntoLegacyColumns rewrites all three
-- on the first successful primary sync, so the only window is between the swap and the
-- reconciler catching up — exactly the window in which the old values are wrong.
--
-- Same column-scoped trigger as 0053 and the same swap condition, so a token refresh, a
-- reconnect to the same email, and a disconnect all remain no-ops.

create or replace function public.reset_calendar_syncs_on_account_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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
     where account_id = new.id
       and status in ('success', 'failed');

    -- NEW in 0059. Primary only: the legacy columns are a mirror of the primary
    -- account's sync state and are never written for the backup slot, so a backup swap
    -- must not touch them.
    if new.account_role = 'primary' then
      update events
         set google_calendar_event_id = null,
             calendar_sync_status     = null,
             calendar_sync_error      = null
       where tenant_id = new.tenant_id
         and google_calendar_event_id is not null;
    end if;
  end if;

  return new;
end;
$$;

-- The trigger itself is unchanged and still installed from 0053 — only the function
-- body is replaced. Recreated here anyway so this migration is self-contained if it is
-- ever applied to a database where 0053's trigger was dropped.
drop trigger if exists reset_calendar_syncs_on_account_change_trigger on public.google_calendar_accounts;
create trigger reset_calendar_syncs_on_account_change_trigger
  after update of google_email, calendar_id on public.google_calendar_accounts
  for each row execute function public.reset_calendar_syncs_on_account_change();
