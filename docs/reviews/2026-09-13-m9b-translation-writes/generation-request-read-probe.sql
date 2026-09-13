DO $$
DECLARE f jsonb:=current_setting('openplan.generation_read_fixture')::jsonb;
BEGIN
 INSERT INTO auth.users(id,aud,role,email) VALUES((f->>'member')::uuid,'authenticated','authenticated','read-member@synthetic.invalid'),
 ((f->>'viewer')::uuid,'authenticated','authenticated','read-viewer@synthetic.invalid'),((f->>'outsider')::uuid,'authenticated','authenticated','read-outsider@synthetic.invalid');
 INSERT INTO workspace_members(workspace_id,user_id,role) VALUES((f->>'workspaceId')::uuid,(f->>'member')::uuid,'member'),
 ((f->>'workspaceId')::uuid,(f->>'viewer')::uuid,'viewer');
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('openplan.generation_read_fixture')::jsonb->>'actorId',true) IS NOT NULL;
DO $$
DECLARE f jsonb:=current_setting('openplan.generation_read_fixture')::jsonb; result jsonb;
BEGIN
 result:=read_translation_generation_request((f->>'campaignId')::uuid,(f->>'requestId')::uuid);
 IF result->>'actorId' IS DISTINCT FROM f->>'actorId' OR result->>'workspaceId' IS DISTINCT FROM f->>'workspaceId' OR result->>'campaignId' IS DISTINCT FROM f->>'campaignId'
 OR result->>'requestId' IS DISTINCT FROM f->>'requestId' THEN RAISE EXCEPTION 'Reader returned different scope'; END IF;
 IF jsonb_array_length(result->'fields')<>2 OR (result->>'count')::int<>2 THEN RAISE EXCEPTION 'Reader truncated field inventory'; END IF;
 IF result::text LIKE '%credentialCiphertext%' OR result::text LIKE '%key_ciphertext%' OR result::text LIKE '%apiKey%' THEN RAISE EXCEPTION 'Reader leaked captured credentials'; END IF;
 IF result#>>'{fields,0,output,digest}' IS DISTINCT FROM f->>'digest' OR result#>>'{fields,0,state}'<>'completed'
 OR result#>>'{fields,1,state}'<>'queued' THEN RAISE EXCEPTION 'Reader lost retained output or queued field'; END IF;
 PERFORM set_config('openplan.generation_read_result',result::text,true);
END $$;
SELECT 'GENERATION_READ_RESULT:'||current_setting('openplan.generation_read_result');
SELECT set_config('request.jwt.claim.sub',current_setting('openplan.generation_read_fixture')::jsonb->>'member',true) IS NOT NULL;
DO $$
DECLARE f jsonb:=current_setting('openplan.generation_read_fixture')::jsonb;
BEGIN
 IF read_translation_generation_request((f->>'campaignId')::uuid,(f->>'requestId')::uuid) IS DISTINCT FROM current_setting('openplan.generation_read_result')::jsonb THEN
  RAISE EXCEPTION 'Staff reader differs from owner'; END IF;
END $$;
RESET ROLE;
DELETE FROM workspace_members WHERE user_id=(current_setting('openplan.generation_read_fixture')::jsonb->>'member')::uuid
 AND workspace_id=(current_setting('openplan.generation_read_fixture')::jsonb->>'workspaceId')::uuid;
SET LOCAL ROLE authenticated;
DO $$
DECLARE f jsonb:=current_setting('openplan.generation_read_fixture')::jsonb; denied boolean;
BEGIN
 denied:=false;
 BEGIN PERFORM read_translation_generation_request((f->>'campaignId')::uuid,(f->>'requestId')::uuid); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Removed staff read was permitted'; END IF;
 PERFORM set_config('request.jwt.claim.sub',f->>'viewer',true);denied:=false;
 BEGIN PERFORM read_translation_generation_request((f->>'campaignId')::uuid,(f->>'requestId')::uuid); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Viewer read was permitted'; END IF;
 PERFORM set_config('request.jwt.claim.sub',f->>'outsider',true);denied:=false;
 BEGIN PERFORM read_translation_generation_request((f->>'campaignId')::uuid,(f->>'requestId')::uuid); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Outsider read was permitted'; END IF;
 PERFORM set_config('request.jwt.claim.sub',f->>'actorId',true);denied:=false;
 BEGIN PERFORM read_translation_generation_request((f->>'campaignId')::uuid,(f->>'foreignRequest')::uuid); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Foreign request read was permitted'; END IF;
 BEGIN PERFORM id FROM engagement_translation_generation_requests; RAISE EXCEPTION 'Private request table read was permitted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE anon;
DO $$
DECLARE f jsonb:=current_setting('openplan.generation_read_fixture')::jsonb; denied boolean:=false;
BEGIN
 BEGIN PERFORM read_translation_generation_request((f->>'campaignId')::uuid,(f->>'requestId')::uuid); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Anonymous request read was permitted'; END IF;
END $$;
RESET ROLE;
SELECT 'GENERATION_READ_PROBE_PASSED';
