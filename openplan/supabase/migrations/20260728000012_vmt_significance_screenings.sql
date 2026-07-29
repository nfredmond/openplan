-- Persisted VMT significance screenings.
--
-- WHAT WAS WRONG. The VMT significance screen is the one DETERMINATION-shaped
-- output in the product: a planner sets a reference baseline and a percent-below
-- threshold, and the screen answers "potentially significant" or "less than
-- significant". Until this migration that answer was computed in the browser,
-- rendered, and thrown away on navigation. Nothing could cite it — not a report,
-- not a stage gate, not a grant narrative — which is every place a determination
-- actually matters. Two planners could screen the same run a week apart, get
-- different answers because one changed the reference, and the record of which
-- was issued when did not exist.
--
-- Append-only, because a determination is a HISTORICAL FACT: it was issued, on
-- that day, from those inputs, under that framework, at that claim tier. Editing
-- one after the fact would rewrite what an agency relied on. The shape follows
-- `project_bca_screenings` (20260718000089) — inputs + server-recomputed result +
-- engine version + a DISTINCT ON latest view — rather than inventing a second
-- one.
--
-- WHY THE TABLE IS NOT CALLED `ceqa_*`. CEQA §15064.3 is California law. A VMT
-- significance determination under it is meaningless in Ohio, and OpenPlan must
-- work for any agency anywhere. So the framework is a REGISTRY ENTRY
-- (src/lib/planner-pack/vmt-significance-frameworks.ts, descriptors under
-- `frameworks/`), exactly as `src/lib/invoicing/profiles/` handles Caltrans LAPM
-- reimbursement, and this table records WHICH framework and WHICH jurisdiction a
-- row was computed under instead of assuming one. Registering a second
-- jurisdiction's framework adds a descriptor file; it does not touch this schema.
--
-- WHY THE CLAIM TIER IS A COLUMN. `src/lib/models/evidence-backbone.ts` ranks
-- four claim tiers, and the repo's own record documents sketch-ABM VMT running
-- ~56% below the CARB reference — a number that would have produced a false
-- "less than significant". A determination that travels without the tier it was
-- computed at is exactly that overclaim, so the tier is stored ALONGSIDE the
-- determination and never derived later from whatever the run's evidence says
-- today. `claim_status` is NULLABLE on purpose: when no modeling_claim_decisions
-- row exists for the run, the honest answer is "not recorded", not a plausible
-- default tier.
--
-- WHY `input_basis`. The screen accepts an opt-in CALIBRATED (count-tuned) VMT
-- that is a different number from the screening VMT. Which one drove a stored
-- determination has to be readable from the row itself, or a calibrated-basis
-- determination becomes indistinguishable from the screening default the moment
-- it leaves the screen.

