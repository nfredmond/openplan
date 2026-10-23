-- Extend the accepted document format without rewriting any retained v1 input.
-- The original grants, RLS policies, author and outer project checks remain.
BEGIN;
DO $migration$
DECLARE
  version_checks text[];
BEGIN
  -- Locate only the original single-version CHECK. Refuse unexpected schema
  -- rather than guessing an auto-generated name or dropping broader checks.
  SELECT array_agg(c.conname) INTO version_checks
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid = 'public.project_bca_versions'::regclass
    AND c.contype = 'c'
    AND pg_catalog.pg_get_expr(c.conbin, c.conrelid) =
      '((document_json ->> ''schemaVersion''::text) = ''1''::text)';
  IF coalesce(cardinality(version_checks), 0) <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one original BCA schema-version CHECK';
  END IF;
  EXECUTE format('ALTER TABLE public.project_bca_versions DROP CONSTRAINT %I', version_checks[1]);
END;
$migration$;

ALTER TABLE public.project_bca_versions
  ADD CONSTRAINT bca_document_schema_version CHECK (
    (document_json->>'schemaVersion' = '1' OR document_json->'schemaVersion' = '2'::jsonb) IS TRUE
  ),
  ADD CONSTRAINT bca_project_place_snapshot CHECK (
    document_json->>'schemaVersion' = '1' OR (
      jsonb_typeof(document_json->'projectPlace') = 'object'
      AND document_json->'projectPlace'->>'projectId' = project_id::text
      AND jsonb_typeof(document_json->'projectPlace'->'place') = 'object'
      AND jsonb_typeof(document_json->'projectPlace'->'projectUpdatedAt') = 'string'
      AND document_json->'projectPlace'->>'status' IN ('recorded', 'missing', 'drawn', 'uploaded')
    ) IS TRUE
  );

