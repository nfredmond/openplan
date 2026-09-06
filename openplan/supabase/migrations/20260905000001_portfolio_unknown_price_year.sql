-- Preserve an unknown cost price year in reviewed CSV and workbook imports.
-- Replace the existing service-role transactions without rewriting any stored row.
-- All authorization, source custody, duplicate, and atomicity checks are unchanged.

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
           OR ((v_row#>>'{estimatedCost,priceYear}') IS NOT NULL
               AND (v_row#>>'{estimatedCost,priceYear}')::integer NOT BETWEEN 1800 AND 3000) THEN
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

CREATE OR REPLACE FUNCTION public.commit_project_portfolio_import_v2(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_source_document_id uuid,
  p_original_workbook_document_id uuid,
  p_source_hash text,
  p_source_format text,
  p_preview_hash text,
  p_sheet_configurations jsonb,
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
  v_source_filename text;
  v_source_content_type text;
  v_original_status text;
  v_original_extraction text;
  v_batch_id uuid := gen_random_uuid();
  v_config jsonb;
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
  v_previous_sheet integer := -1;
BEGIN
  SELECT wm.role INTO v_role
  FROM public.workspace_members wm
  WHERE wm.workspace_id = p_workspace_id AND wm.user_id = p_actor_id;

  IF v_role IS NULL OR v_role = 'viewer' THEN
    RAISE EXCEPTION 'Current workspace role does not allow portfolio import'
      USING ERRCODE = '42501';
  END IF;

  SELECT d.checksum, d.status, d.extraction_source, d.storage_ref,
         d.original_filename, d.content_type
  INTO v_source_checksum, v_source_status, v_source_extraction, v_source_ref,
       v_source_filename, v_source_content_type
  FROM public.kb_documents d
  WHERE d.id = p_source_document_id
    AND d.workspace_id = p_workspace_id
    AND d.project_id IS NULL
    AND d.source_kind = 'uploaded_spreadsheet';

  IF v_source_checksum IS NULL OR v_source_checksum <> p_source_hash OR v_source_ref IS NULL THEN
    RAISE EXCEPTION 'Stored portfolio source is missing, out of scope, or does not match its hash'
      USING ERRCODE = '22023';
  END IF;
  IF p_source_format NOT IN ('csv','xls','xlsx','ods')
     OR lower(COALESCE(v_source_filename, '')) !~ ('\.' || p_source_format || '$') THEN
    RAISE EXCEPTION 'Stored portfolio source format does not match its filename'
      USING ERRCODE = '22023';
  END IF;
  IF (p_source_format = 'csv' AND (
        v_source_status <> 'ready' OR v_source_extraction <> 'spreadsheet_parse'
      )) OR (p_source_format <> 'csv' AND (
        v_source_status <> 'stored' OR v_source_extraction <> 'none'
      )) THEN
    RAISE EXCEPTION 'Stored portfolio source status does not match its format'
      USING ERRCODE = '22023';
  END IF;
  IF (p_source_format = 'csv' AND v_source_content_type NOT IN ('text/csv','application/csv','text/plain','application/octet-stream'))
     OR (p_source_format = 'xls' AND v_source_content_type <> 'application/vnd.ms-excel')
     OR (p_source_format = 'xlsx' AND v_source_content_type <> 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
     OR (p_source_format = 'ods' AND v_source_content_type <> 'application/vnd.oasis.opendocument.spreadsheet') THEN
    RAISE EXCEPTION 'Stored portfolio source content type does not match its format'
      USING ERRCODE = '22023';
  END IF;

  IF p_original_workbook_document_id IS NOT NULL THEN
    IF p_source_format <> 'csv' THEN
      RAISE EXCEPTION 'Only a CSV source may link a separate authoritative workbook'
        USING ERRCODE = '22023';
    END IF;
    SELECT d.status, d.extraction_source
    INTO v_original_status, v_original_extraction
    FROM public.kb_documents d
    WHERE d.id = p_original_workbook_document_id
      AND d.id <> p_source_document_id
      AND d.workspace_id = p_workspace_id
      AND d.project_id IS NULL
      AND d.source_kind = 'uploaded_spreadsheet'
      AND lower(COALESCE(d.original_filename, '')) ~ '\.(xls|xlsx|ods)$';
    IF v_original_status IS NULL OR v_original_status <> 'stored' OR v_original_extraction <> 'none' THEN
      RAISE EXCEPTION 'Authoritative workbook is missing or outside workspace source scope'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_source_hash !~ '^[0-9a-f]{64}$'
     OR p_preview_hash !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(p_sheet_configurations) <> 'array'
     OR jsonb_array_length(p_sheet_configurations) NOT BETWEEN 1 AND 256
     OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Portfolio workbook payload is malformed' USING ERRCODE = '22023';
  END IF;

  FOR v_config IN SELECT value FROM jsonb_array_elements(p_sheet_configurations)
  LOOP
    IF COALESCE((v_config->>'worksheetIndex')::integer, -1) <= v_previous_sheet
       OR COALESCE((v_config->>'worksheetIndex')::integer, -1) NOT BETWEEN 0 AND 255
       OR COALESCE((v_config->>'headerRow')::integer, 0) < 1
       OR char_length(COALESCE(v_config->>'worksheetName', '')) NOT BETWEEN 1 AND 200
       OR jsonb_typeof(v_config->'mapping') <> 'object'
       OR jsonb_typeof(v_config->'defaults') <> 'object' THEN
      RAISE EXCEPTION 'Worksheet configurations must be distinct and in physical order'
        USING ERRCODE = '22023';
    END IF;
    v_previous_sheet := (v_config->>'worksheetIndex')::integer;
  END LOOP;

  v_row_count := jsonb_array_length(p_rows);
  IF v_row_count < 1 OR v_row_count > 2000 THEN
    RAISE EXCEPTION 'Portfolio import row count is outside the supported range'
      USING ERRCODE = '22023';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    IF COALESCE((v_row->>'worksheetIndex')::integer, -1) NOT BETWEEN 0 AND 255
       OR char_length(COALESCE(v_row->>'worksheetName', '')) NOT BETWEEN 1 AND 200
       OR COALESCE((v_row->>'headerRow')::integer, 0) < 1
       OR COALESCE((v_row->>'rowNumber')::integer, 0) <= COALESCE((v_row->>'headerRow')::integer, 0)
       OR COALESCE(v_row->>'fingerprint', '') !~ '^[0-9a-f]{64}$'
       OR COALESCE(v_row->>'decision', '') NOT IN ('create','skip')
       OR COALESCE(v_row->>'state', '') NOT IN ('clean','warning','blocked','created_before')
       OR COALESCE(v_row->>'planType', '') = '' OR char_length(v_row->>'planType') > 80
       OR COALESCE(v_row->>'status', '') NOT IN ('draft','active','on_hold','complete')
       OR COALESCE(v_row->>'deliveryPhase', '') NOT IN ('scoping','analysis','engagement','programming','delivery','complete')
       OR jsonb_typeof(COALESCE(v_row->'formulaFields', '[]'::jsonb)) <> 'array'
       OR jsonb_typeof(COALESCE(v_row->'errors', '[]'::jsonb)) <> 'array'
       OR jsonb_typeof(COALESCE(v_row->'warnings', '[]'::jsonb)) <> 'array'
       OR NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_sheet_configurations) c
         WHERE (c->>'worksheetIndex')::integer = (v_row->>'worksheetIndex')::integer
           AND (c->>'headerRow')::integer = (v_row->>'headerRow')::integer
           AND c->>'worksheetName' = v_row->>'worksheetName'
       ) THEN
      RAISE EXCEPTION 'Portfolio workbook row is malformed or does not match its worksheet setup'
        USING ERRCODE = '22023';
    END IF;
    IF v_row->>'decision' = 'create' AND COALESCE((v_row->>'canCreate')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'A blocked or unconfirmed row was selected for creation' USING ERRCODE = '22023';
    END IF;
    IF v_row->>'decision' = 'create'
       AND jsonb_array_length(COALESCE(v_row->'formulaFields', '[]'::jsonb)) > 0
       AND COALESCE((v_row->>'confirmFormula')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'A cached formula row lacks individual confirmation' USING ERRCODE = '22023';
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

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_rows) r
    WHERE NULLIF(lower(btrim(r->>'sourceId')), '') IS NOT NULL
    GROUP BY lower(btrim(r->>'sourceId')) HAVING count(*) > 1
  ) AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_rows) r
    WHERE r->>'decision' = 'create'
      AND lower(btrim(r->>'sourceId')) IN (
        SELECT lower(btrim(d->>'sourceId')) FROM jsonb_array_elements(p_rows) d
        WHERE NULLIF(lower(btrim(d->>'sourceId')), '') IS NOT NULL
        GROUP BY lower(btrim(d->>'sourceId')) HAVING count(*) > 1
      )
  ) THEN
    RAISE EXCEPTION 'Duplicate source IDs cannot create projects' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_rows) r
    JOIN public.projects p
      ON p.workspace_id = p_workspace_id
     AND lower(regexp_replace(btrim(p.name), '\s+', ' ', 'g')) =
         lower(regexp_replace(btrim(r->>'name'), '\s+', ' ', 'g'))
    WHERE r->>'decision' = 'create'
      AND COALESCE((r->>'confirmNameMatch')::boolean, false) IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'A current project name match lacks individual confirmation'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_rows) r
    WHERE r->>'decision' = 'create'
      AND COALESCE((r->>'confirmNameMatch')::boolean, false) IS NOT TRUE
      AND lower(regexp_replace(btrim(r->>'name'), '\s+', ' ', 'g')) IN (
        SELECT lower(regexp_replace(btrim(d->>'name'), '\s+', ' ', 'g'))
        FROM jsonb_array_elements(p_rows) d
        WHERE NULLIF(btrim(d->>'name'), '') IS NOT NULL
        GROUP BY lower(regexp_replace(btrim(d->>'name'), '\s+', ' ', 'g'))
        HAVING count(*) > 1
      )
  ) THEN
    RAISE EXCEPTION 'A batch project name match lacks individual confirmation'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.project_portfolio_import_batches (
    id, workspace_id, source_document_id, original_workbook_document_id,
    source_sha256, source_format, preview_sha256, mapping_json, defaults_json,
    sheet_configurations_json, row_count, created_count, skipped_count,
    conflicted_count, invalid_count, previously_created_count, imported_by
  ) VALUES (
    v_batch_id, p_workspace_id, p_source_document_id, p_original_workbook_document_id,
    p_source_hash, p_source_format, p_preview_hash,
    jsonb_build_object('version', 2, 'sheets', p_sheet_configurations),
    jsonb_build_object('version', 2), p_sheet_configurations,
    v_row_count, v_created, v_skipped, v_conflicted, v_invalid,
    v_previously_created, p_actor_id
  );

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    v_project_id := NULL;
    v_amount := NULL;
    IF v_row->>'decision' = 'create' THEN
      IF btrim(COALESCE(v_row->>'name', '')) = '' OR char_length(btrim(v_row->>'name')) > 120
         OR char_length(COALESCE(v_row->>'description', '')) > 2000 THEN
        RAISE EXCEPTION 'Created project text is invalid' USING ERRCODE = '22023';
      END IF;
      IF v_row->'estimatedCost' IS NOT NULL AND v_row->'estimatedCost' <> 'null'::jsonb THEN
        IF COALESCE(v_row#>>'{estimatedCost,amount}', '') !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
           OR (v_row#>>'{estimatedCost,amount}')::numeric <= 0
           OR COALESCE(v_row#>>'{estimatedCost,currency}', '') !~ '^[A-Z]{3}$'
           OR ((v_row#>>'{estimatedCost,priceYear}') IS NOT NULL
               AND (v_row#>>'{estimatedCost,priceYear}')::integer NOT BETWEEN 1800 AND 3000) THEN
          RAISE EXCEPTION 'Created project cost is invalid' USING ERRCODE = '22023';
        END IF;
        v_amount := (v_row#>>'{estimatedCost,amount}')::numeric;
      END IF;
      INSERT INTO public.projects (
        workspace_id, name, summary, status, plan_type, delivery_phase, created_by,
        estimated_cost_amount, estimated_cost_currency, estimated_cost_basis_year,
        estimated_cost_source_document_id, estimated_cost_recorded_by, estimated_cost_recorded_at
      ) VALUES (
        p_workspace_id, btrim(v_row->>'name'), NULLIF(btrim(v_row->>'description'), ''),
        v_row->>'status', btrim(v_row->>'planType'), v_row->>'deliveryPhase', p_actor_id,
        v_amount, CASE WHEN v_amount IS NULL THEN NULL ELSE v_row#>>'{estimatedCost,currency}' END,
        CASE WHEN v_amount IS NULL THEN NULL ELSE (v_row#>>'{estimatedCost,priceYear}')::integer END,
        CASE WHEN v_amount IS NULL THEN NULL ELSE p_source_document_id END,
        CASE WHEN v_amount IS NULL THEN NULL ELSE p_actor_id END,
        CASE WHEN v_amount IS NULL THEN NULL ELSE now() END
      ) RETURNING id INTO v_project_id;
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
      batch_id, workspace_id, source_document_id, source_sha256, source_format,
      worksheet_index, worksheet_name, header_row, source_row_number, row_fingerprint,
      mapped_source_id, source_location_text, formula_warning_fields, decision, outcome,
      errors_json, warnings_json, resolved_plan_type, resolved_status,
      resolved_delivery_phase, created_project_id, actor_id
    ) VALUES (
      v_batch_id, p_workspace_id, p_source_document_id, p_source_hash, p_source_format,
      (v_row->>'worksheetIndex')::integer, v_row->>'worksheetName',
      (v_row->>'headerRow')::integer, (v_row->>'rowNumber')::integer,
      v_row->>'fingerprint', NULLIF(btrim(v_row->>'sourceId'), ''),
      NULLIF(btrim(v_row->>'sourceLocationText'), ''),
      COALESCE(v_row->'formulaFields', '[]'::jsonb), v_row->>'decision', v_outcome,
      COALESCE(v_row->'errors', '[]'::jsonb), COALESCE(v_row->'warnings', '[]'::jsonb),
      btrim(v_row->>'planType'), v_row->>'status', v_row->>'deliveryPhase',
      v_project_id, p_actor_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'batchId', v_batch_id, 'created', v_created, 'skipped', v_skipped,
    'conflicted', v_conflicted, 'invalid', v_invalid,
    'previouslyCreated', v_previously_created, 'projectIds', v_project_ids
  );
END;
$$;

REVOKE ALL ON FUNCTION public.commit_project_portfolio_import_v2(
  uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_project_portfolio_import_v2(
  uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb
) TO service_role;
