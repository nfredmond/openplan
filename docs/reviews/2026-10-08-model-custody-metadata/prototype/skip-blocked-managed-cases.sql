-- Invoked inside the verifier's rollback-only transaction after prototype DDL.
CREATE TEMP TABLE skip_role_fixture (
 kind text, run_id uuid, workspace_id uuid, stage_id uuid, blocker_id uuid,
 request_id uuid, expected_outcome text, before_parent jsonb, before_stages jsonb,
 before_attempts jsonb
);
GRANT SELECT ON skip_role_fixture TO service_role,anon,authenticated;
DO $$
DECLARE kind text; run uuid; ws uuid; prior uuid; target uuid; attempt uuid;
BEGIN
 FOREACH kind IN ARRAY ARRAY['unmanaged','managed_failure','managed_reaped'] LOOP
  run:=gen_random_uuid(); prior:=gen_random_uuid(); target:=gen_random_uuid();
  INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
   SELECT run,workspace_id,model_id,engine_key,'queued','Synthetic skip role proof',created_by
   FROM public.model_runs WHERE id='__FIXTURE_RUN__' RETURNING workspace_id INTO ws;
  IF ws IS NULL THEN RAISE EXCEPTION 'Role fixture missing'; END IF;
  INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES
   (prior,run,'Synthetic predecessor',CASE WHEN kind='unmanaged' THEN 'failed' ELSE 'queued' END,1),
   (target,run,'Synthetic dependent','queued',2);
  IF kind<>'unmanaged' THEN
   attempt:=(public.claim_model_stage_attempt(gen_random_uuid(),prior,'synthetic-skip-proof')->>'attempt_id')::uuid;
   IF attempt IS NULL THEN RAISE EXCEPTION 'Managed fixture was not claimed'; END IF;
   IF kind='managed_failure' THEN
    PERFORM public.write_model_stage_attempt(gen_random_uuid(),attempt,'failed','Synthetic log','Synthetic failure');
   ELSE
    IF NOT public.reap_model_run_if_stale(run,clock_timestamp()+interval '1 second','Synthetic forced reaper') THEN
     RAISE EXCEPTION 'Managed fixture was not reaped';
    END IF;
   END IF;
  END IF;
  INSERT INTO skip_role_fixture SELECT kind,run,ws,target,prior,gen_random_uuid(),
   CASE WHEN kind='unmanaged' THEN 'skipped' ELSE 'not_skipped' END,
   (SELECT to_jsonb(r) FROM public.model_runs r WHERE id=run),
   (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.model_run_stages s WHERE run_id=run),
   (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]'::jsonb) FROM public.model_stage_attempts a WHERE run_id=run);
 END LOOP;
END $$;

SET LOCAL ROLE anon;
DO $$ DECLARE f record; BEGIN
 SELECT * INTO STRICT f FROM skip_role_fixture WHERE kind='unmanaged';
 BEGIN
  PERFORM public.skip_blocked_model_stage(f.request_id,f.workspace_id,f.run_id,f.stage_id,f.blocker_id,'failed');
  RAISE EXCEPTION 'Anonymous skip invocation allowed' USING ERRCODE='ZX002';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN
 SELECT * INTO STRICT f FROM skip_role_fixture WHERE kind='unmanaged';
 BEGIN
  PERFORM public.skip_blocked_model_stage(f.request_id,f.workspace_id,f.run_id,f.stage_id,f.blocker_id,'failed');
  RAISE EXCEPTION 'Authenticated skip invocation allowed' USING ERRCODE='ZX002';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ DECLARE f record; receipt jsonb; BEGIN
 FOR f IN SELECT * FROM skip_role_fixture LOOP
  receipt:=public.skip_blocked_model_stage(f.request_id,f.workspace_id,f.run_id,f.stage_id,f.blocker_id,'failed');
  IF receipt->>'outcome' IS DISTINCT FROM f.expected_outcome THEN
   RAISE EXCEPTION 'Service skip outcome differs for %',f.kind;
  END IF;
  IF public.skip_blocked_model_stage(f.request_id,f.workspace_id,f.run_id,f.stage_id,f.blocker_id,'failed') IS DISTINCT FROM receipt THEN
   RAISE EXCEPTION 'Service retry differs';
  END IF;
 END LOOP;
 BEGIN
  UPDATE public.model_stage_skip_receipts SET response_payload='{}'::jsonb;
  RAISE EXCEPTION 'Service directly rewrote skip receipts' USING ERRCODE='ZX002';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT * FROM skip_role_fixture LOOP
  IF (SELECT to_jsonb(r) FROM public.model_runs r WHERE id=f.run_id) IS DISTINCT FROM f.before_parent
   OR (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]'::jsonb) FROM public.model_stage_attempts a WHERE run_id=f.run_id) IS DISTINCT FROM f.before_attempts THEN
   RAISE EXCEPTION 'Role invocation changed parent or attempts';
  END IF;
  IF f.kind<>'unmanaged' AND (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.model_run_stages s WHERE run_id=f.run_id) IS DISTINCT FROM f.before_stages THEN
   RAISE EXCEPTION 'Managed terminal stage history changed';
  END IF;
 END LOOP;
END $$;