CREATE TABLE IF NOT EXISTS public.vmt_significance_screenings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  -- The run the determination was computed from. Exactly one of the two is set:
  -- the same screen serves model runs and county runs, and the modeling evidence
  -- spine (modeling_source_manifests / modeling_validation_results /
  -- modeling_claim_decisions, 20260424000069) already carries both this way, so
  -- following it keeps one shape rather than adding a third.
  model_run_id UUID REFERENCES public.model_runs(id) ON DELETE CASCADE,
  county_run_id UUID REFERENCES public.county_runs(id) ON DELETE CASCADE,

  -- WHICH RULES. framework_name/version are denormalized deliberately: a
  -- descriptor can be revised or retired, and a determination must still read
  -- years later as the thing that was actually issued.
  framework_id TEXT NOT NULL,
  framework_name TEXT NOT NULL,
  framework_version TEXT NOT NULL,

  -- WHERE THOSE RULES APPLY. ISO 3166-1 alpha-2 country, ISO 3166-2 subdivision
  -- part without the country prefix ("CA", not "US-CA"), plus the label a
  -- planner reads. Nullable subdivision is meaningful — a nationwide framework,
  -- or a geography that spans subdivisions.
  jurisdiction_country TEXT NOT NULL,
  jurisdiction_subdivision TEXT,
  jurisdiction_label TEXT NOT NULL,
  -- How the jurisdiction was learned. One value today because OpenPlan learns it
  -- in exactly one way (the workspace's home geography, via resolveJurisdiction);
  -- an explicit per-screening selector would add a value here rather than a
  -- nullable "maybe chosen" flag.
  jurisdiction_basis TEXT NOT NULL
    CHECK (jurisdiction_basis IN ('workspace_home_geography')),

  -- WHAT IT MAY BE CLAIMED AS. Same vocabulary as
  -- modeling_claim_decisions.claim_status (20260721000002), so the two rank
  -- against each other without translation.
  claim_status TEXT
    CHECK (claim_status IN (
      'claim_grade_passed',
      'calibrated_to_counts',
      'screening_grade',
      'prototype_only'
    )),
  claim_status_source TEXT NOT NULL
    CHECK (claim_status_source IN ('recorded_claim_decision', 'not_recorded')),

  -- WHAT IT WAS COMPUTED FROM.
  input_basis TEXT NOT NULL CHECK (input_basis IN ('screening', 'calibrated')),
  vmt_kpi_name TEXT NOT NULL,
  population_kpi_name TEXT,
  scenario_id TEXT NOT NULL,

  -- THE DETERMINATION, and the arithmetic that produced it. Stored as columns as
  -- well as inside result_json so a report or a stage gate can filter on them
  -- without unpacking JSON.
  determination TEXT NOT NULL
    CHECK (determination IN ('less_than_significant', 'potentially_significant')),
  mitigation_required BOOLEAN NOT NULL,
  vmt_per_capita NUMERIC NOT NULL,
  threshold_vmt_per_capita NUMERIC NOT NULL,
  reference_vmt_per_capita NUMERIC NOT NULL CHECK (reference_vmt_per_capita > 0),
  threshold_pct NUMERIC NOT NULL CHECK (threshold_pct > 0 AND threshold_pct < 1),
  reference_label TEXT NOT NULL,
  project_type TEXT NOT NULL,

  inputs_json JSONB NOT NULL,
  result_json JSONB NOT NULL,
  engine_version TEXT NOT NULL,

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT vmt_significance_screenings_one_subject CHECK (
    (model_run_id IS NOT NULL AND county_run_id IS NULL)
    OR (model_run_id IS NULL AND county_run_id IS NOT NULL)
  ),

  -- A tier and its provenance must agree. Without this, a row could claim
  -- 'not_recorded' while carrying a tier (or the reverse), and the disclosure the
  -- tier exists for would be unreadable.
  CONSTRAINT vmt_significance_screenings_claim_status_coherent CHECK (
    (claim_status_source = 'recorded_claim_decision' AND claim_status IS NOT NULL)
    OR (claim_status_source = 'not_recorded' AND claim_status IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS vmt_significance_screenings_model_run_idx
  ON public.vmt_significance_screenings(model_run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS vmt_significance_screenings_county_run_idx
  ON public.vmt_significance_screenings(county_run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS vmt_significance_screenings_workspace_idx
  ON public.vmt_significance_screenings(workspace_id, created_at DESC);

ALTER TABLE public.vmt_significance_screenings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'vmt_significance_screenings'
      AND policyname = 'vmt_significance_screenings_member_read'
  ) THEN
    CREATE POLICY vmt_significance_screenings_member_read
      ON public.vmt_significance_screenings
      FOR SELECT USING (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

-- The write policy is ROLE-AWARE rather than membership-only, so it needs no
-- companion RESTRICTIVE gate from 20260728000006/7. The viewer tier's contract
-- is "read everything, change nothing"; `workspace_member_can_write` is the
-- shared, fail-closed predicate that makes that true at the database, and
-- issuing a significance determination is unambiguously a write.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'vmt_significance_screenings'
      AND policyname = 'vmt_significance_screenings_writer_insert'
  ) THEN
    CREATE POLICY vmt_significance_screenings_writer_insert
      ON public.vmt_significance_screenings
      FOR INSERT WITH CHECK (
        public.workspace_member_can_write(workspace_id)
        AND created_by = auth.uid()
      );
  END IF;
END
$$;

REVOKE ALL ON TABLE public.vmt_significance_screenings FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.vmt_significance_screenings TO authenticated;
GRANT ALL ON TABLE public.vmt_significance_screenings TO service_role;

COMMENT ON TABLE public.vmt_significance_screenings IS
  'Append-only VMT significance determinations. Each row records the determination, the run it came from, the framework and jurisdiction it was issued under, the modeling claim tier at the time, whether screening or calibrated VMT drove it, and the thresholds used. Screening-grade support for a lead agency''s own finding — never a determination of record. Workspace members read; writing members insert; nothing updates or deletes.';

COMMENT ON COLUMN public.vmt_significance_screenings.claim_status IS
  'The modeling claim tier recorded for the run when this determination was issued, or NULL when no modeling_claim_decisions row existed (claim_status_source = ''not_recorded''). Stored rather than derived, so a later re-tiering cannot silently restate what was issued.';

COMMENT ON COLUMN public.vmt_significance_screenings.jurisdiction_basis IS
  'How the jurisdiction was established. ''workspace_home_geography'' is the only value today: OpenPlan reads it from the workspace''s stated home geography and refuses to issue a determination when no registered framework covers that jurisdiction.';

COMMENT ON COLUMN public.vmt_significance_screenings.input_basis IS
  '''screening'' = the default uncalibrated screening VMT KPI. ''calibrated'' = the opt-in count-tuned VMT from the demand-nudge stage, a distinct disclosed basis. Which one drove the determination must be readable from the row itself.';

-- Latest determination per run. The saved history is append-only, so a
-- report or a stage gate asking "what is the current determination for this run"
-- would otherwise have to order and slice the whole history per run. security_invoker
-- so the querying member's RLS on the base table still applies.
--
-- DISTINCT ON coalesces the two subject columns because exactly one is set (see
-- the one-subject CHECK): the pair is the run identity, not two independent keys.
CREATE OR REPLACE VIEW public.vmt_significance_screenings_latest
  WITH (security_invoker = true) AS
  SELECT DISTINCT ON (coalesce(model_run_id, county_run_id))
    id,
    workspace_id,
    model_run_id,
    county_run_id,
    framework_id,
    framework_name,
    framework_version,
    jurisdiction_country,
    jurisdiction_subdivision,
    jurisdiction_label,
    jurisdiction_basis,
    claim_status,
    claim_status_source,
    input_basis,
    vmt_kpi_name,
    population_kpi_name,
    scenario_id,
    determination,
    mitigation_required,
    vmt_per_capita,
    threshold_vmt_per_capita,
    reference_vmt_per_capita,
    threshold_pct,
    reference_label,
    project_type,
    inputs_json,
    result_json,
    engine_version,
    created_by,
    created_at
  FROM public.vmt_significance_screenings
  ORDER BY coalesce(model_run_id, county_run_id), created_at DESC;

REVOKE ALL ON public.vmt_significance_screenings_latest FROM PUBLIC, anon;
GRANT SELECT ON public.vmt_significance_screenings_latest TO authenticated;
GRANT ALL ON public.vmt_significance_screenings_latest TO service_role;

COMMENT ON VIEW public.vmt_significance_screenings_latest IS
  'Newest vmt_significance_screenings row per run (DISTINCT ON the coalesced model_run_id/county_run_id subject). security_invoker so base-table RLS applies. Backs "what is the current determination for this run" without a row cap over an append-only history.';
