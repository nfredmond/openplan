-- Pre-check 00 (window): migration history before the window. Read-only.
-- Run: bash $KIT/kit.sh hosted $W read /work/prechecks/00-history.sql
--
-- Each check row prints check, expected, found and "pass". A check whose found
-- value differs from expected stops the read with
-- 'invalid input syntax for type integer: "PRE-CHECK FAILED ..."', so the
-- envelope reads read-failed and the window stops (README, step 17).
--
-- Expected: 448 rows through 20261024200400; none of the seven planned
-- versions present.
SELECT c.check_name, c.expected, c.found,
       CASE WHEN c.found IS NOT DISTINCT FROM c.expected THEN 'pass'
            ELSE ('PRE-CHECK FAILED ' || c.check_name || ': expected ' || c.expected || ', found ' || coalesce(c.found, 'NULL'))::integer::text
       END AS result
FROM (
  SELECT 'history before the window' AS check_name, '448 through 20261024200400' AS expected,
         (SELECT pg_catalog.count(*)::text || ' through ' || coalesce(pg_catalog.max(h.version), 'none')
            FROM supabase_migrations.schema_migrations h) AS found
  UNION ALL
  SELECT 'planned versions already present', '0',
         (SELECT pg_catalog.count(*)::text FROM supabase_migrations.schema_migrations h
           WHERE h.version IN ('20261102100000', '20261102100100', '20261102110000', '20261102110100',
                               '20261102120000', '20261102130000', '20261102140000'))
) c;

-- Informational (review 15, N6): the row format of the newest history rows.
-- Set the plan's historyStatements to the format these rows share: whole-file
-- (one element equal to the file text), statements (the file split into
-- statements, as the Supabase CLI writes them) or empty. md5_whole_file is the
-- md5 of each committed file's bytes on the integration head.
SELECT h.version, h.name,
       coalesce(pg_catalog.array_length(h.statements, 1), 0) AS statement_count,
       CASE WHEN coalesce(pg_catalog.array_length(h.statements, 1), 0) = 0 THEN 'empty'
            WHEN pg_catalog.array_length(h.statements, 1) = 1 AND pg_catalog.md5(h.statements[1]) = f.md5_whole_file THEN 'whole-file'
            ELSE 'statements' END AS history_format
FROM supabase_migrations.schema_migrations h
LEFT JOIN (VALUES
  ('20261024200000', '078eb70db41253bec07497e69ab46160'),
  ('20261024200100', 'c95451b6121065c72df644728207c1b6'),
  ('20261024200200', 'd87351b6d8334076ab4cdde30ee6a968'),
  ('20261024200300', '4e4ec4a3fa9a3df7f97e4acce2d3f3d1'),
  ('20261024200400', 'b85b35488871a56d7c3ccab312845160')
) AS f(version, md5_whole_file) ON f.version = h.version
WHERE h.version >= '20261024200000'
ORDER BY h.version;
