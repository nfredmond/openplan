-- Reviewed, create-only portfolio CSV import.
--
-- The raw source stays in kb_documents. These two append-only tables record
-- what a planner reviewed and what the one transaction did. CSV values never
-- enter geography columns: source_location_text is provenance only.

CREATE TABLE public.project_portfolio_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source_document_id uuid NOT NULL REFERENCES public.kb_documents(id) ON DELETE RESTRICT,
  original_workbook_document_id uuid REFERENCES public.kb_documents(id) ON DELETE RESTRICT,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  preview_sha256 text NOT NULL CHECK (preview_sha256 ~ '^[0-9a-f]{64}$'),
  mapping_json jsonb NOT NULL CHECK (jsonb_typeof(mapping_json) = 'object'),
  defaults_json jsonb NOT NULL CHECK (jsonb_typeof(defaults_json) = 'object'),
  row_count integer NOT NULL CHECK (row_count BETWEEN 1 AND 2000),
  created_count integer NOT NULL CHECK (created_count BETWEEN 0 AND row_count),
  skipped_count integer NOT NULL CHECK (skipped_count BETWEEN 0 AND row_count),
  conflicted_count integer NOT NULL CHECK (conflicted_count BETWEEN 0 AND row_count),
  invalid_count integer NOT NULL CHECK (invalid_count BETWEEN 0 AND row_count),
  previously_created_count integer NOT NULL CHECK (previously_created_count BETWEEN 0 AND row_count),
  imported_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    created_count + skipped_count + conflicted_count + invalid_count + previously_created_count = row_count
  ),
  CHECK (original_workbook_document_id IS NULL OR original_workbook_document_id <> source_document_id)
);

CREATE TABLE public.project_portfolio_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.project_portfolio_import_batches(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source_document_id uuid NOT NULL REFERENCES public.kb_documents(id) ON DELETE RESTRICT,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_row_number integer NOT NULL CHECK (source_row_number >= 2),
  row_fingerprint text NOT NULL CHECK (row_fingerprint ~ '^[0-9a-f]{64}$'),
  mapped_source_id text CHECK (mapped_source_id IS NULL OR char_length(mapped_source_id) <= 200),
  -- This text is deliberately not a foreign key, coordinate, bbox, geometry,
  -- place id, or project column. A planner may verify geography later through
  -- OpenPlan's existing geography workflow.
  source_location_text text CHECK (
    source_location_text IS NULL OR char_length(source_location_text) <= 2000
  ),
  decision text NOT NULL CHECK (decision IN ('create','skip')),
  outcome text NOT NULL CHECK (
    outcome IN ('created','skipped','conflicted','invalid','previously_created')
  ),
  errors_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(errors_json) = 'array'),
  warnings_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(warnings_json) = 'array'),
  resolved_plan_type text NOT NULL,
  resolved_status text NOT NULL CHECK (resolved_status IN ('draft','active','on_hold','complete')),
  resolved_delivery_phase text NOT NULL CHECK (
    resolved_delivery_phase IN ('scoping','analysis','engagement','programming','delivery','complete')
  ),
  created_project_id uuid REFERENCES public.projects(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (outcome = 'created' AND decision = 'create' AND created_project_id IS NOT NULL)
    OR
    (outcome <> 'created' AND created_project_id IS NULL)
  )
);

CREATE INDEX project_portfolio_import_batches_workspace_time_idx
  ON public.project_portfolio_import_batches(workspace_id, imported_at DESC);
CREATE INDEX project_portfolio_import_rows_batch_row_idx
  ON public.project_portfolio_import_rows(batch_id, source_row_number);
CREATE INDEX project_portfolio_import_rows_source_idx
  ON public.project_portfolio_import_rows(workspace_id, source_sha256, source_row_number);

-- Only a row that actually created a project claims this source identity.
-- Skipped rows remain reviewable on a later import. Concurrent commits race on
-- this key; one transaction wins and the other rolls back without a batch.
CREATE UNIQUE INDEX project_portfolio_import_rows_created_identity_uidx
  ON public.project_portfolio_import_rows(
    workspace_id,
    source_sha256,
    source_row_number,
    row_fingerprint
  ) WHERE outcome = 'created';

