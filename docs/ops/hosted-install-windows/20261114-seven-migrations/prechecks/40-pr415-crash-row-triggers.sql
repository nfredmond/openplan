-- Pre-checks for PR 415 (20261102130000 safety_crash_statement_revision).
-- Read-only. No data check is needed: the migration changes no rows and adds
-- no constraint.
-- Run: bash $KIT/kit.sh hosted $W read /work/prechecks/40-pr415-crash-row-triggers.sql
-- A differing check stops the read with "PRE-CHECK FAILED ..." (see 00-history.sql).
SELECT c.check_name, c.expected, c.found,
       CASE WHEN c.found IS NOT DISTINCT FROM c.expected THEN 'pass'
            ELSE ('PRE-CHECK FAILED ' || c.check_name || ': expected ' || c.expected || ', found ' || coalesce(c.found, 'NULL'))::integer::text
       END AS result
FROM (
  -- 2. Exactly the three row triggers the migration replaces, on their functions.
  SELECT '415-2 crash and party triggers before the window' AS check_name,
         'safety_crash_parties.safety_comparison_party_fence=safety_comparison_private.source_fence;'
         'safety_crashes.safety_comparison_crash_fence=safety_comparison_private.source_fence;'
         'safety_crashes.trg_safety_crashes_project_evidence_revision=public.bump_project_revision_from_parent_evidence' AS expected,
         (SELECT pg_catalog.string_agg(rel.relname || '.' || t.tgname || '=' || n.nspname || '.' || p.proname, ';'
                                       ORDER BY rel.relname, t.tgname)
            FROM pg_catalog.pg_trigger t
            JOIN pg_catalog.pg_class rel ON rel.oid = t.tgrelid
            JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
            JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
           WHERE t.tgrelid IN ('public.safety_crashes'::regclass, 'public.safety_crash_parties'::regclass)
             AND NOT t.tgisinternal) AS found
  UNION ALL
  -- 3. The new function names are free.
  SELECT '415-3 new function names free', 'true,true,true',
         (SELECT (pg_catalog.to_regprocedure('public.safety_crash_child_fence()') IS NULL)::text || ',' ||
                 (pg_catalog.to_regprocedure('public.safety_crash_child_revision()') IS NULL)::text || ',' ||
                 (pg_catalog.to_regprocedure('public.bump_project_revision_from_safety_crash_rows()') IS NULL)::text)
  UNION ALL
  -- 4. Transition tables need PostgreSQL 10 or later.
  SELECT '415-4 server supports transition tables', 'true',
         (SELECT (pg_catalog.current_setting('server_version_num')::integer >= 100000)::text)
) c;

-- Informational: rows on the two tables whose triggers change while the file
-- holds ACCESS EXCLUSIVE on them (DROP TRIGGER and CREATE TRIGGER).
SELECT (SELECT pg_catalog.count(*) FROM public.safety_crashes) AS safety_crashes_rows,
       (SELECT pg_catalog.count(*) FROM public.safety_crash_parties) AS safety_crash_parties_rows,
       pg_catalog.current_setting('server_version') AS server_version;
