-- The six columns that keep a derived service level from over-claiming.
--
-- WHY THIS IS A SEPARATE MIGRATION FROM 20260805000006. The schema and the
-- derivation were built in parallel lanes, deliberately, and the derivation
-- produced six honesty-carrying fields the schema had nowhere to put. Folding
-- them silently into 20260805000006 would erase the fact that they were found by
-- building the thing rather than by designing it, and that fact is the reason
-- they exist. Nothing has shipped: both migrations are unreleased.
--
-- WHAT EACH ONE PREVENTS. Every column here exists because dropping it converts
-- a refusal into a plausible wrong number — which is worse than either a right
-- number or a visible gap, because nothing on the surface looks wrong.
--
--   peak_headway_is_lower_bound
--     THE MOST IMPORTANT ONE. Peak headway is derived as 3600 / (departures in
--     the busiest clock hour). A stop served once a day therefore stores 3600 —
--     which reads as "a bus every hour". It is not: it is "at most one bus in the
--     busiest hour", a floor. Without this flag a once-a-day rural stop and an
--     hourly suburban route are the same row. DEFAULT true is deliberate and is
--     the whole design: the conservative reading is the one you get by
--     forgetting, and a writer that wants to claim a real headway has to say so.
--
--   median_headway_basis
--     A NULL median has three different meanings — a real median over the span,
--     a span that is mostly unserved, or too few departures for a headway to be
--     an idea at all. Collapsing them makes "we could not say" indistinguishable
--     from "there is nothing here". This is a CLAIM TIER with a closed
--     vocabulary, written as a CHECK so that
--     `an-agent-may-not-promote-a-tier.test.ts` derives it automatically: the
--     guard reads tier vocabularies out of `CHECK (col IN (…))`, and the RTP
--     financial work established that a tier with no column is a tier no guard
--     can see. This one gets a column.
--
--   representative_date
--     "42 trips on a Tuesday" is unauditable without saying WHICH Tuesday the
--     calendar was evaluated on. A planner who disbelieves a number must be able
--     to open the feed and check it. Nullable, because a feed whose calendar
--     yields no service day for a weekday legitimately has none.
--
--   served_hours / span_hours
--     Together they are the difference between service spread across a day and
--     the same trip count bunched into two hours. `served_hours < span_hours`
--     means gaps, and a span alone hides them.
--
--   departures_beyond_bin_range
--     The histogram has 30 hourly bins because GTFS times legitimately run past
--     24:00:00 (BART's last Embarcadero departure is 25:10). Anything past bin 30
--     is counted rather than dropped, so a feed that would lose departures says
--     so instead of quietly under-reporting.
--
-- ALSO RELAXED: `stop_name` and `route_type` were NOT NULL. Both are legitimately
-- absent in real feeds — a stop_times row can reference a stop stops.txt never
-- defines (the ordinary case, per the worker's own GTFS reader), and route_type
-- can be unparseable. NOT NULL there would have forced the persist lane to
-- fabricate a value, which is the failure this whole file is about.
--
-- A NOTE FOR THE PERSIST LANE, recorded here because the column type is where it
-- will bite: `peak_headway_seconds` is 3600/n and is NOT an integer for most n
-- (3600/7 = 514.28…). Round deliberately and state the direction; do not let an
-- implicit cast decide whether a 7-departure hour is 514 or 515 seconds.

BEGIN;

ALTER TABLE public.gtfs_route_service_levels
  ADD COLUMN IF NOT EXISTS representative_date date,
  ADD COLUMN IF NOT EXISTS peak_headway_is_lower_bound boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS median_headway_basis text NOT NULL
    DEFAULT 'not_determined_too_few_departures',
  ADD COLUMN IF NOT EXISTS served_hours integer,
  ADD COLUMN IF NOT EXISTS span_hours integer,
  ADD COLUMN IF NOT EXISTS departures_beyond_bin_range integer NOT NULL DEFAULT 0;

ALTER TABLE public.gtfs_stop_service_levels
  ADD COLUMN IF NOT EXISTS representative_date date,
  ADD COLUMN IF NOT EXISTS peak_headway_is_lower_bound boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS median_headway_basis text NOT NULL
    DEFAULT 'not_determined_too_few_departures',
  ADD COLUMN IF NOT EXISTS served_hours integer,
  ADD COLUMN IF NOT EXISTS span_hours integer,
  ADD COLUMN IF NOT EXISTS departures_beyond_bin_range integer NOT NULL DEFAULT 0;

-- The closed vocabulary, matching GTFS_MEDIAN_HEADWAY_BASES in
-- src/lib/gtfs/types.ts. Kept in step by
-- `gtfs-median-headway-basis-vocabulary-matches-the-database.test.ts`, which
-- parses this SQL — the same shape as the demographics language vocabulary,
-- where TypeScript and the database disagreeing meant the app offered a resident
-- their own language and the database refused the row.
ALTER TABLE public.gtfs_route_service_levels
  DROP CONSTRAINT IF EXISTS gtfs_route_service_levels_median_headway_basis_check;
ALTER TABLE public.gtfs_route_service_levels
  ADD CONSTRAINT gtfs_route_service_levels_median_headway_basis_check
  CHECK (median_headway_basis IN (
    'hourly_average_over_span',
    'not_determined_span_mostly_unserved',
    'not_determined_too_few_departures'
  ));

ALTER TABLE public.gtfs_stop_service_levels
  DROP CONSTRAINT IF EXISTS gtfs_stop_service_levels_median_headway_basis_check;
ALTER TABLE public.gtfs_stop_service_levels
  ADD CONSTRAINT gtfs_stop_service_levels_median_headway_basis_check
  CHECK (median_headway_basis IN (
    'hourly_average_over_span',
    'not_determined_span_mostly_unserved',
    'not_determined_too_few_departures'
  ));

-- Both are legitimately absent in real feeds; see the header.
ALTER TABLE public.gtfs_stop_service_levels ALTER COLUMN stop_name DROP NOT NULL;
ALTER TABLE public.gtfs_route_service_levels ALTER COLUMN route_type DROP NOT NULL;

COMMENT ON COLUMN public.gtfs_stop_service_levels.peak_headway_is_lower_bound IS
  'True when the peak headway is a floor rather than a measurement — 3600/n over '
  'the busiest clock hour, so a once-a-day stop stores 3600 and must not be read '
  'as hourly service. Defaults true so that forgetting to set it under-claims.';

COMMENT ON COLUMN public.gtfs_stop_service_levels.median_headway_basis IS
  'Why the median headway is what it is, including the two ways it is not '
  'determined. A closed vocabulary so the claim-tier guard can derive it.';

COMMIT;
