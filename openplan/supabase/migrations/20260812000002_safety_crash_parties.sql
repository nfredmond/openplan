-- People, not just collisions.
--
-- ============================================================================
-- WHY THIS TABLE EXISTS
-- ============================================================================
--
-- The crash-level involvement flags UNDERCOUNT the road users this module exists
-- to protect. Probed against one state's live 2025 file on 2026-08-11:
--
--     crash-level 'BICYCLE' flag           10,221 collisions
--     collisions with a bicyclist party    11,944 collisions   (+16.9%)
--     crash-level 'PEDESTRIAN' flag        12,789 collisions
--     collisions with a pedestrian party   13,177 collisions   (+3.0%)
--     collisions involving a motorcycle    12,513 collisions   (no crash-level flag at all)
--
-- So every vulnerable-road-user figure this product has published is low, and
-- motorcyclists have been invisible. Person rows also answer the question a
-- safety action plan is actually written around — outcomes by role and age band
-- — which no crash-level count can express.
--
-- ROWS, NOT A JSONB SUMMARY ON THE CRASH. A summary cannot answer "pedestrian
-- fatalities among people 65 or older", and a summary computed at ingest freezes
-- the age banding, so changing a band would mean re-ingesting every workspace.
-- Volume is unremarkable: measured at 1.95 parties per crash, a rural county
-- decade is roughly 23,000 rows and a large metropolitan decade roughly 1.2M,
-- and the existing 50,000-record ingest ceiling bounds any single run.
--
-- ============================================================================
-- WHAT IS DELIBERATELY ABSENT, AND WHY EACH REFUSAL IS THE DESIGN
-- ============================================================================
--
-- These columns exist in the source and are never requested — refused in the
-- SELECT, not merely left off a screen, because a field that is fetched reaches
-- a log, a cache and an error message. `src/test/refused-crash-person-fields.test.ts`
-- fails the build if one is added.
--
--   * RACE / ETHNICITY. Both source tables carry it. A race field on an
--     individual victim beside a precise coordinate and date is an
--     identification vector, and crash-level race is not a valid basis for the
--     Title VI analysis this platform already does correctly from tract
--     demographics.
--   * SEX / GENDER. Refused this release. Some safety plans report victims by
--     sex; adding it is one column and one enum, and it is a deliberate change
--     to the PII posture rather than a gap to fill in quietly.
--   * EXACT AGE. Banded inside the adapter. The integer never reaches this
--     table, a response, or a log. Age plus coordinate plus date identifies a
--     person in a small town.
--   * VEHICLE IDENTITY (make, model, colour, year). A car description plus a
--     date and a coordinate identifies a household. The vehicle TYPE is read
--     once, to separate a motorcyclist from a driver, and is not stored raw.
--   * IMPAIRMENT AND FAULT (sobriety/drug findings, at-fault, hit-and-run,
--     drug-recognition-evaluation flags). Pre-adjudication allegations about
--     identifiable people. No reader, and no defensible one.
--   * LICENCE class and issuing state; SEAT POSITION, EJECTION, AIRBAG and
--     SAFETY-EQUIPMENT detail; VICTIM-SERVICES notification flags.
--   * CASE-FILE IDENTIFIERS (report number, evidence number, beat, reporting
--     district, judicial district, photograph/media flags). They are the key
--     back into the police file.
--
-- Kept: the party's role, an age BAND, an injury outcome, and the source's own
-- ids as keys.
--
-- ONE HARD CONSTRAINT ON TOP OF RLS: no party row may reach a public or
-- anonymous surface, ever — not the public engagement pages, not a printable
-- URL, not a survey export. Role plus age band plus injury next to a precise
-- point and date is quasi-identifying in a small town. `anon` is granted
-- nothing below, and that is the enforcement, not the intention.

