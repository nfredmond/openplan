-- Probe for PR 415 (20261102130000), rolled back. Run after the install:
--   bash $KIT/kit.sh hosted $W probe /work/probes/415-crash-acquisition-timing.sql
-- The kit replaces the final ROLLBACK with a raise and then rolls back, so
-- nothing here is kept. It runs under the kit's limits (lock 3 s, statement
-- 60 s, transaction 120 s).
--
-- One synthetic user (its personal workspace comes from the sign-up trigger),
-- one project with a 1.4 MB study polygon, one open acquisition, then the
-- ingest's write pattern for 600 crashes: a 500-row statement, a 100-row
-- statement, and the same 500 rows again through ON CONFLICT DO UPDATE.
--
-- Expected: the probe envelope reads probe-complete, and stderr carries
-- "probe 415: 600 crashes stored ..." with every statement well under 3 s
-- (local rehearsal: under 0.2 s each) and the acquisition revision 1 -> 4,
-- one step per statement. Before the fix, 50 rows took about 5 s on such a
-- project and 500 rows hit the 8 s statement timeout.
DO $probe$
DECLARE
  synthetic_user constant uuid := '00000000-0000-4000-8000-0000000c0de1';
  synthetic_project constant uuid := '00000000-0000-4000-8000-0000000c0de2';
  synthetic_ingest constant uuid := '00000000-0000-4000-8000-0000000c0de3';
  ws uuid; t0 timestamptz; s1 numeric; s2 numeric; s3 numeric; rev bigint; stored bigint;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (synthetic_user, 'install-timing@example.test');
  SELECT m.workspace_id INTO ws FROM public.workspace_members m
   WHERE m.user_id = synthetic_user AND m.role = 'owner' LIMIT 1;
  IF ws IS NULL THEN
    RAISE EXCEPTION 'probe 415: the synthetic user got no personal workspace';
  END IF;
  INSERT INTO public.projects (id, workspace_id, name, created_by)
  VALUES (synthetic_project, ws, 'SYNTHETIC install timing', synthetic_user);
  UPDATE public.projects
     SET place_geometry_geojson = pg_catalog.jsonb_build_object('type', 'Polygon', 'coordinates', pg_catalog.jsonb_build_array(
           (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
                     -110 + pg_catalog.cos(g / 8000.0 * 2 * pg_catalog.pi()) * 1.234567,
                     36 + pg_catalog.sin(g / 8000.0 * 2 * pg_catalog.pi()) * 1.234567))
              FROM pg_catalog.generate_series(0, 80000) g)))
   WHERE id = synthetic_project;
  INSERT INTO public.safety_crash_ingests (id, workspace_id, project_id, min_lon, min_lat, max_lon, max_lat,
                                           source_id, source_label, attribution, coverage_state, status)
  VALUES (synthetic_ingest, ws, synthetic_project, 0, 0, 1, 1, 'ccrs-ca', 'Synthetic', 'Not observed crash data',
          'source_unavailable', 'ready');

  t0 := pg_catalog.clock_timestamp();
  INSERT INTO public.safety_crashes (workspace_id, ingest_id, source_id, external_id, severity, latitude, longitude)
  SELECT ws, synthetic_ingest, 'ccrs-ca', 'timing-' || g, 'injury', 0.5, 0.5 FROM pg_catalog.generate_series(1, 500) g
  ON CONFLICT (workspace_id, ingest_id, source_id, external_id) DO UPDATE SET severity = EXCLUDED.severity;
  s1 := EXTRACT(EPOCH FROM pg_catalog.clock_timestamp() - t0);

  t0 := pg_catalog.clock_timestamp();
  INSERT INTO public.safety_crashes (workspace_id, ingest_id, source_id, external_id, severity, latitude, longitude)
  SELECT ws, synthetic_ingest, 'ccrs-ca', 'timing-' || g, 'injury', 0.5, 0.5 FROM pg_catalog.generate_series(501, 600) g
  ON CONFLICT (workspace_id, ingest_id, source_id, external_id) DO UPDATE SET severity = EXCLUDED.severity;
  s2 := EXTRACT(EPOCH FROM pg_catalog.clock_timestamp() - t0);

  t0 := pg_catalog.clock_timestamp();
  INSERT INTO public.safety_crashes (workspace_id, ingest_id, source_id, external_id, severity, latitude, longitude)
  SELECT ws, synthetic_ingest, 'ccrs-ca', 'timing-' || g, 'fatal', 0.5, 0.5 FROM pg_catalog.generate_series(1, 500) g
  ON CONFLICT (workspace_id, ingest_id, source_id, external_id) DO UPDATE SET severity = EXCLUDED.severity;
  s3 := EXTRACT(EPOCH FROM pg_catalog.clock_timestamp() - t0);

  SELECT i.evidence_revision INTO rev FROM public.safety_crash_ingests i WHERE i.id = synthetic_ingest;
  SELECT pg_catalog.count(*) INTO stored FROM public.safety_crashes c WHERE c.ingest_id = synthetic_ingest;
  RAISE NOTICE 'probe 415: 600 crashes stored (% rows); seconds per statement: 500 new %, 100 new %, 500 updated %; acquisition revision 1 -> %',
    stored, pg_catalog.round(s1, 3), pg_catalog.round(s2, 3), pg_catalog.round(s3, 3), rev;
  IF stored <> 600 THEN
    RAISE EXCEPTION 'probe 415 failed: % crash rows stored, expected 600', stored;
  END IF;
  IF rev IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'probe 415 failed: acquisition revision went 1 -> %, expected 4 (one step per statement)', rev;
  END IF;
  IF GREATEST(s1, s2, s3) >= 3 THEN
    RAISE EXCEPTION 'probe 415 failed: a crash statement took % s (limit 3 s)', pg_catalog.round(GREATEST(s1, s2, s3), 3);
  END IF;
END
$probe$;
ROLLBACK;
