-- These structural frames test native custody, not semantic reconstruction.
RESET ROLE;
CREATE TEMP TABLE context_frames(index integer PRIMARY KEY, body text);
GRANT SELECT ON context_frames TO service_role,authenticated;
INSERT INTO context_frames VALUES(0,'{"schemaVersion":1,"purpose":"private_synthesis_context_content_frame","contextManifestSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","targetRecordId":"item:b0000000-0000-4000-8000-000000000301","rangeUnit":"utf16_code_units","index":0,"parts":[{"id":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","text":"SYNTHETIC retained context frame"}]}'),(1,'{"schemaVersion":1,"purpose":"private_synthesis_context_content_frame","contextManifestSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","targetRecordId":"item:b0000000-0000-4000-8000-000000000301","rangeUnit":"utf16_code_units","index":1,"parts":[{"id":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","text":"SYNTHETIC original\u0000\ud800 \u00e9 \ud83d\ude00"}]}');
CREATE TEMP TABLE context_plan_probe(key text PRIMARY KEY,value jsonb);
GRANT SELECT,INSERT ON context_plan_probe TO service_role,authenticated;
CREATE FUNCTION pg_temp.cp_header(request uuid DEFAULT 'f0000000-0000-4000-8000-000000000010',patch jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r public.engagement_synthesis_generation_requests; c public.engagement_synthesis_context_requests; tail text; bytes bigint:=0; frame record;
BEGIN
 SELECT * INTO r FROM engagement_synthesis_generation_requests WHERE id=request;
 SELECT * INTO c FROM engagement_synthesis_context_requests WHERE request_id=request;
 tail:=encode(extensions.digest('synthesis-context-frames-v1:'||request::text||':'||repeat('e',64)||':'||c.context_sha256,'sha256'),'hex');
 FOR frame IN SELECT * FROM context_frames ORDER BY index LOOP
  bytes:=bytes+octet_length(frame.body);
  tail:=encode(extensions.digest(tail||':'||frame.index::text||':'||encode(extensions.digest(frame.body,'sha256'),'hex')||':'||octet_length(frame.body)::text,'sha256'),'hex');
 END LOOP;
 RETURN jsonb_build_object('schemaVersion',1,'purpose','private_synthesis_context_frame_plan','requestId',request,
  'actorId',r.actor_id,'intentSha256',r.intent_sha256,'contextRequestSha256',c.context_sha256,
  'recipeId','openplan.engagement.synthesis.context.v1','recipeSha256','1ef05631ff83fbf8a85e08110c800f820586580b91c76824728de944d0d88abc',
  'continuationHeaderSha256',repeat('e',64),'contentManifestSha256',repeat('c',64),'contextManifestSha256',repeat('b',64),
  'targetRecordId','item:b0000000-0000-4000-8000-000000000301','frameByteLimit',4096,'frameCount',2,'frameBytes',bytes,'tailSha256',tail)||patch;
END $$;
CREATE FUNCTION pg_temp.cp_prepare(patch jsonb DEFAULT '{}',request uuid DEFAULT 'f0000000-0000-4000-8000-000000000010') RETURNS jsonb LANGUAGE sql AS $$
 SELECT prepare_engagement_synthesis_context_plan(request,pg_temp.cp_header(request,patch)::text);
$$;
CREATE FUNCTION pg_temp.cp_stage(start_at bigint DEFAULT 0,limit_count integer DEFAULT 2,request uuid DEFAULT 'f0000000-0000-4000-8000-000000000010',body_patch jsonb DEFAULT NULL,prefix text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT stage_engagement_synthesis_context_frames(request,start_at,coalesce(prefix,
  CASE WHEN start_at=0 THEN encode(extensions.digest('synthesis-context-frames-v1:'||request::text||':'||repeat('e',64)||':'||
   (SELECT context_sha256 FROM engagement_synthesis_context_requests WHERE request_id=request),'sha256'),'hex')
  ELSE (SELECT chain_sha256 FROM engagement_synthesis_generation_plan_tasks WHERE request_id=request AND task_index=start_at-1) END),
  (SELECT jsonb_agg(CASE WHEN body_patch IS NOT NULL THEN (body::jsonb||body_patch)::text ELSE body END ORDER BY index)::text
   FROM (SELECT * FROM context_frames WHERE index>=start_at ORDER BY index LIMIT limit_count) frames));
$$;
CREATE FUNCTION pg_temp.cp_seal(request uuid DEFAULT 'f0000000-0000-4000-8000-000000000010',header_hash text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT seal_engagement_synthesis_context_plan(request,coalesce(header_hash,(SELECT header_sha256 FROM engagement_synthesis_generation_plans WHERE request_id=request)));
$$;
-- Current staff commands for context requests do not expose worker staging.
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
DO $$ DECLARE patch jsonb; BEGIN
 FOREACH patch IN ARRAY ARRAY[
  '{"schemaVersion":2}'::jsonb,'{"purpose":"wrong"}','{"requestId":"f0000000-0000-4000-8000-000000000099"}',
  '{"actorId":"13466ed2-dcb7-4861-a528-68cc5579eea9"}','{"intentSha256":"wrong"}','{"contextRequestSha256":"wrong"}',
  '{"recipeId":"openplan.engagement.synthesis.segment.v1"}','{"recipeSha256":"wrong"}',
  '{"continuationHeaderSha256":"wrong"}','{"contentManifestSha256":"wrong"}','{"contextManifestSha256":"wrong"}',
  '{"targetRecordId":"item:b0000000-0000-4000-8000-000000000999"}','{"frameByteLimit":8192}',
  '{"frameCount":0}','{"frameCount":0.5}','{"frameCount":9007199254740992}','{"frameBytes":0}',
  '{"tailSha256":"wrong"}','{"extra":true}'
 ] LOOP
  PERFORM pg_temp.expect_error(format('SELECT pg_temp.cp_prepare(%L)',patch),'22023','Malformed context plan header accepted');
 END LOOP;
END $$;
SELECT pg_temp.expect_error($q$SELECT prepare_engagement_synthesis_context_plan('f0000000-0000-4000-8000-000000000010',repeat(' ',4097)||pg_temp.cp_header()::text)$q$,'22023','Oversized context header accepted');
SELECT pg_temp.expect_error($q$SELECT prepare_engagement_synthesis_context_plan('f0000000-0000-4000-8000-000000000010',replace(pg_temp.cp_header()::text,'"schemaVersion": 1','"schemaVersion": 2,"schemaVersion": 1'))$q$,'22023','Duplicate context header accepted');
SELECT pg_temp.expect_error($q$SELECT read_engagement_synthesis_context_plan('f0000000-0000-4000-8000-000000000001')$q$,'42501','Revoked parent gained context worker access');
INSERT INTO context_plan_probe VALUES('prepared',pg_temp.cp_prepare());
SELECT pg_temp.assert_true((SELECT value->>'nextIndex'='0' AND value->'seal'='null'::jsonb FROM context_plan_probe WHERE key='prepared'),'Context preparation cursor differs');
SELECT pg_temp.assert_true(pg_temp.cp_prepare()=(SELECT value FROM context_plan_probe WHERE key='prepared'),'Context preparation retry differs');
SELECT pg_temp.expect_error('SELECT pg_temp.cp_seal()','PT409','Incomplete context plan sealed');
SELECT pg_temp.expect_error($q$SELECT pg_temp.cp_prepare('{"frameCount":3}')$q$,'PT409','Changed context plan header replayed');
SELECT pg_temp.expect_error($q$SELECT pg_temp.cp_stage(1,1,prefix:=repeat('0',64))$q$,'PT409','Out of sequence context frame accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.cp_stage(prefix:=repeat('0',64))$q$,'PT409','Wrong context prefix accepted');
SELECT pg_temp.expect_error($q$SELECT stage_engagement_synthesis_context_frames('f0000000-0000-4000-8000-000000000010',0,(SELECT value->>'tailSha256' FROM context_plan_probe WHERE key='prepared'),
 repeat(' ',4194305)||(SELECT jsonb_build_array(body)::text FROM context_frames WHERE index=0))$q$,'22023','Oversized context staging packet accepted');
SELECT pg_temp.expect_error($q$SELECT stage_engagement_synthesis_context_frames('f0000000-0000-4000-8000-000000000010',0,(SELECT value->>'tailSha256' FROM context_plan_probe WHERE key='prepared'),'[]')$q$,'22023','Empty context frame batch accepted');
SELECT pg_temp.expect_error($q$SELECT stage_engagement_synthesis_context_frames('f0000000-0000-4000-8000-000000000010',0,(SELECT value->>'tailSha256' FROM context_plan_probe WHERE key='prepared'),'[1]')$q$,'22023','Nontext context frame accepted');
SELECT pg_temp.expect_error($q$SELECT stage_engagement_synthesis_context_frames('f0000000-0000-4000-8000-000000000010',0,(SELECT value->>'tailSha256' FROM context_plan_probe WHERE key='prepared'),'["[]"]')$q$,'22023','Nonobject context frame accepted');
INSERT INTO context_plan_probe VALUES('staged',pg_temp.cp_stage());
SELECT pg_temp.assert_true(pg_temp.cp_stage()=(SELECT value FROM context_plan_probe WHERE key='staged'),'Context frame retry differs');
SELECT pg_temp.expect_error($q$SELECT pg_temp.cp_stage(0,1,body_patch:='{"extra":true}')$q$,'PT409','Changed context frame retry accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.cp_seal(header_hash:=repeat('0',64))$q$,'PT409','Wrong context plan sealed');
INSERT INTO context_plan_probe VALUES('sealed',pg_temp.cp_seal());
SELECT pg_temp.assert_true(pg_temp.cp_seal()=(SELECT value FROM context_plan_probe WHERE key='sealed'),'Context seal retry differs');
SELECT pg_temp.assert_true((SELECT value->>'nextIndex'='2' AND value->'seal'<>'null'::jsonb
 AND value->>'frameBytes'=pg_temp.cp_header()->>'frameBytes' AND value->>'tailSha256'=pg_temp.cp_header()->>'tailSha256'
 FROM context_plan_probe WHERE key='sealed'),'Context seal did not cover every original frame');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM context_frames f JOIN engagement_synthesis_context_frames t
 ON t.request_id='f0000000-0000-4000-8000-000000000010' AND t.frame_index=f.index WHERE t.frame_text=f.body
 AND t.frame_sha256=encode(extensions.digest(f.body,'sha256'),'hex') AND t.frame_bytes=octet_length(f.body)),'Original context frame bytes or hashes changed');
SELECT pg_temp.expect_error($q$SELECT read_engagement_synthesis_generation_plan('f0000000-0000-4000-8000-000000000010')$q$,'0A000','Context staging entered segment executor');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM engagement_synthesis_context_frames f JOIN engagement_synthesis_generation_plan_tasks t
 ON t.request_id=f.request_id AND t.task_index=f.frame_index WHERE f.request_id='f0000000-0000-4000-8000-000000000010'
 AND t.task_text::jsonb->>'purpose'='private_synthesis_context_frame_reference'
 AND t.task_text::jsonb->>'frameSha256'=f.frame_sha256 AND t.task_text::jsonb->>'frameBytes'=f.frame_bytes::text
 AND t.task_text::jsonb->>'frameIndex'=f.frame_index::text),'Context frame reference differs from original');
RESET ROLE;
SELECT pg_temp.expect_error($q$UPDATE engagement_synthesis_context_frames SET frame_text='{}' WHERE request_id='f0000000-0000-4000-8000-000000000010'$q$,'P0001','Context frame original changed');
SELECT pg_temp.expect_error($q$DELETE FROM engagement_synthesis_context_frames WHERE request_id='f0000000-0000-4000-8000-000000000010'$q$,'P0001','Context frame original deleted');
-- A retained seal can be recovered after cancellation without creating work.
SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.gen_cancel('f0000000-0000-4000-8000-000000000010','f0000000-0000-4000-8000-000000000110');
RESET ROLE; SELECT set_config('request.jwt.claim.sub','',true); SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(pg_temp.cp_prepare()=(SELECT value||'{"cancelled":true}' FROM context_plan_probe WHERE key='sealed'),'Cancelled context preparation lost exact recovery');
SELECT pg_temp.assert_true(pg_temp.cp_stage()=(SELECT value||'{"cancelled":true}' FROM context_plan_probe WHERE key='sealed'),'Cancelled context frame retry lost exact recovery');
SELECT pg_temp.assert_true(pg_temp.cp_seal()=(SELECT value||'{"cancelled":true}' FROM context_plan_probe WHERE key='sealed'),'Cancelled context seal lost exact recovery');
RESET ROLE;
-- Each incomplete plan has its own immutable request identity.
SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE n integer; BEGIN
 FOR n IN 30..37 LOOP
  PERFORM pg_temp.ctx_create(('f0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid);
 END LOOP;
END $$;
SELECT pg_temp.gen_cancel('f0000000-0000-4000-8000-000000000030','f0000000-0000-4000-8000-000000000130');
RESET ROLE; SELECT set_config('request.jwt.claim.sub','',true); SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT pg_temp.cp_prepare(request:='f0000000-0000-4000-8000-000000000030')$q$,'PT409','Cancelled context prepared new work');
SELECT pg_temp.cp_prepare(request:='f0000000-0000-4000-8000-000000000031');
SELECT pg_temp.cp_stage(0,1,'f0000000-0000-4000-8000-000000000031');
SELECT pg_temp.expect_error($q$SELECT pg_temp.cp_stage(0,2,'f0000000-0000-4000-8000-000000000031')$q$,'PT409','Context retry overlapped new work');
RESET ROLE; SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true); SET LOCAL ROLE authenticated;
SELECT pg_temp.gen_cancel('f0000000-0000-4000-8000-000000000031','f0000000-0000-4000-8000-000000000131');
RESET ROLE; SELECT set_config('request.jwt.claim.sub','',true); SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(pg_temp.cp_stage(0,1,'f0000000-0000-4000-8000-000000000031')->>'nextIndex'='1','Cancelled partial context lost exact frame retry');
SELECT pg_temp.expect_error($q$SELECT pg_temp.cp_stage(1,1,'f0000000-0000-4000-8000-000000000031')$q$,'PT409','Cancelled context staged new frames');
SELECT pg_temp.expect_error($q$SELECT pg_temp.cp_seal('f0000000-0000-4000-8000-000000000031')$q$,'PT409','Cancelled partial context sealed');
-- A fully staged but unsealed cancelled request isolates the cancellation gate.
SELECT pg_temp.cp_prepare(request:='f0000000-0000-4000-8000-000000000032');
SELECT pg_temp.cp_stage(request:='f0000000-0000-4000-8000-000000000032');
RESET ROLE; SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true); SET LOCAL ROLE authenticated;
SELECT pg_temp.gen_cancel('f0000000-0000-4000-8000-000000000032','f0000000-0000-4000-8000-000000000132');
RESET ROLE; SELECT set_config('request.jwt.claim.sub','',true); SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT pg_temp.cp_seal('f0000000-0000-4000-8000-000000000032')$q$,'PT409','Cancelled complete context sealed');
SELECT pg_temp.cp_prepare('{"frameCount":3}','f0000000-0000-4000-8000-000000000033');
SELECT pg_temp.cp_stage(request:='f0000000-0000-4000-8000-000000000033');
SELECT pg_temp.expect_error($q$SELECT pg_temp.cp_seal('f0000000-0000-4000-8000-000000000033')$q$,'PT409','Wrong context frame count sealed');
SELECT pg_temp.cp_prepare(jsonb_build_object('frameBytes',(pg_temp.cp_header()->>'frameBytes')::bigint+1),'f0000000-0000-4000-8000-000000000034');
SELECT pg_temp.cp_stage(request:='f0000000-0000-4000-8000-000000000034');
SELECT pg_temp.expect_error($q$SELECT pg_temp.cp_seal('f0000000-0000-4000-8000-000000000034')$q$,'PT409','Wrong context byte total sealed');
SELECT pg_temp.cp_prepare('{"tailSha256":"0000000000000000000000000000000000000000000000000000000000000000"}','f0000000-0000-4000-8000-000000000035');
SELECT pg_temp.cp_stage(request:='f0000000-0000-4000-8000-000000000035');
SELECT pg_temp.expect_error($q$SELECT pg_temp.cp_seal('f0000000-0000-4000-8000-000000000035')$q$,'PT409','Wrong context chain sealed');
SELECT pg_temp.cp_prepare(jsonb_build_object('frameBytes',(pg_temp.cp_header()->>'frameBytes')::bigint-1),'f0000000-0000-4000-8000-000000000036');
SELECT pg_temp.expect_error($q$SELECT pg_temp.cp_stage(request:='f0000000-0000-4000-8000-000000000036')$q$,'PT409','Context byte ceiling exceeded');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM engagement_synthesis_context_frames WHERE request_id='f0000000-0000-4000-8000-000000000036')
 AND NOT EXISTS(SELECT 1 FROM engagement_synthesis_generation_plan_tasks WHERE request_id='f0000000-0000-4000-8000-000000000036'),'Refused batch retained partial frame or reference');
