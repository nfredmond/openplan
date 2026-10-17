-- Preserve retained context and geography together without backfilling history.
CREATE FUNCTION public.guard_land_use_plan_context_geography()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  place jsonb; shape jsonb; polygons jsonb; polygon jsonb; ring jsonb; position jsonb;
  coordinate_key text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- No-op assignments and unrelated edits do not revalidate historical rows.
    IF NEW.plan_context IS NOT DISTINCT FROM OLD.plan_context
       AND NEW.geography_label IS NOT DISTINCT FROM OLD.geography_label
       AND NEW.geography_geojson IS NOT DISTINCT FROM OLD.geography_geojson THEN RETURN NEW; END IF;
    IF OLD.plan_context IS NOT NULL AND NEW.plan_context IS NOT DISTINCT FROM OLD.plan_context THEN
      -- Even a divergent/malformed historical row needs an explicit context save.
      RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Land-use plan geography must match saved context';
    END IF;
    IF OLD.plan_context IS NOT NULL AND NEW.plan_context IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Land-use plan geography must match saved context';
    END IF;
  END IF;
  IF NEW.plan_context IS NULL THEN RETURN NEW; END IF;

  -- The existing server-write guard and context command retain actor, authority,
  -- resolver and receipt validation. This guard checks the retained place used
  -- for agreement, never derives jurisdiction or changes any supplied value.
  place := NEW.plan_context->'place';
  shape := place->'geometry';
  IF (jsonb_typeof(NEW.plan_context) = 'object'
      AND NEW.plan_context->'schemaVersion' = '1'::jsonb
      AND jsonb_typeof(place) = 'object'
      AND jsonb_typeof(place->'label') = 'string'
      AND length(place->>'label') BETWEEN 1 AND 240
      AND btrim(place->>'label') = place->>'label'
      AND jsonb_typeof(place->'source') = 'string' AND length(place->>'source') > 0
      AND jsonb_typeof(place->'kind') IN ('string','null')
      AND jsonb_typeof(place->'ref') IN ('string','null')
      AND (place->'countryCode' = 'null'::jsonb OR
        (jsonb_typeof(place->'countryCode') = 'string' AND place->>'countryCode' ~ '^[A-Z]{2}$'))
      AND jsonb_typeof(place->'subdivisionCode') IN ('string','null')
      AND jsonb_typeof(place->'bbox') = 'object'
      AND jsonb_typeof(shape) = 'object' AND shape->>'type' IN ('Polygon','MultiPolygon')
      AND jsonb_typeof(shape->'coordinates') = 'array'
      AND NEW.geography_label = place->>'label'
      AND NEW.geography_geojson = shape) IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Land-use plan geography must match saved context';
  END IF;
  IF place->>'source' IN ('drawn','uploaded_file') AND (
    place->'kind' IS DISTINCT FROM 'null'::jsonb OR place->'ref' IS DISTINCT FROM 'null'::jsonb
    OR place->'countryCode' IS DISTINCT FROM 'null'::jsonb OR place->'subdivisionCode' IS DISTINCT FROM 'null'::jsonb
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Land-use plan geography must match saved context';
  END IF;
  FOREACH coordinate_key IN ARRAY ARRAY['minLon','minLat','maxLon','maxLat'] LOOP
    IF (jsonb_typeof(place->'bbox'->coordinate_key) = 'number') IS NOT TRUE THEN
      RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Land-use plan geography must match saved context';
    END IF;
    IF abs((place->'bbox'->>coordinate_key)::numeric) > CASE WHEN coordinate_key IN ('minLon','maxLon') THEN 180 ELSE 90 END THEN
      RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Land-use plan geography must match saved context';
    END IF;
  END LOOP;
  IF (place#>>'{bbox,minLat}')::numeric > (place#>>'{bbox,maxLat}')::numeric THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Land-use plan geography must match saved context';
  END IF;
  polygons := CASE WHEN shape->>'type' = 'Polygon' THEN jsonb_build_array(shape->'coordinates') ELSE shape->'coordinates' END;
  IF jsonb_array_length(polygons) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Land-use plan geography must match saved context';
  END IF;
  FOR polygon IN SELECT value FROM jsonb_array_elements(polygons) LOOP
    IF jsonb_typeof(polygon) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Land-use plan geography must match saved context';
    END IF;
    IF jsonb_array_length(polygon) = 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Land-use plan geography must match saved context';
    END IF;
    FOR ring IN SELECT value FROM jsonb_array_elements(polygon) LOOP
      IF jsonb_typeof(ring) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Land-use plan geography must match saved context';
      END IF;
      IF jsonb_array_length(ring) < 4 THEN
        RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Land-use plan geography must match saved context';
      END IF;
      FOR position IN SELECT value FROM jsonb_array_elements(ring) LOOP
        IF jsonb_typeof(position) IS DISTINCT FROM 'array' THEN
          RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Land-use plan geography must match saved context';
        END IF;
        IF jsonb_array_length(position) <> 2
           OR jsonb_typeof(position->0) IS DISTINCT FROM 'number' OR jsonb_typeof(position->1) IS DISTINCT FROM 'number' THEN
          RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Land-use plan geography must match saved context';
        END IF;
        IF abs((position->>0)::numeric) > 180 OR abs((position->>1)::numeric) > 90 THEN
          RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Land-use plan geography must match saved context';
        END IF;
      END LOOP;
      IF abs((ring#>>'{0,0}')::numeric - (ring->-1->>0)::numeric) > 0.000000001
         OR abs((ring#>>'{0,1}')::numeric - (ring->-1->>1)::numeric) > 0.000000001 THEN
        RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Land-use plan geography must match saved context';
      END IF;
    END LOOP;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_land_use_plan_context_geography() FROM PUBLIC, anon, authenticated, service_role;
-- Run after the existing context server-write trigger, preserving its 42501.
CREATE TRIGGER land_use_plan_context_zz_geography
  BEFORE INSERT OR UPDATE ON public.land_use_plans
  FOR EACH ROW EXECUTE FUNCTION public.guard_land_use_plan_context_geography();
