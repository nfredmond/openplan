-- Source candidate only. Apply and exercise transaction/RLS/recovery in isolation before rollout.
-- One receipt owns all six append-only drafts. A response loss replays the receipt;
-- a transaction failure rolls back the receipt and every draft together.
CREATE TABLE public.funding_opportunity_safety_seeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES public.funding_opportunities(id) ON DELETE CASCADE,
  artifact_id uuid NOT NULL REFERENCES public.report_artifacts(id),
  preview_hash text NOT NULL CHECK (preview_hash ~ '^[a-f0-9]{64}$'),
  draft_ids uuid[] NOT NULL CHECK (cardinality(draft_ids) = 6),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (opportunity_id, preview_hash)
);
CREATE INDEX funding_opportunity_safety_seeds_workspace_idx ON public.funding_opportunity_safety_seeds(workspace_id);
ALTER TABLE public.funding_opportunity_safety_seeds ENABLE ROW LEVEL SECURITY;
CREATE POLICY safety_seeds_member_read ON public.funding_opportunity_safety_seeds FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = funding_opportunity_safety_seeds.workspace_id AND m.user_id = (SELECT auth.uid())));
REVOKE ALL ON public.funding_opportunity_safety_seeds FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.funding_opportunity_safety_seeds TO authenticated;
GRANT ALL ON public.funding_opportunity_safety_seeds TO service_role;

ALTER TABLE public.funding_opportunity_section_drafts
  ADD COLUMN origin text NOT NULL DEFAULT 'ai' CHECK (origin IN ('ai', 'safety_plan_seed')),
  ADD COLUMN safety_seed_id uuid REFERENCES public.funding_opportunity_safety_seeds(id),
  ADD CONSTRAINT safety_seed_origin_consistent CHECK ((origin = 'safety_plan_seed') = (safety_seed_id IS NOT NULL));

CREATE FUNCTION public.guard_safety_seed_draft_origin() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF (NEW.origin <> 'ai' OR NEW.safety_seed_id IS NOT NULL) AND current_user NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'Code-built Safety drafts require the authorized user-operated server route' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_safety_seed_draft_origin() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_safety_seed_draft_origin BEFORE INSERT OR UPDATE ON public.funding_opportunity_section_drafts
  FOR EACH ROW EXECUTE FUNCTION public.guard_safety_seed_draft_origin();

-- A separate immutable custody row is written after all three known persistence
-- effects. It has no aggregate-project touch trigger, so recording P3 cannot make
-- P4. Existing evidence triggers remain enabled and unchanged.
CREATE TABLE public.report_safety_snapshot_persistence (
  artifact_id uuid PRIMARY KEY REFERENCES public.report_artifacts(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  report_id uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  schema_version text NOT NULL DEFAULT 'openplan.safety-plan-persistence.v1'
    CHECK (schema_version = 'openplan.safety-plan-persistence.v1'),
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
  source_project_updated_at timestamptz NOT NULL,
  persisted_project_updated_at timestamptz NOT NULL,
  source_report_updated_at timestamptz NOT NULL,
  report_updated_at timestamptz NOT NULL,
  CHECK (persisted_project_updated_at > source_project_updated_at)
);
CREATE INDEX report_safety_snapshot_persistence_workspace_idx ON public.report_safety_snapshot_persistence(workspace_id);
ALTER TABLE public.report_safety_snapshot_persistence ENABLE ROW LEVEL SECURITY;
CREATE POLICY report_safety_snapshot_persistence_member_read ON public.report_safety_snapshot_persistence FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = report_safety_snapshot_persistence.workspace_id AND m.user_id = (SELECT auth.uid())));
REVOKE ALL ON public.report_safety_snapshot_persistence FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.report_safety_snapshot_persistence TO authenticated;
GRANT SELECT, INSERT ON public.report_safety_snapshot_persistence TO service_role;
-- PostgreSQL requires UPDATE privilege on at least one column for FOR SHARE.
-- This column grant permits the lock; the immutable trigger still rejects every
-- actual custody-row update, including a service-role update.
GRANT UPDATE (artifact_id) ON public.report_safety_snapshot_persistence TO service_role;

