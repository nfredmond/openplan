-- The eight GTFS child tables start ENFORCING the workspace-scoped policies they
-- have carried, unenforced, since 20260420000062.
--
-- THE DEFECT, IN ONE SENTENCE. Every one of these tables has a correct
-- feed-inheritance SELECT policy, and not one of them has ever had row-level
-- security switched on, so the policy has never been in force for a single
-- second. `ALTER TABLE … ENABLE ROW LEVEL SECURITY` appears in no migration in
-- this repository for any of the eight. A policy without RLS is decoration:
-- Postgres stores it, `pg_policies` lists it, `psql \d` prints it under
-- "Policies (row security disabled)", and it filters nothing.
--
-- WHAT THAT MEANT LIVE. Verified on 2026-08-03 by seeding one workspace's
-- private transit feed (`gtfs_feeds.workspace_id` set to tenant B) with one row
-- in each child table, then attacking with the public anon key and NO ACCOUNT AT
-- ALL, and separately as an authenticated member of an unrelated workspace:
--
--   * anon SELECT returned tenant B's row from ALL EIGHT tables — agencies,
--     routes, stops, trips, stop_times, shapes, calendar, calendar_dates.
--   * an unrelated tenant's authenticated session read them too.
--   * anon INSERT into tenant B's feed — LANDED.
--   * anon UPDATE of tenant B's route short_name to "DEFACED" — LANDED.
--   * anon DELETE of tenant B's stop — LANDED.
--
-- THE CONTROL IS WHAT MAKES THIS CONCLUSIVE. In the same run, the PARENT table
-- `gtfs_feeds` returned `[]` to both attackers, because it has RLS enabled and a
-- workspace policy. Parent denies, children publish. That asymmetry is the proof
-- the tenant boundary here was designed, written, reviewed — and then never
-- switched on. It is not a missing policy; it is an unarmed one.
--
-- WHAT IS EXPOSED. A transit agency's network: agency identity, route
-- alignments, stop locations, trip patterns and full timetables for a feed its
-- workspace loaded privately. Under the write grants, any anonymous caller could
-- also silently reroute or delete it.
--
-- WHY ENABLING RLS IS SUFFICIENT AND NEEDS NO POLICY CHANGES. The existing
-- `public_read_*` policies are already right. Each is
-- `FOR SELECT USING (EXISTS (SELECT 1 FROM gtfs_feeds feed WHERE feed.id =
-- <child>.feed_id AND (feed.workspace_id IS NULL OR feed.workspace_id IN
-- (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()))))`,
-- which preserves the deliberate `workspace_id IS NULL` case for genuinely
-- shared public feeds while scoping workspace-owned feeds to their members.
-- Turning RLS on converts eight correct-but-inert policies into enforcement.
--
-- WHY THIS DOES NOT LOCK ANYBODY OUT — checked in both directions. The
-- over-restriction risk is real and was measured, not assumed: in the same live
-- run, an authenticated OWNER of the feed's workspace read their own row from
-- all eight tables both before and after. Public feeds
-- (`workspace_id IS NULL`) stay world-readable through the same policy branch.
-- And no application code reaches these tables at all — a repository-wide grep
-- for `.from("agencies"|"routes"|"stops"|"trips"|"stop_times"|"shapes"|
-- "calendar"|"calendar_dates")` across `src/` and `workers/` outside tests
-- returns nothing — so there is no query to regress. The service role, which any
-- future GTFS ingest will use, bypasses RLS entirely.
--
-- THE WRITE REVOKE IS DELIBERATE DEFENCE IN DEPTH, NOT REDUNDANCY. Enabling RLS
-- with SELECT-only policies already denies every write, so the revoke below
-- changes no behaviour today. It is here because the two controls fail
-- independently: a future `FOR ALL USING (true)` written for convenience, or a
-- policy widened during a refactor, would re-open writes to anonymous callers
-- with nothing failing loudly. Removing the grant means such a mistake grants
-- nothing.
--
-- THE GENERAL LESSON, RECORDED SO IT IS NOT RELEARNED. `src/test/
-- gtfs-child-policies.test.ts` was green throughout. It asserted on the TEXT of
-- the two migration files — that the policy SQL contained
-- `WHERE feed.id = stops.feed_id` — and never touched a database, so it could
-- not see that the policy it was reading had never been enforced. Guarding a
-- copy of the artifact instead of the artifact is how this survived four months.
-- That test is being replaced in the same change with one that reads
-- `pg_class.relrowsecurity` live, and with a general invariant: no table may
-- carry a policy while RLS is off.

alter table public.agencies enable row level security;
alter table public.routes enable row level security;
alter table public.stops enable row level security;
alter table public.trips enable row level security;
alter table public.stop_times enable row level security;
alter table public.shapes enable row level security;
alter table public.calendar enable row level security;
alter table public.calendar_dates enable row level security;

revoke insert, update, delete, truncate, references, trigger
  on public.agencies, public.routes, public.stops, public.trips,
     public.stop_times, public.shapes, public.calendar, public.calendar_dates
  from anon, authenticated;

revoke insert, update, delete, truncate, references, trigger
  on public.agencies, public.routes, public.stops, public.trips,
     public.stop_times, public.shapes, public.calendar, public.calendar_dates
  from public;
