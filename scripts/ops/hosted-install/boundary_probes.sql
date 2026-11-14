-- The October 10 access-boundary probes (review 15, B7.4), for the restored
-- copy only. Run with run_sql.py probe: it refuses a probe without the final
-- ROLLBACK and replaces it with a raise, so nothing here can commit.
--
-- Picks the oldest project, an owner of its workspace and a user who belongs
-- to none of that workspace's memberships, then reads that one project row as
-- each of them and as anon. Expected: 1, 0, 0. compare_restore.py checks it.
SELECT pg_catalog.set_config('openplan.probe_project',
  COALESCE((SELECT p.id::text FROM public.projects p ORDER BY p.created_at, p.id LIMIT 1), ''), true);
SELECT pg_catalog.set_config('openplan.probe_owner',
  COALESCE((SELECT m.user_id::text FROM public.workspace_members m JOIN public.projects p ON p.workspace_id = m.workspace_id
            WHERE p.id::text = pg_catalog.current_setting('openplan.probe_project') AND m.role = 'owner'
            ORDER BY m.user_id LIMIT 1), ''), true);
SELECT pg_catalog.set_config('openplan.probe_other',
  COALESCE((SELECT u.id::text FROM auth.users u
            WHERE NOT EXISTS (SELECT 1 FROM public.workspace_members m JOIN public.projects p ON p.workspace_id = m.workspace_id
                              WHERE p.id::text = pg_catalog.current_setting('openplan.probe_project') AND m.user_id = u.id)
            ORDER BY u.id LIMIT 1), ''), true);
SELECT 'OPENPLAN_RESULT ' || pg_catalog.jsonb_build_object('probe', 'picked',
  'project', pg_catalog.current_setting('openplan.probe_project') <> '',
  'owner', pg_catalog.current_setting('openplan.probe_owner') <> '',
  'other', pg_catalog.current_setting('openplan.probe_other') <> '')::text;
SELECT pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object('sub', pg_catalog.current_setting('openplan.probe_owner'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT 'OPENPLAN_RESULT ' || pg_catalog.jsonb_build_object('probe', 'owner', 'rows',
  (SELECT pg_catalog.count(*) FROM public.projects p WHERE p.id::text = pg_catalog.current_setting('openplan.probe_project')))::text;
RESET ROLE;
SELECT pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object('sub', pg_catalog.current_setting('openplan.probe_other'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT 'OPENPLAN_RESULT ' || pg_catalog.jsonb_build_object('probe', 'other-workspace', 'rows',
  (SELECT pg_catalog.count(*) FROM public.projects p WHERE p.id::text = pg_catalog.current_setting('openplan.probe_project')))::text;
RESET ROLE;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role": "anon"}', true);
SET LOCAL ROLE anon;
SELECT 'OPENPLAN_RESULT ' || pg_catalog.jsonb_build_object('probe', 'anon', 'rows',
  (SELECT pg_catalog.count(*) FROM public.projects p WHERE p.id::text = pg_catalog.current_setting('openplan.probe_project')))::text;
RESET ROLE;
ROLLBACK;