CREATE FUNCTION public.guard_safety_snapshot_persistence() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Safety generation custody is immutable; regenerate a new artifact' USING ERRCODE = '23514';
END;
$$;
REVOKE ALL ON FUNCTION public.guard_safety_snapshot_persistence() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_safety_snapshot_persistence BEFORE UPDATE ON public.report_safety_snapshot_persistence
  FOR EACH ROW EXECUTE FUNCTION public.guard_safety_snapshot_persistence();

-- Lock and compare P0 BEFORE any own write, then keep the lock until the custody
-- row records P3. A genuine source edit before persistence refuses P0; a later
-- edit advances beyond P3. No caller-supplied current revision can authorize it.
CREATE FUNCTION public.persist_safety_plan_generation(p_actor uuid, p_artifact jsonb, p_report_update jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_snapshot jsonb := p_artifact->'metadata_json'->'safetyPlanSnapshotV1';
  v_project public.projects%ROWTYPE;
  v_report public.reports%ROWTYPE;
  v_receipt public.report_safety_snapshot_persistence%ROWTYPE;
  v_report_updated_at timestamptz;
  v_project_updated_at timestamptz;
  v_report_id uuid := (v_snapshot->>'reportId')::uuid;
  v_artifact_id uuid := (v_snapshot->>'artifactId')::uuid;
BEGIN
  IF current_user NOT IN ('service_role', 'postgres') OR p_actor IS NULL THEN
    RAISE EXCEPTION 'Authorized generation server actor required' USING ERRCODE = '42501';
  END IF;
  IF v_snapshot IS NULL OR v_snapshot->>'version' IS DISTINCT FROM 'openplan.safety-plan-snapshot.v1'
    OR v_snapshot->>'hash' IS NULL OR v_snapshot->>'hash' !~ '^[a-f0-9]{64}$'
    OR p_artifact->>'id' IS DISTINCT FROM v_artifact_id::text
    OR p_artifact->>'report_id' IS DISTINCT FROM v_report_id::text
    OR p_artifact->>'generated_by' IS DISTINCT FROM p_actor::text
    OR p_artifact->>'artifact_kind' NOT IN ('html','pdf')
    OR (p_artifact->>'generated_at')::timestamptz IS DISTINCT FROM (v_snapshot->>'generatedAt')::timestamptz
    OR p_artifact->'metadata_json'->'generationWriteback' IS DISTINCT FROM 'null'::jsonb
    OR NOT (p_report_update ?& ARRAY['status','generated_at','latest_artifact_kind','latest_artifact_url','metadata_json','rtp_basis_stale','rtp_basis_stale_reason','rtp_basis_stale_run_id','rtp_basis_stale_marked_at'])
    OR p_report_update - ARRAY['status','generated_at','latest_artifact_kind','latest_artifact_url','metadata_json','rtp_basis_stale','rtp_basis_stale_reason','rtp_basis_stale_run_id','rtp_basis_stale_marked_at'] <> '{}'::jsonb
    OR p_report_update->>'status' IS DISTINCT FROM 'generated'
    OR p_report_update->>'latest_artifact_kind' IS DISTINCT FROM p_artifact->>'artifact_kind'
    OR (p_report_update->>'generated_at')::timestamptz IS DISTINCT FROM (v_snapshot->>'generatedAt')::timestamptz THEN
    RAISE EXCEPTION 'Safety generation payload does not match the frozen snapshot' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO STRICT v_project FROM public.projects
    WHERE id = (v_snapshot->>'projectId')::uuid AND workspace_id = (v_snapshot->>'workspaceId')::uuid FOR UPDATE;
  PERFORM 1 FROM public.workspace_members WHERE workspace_id = v_project.workspace_id
    AND user_id = p_actor AND role IN ('owner','admin','member') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Current generation writer required' USING ERRCODE = '42501'; END IF;
  IF v_project.updated_at IS DISTINCT FROM (v_snapshot->>'projectUpdatedAt')::timestamptz THEN
    RAISE EXCEPTION 'Project source changed before Safety persistence' USING ERRCODE = '40001';
  END IF;
  SELECT * INTO STRICT v_report FROM public.reports WHERE id = v_report_id
    AND project_id = v_project.id AND workspace_id = v_project.workspace_id FOR UPDATE;
  IF v_report.updated_at IS DISTINCT FROM (v_snapshot->>'reportUpdatedAt')::timestamptz THEN
    RAISE EXCEPTION 'Report source changed before Safety persistence' USING ERRCODE = '40001';
  END IF;
  INSERT INTO public.report_artifacts(id, report_id, artifact_kind, storage_path, generated_by, generated_at, metadata_json)
    VALUES (v_artifact_id, v_report_id, p_artifact->>'artifact_kind', p_artifact->>'storage_path', p_actor,
      (p_artifact->>'generated_at')::timestamptz, p_artifact->'metadata_json');
  UPDATE public.reports SET status = 'generated', generated_at = (p_report_update->>'generated_at')::timestamptz,
    latest_artifact_kind = p_report_update->>'latest_artifact_kind', latest_artifact_url = p_report_update->>'latest_artifact_url',
    metadata_json = p_report_update->'metadata_json', rtp_basis_stale = false,
    rtp_basis_stale_reason = NULL, rtp_basis_stale_run_id = NULL, rtp_basis_stale_marked_at = NULL
    WHERE id = v_report_id RETURNING updated_at INTO STRICT v_report_updated_at;
  UPDATE public.report_artifacts SET metadata_json = jsonb_set(p_artifact->'metadata_json', '{generationWriteback}',
    jsonb_build_object('schema','openplan.report-generation-writeback.v1','reportUpdatedAt',v_report_updated_at))
    WHERE id = v_artifact_id AND report_id = v_report_id;
  -- All inherited AFTER ROW trigger effects have completed before this read.
  SELECT updated_at INTO STRICT v_project_updated_at FROM public.projects WHERE id = v_project.id;
  INSERT INTO public.report_safety_snapshot_persistence(artifact_id, workspace_id, project_id, report_id, snapshot_hash,
    source_project_updated_at, persisted_project_updated_at, source_report_updated_at, report_updated_at)
    VALUES (v_artifact_id, v_project.workspace_id, v_project.id, v_report_id, v_snapshot->>'hash',
      v_project.updated_at, v_project_updated_at, v_report.updated_at, v_report_updated_at) RETURNING * INTO v_receipt;
  RETURN to_jsonb(v_receipt);
END;
$$;
REVOKE ALL ON FUNCTION public.persist_safety_plan_generation(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_safety_plan_generation(uuid, jsonb, jsonb) TO service_role;

-- Service-only and SECURITY INVOKER: the route validates and code-builds the payload;
-- this transaction rechecks current attributed membership, sources and revisions.
CREATE FUNCTION public.apply_ss4a_safety_seed(p_actor uuid, p_rows jsonb, p_preview_hash text, p_sections jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_opportunity public.funding_opportunities%ROWTYPE;
  v_current jsonb;
  v_section public.funding_opportunity_application_sections%ROWTYPE;
  v_expected jsonb;
  v_receipt public.funding_opportunity_safety_seeds%ROWTYPE;
  v_draft jsonb;
  v_ids uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  v_index integer := 0;
  v_count integer := 0;
  v_keys text[] := ARRAY['project-overview','safety-problem-and-impact','equity-and-underserved-communities','engagement-and-collaboration','implementation-and-capacity','budget-narrative'];
BEGIN
  IF current_user NOT IN ('service_role', 'postgres') OR p_actor IS NULL THEN
    RAISE EXCEPTION 'Authorized server actor required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO STRICT v_opportunity FROM public.funding_opportunities
    WHERE id = (p_rows->'opportunity'->>'id')::uuid FOR UPDATE;
  PERFORM 1 FROM public.workspace_members WHERE workspace_id = v_opportunity.workspace_id
    AND user_id = p_actor AND role IN ('owner','admin','member') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Current workspace writer required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_receipt FROM public.funding_opportunity_safety_seeds
    WHERE opportunity_id = v_opportunity.id AND preview_hash = p_preview_hash;
  IF FOUND THEN
    IF v_receipt.artifact_id <> (p_rows->'artifact'->>'id')::uuid OR
      (SELECT count(*) FROM public.funding_opportunity_section_drafts WHERE safety_seed_id = v_receipt.id AND id = ANY(v_receipt.draft_ids)) <> 6 THEN
      RAISE EXCEPTION 'Incomplete retained seed receipt; no partial replay' USING ERRCODE = '40001';
    END IF;
    RETURN to_jsonb(v_receipt);
  END IF;
  IF v_opportunity.pursuit_kind <> 'grant' OR v_opportunity.project_id IS NULL OR
    EXISTS (SELECT FROM jsonb_each(p_rows->'opportunity') e WHERE to_jsonb(v_opportunity)->e.key IS DISTINCT FROM e.value) THEN
    RAISE EXCEPTION 'Opportunity changed' USING ERRCODE = '40001';
  END IF;
  SELECT to_jsonb(p) INTO v_current FROM public.projects p WHERE p.id = v_opportunity.project_id AND p.workspace_id = v_opportunity.workspace_id FOR SHARE;
  IF NOT FOUND OR EXISTS (SELECT FROM jsonb_each(p_rows->'project') e WHERE v_current->e.key IS DISTINCT FROM e.value) THEN
    RAISE EXCEPTION 'Project changed' USING ERRCODE = '40001';
  END IF;
  SELECT to_jsonb(r) INTO v_current FROM public.reports r WHERE r.id = (p_rows->'report'->>'id')::uuid
    AND r.project_id = v_opportunity.project_id AND r.workspace_id = v_opportunity.workspace_id FOR SHARE;
  IF NOT FOUND OR EXISTS (SELECT FROM jsonb_each(p_rows->'report') e WHERE v_current->e.key IS DISTINCT FROM e.value) THEN
    RAISE EXCEPTION 'Report changed' USING ERRCODE = '40001';
  END IF;
  SELECT to_jsonb(a) INTO v_current FROM public.report_artifacts a WHERE a.id = (p_rows->'artifact'->>'id')::uuid
    AND a.report_id = (p_rows->'report'->>'id')::uuid FOR SHARE;
  IF NOT FOUND OR EXISTS (SELECT FROM jsonb_each(p_rows->'artifact') e WHERE v_current->e.key IS DISTINCT FROM e.value) THEN
    RAISE EXCEPTION 'Artifact changed' USING ERRCODE = '40001';
  END IF;
  SELECT to_jsonb(c) INTO v_current FROM public.report_safety_snapshot_persistence c
    WHERE c.artifact_id = (p_rows->'artifact'->>'id')::uuid
      AND c.report_id = (p_rows->'report'->>'id')::uuid
      AND c.project_id = v_opportunity.project_id AND c.workspace_id = v_opportunity.workspace_id FOR SHARE;
  IF NOT FOUND OR EXISTS (SELECT FROM jsonb_each(p_rows->'persistence') e WHERE v_current->e.key IS DISTINCT FROM e.value) THEN
    RAISE EXCEPTION 'Safety persistence custody changed' USING ERRCODE = '40001';
  END IF;
  SELECT to_jsonb(a) INTO v_current FROM public.safety_crash_ingests a WHERE a.id = (p_rows->'acquisition'->>'id')::uuid
    AND a.project_id = v_opportunity.project_id AND a.workspace_id = v_opportunity.workspace_id AND a.status = 'ready' FOR SHARE;
  IF NOT FOUND OR EXISTS (SELECT FROM jsonb_each(p_rows->'acquisition') e WHERE v_current->e.key IS DISTINCT FROM e.value) THEN
    RAISE EXCEPTION 'Acquisition changed' USING ERRCODE = '40001';
  END IF;
  -- Strong locks also serialize FK-backed draft inserts. Exact row and draft-set
  -- comparisons catch writes made since preview, including edits to final text.
  FOR v_section IN SELECT * FROM public.funding_opportunity_application_sections
    WHERE opportunity_id = v_opportunity.id AND workspace_id = v_opportunity.workspace_id ORDER BY id FOR UPDATE LOOP
    SELECT value INTO v_expected FROM jsonb_array_elements(p_rows->'sections') WHERE value->>'id' = v_section.id::text;
    IF v_expected IS NULL OR EXISTS (SELECT FROM jsonb_each(v_expected) e WHERE to_jsonb(v_section)->e.key IS DISTINCT FROM e.value) THEN
      RAISE EXCEPTION 'Section changed' USING ERRCODE = '40001';
    END IF;
    IF v_section.source = 'catalog' AND NOT (v_section.section_key = ANY(v_keys)) THEN
      RAISE EXCEPTION 'Ambiguous or other catalog template' USING ERRCODE = '40001';
    END IF;
    v_count := v_count + 1;
  END LOOP;
  IF v_count <> jsonb_array_length(p_rows->'sections') OR
    (SELECT count(*) FROM public.funding_opportunity_application_sections WHERE opportunity_id = v_opportunity.id AND source = 'catalog' AND section_key = ANY(v_keys)) <> 6 THEN
    RAISE EXCEPTION 'All six catalog SS4A sections required' USING ERRCODE = '40001';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'section_id', section_id) ORDER BY id), '[]'::jsonb) INTO v_current
    FROM public.funding_opportunity_section_drafts WHERE opportunity_id = v_opportunity.id AND workspace_id = v_opportunity.workspace_id;
  IF v_current IS DISTINCT FROM p_rows->'drafts' THEN RAISE EXCEPTION 'Draft history changed' USING ERRCODE = '40001'; END IF;
  IF jsonb_array_length(p_sections) <> 6 OR
    (SELECT count(DISTINCT value->>'section_key') FROM jsonb_array_elements(p_sections) WHERE value->>'section_key' = ANY(v_keys)) <> 6 THEN
    RAISE EXCEPTION 'Exactly six supported drafts required' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.funding_opportunity_safety_seeds(workspace_id, opportunity_id, artifact_id, preview_hash, draft_ids, created_by)
    VALUES (v_opportunity.workspace_id, v_opportunity.id, (p_rows->'artifact'->>'id')::uuid, p_preview_hash, v_ids, p_actor) RETURNING * INTO v_receipt;
  FOR v_draft IN SELECT value FROM jsonb_array_elements(p_sections) LOOP
    v_index := v_index + 1;
    SELECT * INTO STRICT v_section FROM public.funding_opportunity_application_sections WHERE id = (v_draft->>'section_id')::uuid
      AND opportunity_id = v_opportunity.id AND workspace_id = v_opportunity.workspace_id AND source = 'catalog' AND section_key = v_draft->>'section_key';
    INSERT INTO public.funding_opportunity_section_drafts(id, workspace_id, opportunity_id, section_id, draft_markdown, model, origin, safety_seed_id, grounding_json, created_by)
      VALUES (v_ids[v_index], v_opportunity.workspace_id, v_opportunity.id, v_section.id, v_draft->>'draft_markdown', NULL, 'safety_plan_seed', v_receipt.id, v_draft->'provenance', p_actor);
    UPDATE public.funding_opportunity_application_sections SET status = CASE WHEN status = 'final' THEN status ELSE 'operator_review' END,
      updated_by = p_actor, updated_at = clock_timestamp() WHERE id = v_section.id;
  END LOOP;
  RETURN to_jsonb(v_receipt);