ALTER TABLE public.project_portfolio_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_portfolio_import_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_portfolio_import_batches_read
  ON public.project_portfolio_import_batches
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = project_portfolio_import_batches.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY project_portfolio_import_rows_read
  ON public.project_portfolio_import_rows
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = project_portfolio_import_rows.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

REVOKE ALL ON TABLE public.project_portfolio_import_batches FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.project_portfolio_import_rows FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.project_portfolio_import_batches TO authenticated;
GRANT SELECT ON TABLE public.project_portfolio_import_rows TO authenticated;
GRANT ALL ON TABLE public.project_portfolio_import_batches TO service_role;
GRANT ALL ON TABLE public.project_portfolio_import_rows TO service_role;

CREATE OR REPLACE FUNCTION public.refuse_project_portfolio_import_rewrite()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Preserve ordinary workspace deletion. During its cascade the parent has
  -- already disappeared, so these provenance children may disappear with it.
  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME = 'project_portfolio_import_batches' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id
      ) THEN
        RETURN OLD;
      END IF;
    ELSIF TG_TABLE_NAME = 'project_portfolio_import_rows' THEN
      IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id)
         OR NOT EXISTS (
           SELECT 1 FROM public.project_portfolio_import_batches WHERE id = OLD.batch_id
         ) THEN
        RETURN OLD;
      END IF;
    END IF;
  END IF;
  RAISE EXCEPTION 'Project portfolio import provenance is immutable';
END;
$$;

CREATE TRIGGER project_portfolio_import_batches_immutable
  BEFORE UPDATE OR DELETE ON public.project_portfolio_import_batches
  FOR EACH ROW EXECUTE FUNCTION public.refuse_project_portfolio_import_rewrite();
CREATE TRIGGER project_portfolio_import_rows_immutable
  BEFORE UPDATE OR DELETE ON public.project_portfolio_import_rows
  FOR EACH ROW EXECUTE FUNCTION public.refuse_project_portfolio_import_rewrite();

