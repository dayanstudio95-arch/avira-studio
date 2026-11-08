-- 0115: no one on two weddings the same day (2026-11-09, the owner: "אסור שזה יקרה").
--
-- The owner saw איילון "פנוי" for שחר ובן (9.6.2027) while he is צלם 1 at קמילה ואסף that day, and "שבץ" would have
-- put him on both. No screen and no server checked it in every path (the crew picker blocked only the same slot;
-- "תשובות זמינות", the "✅ פנוי" pills, the staff chat history and a change of an event's date did not check at all).
-- The screens now show and block it (src/lib/sameDayCrew.js); this is the guard under all of them, and under any path
-- added later: an event's team is not saved when a photographer / videographer on it is already on another event of
-- the same studio on the same day.
--
--   * The editor works from home: never counted, on either side.
--   * "אין סטילס" / "אין וידאו" (names starting with "אין "): on the staff list, but a mark that the couple has no
--     stills / video, not a person — never counted (isPlaceholder in sameDayCrew.js).
--   * The same person twice on ONE event (צלם 1 and צלם 2) is refused too — only a new double (one already saved stays
--     editable; there is none today but a past "אין סטילס").
--   * Names are compared trimmed (team entries carry the name only, as everywhere in the app).
--   * Only people NEW on the event are checked (or everyone, when the event's date changes, or a new event): the two
--     double bookings already saved (רודי 23.6.2027, סלבה 15.9.2027 — a banner on "שיבוץ צוות" until the owner fixes
--     them) never block an unrelated edit of those events (a cost, a paid mark).
--   * The words are the app's (doubleBookingText in src/lib/sameDayCrew.js); hint 'double_booking'.
--
-- Rollback: audit-reports/rollback/0115_rollback.sql (drops the trigger and the function).

create or replace function public.prevent_same_day_double_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  m jsonb;
  nm text;
  before_names text[] := '{}';
  clash record;
begin
  if new.date is null or new.tenant_id is null or jsonb_typeof(new.team) is distinct from 'array' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.date is not distinct from old.date and new.team is not distinct from old.team then
    return new;
  end if;
  -- Same day as before: the people already on it are not checked again (an old double booking never blocks an edit).
  if tg_op = 'UPDATE' and new.date is not distinct from old.date and jsonb_typeof(old.team) = 'array' then
    select coalesce(array_agg(btrim(x->>'staffMemberName')), '{}')
      into before_names
      from jsonb_array_elements(old.team) x
     where coalesce(x->>'role', '') <> 'editor'
       and btrim(coalesce(x->>'staffMemberName', '')) <> '';
  end if;

  for m in select value from jsonb_array_elements(new.team) loop
    nm := btrim(coalesce(m->>'staffMemberName', ''));
    continue when nm = '' or coalesce(m->>'role', '') = 'editor' or nm ~ '^אין\s' or nm = any(before_names);
    select e.couple_names, x->>'role' as role
      into clash
      from public.events e
      cross join lateral jsonb_array_elements(case when jsonb_typeof(e.team) = 'array' then e.team else '[]'::jsonb end) x
     where e.tenant_id = new.tenant_id
       and e.date = new.date
       and e.id <> new.id
       and coalesce(x->>'role', '') <> 'editor'
       and btrim(coalesce(x->>'staffMemberName', '')) = nm
     limit 1;
    if found then
      raise exception using
        errcode = 'P0001',
        message = format(
          '%s כבר משובץ/ת ב-%s אצל %s (%s). קודם מוציאים אותו משם.',
          nm,
          to_char(new.date, 'FMDD.FMMM.YYYY'),
          coalesce(nullif(btrim(clash.couple_names), ''), 'אירוע אחר'),
          case clash.role
            when 'photographer1' then 'צלם 1'
            when 'photographer2' then 'צלם 2'
            when 'videographer' then 'צלם וידאו'
            when 'videographer2' then 'צלם וידאו 2'
            else coalesce(clash.role, '')
          end
        ),
        hint = 'double_booking';
    end if;
  end loop;

  -- One person, one photo / video slot on this event (a double already saved stays editable).
  for nm in
    select btrim(x->>'staffMemberName')
      from jsonb_array_elements(new.team) x
     where coalesce(x->>'role', '') <> 'editor'
       and btrim(coalesce(x->>'staffMemberName', '')) <> ''
       and btrim(x->>'staffMemberName') !~ '^אין\s'
     group by 1
    having count(*) > 1
  loop
    continue when tg_op = 'UPDATE' and jsonb_typeof(old.team) = 'array' and (
      select count(*) from jsonb_array_elements(old.team) y
       where coalesce(y->>'role', '') <> 'editor' and btrim(coalesce(y->>'staffMemberName', '')) = nm
    ) > 1;
    raise exception using
      errcode = 'P0001',
      message = format('%s כבר משובץ/ת באירוע הזה בתפקיד אחר. כל אחד בתפקיד אחד.', nm),
      hint = 'double_booking';
  end loop;
  return new;
end;
$$;

-- Not callable on its own (a trigger function); only the trigger runs it.
revoke all on function public.prevent_same_day_double_booking() from public, anon, authenticated;

-- "trg_…" sorts after "set_tenant_id": on an insert the event's studio is already set when this runs.
drop trigger if exists trg_events_no_same_day_double_booking on public.events;
create trigger trg_events_no_same_day_double_booking
  before insert or update of team, date on public.events
  for each row execute function public.prevent_same_day_double_booking();

-- The lookup by studio and day uses events_date_idx (tenant_id, date), already there.
