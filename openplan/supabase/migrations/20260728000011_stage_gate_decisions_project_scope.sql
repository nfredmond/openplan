-- Stage-gate decisions learn what they are about.
--
-- THE DEFECT. `stage_gate_decisions` (20260306000010) carries workspace_id and
-- run_id and nothing else that locates a decision. A gate decision is a
-- judgement about A PROJECT's delivery readiness — "may this project pass G03
-- and proceed" — and the table could not say which project. Every reader
-- therefore queried the whole WORKSPACE and rendered the result on every
-- project's board, so a decision recorded while looking at one project appeared,
-- identically, on all of them. With one project per workspace that reads as
-- correct; with two it is silently wrong, and nothing on screen says so.
--
-- The run reference had the mirror-image gap. It points at `runs` — Analysis
-- Studio only — while the modeling lane a project actually hands its study area
-- down to is `model_runs`, and the county validation lane is `county_runs`. So
-- the one edge that mattered most, "this gate passed BECAUSE of that model run",
-- was the one edge the schema could not express. `report_runs`
-- (20260727000004) already established the shape for citing a run when there are
-- three run tables; this follows it rather than inventing a second convention.
--
-- WHAT IS DELIBERATELY DIFFERENT FROM report_runs: that table requires EXACTLY
-- one run (`num_nonnulls(...) = 1`) because a citation with no run cites
-- nothing. A gate decision may legitimately rest on no run at all — an
-- agreements-and-procurement gate is about executed documents, not about
-- traffic. So the constraint here is AT MOST one: a decision either names the
-- single run it turned on, or names none.
--
-- ON project_id BEING NULLABLE. Additive: the rows already in this table were
-- all written by the report-export path (gate_id = 'report_artifact_gate') and
-- had no project to name. Backfilling them would be invention. NULL means "this
-- decision was recorded before decisions could be about a project", never "this
-- decision is about every project" — which is why readers scope by project_id
-- rather than treating NULL as a wildcard.
--
-- ON template_id. Recorded, not yet filtered on. A gate id is only meaningful
-- inside the template whose vocabulary it comes from, and
-- src/lib/stage-gates/template-registry.ts exists precisely so more than one
-- jurisdiction's pack can be registered. Once two packs use overlapping gate
-- ids, or a workspace rebinds from one pack to another, a decision that does not
-- remember which template it was recorded against becomes unattributable — and
-- unlike the other columns here, that fact cannot be recovered later. So it is
-- captured now and consumed when there is a second pack to disambiguate.
-- It is TEXT and references nothing: templates are code/data artifacts in the
-- registry, not rows.
--
-- Additive only: no drops, no backfill, no data rewritten.

ALTER TABLE public.stage_gate_decisions
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE;

-- ON DELETE CASCADE, unlike run_id's SET NULL, and the difference is the point.
-- A run that loses its project is still a run someone can open; a gate decision
-- that loses its project is a verdict about nothing. Deleting a project that
-- carries decisions is separately REFUSED by
-- src/lib/projects/project-delete-preconditions.ts, which names them in the
-- refusal — so this cascade is the floor beneath that rule, not the ordinary
-- path.

ALTER TABLE public.stage_gate_decisions
  ADD COLUMN IF NOT EXISTS model_run_id UUID REFERENCES public.model_runs(id) ON DELETE SET NULL;

ALTER TABLE public.stage_gate_decisions
  ADD COLUMN IF NOT EXISTS county_run_id UUID REFERENCES public.county_runs(id) ON DELETE SET NULL;

-- SET NULL, matching run_id: a recorded decision and its stated rationale are
-- governance history and must survive the deletion of the evidence they cite.
-- The citation is dropped; the judgement, and the fact that it was made, are
-- not. A decision whose citation has gone reads as a decision with no run, which
-- is exactly what it has become.

ALTER TABLE public.stage_gate_decisions
  ADD COLUMN IF NOT EXISTS template_id TEXT;

