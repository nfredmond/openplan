-- Pre-checks for PR 409 (20261102110000 reserve_ai_usage,
-- 20261102110100 application_export_custody). Read-only.
-- Run: bash $KIT/kit.sh hosted $W read /work/prechecks/20-pr409-ai-reservation-and-export-custody.sql
-- A differing check stops the read with "PRE-CHECK FAILED ..." (see 00-history.sql).
SELECT c.check_name, c.expected, c.found,
       CASE WHEN c.found IS NOT DISTINCT FROM c.expected THEN 'pass'
            ELSE ('PRE-CHECK FAILED ' || c.check_name || ': expected ' || c.expected || ', found ' || coalesce(c.found, 'NULL'))::integer::text
       END AS result
FROM (
  SELECT '409 reserve_ai_usage absent' AS check_name, 'true' AS expected,
         (SELECT (pg_catalog.to_regprocedure('public.reserve_ai_usage(uuid,text[],integer,integer,text,text,text,jsonb)') IS NULL)::text) AS found
  UNION ALL
  SELECT '409 export custody columns absent', '0',
         (SELECT pg_catalog.count(*)::text FROM information_schema.columns col
           WHERE col.table_schema = 'public' AND col.table_name = 'funding_opportunity_application_exports'
             AND col.column_name IN ('sha256', 'appendix_manifest_json'))
  UNION ALL
  SELECT '409 export custody constraints absent', '0',
         (SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_constraint con
           WHERE con.conname IN ('fo_application_exports_sha256_format', 'fo_application_exports_appendix_manifest_array'))
) c;

-- Informational: rows the two new CHECKs scan. Both columns start NULL, so
-- no existing row can fail them.
SELECT pg_catalog.count(*) AS application_export_rows FROM public.funding_opportunity_application_exports;
