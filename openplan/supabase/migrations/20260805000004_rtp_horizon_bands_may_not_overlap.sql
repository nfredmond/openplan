-- Horizon periods within one RTP cycle may not overlap.
--
-- Decided by Nathaniel 2026-08-05: "Horizon bands should not overlap, but the
-- band may fall outside in some cases in weird situations." So overlap is
-- REFUSED here, and a band falling outside the cycle's declared horizon stays
-- ALLOWED — the surfaces disclose it rather than the database forbidding it,
-- because he named real situations where it is correct.
--
-- WHY A CONSTRAINT RATHER THAN A CHECK IN THE ROUTE. The route is a convention:
-- it holds until the next writer forgets, and it cannot see a concurrent
-- insert at all. Two overlapping periods created in the same instant would both
-- pass a SELECT-then-INSERT check and both land. An exclusion constraint is
-- index-backed and evaluated by the database, so it cannot be raced and cannot
-- be bypassed by a second write path.
--
-- WHY THIS MATTERS BEYOND TIDINESS. Overlapping periods make a plan's own
-- arithmetic ambiguous. Every revenue line, cost line and project cost attaches
-- to exactly one band, and each band escalates its money to its own expenditure
-- year — so two periods claiming 2030 means the same calendar year carries two
-- different escalation exponents, and which one applies to a given dollar
-- depends only on which band a planner happened to file it under. A published
-- plan would present two periods claiming the same years with no way for a
-- reader to tell what was counted where.
--
-- `int4range(start_year, end_year, '[]')` is INCLUSIVE at both ends, which is
-- how a planner reads "2026–2035": a band ending 2035 and one starting 2035
-- overlap, because 2035 belongs to both. A half-open range would silently allow
-- that, and the shared year would escalate under whichever band won.
--
-- btree_gist is required for the `=` operator on a uuid inside an exclusion
-- constraint. It is a standard contrib extension that Supabase ships; noted
-- here because it is this schema's first exclusion constraint and therefore its
-- first dependency on the extension.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Existing overlapping rows would make ADD CONSTRAINT fail. Nothing in the
-- product could create one until now (the table shipped in 20260805000003
-- earlier today), so this reports rather than repairs: silently deleting or
-- editing an agency's periods to satisfy a new constraint would be the
-- migration destroying planning work to make itself apply.
DO $$
DECLARE
  offending INTEGER;
BEGIN
  SELECT count(*) INTO offending
  FROM public.rtp_horizon_bands a
  JOIN public.rtp_horizon_bands b
    ON a.rtp_cycle_id = b.rtp_cycle_id
   AND a.id <> b.id
   AND int4range(a.start_year, a.end_year, '[]') && int4range(b.start_year, b.end_year, '[]');

  IF offending > 0 THEN
    RAISE EXCEPTION
      'Cannot add the no-overlap constraint: % horizon band rows overlap another band in the same RTP cycle. Resolve the overlaps first; this migration will not edit or delete planning data to make itself apply.',
      offending;
  END IF;
END
$$;

ALTER TABLE public.rtp_horizon_bands
  ADD CONSTRAINT rtp_horizon_bands_no_overlap
  EXCLUDE USING gist (
    rtp_cycle_id WITH =,
    int4range(start_year, end_year, '[]') WITH &&
  );

COMMENT ON CONSTRAINT rtp_horizon_bands_no_overlap ON public.rtp_horizon_bands IS
  'Two periods of one RTP cycle may not claim the same year. Enforced at the database rather than in the route because a SELECT-then-INSERT check cannot see a concurrent insert, and because overlapping periods make the plan''s own escalation arithmetic ambiguous — the same calendar year would carry two different expenditure years depending only on which band a dollar was filed under. Ranges are inclusive at both ends, matching how a planner reads "2026–2035".';