SELECT pg_temp.cp_prepare('{"frameCount":129,"frameBytes":1000000}','f0000000-0000-4000-8000-000000000037');
SELECT pg_temp.expect_error($q$SELECT stage_engagement_synthesis_context_frames('f0000000-0000-4000-8000-000000000037',0,
 read_engagement_synthesis_context_plan('f0000000-0000-4000-8000-000000000037')->>'tailSha256',
 (SELECT jsonb_agg(f.body)::text FROM context_frames f CROSS JOIN generate_series(1,129) WHERE f.index=0))$q$,'22023','Context batch count limit bypassed');
SELECT pg_temp.expect_error($q$SELECT stage_engagement_synthesis_context_frames('f0000000-0000-4000-8000-000000000037',0,
 read_engagement_synthesis_context_plan('f0000000-0000-4000-8000-000000000037')->>'tailSha256',
 jsonb_build_array(jsonb_build_object('text',repeat('x',4096))::text)::text)$q$,'22023','Context individual frame limit bypassed');
RESET ROLE;
-- Grants are checked separately, so another scope denial cannot hide exposure.
SELECT pg_temp.assert_true(NOT has_function_privilege('service_role','public.lock_synthesis_context_plan_scope(uuid)','EXECUTE'),'Private context plan scope exposed');
DO $$ DECLARE signature text; role_name text; BEGIN
 FOREACH signature IN ARRAY ARRAY['public.read_engagement_synthesis_context_plan(uuid)','public.prepare_engagement_synthesis_context_plan(uuid,text)',
  'public.stage_engagement_synthesis_context_frames(uuid,bigint,text,text)','public.seal_engagement_synthesis_context_plan(uuid,text)'] LOOP
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   PERFORM pg_temp.assert_true(NOT has_function_privilege(role_name,signature,'EXECUTE'),'Context worker command exposed to staff or public');
  END LOOP;
 END LOOP;
END $$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT * FROM engagement_synthesis_context_frames','42501','Private context frame table exposed');
RESET ROLE;
UPDATE workspace_members SET role='owner' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
UPDATE workspace_members SET role='viewer' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='7a50d4fb-35b7-41f4-9bce-8a4e7d157569';
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('SELECT pg_temp.cp_prepare()','42501','Revoked context requester kept staging access');
SELECT pg_temp.expect_error($q$SELECT read_engagement_synthesis_context_plan('f0000000-0000-4000-8000-000000000001')$q$,'0A000','Segment request entered context plan');
RESET ROLE;
SELECT 'synthesis-context-plan-verified';
