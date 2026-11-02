-- Production gives a new table no privileges at all (its default ACLs were tightened long ago); staging and the
-- pglite contract test still do, so 0101 and 0102 passed there and failed live: the gallery Worker and drive-helper
-- (service role) got "permission denied" on their own tables, and so would the studio's screens. Found 2026-11-02
-- right after 0102 went live, before anything was lost (no starred gallery, no Drive task, no photographer page yet).
-- Only grants; RLS still decides which rows each one sees. From now on every new table grants explicitly (as 0091).

-- 0101: the Worker queues and cancels, drive-helper hands out and closes; the studio's screens only read (RLS: its
-- owner / admin / studio_manager).
grant select, insert, update, delete on public.drive_tasks to service_role;
grant select on public.drive_tasks to authenticated;

-- 0102: the studio edits its pages in "דפי צלמים" (RLS: owner / admin / studio_manager; the lead coordinator reads
-- the published ones); the Worker reads them for /photographer/<token>.
grant select, insert, update, delete on public.photographer_pages to authenticated, service_role;
grant select, insert, update, delete on public.photographer_testimonials to authenticated, service_role;