END;
$$;
REVOKE ALL ON FUNCTION public.apply_ss4a_safety_seed(uuid, jsonb, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_ss4a_safety_seed(uuid, jsonb, text, jsonb) TO service_role;

-- New typed snapshots originate on the authorized generation server. Freeze the
-- source and artifact identity while permitting the one generation receipt write.
-- Legacy artifacts are left unchanged and cannot acquire a snapshot by update.
CREATE FUNCTION public.guard_report_safety_snapshot() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_report public.reports%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.metadata_json->'safetyPlanSnapshotV1' IS NOT NULL AND NEW.metadata_json->'safetyPlanSnapshotV1' <> 'null'::jsonb THEN
      IF current_user NOT IN ('service_role', 'postgres') THEN
        RAISE EXCEPTION 'Safety snapshots require the authorized generation server' USING ERRCODE = '42501';
      END IF;
      IF current_user = 'service_role' THEN
        SELECT * INTO STRICT v_report FROM public.reports WHERE id = NEW.report_id FOR SHARE;
        PERFORM 1 FROM public.workspace_members WHERE workspace_id = v_report.workspace_id
          AND user_id = NEW.generated_by AND role IN ('owner','admin','member') FOR SHARE;
        IF NOT FOUND OR NEW.metadata_json->'safetyPlanSnapshotV1'->>'artifactId' <> NEW.id::text
          OR NEW.metadata_json->'safetyPlanSnapshotV1'->>'reportId' <> NEW.report_id::text
          OR NEW.metadata_json->'safetyPlanSnapshotV1'->>'workspaceId' <> v_report.workspace_id::text
          OR NEW.metadata_json->'safetyPlanSnapshotV1'->>'projectId' <> v_report.project_id::text
          OR (NEW.metadata_json->'safetyPlanSnapshotV1'->>'reportUpdatedAt')::timestamptz IS DISTINCT FROM v_report.updated_at THEN
          RAISE EXCEPTION 'Safety snapshot source changed or writer is unavailable' USING ERRCODE = '40001';
        END IF;
      END IF;
    END IF;
  ELSE
    IF coalesce(OLD.metadata_json->'safetyPlanSnapshotV1', 'null'::jsonb) IS DISTINCT FROM coalesce(NEW.metadata_json->'safetyPlanSnapshotV1', 'null'::jsonb) THEN
      RAISE EXCEPTION 'Safety snapshots are immutable; regenerate a new artifact' USING ERRCODE = '23514';
    END IF;
    IF OLD.metadata_json->'safetyPlanSnapshotV1' IS NOT NULL AND OLD.metadata_json->'safetyPlanSnapshotV1' <> 'null'::jsonb THEN
      IF ROW(NEW.id, NEW.report_id, NEW.generated_at, NEW.generated_by, NEW.artifact_kind, NEW.storage_path)
        IS DISTINCT FROM ROW(OLD.id, OLD.report_id, OLD.generated_at, OLD.generated_by, OLD.artifact_kind, OLD.storage_path)
        OR NEW.metadata_json->'htmlContent' IS DISTINCT FROM OLD.metadata_json->'htmlContent' THEN
        RAISE EXCEPTION 'Safety artifact identity and rendered evidence are immutable' USING ERRCODE = '23514';
      END IF;
      IF OLD.metadata_json->'generationWriteback' IS NOT NULL AND OLD.metadata_json->'generationWriteback' <> 'null'::jsonb THEN
        IF NEW.metadata_json->'generationWriteback' IS DISTINCT FROM OLD.metadata_json->'generationWriteback' THEN
          RAISE EXCEPTION 'Safety generation receipt is immutable' USING ERRCODE = '23514';
        END IF;
      ELSIF NEW.metadata_json->'generationWriteback' IS NOT NULL AND NEW.metadata_json->'generationWriteback' <> 'null'::jsonb THEN
        SELECT * INTO STRICT v_report FROM public.reports WHERE id = NEW.report_id FOR SHARE;
        IF NEW.metadata_json->'generationWriteback'->>'schema' IS DISTINCT FROM 'openplan.report-generation-writeback.v1'
          OR (NEW.metadata_json->'generationWriteback'->>'reportUpdatedAt')::timestamptz IS DISTINCT FROM v_report.updated_at THEN
          RAISE EXCEPTION 'Safety generation receipt does not match report writeback' USING ERRCODE = '40001';
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_report_safety_snapshot() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_report_safety_snapshot BEFORE INSERT OR UPDATE ON public.report_artifacts
  FOR EACH ROW EXECUTE FUNCTION public.guard_report_safety_snapshot();