CREATE OR REPLACE FUNCTION public.commit_project_portfolio_import(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_source_document_id uuid,
  p_original_workbook_document_id uuid,
  p_source_hash text,
  p_preview_hash text,
  p_mapping jsonb,
  p_defaults jsonb,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_role text;
  v_source_checksum text;
  v_source_status text;
  v_source_extraction text;
  v_source_ref text;
  v_original_status text;
  v_original_extraction text;
  v_batch_id uuid := gen_random_uuid();
  v_row jsonb;
  v_project_id uuid;
  v_outcome text;
  v_row_count integer;
  v_created integer := 0;
  v_skipped integer := 0;
  v_conflicted integer := 0;
  v_invalid integer := 0;
  v_previously_created integer := 0;
  v_project_ids jsonb := '[]'::jsonb;
  v_amount numeric;
BEGIN
  SELECT wm.role INTO v_role
  FROM public.workspace_members wm
  WHERE wm.workspace_id = p_workspace_id
    AND wm.user_id = p_actor_id;

  IF v_role IS NULL OR v_role = 'viewer' THEN
    RAISE EXCEPTION 'Current workspace role does not allow portfolio import'
      USING ERRCODE = '42501';
  END IF;

  SELECT d.checksum, d.status, d.extraction_source, d.storage_ref
  INTO v_source_checksum, v_source_status, v_source_extraction, v_source_ref
  FROM public.kb_documents d
  WHERE d.id = p_source_document_id
    AND d.workspace_id = p_workspace_id
    AND d.project_id IS NULL
    AND d.source_kind = 'uploaded_spreadsheet';

  IF v_source_checksum IS NULL
     OR v_source_checksum <> p_source_hash
     OR v_source_status <> 'ready'
     OR v_source_extraction <> 'spreadsheet_parse'
     OR v_source_ref IS NULL THEN
    RAISE EXCEPTION 'Stored CSV source is missing, out of scope, or does not match its hash'
      USING ERRCODE = '22023';
  END IF;

  IF p_original_workbook_document_id IS NOT NULL THEN
    SELECT d.status, d.extraction_source
    INTO v_original_status, v_original_extraction
    FROM public.kb_documents d
    WHERE d.id = p_original_workbook_document_id
      AND d.id <> p_source_document_id
      AND d.workspace_id = p_workspace_id
      AND d.project_id IS NULL
      AND d.source_kind = 'uploaded_spreadsheet';

    IF v_original_status IS NULL
       OR v_original_status <> 'stored'
       OR v_original_extraction <> 'none' THEN
      RAISE EXCEPTION 'Original workbook is missing or outside the workspace-level source scope'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_source_hash !~ '^[0-9a-f]{64}$'
     OR p_preview_hash !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(p_mapping) <> 'object'
     OR jsonb_typeof(p_defaults) <> 'object'
     OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Portfolio import payload is malformed' USING ERRCODE = '22023';
  END IF;

  v_row_count := jsonb_array_length(p_rows);
  IF v_row_count < 1 OR v_row_count > 2000 THEN
    RAISE EXCEPTION 'Portfolio import row count is outside the supported range'
      USING ERRCODE = '22023';
  END IF;

  -- Validate and count before the first write. The route reviewed these rows,
  -- but the transaction boundary refuses a malformed service-role call too.
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    IF COALESCE((v_row->>'rowNumber')::integer, 0) < 2
       OR COALESCE(v_row->>'fingerprint', '') !~ '^[0-9a-f]{64}$'
       OR COALESCE(v_row->>'decision', '') NOT IN ('create','skip')
       OR COALESCE(v_row->>'state', '') NOT IN ('clean','warning','blocked','created_before')
       OR COALESCE(v_row->>'planType', '') = ''
       OR char_length(v_row->>'planType') > 80
       OR COALESCE(v_row->>'status', '') NOT IN ('draft','active','on_hold','complete')
       OR COALESCE(v_row->>'deliveryPhase', '') NOT IN (
         'scoping','analysis','engagement','programming','delivery','complete'
       )
       OR jsonb_typeof(COALESCE(v_row->'errors', '[]'::jsonb)) <> 'array'
       OR jsonb_typeof(COALESCE(v_row->'warnings', '[]'::jsonb)) <> 'array' THEN
      RAISE EXCEPTION 'Portfolio import row is malformed' USING ERRCODE = '22023';
    END IF;

    IF v_row->>'decision' = 'create' AND COALESCE((v_row->>'canCreate')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'A blocked or unconfirmed row was selected for creation'
        USING ERRCODE = '22023';
    END IF;

    IF v_row->>'decision' = 'create' THEN
      v_created := v_created + 1;
    ELSIF v_row->>'state' = 'created_before' THEN
      v_previously_created := v_previously_created + 1;
    ELSIF (v_row->'errors') @> '[{"code":"duplicate_source_id"}]'::jsonb THEN
      v_conflicted := v_conflicted + 1;
    ELSIF jsonb_array_length(COALESCE(v_row->'errors', '[]'::jsonb)) > 0 THEN
      v_invalid := v_invalid + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  INSERT INTO public.project_portfolio_import_batches (
    id, workspace_id, source_document_id, original_workbook_document_id,
    source_sha256, preview_sha256, mapping_json, defaults_json, row_count,
    created_count, skipped_count, conflicted_count, invalid_count,
    previously_created_count, imported_by
  ) VALUES (
    v_batch_id, p_workspace_id, p_source_document_id, p_original_workbook_document_id,
    p_source_hash, p_preview_hash, p_mapping, p_defaults, v_row_count,
    v_created, v_skipped, v_conflicted, v_invalid, v_previously_created, p_actor_id
  );

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    v_project_id := NULL;
    v_amount := NULL;

    IF v_row->>'decision' = 'create' THEN
      IF btrim(COALESCE(v_row->>'name', '')) = '' OR char_length(btrim(v_row->>'name')) > 120 THEN
        RAISE EXCEPTION 'Created project name is invalid' USING ERRCODE = '22023';
      END IF;
      IF char_length(COALESCE(v_row->>'description', '')) > 2000 THEN
        RAISE EXCEPTION 'Created project description is invalid' USING ERRCODE = '22023';
      END IF;

      IF v_row->'estimatedCost' IS NOT NULL AND v_row->'estimatedCost' <> 'null'::jsonb THEN
        IF COALESCE(v_row#>>'{estimatedCost,amount}', '') !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
           OR (v_row#>>'{estimatedCost,amount}')::numeric <= 0
           OR COALESCE(v_row#>>'{estimatedCost,currency}', '') !~ '^[A-Z]{3}$'
           OR COALESCE((v_row#>>'{estimatedCost,priceYear}')::integer, 0) NOT BETWEEN 1800 AND 3000 THEN
          RAISE EXCEPTION 'Created project cost is invalid' USING ERRCODE = '22023';
        END IF;
        v_amount := (v_row#>>'{estimatedCost,amount}')::numeric;
      END IF;

      INSERT INTO public.projects (
        workspace_id, name, summary, status, plan_type, delivery_phase, created_by,
        estimated_cost_amount, estimated_cost_currency, estimated_cost_basis_year,
        estimated_cost_source_document_id, estimated_cost_recorded_by, estimated_cost_recorded_at
      ) VALUES (
        p_workspace_id,
        btrim(v_row->>'name'),
        NULLIF(btrim(v_row->>'description'), ''),
        v_row->>'status',
        btrim(v_row->>'planType'),
        v_row->>'deliveryPhase',
        p_actor_id,
        v_amount,
        CASE WHEN v_amount IS NULL THEN NULL ELSE v_row#>>'{estimatedCost,currency}' END,
        CASE WHEN v_amount IS NULL THEN NULL ELSE (v_row#>>'{estimatedCost,priceYear}')::integer END,
        CASE WHEN v_amount IS NULL THEN NULL ELSE p_source_document_id END,
        CASE WHEN v_amount IS NULL THEN NULL ELSE p_actor_id END,
        CASE WHEN v_amount IS NULL THEN NULL ELSE now() END
      )
      RETURNING id INTO v_project_id;

      v_outcome := 'created';
      v_project_ids := v_project_ids || jsonb_build_array(v_project_id);
    ELSIF v_row->>'state' = 'created_before' THEN
      v_outcome := 'previously_created';
    ELSIF (v_row->'errors') @> '[{"code":"duplicate_source_id"}]'::jsonb THEN
      v_outcome := 'conflicted';
    ELSIF jsonb_array_length(COALESCE(v_row->'errors', '[]'::jsonb)) > 0 THEN
      v_outcome := 'invalid';
    ELSE
      v_outcome := 'skipped';
    END IF;

    INSERT INTO public.project_portfolio_import_rows (
      batch_id, workspace_id, source_document_id, source_sha256,
      source_row_number, row_fingerprint, mapped_source_id,
      source_location_text, decision, outcome, errors_json, warnings_json,
      resolved_plan_type, resolved_status, resolved_delivery_phase,
      created_project_id, actor_id
    ) VALUES (
      v_batch_id, p_workspace_id, p_source_document_id, p_source_hash,
      (v_row->>'rowNumber')::integer, v_row->>'fingerprint',
      NULLIF(btrim(v_row->>'sourceId'), ''),
      NULLIF(btrim(v_row->>'sourceLocationText'), ''),
      v_row->>'decision', v_outcome,
      COALESCE(v_row->'errors', '[]'::jsonb),
      COALESCE(v_row->'warnings', '[]'::jsonb),
      btrim(v_row->>'planType'), v_row->>'status', v_row->>'deliveryPhase',
      v_project_id, p_actor_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'batchId', v_batch_id,
    'created', v_created,
    'skipped', v_skipped,
    'conflicted', v_conflicted,
    'invalid', v_invalid,
    'previouslyCreated', v_previously_created,
    'projectIds', v_project_ids
  );
END;
$$;

REVOKE ALL ON FUNCTION public.commit_project_portfolio_import(
  uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_project_portfolio_import(
  uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,jsonb
) TO service_role;

COMMENT ON TABLE public.project_portfolio_import_batches IS
  'Immutable summary of one human-approved, create-only portfolio CSV import. The source bytes remain in kb_documents.';
COMMENT ON TABLE public.project_portfolio_import_rows IS
  'Immutable per-row review and outcome. source_location_text is provenance only and never project geography.';
COMMENT ON FUNCTION public.commit_project_portfolio_import(
  uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,jsonb
) IS
  'Service-role-only transaction that rechecks current actor role and workspace-level source scope, then records the batch, every row, and selected projects atomically.';
