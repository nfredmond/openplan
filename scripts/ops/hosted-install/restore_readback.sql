-- Restore readback (review 15, B7). Read-only; run with run_sql.py read and
-- --var capture_started=<the capture's capturedAt>, once on the restored copy and
-- once on the source within 10 minutes after the capture's completion line.
-- compare_restore.py compares the two with the decrypted manifest.
--
-- Returns one result line with: history (count, newest, tuple hash); an exact
-- count(*) for every table in public, auth and storage, with the number of rows
-- whose created_at or updated_at is at or after capture_started; md5 of the
-- ordered primary keys of five key tables; every storage.objects row's bucket,
-- name, size and timestamps; buckets; RLS and policy counts; event triggers.
-- Every name is schema-qualified: run_sql.py sets search_path to pg_catalog.
WITH tables AS (
  SELECT n.nspname AS schema_name, c.relname AS table_name,
         (SELECT string_agg(format('%I >= %L::timestamptz', a.attname, :'capture_started'), ' OR ' ORDER BY a.attname)
          FROM pg_attribute a
          WHERE a.attrelid = c.oid AND a.attname IN ('created_at', 'updated_at') AND NOT a.attisdropped
            AND a.atttypid IN ('timestamptz'::regtype, 'timestamp'::regtype)) AS recent_filter
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'auth', 'storage') AND c.relkind IN ('r', 'p') AND NOT c.relispartition
), counted AS (
  SELECT t.schema_name, t.table_name,
         (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', t.schema_name, t.table_name), false, true, '')))[1]::text::bigint AS total,
         CASE WHEN t.recent_filter IS NOT NULL THEN
           (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I WHERE %s', t.schema_name, t.table_name, t.recent_filter), false, true, '')))[1]::text::bigint
         END AS recent
  FROM tables t
), keyed AS (
  SELECT k.schema_name, k.table_name,
         (SELECT string_agg(format('%I', a.attname), ', ' ORDER BY array_position(i.indkey::int2[], a.attnum))
          FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
          WHERE i.indrelid = format('%I.%I', k.schema_name, k.table_name)::regclass AND i.indisprimary) AS pk
  FROM (VALUES ('public', 'workspaces'), ('public', 'workspace_members'), ('public', 'projects'),
               ('auth', 'users'), ('storage', 'buckets')) AS k(schema_name, table_name)
  WHERE to_regclass(format('%I.%I', k.schema_name, k.table_name)) IS NOT NULL
), key_hashes AS (
  SELECT k.schema_name, k.table_name, k.pk,
         (xpath('/row/c/text()', query_to_xml(format(
            'SELECT md5(COALESCE(string_agg(x, E''\n'' ORDER BY x COLLATE "C"), '''')) AS c FROM (SELECT ROW(%s)::text AS x FROM %I.%I) s',
            k.pk, k.schema_name, k.table_name), false, true, '')))[1]::text AS md5
  FROM keyed k WHERE k.pk IS NOT NULL
)
SELECT 'OPENPLAN_RESULT ' || jsonb_build_object(
  'kind', 'restore-readback',
  'captureStarted', :'capture_started',
  'serverVersion', current_setting('server_version'),
  'history', (SELECT jsonb_build_object(
      'count', count(*), 'newest', max(h.version),
      'tupleHash', md5(COALESCE(string_agg(h.version || ':' || COALESCE(h.name, '') || ':' || md5(COALESCE(h.statements::text, '')), E'\n' ORDER BY h.version COLLATE "C"), '')))
    FROM supabase_migrations.schema_migrations h),
  'tables', (SELECT jsonb_object_agg(c.schema_name || '.' || c.table_name, jsonb_build_object('count', c.total, 'recent', c.recent)) FROM counted c),
  'keyHashes', (SELECT jsonb_object_agg(k.schema_name || '.' || k.table_name, jsonb_build_object('pk', k.pk, 'md5', k.md5)) FROM key_hashes k),
  'objects', (SELECT COALESCE(jsonb_agg(jsonb_build_array(o.bucket_id, o.name, o.metadata ->> 'size', o.created_at, o.updated_at)
                              ORDER BY o.bucket_id, o.name), '[]'::jsonb) FROM storage.objects o),
  'buckets', (SELECT COALESCE(jsonb_agg(b.id ORDER BY b.id), '[]'::jsonb) FROM storage.buckets b),
  'publicTables', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')),
  'publicTablesWithRls', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                          WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity),
  'policies', (SELECT count(*) FROM pg_policy),
  'eventTriggers', (SELECT COALESCE(jsonb_agg(jsonb_build_array(e.evtname, pg_get_userbyid(e.evtowner), e.evtenabled::text) ORDER BY e.evtname), '[]'::jsonb)
                    FROM pg_event_trigger e)
)::text;
