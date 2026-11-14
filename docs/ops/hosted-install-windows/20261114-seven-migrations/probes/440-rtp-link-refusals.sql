-- Probe for PR 440 (20261102140000), rolled back. Run after the install:
--   bash $KIT/kit.sh hosted $W probe /work/probes/440-rtp-link-refusals.sql
-- The kit replaces the final ROLLBACK with a raise and then rolls back.
--
-- Synthetic rows only. It writes nothing to auth.users: the two workspaces
-- are inserted directly, as the guard needs only workspace ids. Workspace A
-- holds a project, a cycle and a link; workspace B holds a project. Four
-- cross-workspace writes must each be refused with SQLSTATE 23514 and the
-- guard's own message.
--
-- Reading the result (the envelope reads probe-failed for every case but the
-- first; read its stderrTail):
--   probe-complete, notice "probe 440: four cross-workspace writes refused":
--     the migration behaves as intended.
--   "PROBE SETUP FAILED, probe 440": the probe could not build its synthetic
--     rows. This says nothing about the migration and is not a reason to roll
--     back.
--   "PROBE BLOCKED, probe 440": a lock held by live traffic ran past the lock
--     timeout. Run the probe again later. Not a reason to roll back.
--   "PROBE CHECK FAILED, probe 440": a refusal the migration adds did not
--     happen. Stop and review (rollback is a separate decision).
-- Without the migration (448) the first write is accepted and the probe reads
-- "PROBE CHECK FAILED, probe 440: link to another workspace's project accepted".
DO $probe$
DECLARE
  ws_a constant uuid := '00000000-0000-4000-8000-0000000440a0';
  ws_b constant uuid := '00000000-0000-4000-8000-0000000440b0';
  project_a constant uuid := '00000000-0000-4000-8000-0000000440a2';
  project_b constant uuid := '00000000-0000-4000-8000-0000000440b2';
  cycle_a constant uuid := '00000000-0000-4000-8000-0000000440a3';
  link_a constant uuid := '00000000-0000-4000-8000-0000000440a4';
  step text;
BEGIN
  BEGIN
    INSERT INTO public.workspaces (id, name, slug) VALUES
      (ws_a, 'SYNTHETIC RTP probe workspace A', 'synthetic-rtp-probe-' || ws_a::text),
      (ws_b, 'SYNTHETIC RTP probe workspace B', 'synthetic-rtp-probe-' || ws_b::text);
    INSERT INTO public.projects (id, workspace_id, name) VALUES
      (project_a, ws_a, 'SYNTHETIC RTP probe project A'),
      (project_b, ws_b, 'SYNTHETIC RTP probe project B');
    INSERT INTO public.rtp_cycles (id, workspace_id, title) VALUES (cycle_a, ws_a, 'SYNTHETIC RTP probe cycle');
    INSERT INTO public.project_rtp_cycle_links (id, workspace_id, project_id, rtp_cycle_id) VALUES (link_a, ws_a, project_a, cycle_a);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'PROBE SETUP FAILED, probe 440 (synthetic rows could not be written; says nothing about the migration; not a reason to roll back): % (SQLSTATE %)', SQLERRM, SQLSTATE;
  END;

  BEGIN
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
        RAISE EXCEPTION '% accepted', step;
      EXCEPTION WHEN check_violation THEN
        IF SQLERRM NOT IN ('An RTP project link must stay inside one workspace',
                           'A project or RTP cycle with RTP project links cannot move to another workspace') THEN
          RAISE EXCEPTION '% refused by another check: %', step, SQLERRM;
        END IF;
      END;
    END LOOP;
  EXCEPTION
    WHEN lock_not_available OR deadlock_detected THEN
      RAISE EXCEPTION 'PROBE BLOCKED, probe 440 (live traffic held a lock; run again later; not a reason to roll back): % (SQLSTATE %)', SQLERRM, SQLSTATE;
    WHEN OTHERS THEN
      RAISE EXCEPTION 'PROBE CHECK FAILED, probe 440: % (SQLSTATE %)', SQLERRM, SQLSTATE;
  END;
  RAISE NOTICE 'probe 440: four cross-workspace writes refused';
END
$probe$;
ROLLBACK;
