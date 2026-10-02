-- Synthetic byte custody, not provider execution or semantic reconstruction.
RESET ROLE;
CREATE TEMP TABLE thematic_frames(index integer PRIMARY KEY,body text);
GRANT SELECT ON thematic_frames TO service_role;
INSERT INTO thematic_frames VALUES(0,'{"text":"SYNTHETIC first é 中文 😀"}'),(1,'{"text":"SYNTHETIC exact\u0000\ud800 tail"}');
CREATE TEMP TABLE thematic_plan_probe(key text PRIMARY KEY,value jsonb);
GRANT SELECT,INSERT ON thematic_plan_probe TO service_role;
CREATE FUNCTION pg_temp.tp_header(patch jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r engagement_synthesis_generation_requests; t engagement_synthesis_thematic_requests; s engagement_synthesis_thematic_input_seals;
 tail text; bytes bigint:=0; frame record;
BEGIN
 SELECT * INTO r FROM engagement_synthesis_generation_requests WHERE id='f0000000-0000-4000-8000-000000000010';
 SELECT * INTO t FROM engagement_synthesis_thematic_requests WHERE request_id=r.id;
 SELECT * INTO s FROM engagement_synthesis_thematic_input_seals WHERE request_id=r.id;
 tail:=encode(extensions.digest('synthesis-thematic-frames-v1:'||r.id::text||':'||repeat('e',64)||':'||s.manifest_sha256||':'||s.receipt_sha256,'sha256'),'hex');
 FOR frame IN SELECT * FROM thematic_frames ORDER BY index LOOP
  bytes:=bytes+octet_length(frame.body);
  tail:=encode(extensions.digest(tail||':'||frame.index::text||':'||encode(extensions.digest(frame.body,'sha256'),'hex')||':'||octet_length(frame.body)::text,'sha256'),'hex');
 END LOOP;
 RETURN jsonb_build_object('schemaVersion',1,'purpose','private_synthesis_thematic_frame_plan','requestId',r.id,
 'campaignId',r.campaign_id,'workspaceId',r.workspace_id,'actorId',r.actor_id,'intentSha256',r.intent_sha256,'thematicRequestSha256',t.thematic_sha256,
 'recipeId','openplan.engagement.synthesis.thematic.v1','recipeSha256','7310c615ecff9ec8d67f498d188321c2bc104cec6020b206481953c7f88eda69',
 'continuationHeaderSha256',repeat('e',64),'contentManifestSha256',repeat('c',64),'inputManifestSha256',s.manifest_sha256,'inputSealSha256',s.receipt_sha256,
 'frameByteLimit',t.thematic_text::jsonb->'frameByteLimit','taskByteLimit',r.intent_text::jsonb->'taskByteLimit',
 'frameCount',2,'taskCount',3,'frameBytes',bytes,'tailSha256',tail)||patch;
END $$;
CREATE FUNCTION pg_temp.tp_prepare(patch jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
 SELECT prepare_engagement_synthesis_thematic_plan('f0000000-0000-4000-8000-000000000010',pg_temp.tp_header(patch)::text);
$$;
CREATE FUNCTION pg_temp.tp_read() RETURNS jsonb LANGUAGE sql AS $$
 SELECT read_engagement_synthesis_thematic_plan('f0000000-0000-4000-8000-000000000010');
$$;
CREATE FUNCTION pg_temp.tp_stage(start_at bigint DEFAULT 0,limit_count integer DEFAULT 2,raw_frames text DEFAULT NULL,prefix text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT stage_engagement_synthesis_thematic_frames('f0000000-0000-4000-8000-000000000010',start_at,
 coalesce(prefix,CASE WHEN start_at=0 THEN encode(extensions.digest('synthesis-thematic-frames-v1:f0000000-0000-4000-8000-000000000010:'||repeat('e',64)||':'||
 (pg_temp.tp_header()->>'inputManifestSha256')||':'||(pg_temp.tp_header()->>'inputSealSha256'),'sha256'),'hex')
 ELSE (SELECT chain_sha256 FROM engagement_synthesis_generation_plan_tasks WHERE request_id='f0000000-0000-4000-8000-000000000010' AND task_index=start_at-1) END),
 coalesce(raw_frames,(SELECT jsonb_agg(body ORDER BY index)::text FROM (SELECT * FROM thematic_frames WHERE index>=start_at ORDER BY index LIMIT limit_count) f)));
$$;
CREATE FUNCTION pg_temp.tp_seal(header_hash text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT seal_engagement_synthesis_thematic_plan('f0000000-0000-4000-8000-000000000010',coalesce(header_hash,pg_temp.tp_read()->>'headerSha256'));
$$;
-- Each scenario rolls back only its own writes, preserving the input seal.
CREATE FUNCTION pg_temp.tp_scenario(commands text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE commands; RAISE EXCEPTION 'Restore thematic staging scenario' USING ERRCODE='ZX001';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL; END;
END $$;
CREATE FUNCTION pg_temp.tp_cancel() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO engagement_synthesis_generation_cancellations(request_id,id,campaign_id,workspace_id,actor_id,receipt_text)
 SELECT id,'f0000000-0000-4000-8000-000000000110',campaign_id,workspace_id,actor_id,'{"schemaVersion":1,"reason":"SYNTHETIC cancellation"}'
 FROM engagement_synthesis_generation_requests WHERE id='f0000000-0000-4000-8000-000000000010';
END $$;
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('SELECT pg_temp.tp_prepare()','PT409','Missing input seal allowed staging');
RESET ROLE;
SELECT pg_temp.seal_save();
SET LOCAL ROLE service_role;
DO $$ DECLARE patch jsonb; BEGIN
 FOREACH patch IN ARRAY ARRAY['{"schemaVersion":2}'::jsonb,'{"purpose":"wrong"}',
 '{"requestId":"f0000000-0000-4000-8000-000000000099"}','{"campaignId":"00000000-0000-4000-8000-000000000099"}',
 '{"workspaceId":"00000000-0000-4000-8000-000000000099"}','{"actorId":"00000000-0000-4000-8000-000000000099"}',
 '{"intentSha256":"wrong"}','{"thematicRequestSha256":"wrong"}','{"recipeId":"wrong"}','{"recipeSha256":"wrong"}',
 '{"inputManifestSha256":"wrong"}','{"inputSealSha256":"wrong"}','{"continuationHeaderSha256":"wrong"}','{"contentManifestSha256":"wrong"}',
 '{"frameByteLimit":8192}','{"taskByteLimit":1}','{"frameCount":0}','{"frameCount":0.5}',
 '{"frameCount":9007199254740992}','{"taskCount":2}','{"frameBytes":0}','{"frameBytes":"1"}','{"tailSha256":"wrong"}','{"extra":true}'] LOOP
  PERFORM pg_temp.expect_error(format('SELECT pg_temp.tp_prepare(%L)',patch),'22023','Malformed thematic plan header accepted: '||patch::text);
 END LOOP;
END $$;
SELECT pg_temp.expect_error($q$SELECT prepare_engagement_synthesis_thematic_plan('f0000000-0000-4000-8000-000000000010',repeat(' ',8193)||pg_temp.tp_header()::text)$q$,'22023','Oversized thematic header accepted');
SELECT pg_temp.expect_error($q$SELECT prepare_engagement_synthesis_thematic_plan('f0000000-0000-4000-8000-000000000010',replace(pg_temp.tp_header()::text,'"schemaVersion": 1','"schemaVersion": 2,"schemaVersion": 1'))$q$,'22023','Duplicate thematic header accepted');
SELECT pg_temp.tp_scenario($s$SELECT pg_temp.tp_prepare('{"frameCount":3,"taskCount":4}');SELECT pg_temp.tp_stage();SELECT pg_temp.expect_error('SELECT pg_temp.tp_seal()','PT409','Wrong frame count sealed')$s$);
SELECT pg_temp.tp_scenario($s$SELECT pg_temp.tp_prepare(jsonb_build_object('frameBytes',(pg_temp.tp_header()->>'frameBytes')::int+1));SELECT pg_temp.tp_stage();SELECT pg_temp.expect_error('SELECT pg_temp.tp_seal()','PT409','Wrong byte total sealed')$s$);
SELECT pg_temp.tp_scenario($s$SELECT pg_temp.tp_prepare(jsonb_build_object('tailSha256',repeat('0',64)));SELECT pg_temp.tp_stage();SELECT pg_temp.expect_error('SELECT pg_temp.tp_seal()','PT409','Wrong frame tail sealed')$s$);
SELECT pg_temp.tp_scenario($s$SELECT pg_temp.tp_prepare(jsonb_build_object('frameBytes',(pg_temp.tp_header()->>'frameBytes')::int-1));SELECT pg_temp.expect_error('SELECT pg_temp.tp_stage()','PT409','Frame byte ceiling exceeded');SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM engagement_synthesis_thematic_frames WHERE request_id='f0000000-0000-4000-8000-000000000010'),'Refused batch retained frames');SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM engagement_synthesis_generation_plan_tasks WHERE request_id='f0000000-0000-4000-8000-000000000010'),'Refused batch retained references')$s$);
RESET ROLE;
SELECT pg_temp.tp_scenario($s$SELECT pg_temp.tp_cancel();SELECT pg_temp.expect_error('SELECT pg_temp.tp_prepare()','PT409','Cancelled request prepared')$s$);
SELECT pg_temp.tp_scenario($s$SELECT pg_temp.tp_prepare();SELECT pg_temp.tp_stage(0,1);SELECT pg_temp.tp_cancel();SELECT pg_temp.assert_true(pg_temp.tp_stage(0,1)->>'cancelled'='true','Cancelled prefix retry unavailable');SELECT pg_temp.expect_error('SELECT pg_temp.tp_stage(1,1)','PT409','Cancelled request staged')$s$);
SELECT pg_temp.tp_scenario($s$SELECT pg_temp.tp_prepare();SELECT pg_temp.tp_stage();SELECT pg_temp.tp_cancel();SELECT pg_temp.expect_error('SELECT pg_temp.tp_seal()','PT409','Cancelled complete request sealed')$s$);
SET LOCAL ROLE service_role;
INSERT INTO thematic_plan_probe VALUES('prepared',pg_temp.tp_prepare());
SELECT pg_temp.assert_true(pg_temp.tp_prepare()=(SELECT value FROM thematic_plan_probe WHERE key='prepared'),'Preparation retry changed');
SELECT pg_temp.assert_true(pg_temp.tp_read()->>'nextIndex'='0' AND pg_temp.tp_read()->>'frameBytes'='0','Empty cursor differs');
SELECT pg_temp.expect_error('SELECT pg_temp.tp_seal()','PT409','Incomplete plan sealed');
SELECT pg_temp.expect_error($q$SELECT pg_temp.tp_prepare('{"taskCount":4}')$q$,'PT409','Changed plan retry accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.tp_stage(1,1,prefix:=repeat('0',64))$q$,'PT409','Frame gap accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.tp_stage(prefix:=repeat('0',64))$q$,'PT409','Wrong prefix accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.tp_stage(raw_frames:=repeat(' ',4194305)||'["{}"]')$q$,'22023','Oversized packet accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.tp_stage(raw_frames:='[]')$q$,'22023','Empty packet accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.tp_stage(raw_frames:='[1]')$q$,'22023','Nontext frame accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.tp_stage(raw_frames:='["[]"]')$q$,'22023','Nonobject frame accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.tp_stage(raw_frames:=(SELECT jsonb_agg('{}'::text)::text FROM generate_series(1,129)))$q$,'22023','Frame count limit bypassed');
SELECT pg_temp.expect_error($q$SELECT pg_temp.tp_stage(raw_frames:=jsonb_build_array(jsonb_build_object('text',repeat('x',4096))::text)::text)$q$,'22023','Individual frame limit bypassed');
SELECT pg_temp.tp_stage(0,1);
SELECT pg_temp.expect_error('SELECT pg_temp.tp_stage()','PT409','Overlapping retry accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.tp_stage(0,1,'["{}"]')$q$,'PT409','Changed frame retry accepted');
SELECT pg_temp.tp_stage(1,1);
SELECT pg_temp.expect_error($q$SELECT pg_temp.tp_seal(repeat('0',64))$q$,'PT409','Wrong header sealed');
INSERT INTO thematic_plan_probe VALUES('sealed',pg_temp.tp_seal());
SELECT pg_temp.assert_true(pg_temp.tp_seal()=(SELECT value FROM thematic_plan_probe WHERE key='sealed'),'Seal retry changed');
SELECT pg_temp.assert_true(pg_temp.tp_stage()=(SELECT value FROM thematic_plan_probe WHERE key='sealed'),'Sealed frame retry changed');
SELECT pg_temp.assert_true(pg_temp.tp_read()->>'nextIndex'='2' AND pg_temp.tp_read()->>'frameBytes'=pg_temp.tp_header()->>'frameBytes' AND pg_temp.tp_read()->>'tailSha256'=pg_temp.tp_header()->>'tailSha256','Final proposal reference changed frame cursor');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM thematic_frames f JOIN engagement_synthesis_thematic_frames t ON t.frame_index=f.index AND t.request_id='f0000000-0000-4000-8000-000000000010'
 WHERE t.frame_text=f.body AND t.frame_bytes=octet_length(f.body) AND t.frame_sha256=encode(extensions.digest(f.body,'sha256'),'hex')),'Original thematic bytes differ');
SELECT pg_temp.assert_true((SELECT count(*)=3 FROM engagement_synthesis_generation_plan_tasks WHERE request_id='f0000000-0000-4000-8000-000000000010'),'Proposal slot missing or duplicated');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM engagement_synthesis_thematic_frames f JOIN engagement_synthesis_generation_plan_tasks t ON t.request_id=f.request_id AND t.task_index=f.frame_index
 WHERE t.task_text::jsonb->>'purpose'='private_synthesis_thematic_frame_reference' AND t.task_text::jsonb->>'frameSha256'=f.frame_sha256
 AND t.task_text::jsonb->>'frameBytes'=f.frame_bytes::text AND t.task_text::jsonb->>'frameIndex'=f.frame_index::text
 AND t.task_text::jsonb->>'inputManifestSha256'=pg_temp.tp_header()->>'inputManifestSha256' AND t.task_text::jsonb->>'contentManifestSha256'=pg_temp.tp_header()->>'contentManifestSha256'),'Frame reference differs');