-- Whether a run belongs to a workspace. There is a helper for the model/county
-- pair already (modeling_evidence_target_matches_workspace, 20260424000069) and
-- none for `runs`; this fills that gap in the same shape rather than leaving one
-- of the three run references unconstrained, which would read as an oversight to
-- the next person and behave as one to an attacker.
--
-- Plain STABLE SQL, not SECURITY DEFINER, and not used in any RLS policy — the
-- same posture as run_project_matches_workspace (20260727000003).
CREATE OR REPLACE FUNCTION public.run_matches_workspace(
  p_workspace_id UUID,
  p_run_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT
    p_run_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.runs r
      WHERE r.id = p_run_id
        AND r.workspace_id = p_workspace_id
    );
$$;

REVOKE ALL ON FUNCTION public.run_matches_workspace(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_matches_workspace(UUID, UUID) TO authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stage_gate_decisions_project_workspace_match'
  ) THEN
    ALTER TABLE public.stage_gate_decisions
      ADD CONSTRAINT stage_gate_decisions_project_workspace_match
      CHECK (public.run_project_matches_workspace(workspace_id, project_id));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stage_gate_decisions_run_workspace_match'
  ) THEN
    ALTER TABLE public.stage_gate_decisions
      ADD CONSTRAINT stage_gate_decisions_run_workspace_match
      CHECK (
        public.run_matches_workspace(workspace_id, run_id)
        AND public.modeling_evidence_target_matches_workspace(workspace_id, model_run_id, county_run_id)
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stage_gate_decisions_single_run_citation'
  ) THEN
    ALTER TABLE public.stage_gate_decisions
      ADD CONSTRAINT stage_gate_decisions_single_run_citation
      CHECK (num_nonnulls(run_id, model_run_id, county_run_id) <= 1);
  END IF;
END
$$;

-- The read every board does: this project's decisions, newest first. Partial,
-- because the pre-existing rows carry no project and indexing them here would
-- index a column nothing queries by.
CREATE INDEX IF NOT EXISTS idx_stage_gate_decisions_project_time
  ON public.stage_gate_decisions (project_id, decided_at DESC)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stage_gate_decisions_model_run
  ON public.stage_gate_decisions (model_run_id)
  WHERE model_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stage_gate_decisions_county_run
  ON public.stage_gate_decisions (county_run_id)
  WHERE county_run_id IS NOT NULL;

COMMENT ON COLUMN public.stage_gate_decisions.project_id IS
  'The project this gate decision is about. NULL only on rows recorded before decisions could name a project; it never means "all projects".';

COMMENT ON COLUMN public.stage_gate_decisions.template_id IS
  'The stage-gate template whose vocabulary gate_id was drawn from. NULL for rows recorded before templates were stamped.';

-- NO NEW RLS POLICIES, and that is a decision rather than an omission.
--
-- This table is written through the CALLER's client, so it needs a PERMISSIVE
-- policy for every command that path uses. The path uses exactly one: INSERT.
-- A stage-gate decision log is append-only — a recorded PASS that was wrong is
-- corrected by recording the HOLD that supersedes it, never by editing the
-- verdict someone signed. So there is deliberately no UPDATE and no DELETE
-- policy, and no route that would need one.
--
-- The two policies from 20260306000010 remain sufficient and unchanged:
-- stage_gate_decisions_read (SELECT, workspace membership) and
-- stage_gate_decisions_insert (INSERT, decided_by = auth.uid() AND membership).
-- The viewer tier is already denied at the database by the RESTRICTIVE gates
-- 20260728000006 created for this table, so a read-only member cannot record a
-- decision even holding the anon key directly.
--
-- The new columns are constrained by CHECKs rather than by policy predicates on
-- purpose: a CHECK binds service_role too, and cross-workspace citation is a
-- data-integrity rule, not an authorization one.