-- Match ECMAScript String.trim used by the existing project jurisdiction
-- reader. Do not normalize a project, snapshot, immutable input or timestamp.
CREATE FUNCTION public.bca_snapshot_trim(value text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  SELECT btrim(value, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$$;

CREATE FUNCTION public.bca_snapshot_text_valid(value text, max_units integer, canonical boolean DEFAULT false, min_units integer DEFAULT 1)
RETURNS boolean LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  -- Zod 4.6 and PostgreSQL char_length both count code points, as does the
  -- projects table's own jurisdiction label check.
  SELECT public.bca_snapshot_trim(value) <> ''
    AND char_length(value) BETWEEN min_units AND max_units
    AND (NOT canonical OR value = public.bca_snapshot_trim(value));
$$;

CREATE FUNCTION public.valid_bca_snapshot_jurisdiction(value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE item jsonb; resolved text[]; reference_value text;
BEGIN
  IF value = 'null'::jsonb THEN RETURN true; END IF;
  -- Reuse the project's native schema. Supplement its permissive SQL-NULL and
  -- trim behavior with the existing TypeScript reader's strict result shape.
  IF public.valid_project_jurisdiction_context(value) IS DISTINCT FROM true
    OR jsonb_typeof(value) IS DISTINCT FROM 'object'
    OR NOT (value ?& ARRAY['version','state','entries','recordedBy','recordedAt'])
    OR value - ARRAY['version','state','entries','recordedBy','recordedAt'] <> '{}'::jsonb
    OR value->'version' IS DISTINCT FROM '1'::jsonb
    OR jsonb_typeof(value->'state') IS DISTINCT FROM 'string'
    OR (value->>'state' IN ('unresolved','declared')) IS DISTINCT FROM true
    OR jsonb_typeof(value->'entries') IS DISTINCT FROM 'array'
    OR jsonb_typeof(value->'recordedBy') IS DISTINCT FROM 'string'
    OR (value->>'recordedBy' ~* '^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$') IS DISTINCT FROM true
    OR jsonb_typeof(value->'recordedAt') IS DISTINCT FROM 'string'
    OR (value->>'recordedAt' ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$') IS DISTINCT FROM true
    THEN RETURN false; END IF;
  IF jsonb_array_length(value->'entries') > 12
    OR (value->>'state' = 'declared' AND jsonb_array_length(value->'entries') = 0)
    OR (value->>'state' = 'unresolved' AND jsonb_array_length(value->'entries') <> 0)
    THEN RETURN false; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(value->'entries') LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object'
      OR NOT (item ?& ARRAY['label','countryCode','subdivisionCode','kind','reference','scope','identity'])
      OR item - ARRAY['label','countryCode','subdivisionCode','kind','reference','scope','identity'] <> '{}'::jsonb
      OR jsonb_typeof(item->'label') IS DISTINCT FROM 'string'
      OR public.bca_snapshot_text_valid(item->>'label', 200, true) IS DISTINCT FROM true
      OR jsonb_typeof(item->'kind') IS DISTINCT FROM 'string'
      OR public.bca_snapshot_text_valid(item->>'kind', 80, true) IS DISTINCT FROM true
      OR jsonb_typeof(item->'scope') IS DISTINCT FROM 'string'
      OR (item->>'scope' IN ('administrative','sovereign','overlap','other')) IS DISTINCT FROM true
      OR jsonb_typeof(item->'identity') IS DISTINCT FROM 'string'
      OR (item->>'identity' IN ('staff_declared','server_resolved')) IS DISTINCT FROM true
      THEN RETURN false; END IF;
    IF item->'countryCode' IS DISTINCT FROM 'null'::jsonb AND (
      jsonb_typeof(item->'countryCode') IS DISTINCT FROM 'string'
      OR (item->>'countryCode' ~ '^[A-Z]{2}$') IS DISTINCT FROM true) THEN RETURN false; END IF;
    IF item->'subdivisionCode' IS DISTINCT FROM 'null'::jsonb AND (
      jsonb_typeof(item->'subdivisionCode') IS DISTINCT FROM 'string'
      OR (item->>'subdivisionCode' ~ '^[A-Z0-9-]{1,16}$') IS DISTINCT FROM true) THEN RETURN false; END IF;
    IF item->'reference' IS DISTINCT FROM 'null'::jsonb THEN
      reference_value := item->>'reference';
      IF jsonb_typeof(item->'reference') IS DISTINCT FROM 'string'
        OR (reference_value ~ '^[a-z][a-z0-9._-]*:[^[:space:]]{1,180}$') IS DISTINCT FROM true
        OR reference_value ~ (U&'[\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF]')
        OR public.bca_snapshot_text_valid(regexp_replace(reference_value, '^[^:]*:', ''), 180) IS DISTINCT FROM true
        THEN RETURN false; END IF;
    END IF;
    IF item->>'identity' = 'server_resolved' THEN
      -- This is the existing project-jurisdiction adapter's vocabulary, not a
      -- global source allowlist. Staff-declared sovereign/overlap entries remain.
      resolved := regexp_match(item->>'reference', '^tigerweb:([^:]+):([0-9]{5,7})$');
      IF resolved IS NULL OR (resolved[1] = ANY(ARRAY['county','city','cdp','metro','micro'])) IS DISTINCT FROM true
        OR item->>'kind' IS DISTINCT FROM ('tigerweb:' || resolved[1])
        OR item->>'scope' IS DISTINCT FROM 'administrative' THEN RETURN false; END IF;
    END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

CREATE FUNCTION public.guard_project_bca_place_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = '' SET timezone = 'UTC' AS $$
DECLARE project public.projects%ROWTYPE; expected jsonb; place jsonb; state text; field text;
  reader_timestamp_pattern constant text := '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]+)?(Z|[+]00:00)$';
BEGIN
  -- Same trusted database restoration boundary used by the project context
  -- guard. No JWT claim, request field or user-settable GUC enables this path.
  IF current_user = 'postgres' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL OR NEW.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Current attributed BCA writer required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(NEW.document_json->'schemaVersion') IS DISTINCT FROM 'number'
    OR NEW.document_json->'schemaVersion' IS DISTINCT FROM '2'::jsonb
    OR NEW.document_json->'projectId' IS DISTINCT FROM to_jsonb(NEW.project_id::text) THEN
    RAISE EXCEPTION 'New BCA inputs require numeric v2 and their exact project identity' USING ERRCODE = '23514';
  END IF;
  -- FOR SHARE conflicts with project UPDATE/DELETE, including non-key place
  -- edits. Hold this exact row through the insert transaction, not afterward.
  SELECT p.* INTO project FROM public.projects p WHERE p.id = NEW.project_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BCA project is not accessible' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members member
    WHERE member.workspace_id = project.workspace_id AND member.user_id = auth.uid()
      AND member.role IN ('owner','admin','member')) THEN
    RAISE EXCEPTION 'Current project workspace writer required' USING ERRCODE = '42501';
  END IF;
  IF project.updated_at IS NULL OR NOT isfinite(project.updated_at)
    OR (project.place_set_at IS NOT NULL AND NOT isfinite(project.place_set_at)) THEN
    RAISE EXCEPTION 'Project revision timestamps are invalid' USING ERRCODE = '23514';
  END IF;
  -- Native UUID/date types have a wider domain than the retained-input reader.
  -- Match locked Zod 4.4.3 UUID versions 1-8, RFC variant, nil and max. Native
  -- timestamp types supply valid calendar dates; their UTC JSON must also fit
  -- the reader's four-digit year. Inspect emitted source, never cast input.
  IF (project.id::text ~* '^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Project identity is outside the BCA reader UUID domain' USING ERRCODE = '23514';
  END IF;
  IF ((to_jsonb(project.updated_at) #>> '{}') ~ reader_timestamp_pattern) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Project updated_at is outside the BCA reader datetime domain' USING ERRCODE = '23514';
  END IF;
  IF project.place_set_at IS NOT NULL AND
    ((to_jsonb(project.place_set_at) #>> '{}') ~ reader_timestamp_pattern) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Project place_set_at is outside the BCA reader datetime domain' USING ERRCODE = '23514';
  END IF;
  place := jsonb_build_object('source', project.place_source, 'kind', project.place_kind,
    'ref', project.place_ref, 'label', project.place_label, 'countryCode', project.place_country_code,
    'subdivisionCode', project.place_subdivision_code, 'bbox', NULL, 'geometry', NULL);
  FOREACH field IN ARRAY ARRAY['source','kind','ref','label','subdivisionCode'] LOOP
    IF place->field <> 'null'::jsonb
      AND public.bca_snapshot_text_valid(place->>field, 4000) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Project place text is invalid' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  -- The typed project columns and their complete/globe/ISO/coherence CHECKs
  -- remain authoritative. These are the BCA reader's additional state rules.
  IF project.place_source IS NULL THEN
    state := 'missing';
    IF project.place_set_at IS NOT NULL OR place <> jsonb_build_object(
      'source', NULL, 'kind', NULL, 'ref', NULL, 'label', NULL,
      'countryCode', NULL, 'subdivisionCode', NULL, 'bbox', NULL, 'geometry', NULL)
      OR num_nonnulls(project.place_min_lon, project.place_min_lat, project.place_max_lon, project.place_max_lat) <> 0 THEN
      RAISE EXCEPTION 'Missing project place carries orphaned scope' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF project.place_set_at IS NULL
      OR num_nonnulls(project.place_min_lon, project.place_min_lat, project.place_max_lon, project.place_max_lat) <> 4 THEN
      RAISE EXCEPTION 'Project area requires its recorded extent and timestamp' USING ERRCODE = '23514';
    END IF;
    place := jsonb_set(place, '{bbox}', jsonb_build_object('minLon', project.place_min_lon,
      'minLat', project.place_min_lat, 'maxLon', project.place_max_lon, 'maxLat', project.place_max_lat));
    IF project.place_source IN ('drawn','uploaded_file') THEN
      state := CASE project.place_source WHEN 'drawn' THEN 'drawn' ELSE 'uploaded' END;
      IF num_nonnulls(project.place_kind, project.place_ref, project.place_country_code, project.place_subdivision_code) <> 0 THEN
        RAISE EXCEPTION 'Drawn/uploaded project area cannot carry inferred identity' USING ERRCODE = '23514';
      END IF;
    ELSE
      state := 'recorded';
      IF project.place_kind IS NULL OR project.place_ref IS NULL THEN
        RAISE EXCEPTION 'Recorded project place requires its source identity' USING ERRCODE = '23514';
      END IF;
      -- Parity with projectPlaceReference. Other adapters keep opaque kind/ref.
      IF project.place_source = 'tigerweb' AND (
        project.place_kind <> ALL(ARRAY['county','city','cdp','metro','micro'])
        OR public.bca_snapshot_text_valid(public.bca_snapshot_trim(project.place_ref), 7, false, 5) IS DISTINCT FROM true) THEN
        RAISE EXCEPTION 'Recorded project place reference is invalid' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  IF public.valid_bca_snapshot_jurisdiction(coalesce(project.jurisdiction_context, 'null'::jsonb)) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Project jurisdiction is invalid or changes under its strict reader; review the project record' USING ERRCODE = '23514';
  END IF;
  -- to_jsonb(timestamptz) in UTC matches the ordinary UTC project projection.
  -- It retains microseconds and its lexical precision. Do not cast/round or
  -- normalize a submitted timestamp; equivalent alternative spellings refuse.
  expected := jsonb_build_object('projectId', project.id, 'projectUpdatedAt', project.updated_at,
    'placeSetAt', project.place_set_at, 'status', state, 'place', place,
    'jurisdiction', project.jurisdiction_context);
  IF NEW.document_json->'projectPlace' IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'BCA snapshot does not match the locked current project source/context' USING ERRCODE = 'PT409';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bca_snapshot_trim(text), public.bca_snapshot_text_valid(text, integer, boolean, integer),
  public.valid_bca_snapshot_jurisdiction(jsonb), public.guard_project_bca_place_insert() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bca_snapshot_trim(text), public.bca_snapshot_text_valid(text, integer, boolean, integer),
  public.valid_bca_snapshot_jurisdiction(jsonb) TO authenticated, service_role;
CREATE TRIGGER project_bca_place_insert_guard BEFORE INSERT ON public.project_bca_versions
  FOR EACH ROW EXECUTE FUNCTION public.guard_project_bca_place_insert();
COMMIT;