SELECT pg_temp.assert_true((SELECT task_text=(pg_temp.tp_read()#>>'{seal,receiptText}')::jsonb->>'proposalReferenceText' AND task_sha256=(pg_temp.tp_read()#>>'{seal,receiptText}')::jsonb->>'proposalReferenceSha256'
 FROM engagement_synthesis_generation_plan_tasks WHERE request_id='f0000000-0000-4000-8000-000000000010' AND task_index=2),'Proposal receipt differs');
SELECT pg_temp.expect_error($q$SELECT read_engagement_synthesis_generation_plan('f0000000-0000-4000-8000-000000000010')$q$,'0A000','Thematic staging entered segment executor');
SELECT pg_temp.expect_error($q$SELECT read_engagement_synthesis_context_plan('f0000000-0000-4000-8000-000000000010')$q$,'0A000','Thematic staging entered context executor');
SELECT pg_temp.assert_true(((pg_temp.tp_read()#>>'{seal,receiptText}')::jsonb->>'proposalReferenceText')::jsonb=jsonb_build_object(
 'schemaVersion',1,'purpose','private_synthesis_thematic_proposal_reference','taskIndex',2,'inputManifestSha256',pg_temp.tp_header()->>'inputManifestSha256',
 'inputSealSha256',pg_temp.tp_header()->>'inputSealSha256','continuationHeaderSha256',pg_temp.tp_header()->>'continuationHeaderSha256',
 'contentManifestSha256',pg_temp.tp_header()->>'contentManifestSha256','frameTailSha256',pg_temp.tp_header()->>'tailSha256'),'Proposal reference binding differs');
SELECT 'THEMATIC-PLAN-COMPATIBILITY:'||jsonb_build_object('state',pg_temp.tp_read(),'frames',(SELECT jsonb_agg(body ORDER BY index) FROM thematic_frames))::text;
RESET ROLE;
SELECT pg_temp.expect_error($q$UPDATE engagement_synthesis_thematic_frames SET frame_text='{}' WHERE request_id='f0000000-0000-4000-8000-000000000010'$q$,'P0001','Thematic original update allowed');
SELECT pg_temp.expect_error($q$DELETE FROM engagement_synthesis_thematic_frames WHERE request_id='f0000000-0000-4000-8000-000000000010'$q$,'P0001','Thematic original deletion allowed');
SELECT pg_temp.tp_cancel();
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(pg_temp.tp_prepare()=(SELECT value||'{"cancelled":true}' FROM thematic_plan_probe WHERE key='sealed'),'Cancelled preparation lost recovery');
SELECT pg_temp.assert_true(pg_temp.tp_stage()=(SELECT value||'{"cancelled":true}' FROM thematic_plan_probe WHERE key='sealed'),'Cancelled frames lost recovery');
SELECT pg_temp.assert_true(pg_temp.tp_seal()=(SELECT value||'{"cancelled":true}' FROM thematic_plan_probe WHERE key='sealed'),'Cancelled seal lost recovery');
RESET ROLE;
DO $$ DECLARE signature text; role_name text; BEGIN
 FOREACH signature IN ARRAY ARRAY['public.read_engagement_synthesis_thematic_plan(uuid)','public.prepare_engagement_synthesis_thematic_plan(uuid,text)','public.stage_engagement_synthesis_thematic_frames(uuid,bigint,text,text)','public.seal_engagement_synthesis_thematic_plan(uuid,text)'] LOOP
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   PERFORM pg_temp.assert_true(NOT has_function_privilege(role_name,signature,'EXECUTE'),'Client thematic staging command exposed');
  END LOOP;
  PERFORM pg_temp.assert_true(has_function_privilege('service_role',signature,'EXECUTE'),'Worker staging command unavailable');
 END LOOP;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  PERFORM pg_temp.assert_true(NOT has_function_privilege(role_name,'public.lock_synthesis_thematic_plan_scope(uuid)','EXECUTE'),'Private staging helper exposed');
  PERFORM pg_temp.assert_true(NOT has_table_privilege(role_name,'engagement_synthesis_thematic_frames','INSERT,UPDATE,DELETE'),'Direct thematic frame mutation allowed');
 END LOOP;
 PERFORM pg_temp.assert_true((SELECT relrowsecurity FROM pg_class WHERE oid='engagement_synthesis_thematic_frames'::regclass),'Thematic frame RLS disabled');
END $$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT * FROM engagement_synthesis_thematic_frames','42501','Private thematic frame read exposed');
RESET ROLE;
UPDATE workspace_members SET role='owner' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
UPDATE workspace_members SET role='viewer' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='7a50d4fb-35b7-41f4-9bce-8a4e7d157569';
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('SELECT pg_temp.tp_read()','42501','Revoked requester read staging');
SELECT pg_temp.expect_error('SELECT pg_temp.tp_prepare()','42501','Revoked requester prepared staging');
SELECT pg_temp.expect_error('SELECT pg_temp.tp_stage()','42501','Revoked requester staged frames');
SELECT pg_temp.expect_error('SELECT pg_temp.tp_seal()','42501','Revoked requester sealed staging');
RESET ROLE;
SELECT 'synthesis-thematic-plan-verified';
