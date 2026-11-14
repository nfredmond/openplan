-- Probe for PR 440 (20261102140000), rolled back. Run after the install:
--   bash $KIT/kit.sh hosted $W probe /work/probes/440-rtp-link-refusals.sql
-- The kit replaces the final ROLLBACK with a raise and then rolls back.
--
-- Synthetic rows only (PR 440's packet probe updated a real link row; this
-- one does not touch any). Two synthetic users get their personal workspaces
-- from the sign-up trigger; workspace A holds a project, a cycle and a link,
-- workspace B holds a project. Four cross-workspace writes must each be
-- refused with SQLSTATE 23514 and the guard's own message.
--
-- Expected: probe-complete, with the stderr notice "probe 440: four
-- cross-workspace writes refused". Without the migration the first write is
-- accepted and the probe fails with "probe 440 failed: ... accepted".
DO $probe$
DECLARE
  user_a constant uuid := '00000000-0000-4000-8000-0000000440a1';
  user_b constant uuid := '00000000-0000-4000-8000-0000000440b1';
  project_a constant uuid := '00000000-0000-4000-8000-0000000440a2';
  project_b constant uuid := '00000000-0000-4000-8000-0000000440b2';
  cycle_a constant uuid := '00000000-0000-4000-8000-0000000440a3';
  link_a constant uuid := '00000000-0000-4000-8000-0000000440a4';
  ws_a uuid; ws_b uuid; step text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (user_a, 'install-rtp-a@example.test'), (user_b, 'install-rtp-b@example.test');
  SELECT m.workspace_id INTO ws_a FROM public.workspace_members m WHERE m.user_id = user_a AND m.role = 'owner' LIMIT 1;
  SELECT m.workspace_id INTO ws_b FROM public.workspace_members m WHERE m.user_id = user_b AND m.role = 'owner' LIMIT 1;
  IF ws_a IS NULL OR ws_b IS NULL OR ws_a = ws_b THEN
    RAISE EXCEPTION 'probe 440: the synthetic users did not get two personal workspaces';
  END IF;
  INSERT INTO public.projects (id, workspace_id, name, created_by) VALUES
    (project_a, ws_a, 'SYNTHETIC RTP probe project A', user_a),
    (project_b, ws_b, 'SYNTHETIC RTP probe project B', user_b);
  INSERT INTO public.rtp_cycles (id, workspace_id, title) VALUES (cycle_a, ws_a, 'SYNTHETIC RTP probe cycle');
  INSERT INTO public.project_rtp_cycle_links (id, workspace_id, project_id, rtp_cycle_id) VALUES (link_a, ws_a, project_a, cycle_a);

  FOREACH step IN ARRAY ARRAY['link to another workspace''s project', 'link moved to another workspace',
                              'linked project moved to another workspace', 'linked cycle moved to another workspace'] LOOP
    BEGIN
      CASE step
        WHEN 'link to another workspace''s project' THEN
          INSERT INTO public.project_rtp_cycle_links (workspace_id, project_id, rtp_cycle_id) VALUES (ws_a, project_b, cycle_a);
        WHEN 'link moved to another workspace' THEN
          UPDATE public.project_rtp_cycle_links SET workspace_id = ws_b WHERE id = link_a;
        WHEN 'linked project moved to another workspace' THEN
          UPDATE public.projects SET workspace_id = ws_b WHERE id = project_a;
        ELSE
          UPDATE public.rtp_cycles SET workspace_id = ws_b WHERE id = cycle_a;
      END CASE;
      RAISE EXCEPTION 'probe 440 failed: % accepted', step;
    EXCEPTION WHEN check_violation THEN
      IF SQLERRM NOT IN ('An RTP project link must stay inside one workspace',
                         'A project or RTP cycle with RTP project links cannot move to another workspace') THEN
        RAISE EXCEPTION 'probe 440 failed: % refused by another check: %', step, SQLERRM;
      END IF;
    END;
  END LOOP;
  RAISE NOTICE 'probe 440: four cross-workspace writes refused';
END
$probe$;
ROLLBACK;
