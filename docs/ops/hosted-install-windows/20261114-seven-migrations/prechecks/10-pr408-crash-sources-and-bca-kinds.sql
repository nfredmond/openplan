-- Pre-checks for PR 408 (20261102100000 persist_state_injury_crashes,
-- 20261102100100 bca_tribal_and_town_place_kinds). Read-only.
-- Run: bash $KIT/kit.sh hosted $W read /work/prechecks/10-pr408-crash-sources-and-bca-kinds.sql
-- A differing check stops the read with "PRE-CHECK FAILED ..." (see 00-history.sql).
SELECT c.check_name, c.expected, c.found,
       CASE WHEN c.found IS NOT DISTINCT FROM c.expected THEN 'pass'
            ELSE ('PRE-CHECK FAILED ' || c.check_name || ': expected ' || c.expected || ', found ' || coalesce(c.found, 'NULL'))::integer::text
       END AS result
FROM (
  -- 1. Exactly one CHECK per domain. The migration finds each by its
  --    expression and raises unless it finds exactly one.
  SELECT '408-1 one CHECK per crash domain' AS check_name,
         'safety_crash_ingests_coverage_state_check,safety_crashes_source_id_check' AS expected,
         (SELECT pg_catalog.string_agg(x.conname, ',' ORDER BY x.conname) FROM (
            SELECT con.conname::text AS conname FROM pg_catalog.pg_constraint con
             WHERE con.contype = 'c'
               AND ((con.conrelid = 'public.safety_crashes'::regclass AND pg_catalog.pg_get_constraintdef(con.oid) LIKE '%source_id%')
                 OR (con.conrelid = 'public.safety_crash_ingests'::regclass AND pg_catalog.pg_get_constraintdef(con.oid) LIKE '%coverage_state%'))) x) AS found
  UNION ALL
  -- 2. Stored values sit inside today's domains, so inside the wider ones.
  SELECT '408-2 crash source ids outside ccrs-ca and fars-national', '0',
         (SELECT pg_catalog.count(*)::text FROM public.safety_crashes s WHERE s.source_id NOT IN ('ccrs-ca', 'fars-national'))
  UNION ALL
  SELECT '408-2 coverage states outside the five existing', '0',
         (SELECT pg_catalog.count(*)::text FROM public.safety_crash_ingests i
           WHERE i.coverage_state NOT IN ('ccrs_ca_statewide', 'fars_fatal_only', 'switrs_legacy_local', 'out_of_coverage', 'source_unavailable'))
  UNION ALL
  -- 3. Helper absent; the two functions it works with present.
  SELECT '408-3 helper absent, guard and jurisdiction check present', 'true,true,true',
         (SELECT (pg_catalog.to_regprocedure('public.bca_snapshot_tigerweb_geoid_valid(text,text)') IS NULL)::text || ',' ||
                 (pg_catalog.to_regprocedure('public.guard_project_bca_place_insert()') IS NOT NULL)::text || ',' ||
                 (pg_catalog.to_regprocedure('public.valid_bca_snapshot_jurisdiction(jsonb)') IS NOT NULL)::text)
  UNION ALL
  -- 4. Projects whose TIGERweb place or resolved jurisdiction the per-kind
  --    GEOID check would refuse on their next BCA save. The app reader already
  --    refuses them and no stored row changes, but review 15 step 17 treats
  --    any such project as a stop for review.
  SELECT '408-4 places or jurisdictions the per-kind check refuses', '0',
         (SELECT (
            (SELECT pg_catalog.count(*) FROM public.projects p
              WHERE p.place_source = 'tigerweb' AND NOT coalesce(CASE p.place_kind
                WHEN 'county' THEN upper(btrim(p.place_ref)) ~ '^[0-9]{5}$' WHEN 'metro' THEN upper(btrim(p.place_ref)) ~ '^[0-9]{5}$'
                WHEN 'micro' THEN upper(btrim(p.place_ref)) ~ '^[0-9]{5}$' WHEN 'city' THEN upper(btrim(p.place_ref)) ~ '^[0-9]{7}$'
                WHEN 'cdp' THEN upper(btrim(p.place_ref)) ~ '^[0-9]{7}$' WHEN 'cousub' THEN upper(btrim(p.place_ref)) ~ '^[0-9]{10}$'
                WHEN 'aiannh' THEN upper(btrim(p.place_ref)) ~ '^[0-9]{4}[RT]$' ELSE false END, false))
            +
            (SELECT pg_catalog.count(*) FROM public.projects p, pg_catalog.jsonb_array_elements(
                CASE WHEN pg_catalog.jsonb_typeof(p.jurisdiction_context -> 'entries') = 'array' THEN p.jurisdiction_context -> 'entries' ELSE '[]'::jsonb END) e
              WHERE e ->> 'identity' = 'server_resolved'
                AND NOT coalesce((e ->> 'reference') ~ '^tigerweb:(county|metro|micro):[0-9]{5}$|^tigerweb:(city|cdp):[0-9]{7}$|^tigerweb:cousub:[0-9]{10}$|^tigerweb:aiannh:[0-9]{4}[RT]$', false))
          )::text)
) c;

-- Informational: rows the two new CHECKs scan while 20261102100000 holds
-- ACCESS EXCLUSIVE on both tables.
SELECT 'safety_crashes' AS table_name, s.source_id AS value, pg_catalog.count(*) AS row_count
FROM public.safety_crashes s GROUP BY 2
UNION ALL
SELECT 'safety_crash_ingests', i.coverage_state, pg_catalog.count(*) FROM public.safety_crash_ingests i GROUP BY 2
ORDER BY 1, 2;
