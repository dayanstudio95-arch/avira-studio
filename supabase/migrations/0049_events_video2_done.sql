-- Gives the `videographer2` crew slot its own completion flag.
--
-- `events` already had photographer1_done, photographer2_done, video1_done and editor_done, but no
-- video2_done. src/lib/staffRoles.js's videographer2 entry therefore aliased onto video1Done, so marking
-- either videographer's work done marked both. That aliasing was a documented deferral from the role
-- consolidation, taken when videographer2 had no live data.
--
-- Census on 2026-08-26 (production): 270 events, of which 6 carry a videographer2 in events.team --
-- אביב וטל (2026-05-20), מיטל וינון (2026-07-07), נועה ודודו (2026-08-04), מתן ודניאל (2026-08-05),
-- נויה ושגיב (2026-11-04), פז וגיל (2026-12-03). The first four already have video1_done = true.
--
-- Shape copied exactly from photographer2_done: boolean not null default false. The default means the
-- other 264 events are unaffected, and nothing can read a null.
alter table events add column if not exists video2_done boolean not null default false;

-- Seed only the 6 events that actually have a second videographer, from video1_done -- the flag that was
-- standing in for this column until now. Without this the four already-completed events would appear to
-- regress to "not done" the moment the frontend starts reading the new column.
--
-- The WHERE clause is narrow on purpose: an event with no videographer2 keeps the false default, and
-- re-running is a no-op because the second predicate excludes rows already in the target state.
update events e
set video2_done = e.video1_done
where exists (
        select 1
        from jsonb_array_elements(coalesce(e.team, '[]'::jsonb)) t
        where t->>'role' = 'videographer2'
      )
  and e.video2_done is distinct from e.video1_done;