------------------------------------------------------------------------------
-- 1. TABLE
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.safety_crash_parties (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- CASCADE from the crash: a person with no collision is not a record of
  -- anything, and an orphan person row is exactly the shape that leaks.
  crash_id            uuid NOT NULL REFERENCES public.safety_crashes(id) ON DELETE CASCADE,
  ingest_id           uuid NOT NULL REFERENCES public.safety_crash_ingests(id) ON DELETE CASCADE,

  -- Same closed domain as safety_crashes.source_id: persisted coverage advances
  -- by migration while read coverage advances by registering an adapter.
  source_id           text NOT NULL CHECK (source_id IN ('ccrs-ca')),
  -- The source's own per-person key (typically case id + party number), which is
  -- what makes re-ingest idempotent at person level rather than duplicative.
  external_party_id   text NOT NULL,

  -- Neutral vocabulary, declared once in src/lib/safety/vocabulary.ts. Named for
  -- the physical fact, never for one jurisdiction's spelling.
  party_role          text NOT NULL CHECK (party_role IN (
    'driver','passenger','pedestrian','bicyclist','motorcyclist',
    'parked_vehicle','other','unknown'
  )),
  -- ONE banding everywhere, so counts from different surfaces compare.
  age_band            text NOT NULL CHECK (age_band IN (
    'under_15','15_24','25_44','45_64','65_plus','unknown'
  )),
  -- A person's outcome is a different measurement from the crash's severity
  -- band: a fatal crash contains people who were not hurt. 'unknown' is the
  -- default for a person the source coded no outcome for — never
  -- 'no_apparent_injury', which would turn an unanswered question into a finding.
  person_injury       text NOT NULL DEFAULT 'unknown' CHECK (person_injury IN (
    'fatal','suspected_serious','suspected_minor','possible','no_apparent_injury','unknown'
  )),

  -- Source spellings the descriptor does not declare, kept verbatim rather than
  -- dropped. Read only inside src/lib/safety/sources/**.
  source_attributes   jsonb NOT NULL DEFAULT '{}'::jsonb,

  ingested_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT safety_crash_parties_source_external_uniq
    UNIQUE (workspace_id, source_id, external_party_id)
);

-- The two access paths that exist: everything for one crash (the inspector), and
-- the workspace-wide role/outcome rollup the evidence shape and the RTP safety
-- criterion read. No index per dimension — see 20260812000001's header.
CREATE INDEX IF NOT EXISTS idx_safety_crash_parties_crash
  ON public.safety_crash_parties (crash_id);
CREATE INDEX IF NOT EXISTS idx_safety_crash_parties_workspace_role
  ON public.safety_crash_parties (workspace_id, party_role);
CREATE INDEX IF NOT EXISTS idx_safety_crash_parties_ingest
  ON public.safety_crash_parties (ingest_id);

------------------------------------------------------------------------------
-- 2. RLS — members read; every write is a service-role API route.
------------------------------------------------------------------------------
ALTER TABLE public.safety_crash_parties ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'safety_crash_parties'
      AND policyname = 'safety_crash_parties_read'
  ) THEN
    CREATE POLICY safety_crash_parties_read ON public.safety_crash_parties FOR SELECT USING (
      EXISTS (SELECT 1 FROM public.workspace_members wm
              WHERE wm.workspace_id = safety_crash_parties.workspace_id AND wm.user_id = auth.uid()));
  END IF;
END $$;

------------------------------------------------------------------------------
-- 3. GRANTS — required, and revoked first.
------------------------------------------------------------------------------
-- This table is created AFTER 20260804000001 flipped default privileges to deny,
-- so it is born with nothing for the client roles. A permissive policy with no
-- matching GRANT is a door with no handle: PostgREST answers `permission denied`
-- before RLS is ever consulted, which is exactly how the v0.14.0 notification
-- inbox shipped unusable. `a-policy-without-a-grant-is-a-locked-door.test.ts`
-- now fails the build for it.
--
-- The revoke runs first and that is not cosmetic: Postgres drops column
-- privileges along with table-level ones, so a revoke after a grant destroys it.
-- It also records the INSERT/UPDATE/DELETE denial in the migration corpus, where
-- the grant-composition guard can see a future blanket GRANT widening it.
--
-- `anon` gets nothing, permanently. See the header: a person's role, age band
-- and injury outcome beside a precise coordinate and date is quasi-identifying,
-- and `anon` is the role every public engagement surface runs as.
REVOKE ALL ON TABLE public.safety_crash_parties FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.safety_crash_parties TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.safety_crash_parties TO service_role;

COMMENT ON TABLE public.safety_crash_parties IS
  'One person in one observed collision: neutral role, age BAND, injury outcome. No name, race, sex, exact age, licence, vehicle identity, impairment or fault allegation, or case-file identifier — those are refused in the source query, not merely undisplayed (src/test/refused-crash-person-fields.test.ts). Never reachable by anon.';
