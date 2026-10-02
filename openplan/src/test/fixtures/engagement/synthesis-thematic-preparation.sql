-- Earlier setup retains a choice after parent cancellation and author departure.
-- No fixture digest is claimed to be a semantically verified model result.
RESET ROLE;
CREATE TEMP TABLE preparation_probe(key text PRIMARY KEY,value jsonb);
GRANT SELECT,INSERT ON preparation_probe TO service_role;
CREATE FUNCTION pg_temp.prep_read() RETURNS jsonb LANGUAGE sql AS $$
 SELECT read_engagement_synthesis_thematic_preparation('f0000000-0000-4000-8000-000000000010','item:b0000000-0000-4000-8000-000000000301');
$$;
CREATE FUNCTION pg_temp.prep_page(stage text DEFAULT 'parent',after_index bigint DEFAULT -1,page_limit integer DEFAULT 128) RETURNS jsonb LANGUAGE sql AS $$
 SELECT read_engagement_synthesis_thematic_preparation_selections('f0000000-0000-4000-8000-000000000010','item:b0000000-0000-4000-8000-000000000301',stage,after_index,page_limit);
$$;
-- Each deliberately inconsistent historical row is restored by a nested rollback.
-- Ordinary callers cannot create these rows or disable their immutable triggers.
CREATE FUNCTION pg_temp.prep_broken(command text,expected_code text,label text,probe text DEFAULT 'SELECT pg_temp.prep_read()') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN
  EXECUTE command;
  PERFORM pg_temp.expect_error(probe,expected_code,label);
  RAISE EXCEPTION 'Restore synthetic row' USING ERRCODE='ZX001';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
 END;
END $$;
DO $$ DECLARE signature text; BEGIN
 FOREACH signature IN ARRAY ARRAY['public.read_engagement_synthesis_thematic_preparation(uuid,text)',
 'public.read_engagement_synthesis_thematic_preparation_selections(uuid,text,text,bigint,integer)'] LOOP
  PERFORM pg_temp.assert_true(NOT has_function_privilege('anon',signature,'EXECUTE'),'Anonymous preparation allowed');
  PERFORM pg_temp.assert_true(NOT has_function_privilege('authenticated',signature,'EXECUTE'),'Staff bypassed preparation delegation');
  PERFORM pg_temp.assert_true(has_function_privilege('service_role',signature,'EXECUTE'),'Service preparation unavailable');
 END LOOP;
 FOREACH signature IN ARRAY ARRAY['public.lock_synthesis_thematic_preparation_scope(uuid)','public.synthesis_preparation_request_record(uuid)'] LOOP
  PERFORM pg_temp.assert_true(NOT has_function_privilege('anon',signature,'EXECUTE') AND NOT has_function_privilege('authenticated',signature,'EXECUTE')
   AND NOT has_function_privilege('service_role',signature,'EXECUTE'),'Private preparation helper exposed');
 END LOOP;
END $$;
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
INSERT INTO preparation_probe VALUES('original',pg_temp.prep_read());
SELECT pg_temp.assert_true((SELECT value#>>'{thematic,request,actorId}'='7a50d4fb-35b7-41f4-9bce-8a4e7d157569'
 AND value#>>'{parent,request,actorId}'='13466ed2-dcb7-4861-a528-68cc5579eea9' AND value#>'{parent,cancellation}'<>'null'::jsonb
 AND value#>>'{context,request,id}'='f0000000-0000-4000-8000-000000000014'
 AND value#>>'{choice,choiceText}'=(SELECT value->>'choiceText' FROM thematic_choice_probe WHERE key='original')
 AND value#>>'{source,requestId}'='d0000000-0000-4000-8000-000000000002'
 FROM preparation_probe WHERE key='original'),'Preparation lost original scope or authorship');
SELECT pg_temp.assert_true(pg_temp.prep_page()=jsonb_build_object('schemaVersion',1,'requestId','f0000000-0000-4000-8000-000000000001',
 'throughSequence',0,'afterTaskIndex',-1,'hasMore',false,'entries','[]'::jsonb),'Parent preparation page differs');
SELECT pg_temp.assert_true(pg_temp.prep_page('context')->>'requestId'='f0000000-0000-4000-8000-000000000014','Context preparation page differs');
SELECT pg_temp.expect_error($q$SELECT pg_temp.prep_page('thematic')$q$,'22023','Unknown dependency stage accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.prep_page(NULL)$q$,'22023','Null dependency stage accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.prep_page('parent',-2)$q$,'22023','Invalid page cursor accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.prep_page('parent',NULL)$q$,'22023','Null page cursor accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.prep_page('parent',-1,0)$q$,'22023','Invalid page limit accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.prep_page('parent',-1,129)$q$,'22023','Oversized page limit accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.prep_page('parent',-1,NULL)$q$,'22023','Null page limit accepted');
SELECT pg_temp.expect_error($q$SELECT read_engagement_synthesis_thematic_preparation('f0000000-0000-4000-8000-000000000099','item:b0000000-0000-4000-8000-000000000301')$q$,'42501','Absent request accepted');
SELECT pg_temp.expect_error($q$SELECT read_engagement_synthesis_thematic_preparation('f0000000-0000-4000-8000-000000000012','item:b0000000-0000-4000-8000-000000000301')$q$,'0A000','Segment request accepted as thematic');
SELECT pg_temp.expect_error($q$SELECT read_engagement_synthesis_thematic_preparation('f0000000-0000-4000-8000-000000000010','item:b0000000-0000-4000-8000-000000999999')$q$,'42501','Unchosen target accepted');
RESET ROLE;
SELECT pg_temp.prep_broken($q$UPDATE workspace_members SET role='owner' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9'; UPDATE workspace_members SET role='viewer' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='7a50d4fb-35b7-41f4-9bce-8a4e7d157569'$q$,'42501','Revoked thematic requester read preparation');
SELECT pg_temp.prep_broken($q$UPDATE workspace_members SET role='owner' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9'; UPDATE workspace_members SET role='viewer' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='7a50d4fb-35b7-41f4-9bce-8a4e7d157569'$q$,'42501','Revoked thematic requester read another page','SELECT pg_temp.prep_page()');
SELECT pg_temp.prep_broken($q$ALTER TABLE engagement_synthesis_thematic_choices DISABLE TRIGGER synthesis_thematic_choice_immutable; UPDATE engagement_synthesis_thematic_choices SET created_by='13466ed2-dcb7-4861-a528-68cc5579eea9' WHERE request_id='f0000000-0000-4000-8000-000000000010'$q$,'42501','Different choice author accepted');
SELECT pg_temp.prep_broken($q$ALTER TABLE engagement_synthesis_thematic_choices DISABLE TRIGGER synthesis_thematic_choice_immutable; UPDATE engagement_synthesis_thematic_choices SET choice_text=jsonb_set(choice_text::jsonb,'{selectionSequence}','1')::text WHERE request_id='f0000000-0000-4000-8000-000000000010'$q$,'PT409','Unretained context sequence accepted',$q$SELECT pg_temp.prep_page('context')$q$);
SELECT pg_temp.prep_broken($q$ALTER TABLE engagement_synthesis_thematic_requests DISABLE TRIGGER synthesis_thematic_request_immutable; UPDATE engagement_synthesis_thematic_requests SET thematic_text=jsonb_set(thematic_text::jsonb,'{selectionSequence}','-1')::text WHERE request_id='f0000000-0000-4000-8000-000000000010'; ALTER TABLE engagement_synthesis_context_requests DISABLE TRIGGER synthesis_context_request_immutable; UPDATE engagement_synthesis_context_requests SET context_text=jsonb_set(context_text::jsonb,'{selectionSequence}','-1')::text WHERE request_id='f0000000-0000-4000-8000-000000000014'$q$,'PT409','Unretained parent sequence accepted','SELECT pg_temp.prep_page()');
SELECT pg_temp.prep_broken('ALTER TABLE engagement_synthesis_generation_requests DISABLE TRIGGER synthesis_generation_request_immutable; UPDATE engagement_synthesis_generation_requests SET campaign_id=''250f0f62-7225-48b3-a2f7-5a134d3b9f78'' WHERE id=''f0000000-0000-4000-8000-000000000001''','42501','Foreign parent campaign_id accepted','SELECT pg_temp.prep_read()');
SELECT pg_temp.prep_broken('ALTER TABLE engagement_synthesis_generation_requests DISABLE TRIGGER synthesis_generation_request_immutable; UPDATE engagement_synthesis_generation_requests SET workspace_id=''7791bbb4-6c7c-435e-9d1d-d2146334a944'' WHERE id=''f0000000-0000-4000-8000-000000000001''','42501','Foreign parent workspace_id accepted','SELECT pg_temp.prep_read()');
SELECT pg_temp.prep_broken('ALTER TABLE engagement_synthesis_generation_requests DISABLE TRIGGER synthesis_generation_request_immutable; UPDATE engagement_synthesis_generation_requests SET source_id=''d0000000-0000-4000-8000-000000000001'' WHERE id=''f0000000-0000-4000-8000-000000000001''','42501','Foreign parent source_id accepted','SELECT pg_temp.prep_read()');
SELECT pg_temp.prep_broken('ALTER TABLE engagement_synthesis_generation_requests DISABLE TRIGGER synthesis_generation_request_immutable; UPDATE engagement_synthesis_generation_requests SET campaign_id=''250f0f62-7225-48b3-a2f7-5a134d3b9f78'' WHERE id=''f0000000-0000-4000-8000-000000000014''','42501','Foreign context campaign_id accepted','SELECT pg_temp.prep_read()');
SELECT pg_temp.prep_broken('ALTER TABLE engagement_synthesis_generation_requests DISABLE TRIGGER synthesis_generation_request_immutable; UPDATE engagement_synthesis_generation_requests SET workspace_id=''7791bbb4-6c7c-435e-9d1d-d2146334a944'' WHERE id=''f0000000-0000-4000-8000-000000000014''','42501','Foreign context workspace_id accepted','SELECT pg_temp.prep_read()');
SELECT pg_temp.prep_broken('ALTER TABLE engagement_synthesis_generation_requests DISABLE TRIGGER synthesis_generation_request_immutable; UPDATE engagement_synthesis_generation_requests SET source_id=''d0000000-0000-4000-8000-000000000001'' WHERE id=''f0000000-0000-4000-8000-000000000014''','42501','Foreign context source_id accepted','SELECT pg_temp.prep_read()');
SELECT pg_temp.prep_broken('ALTER TABLE engagement_synthesis_generation_requests DISABLE TRIGGER synthesis_generation_request_immutable; UPDATE engagement_synthesis_generation_requests SET campaign_id=''250f0f62-7225-48b3-a2f7-5a134d3b9f78'' WHERE id=''f0000000-0000-4000-8000-000000000010''','42501','Foreign root campaign accepted','SELECT lock_synthesis_thematic_preparation_scope(''f0000000-0000-4000-8000-000000000010'')');
SELECT pg_temp.prep_broken('ALTER TABLE engagement_synthesis_sources DISABLE TRIGGER engagement_synthesis_sources_immutable; UPDATE engagement_synthesis_sources SET campaign_id=''250f0f62-7225-48b3-a2f7-5a134d3b9f78'' WHERE id=''d0000000-0000-4000-8000-000000000002''','42501','Foreign source campaign_id accepted','SELECT pg_temp.prep_read()');
SELECT pg_temp.prep_broken('ALTER TABLE engagement_synthesis_sources DISABLE TRIGGER engagement_synthesis_sources_immutable; UPDATE engagement_synthesis_sources SET workspace_id=''7791bbb4-6c7c-435e-9d1d-d2146334a944'' WHERE id=''d0000000-0000-4000-8000-000000000002''','42501','Foreign source workspace_id accepted','SELECT pg_temp.prep_read()');
SELECT pg_temp.prep_broken('ALTER TABLE engagement_synthesis_context_requests DISABLE TRIGGER synthesis_context_request_immutable; UPDATE engagement_synthesis_context_requests SET context_text=jsonb_set(context_text::jsonb,''{parentRequestId}'',''"f0000000-0000-4000-8000-000000000012"'')::text WHERE request_id=''f0000000-0000-4000-8000-000000000014''','PT409','Changed context parentRequestId accepted','SELECT pg_temp.prep_read()');
SELECT pg_temp.prep_broken('ALTER TABLE engagement_synthesis_context_requests DISABLE TRIGGER synthesis_context_request_immutable; UPDATE engagement_synthesis_context_requests SET context_text=jsonb_set(context_text::jsonb,''{selectionSequence}'',''1'')::text WHERE request_id=''f0000000-0000-4000-8000-000000000014''','PT409','Changed context selectionSequence accepted','SELECT pg_temp.prep_read()');
SELECT pg_temp.prep_broken('ALTER TABLE engagement_synthesis_context_requests DISABLE TRIGGER synthesis_context_request_immutable; UPDATE engagement_synthesis_context_requests SET context_text=jsonb_set(context_text::jsonb,''{segmentResultsManifestSha256}'',''"0000000000000000000000000000000000000000000000000000000000000000"'')::text WHERE request_id=''f0000000-0000-4000-8000-000000000014''','PT409','Changed context segmentResultsManifestSha256 accepted','SELECT pg_temp.prep_read()');
SELECT pg_temp.prep_broken('ALTER TABLE engagement_synthesis_context_requests DISABLE TRIGGER synthesis_context_request_immutable; UPDATE engagement_synthesis_context_requests SET context_text=jsonb_set(context_text::jsonb,''{contextManifestSha256}'',''"0000000000000000000000000000000000000000000000000000000000000000"'')::text WHERE request_id=''f0000000-0000-4000-8000-000000000014''','PT409','Changed context contextManifestSha256 accepted','SELECT pg_temp.prep_read()');
SELECT pg_temp.prep_broken('ALTER TABLE engagement_synthesis_context_requests DISABLE TRIGGER synthesis_context_request_immutable; UPDATE engagement_synthesis_context_requests SET context_text=jsonb_set(context_text::jsonb,''{targetRecordId}'',''"item:b0000000-0000-4000-8000-000000000300"'')::text WHERE request_id=''f0000000-0000-4000-8000-000000000014''','PT409','Changed context targetRecordId accepted','SELECT pg_temp.prep_read()');
SELECT pg_temp.prep_broken('ALTER TABLE engagement_synthesis_context_requests DISABLE TRIGGER synthesis_context_request_immutable; UPDATE engagement_synthesis_context_requests SET parent_request_id=''f0000000-0000-4000-8000-000000000012'' WHERE request_id=''f0000000-0000-4000-8000-000000000014''','PT409','Changed context parent column accepted','SELECT pg_temp.prep_read()');
SELECT pg_temp.prep_broken('ALTER TABLE engagement_synthesis_sources DISABLE TRIGGER engagement_synthesis_sources_immutable; UPDATE engagement_synthesis_sources SET snapshot_text=jsonb_set(snapshot_text::jsonb,''{items}'',''[]'')::text WHERE id=''d0000000-0000-4000-8000-000000000002''','PT409','Target outside source accepted','SELECT pg_temp.prep_read()');
-- Synthetic cleared receipts isolate SQL pagination. These headers and receipts
-- are not executable plans; full original-response replay belongs to HTTP tests.
INSERT INTO engagement_synthesis_generation_plans(request_id,header_text)
 SELECT id,'{}' FROM engagement_synthesis_generation_requests WHERE id IN
 ('f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000014','f0000000-0000-4000-8000-000000000020');
INSERT INTO engagement_synthesis_generation_plan_tasks(request_id,task_index,task_text,cumulative_bytes,chain_sha256)
 SELECT request_id,n,'{}',0,repeat('0',64) FROM engagement_synthesis_generation_plans CROSS JOIN generate_series(0,2) n WHERE request_id IN ('f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000014','f0000000-0000-4000-8000-000000000020');
DO $$ DECLARE request uuid; task integer; seq integer; predecessor uuid; identity uuid; BEGIN
 FOREACH request IN ARRAY ARRAY['f0000000-0000-4000-8000-000000000001'::uuid,'f0000000-0000-4000-8000-000000000014'::uuid,'f0000000-0000-4000-8000-000000000020'::uuid] LOOP
  predecessor:=NULL;
  FOR seq IN 1..4 LOOP
   task:=CASE seq WHEN 1 THEN 0 WHEN 2 THEN 1 WHEN 3 THEN 0 ELSE 2 END;
   identity:=extensions.gen_random_uuid();
   INSERT INTO engagement_synthesis_generation_selections(id,request_id,task_index,attempt_id,previous_selection_id,sequence_no,actor_id,origin,receipt_text)
   VALUES(identity,request,task,NULL,CASE WHEN seq=3 THEN predecessor ELSE NULL END,seq,'13466ed2-dcb7-4861-a528-68cc5579eea9','staff',
    jsonb_build_object('requestId',request,'taskIndex',task,'sequence',seq)::text);
   IF seq=1 THEN predecessor:=identity; END IF;
  END LOOP;
 END LOOP;
END $$;
ALTER TABLE engagement_synthesis_thematic_requests DISABLE TRIGGER synthesis_thematic_request_immutable;
UPDATE engagement_synthesis_thematic_requests SET thematic_text=jsonb_set(thematic_text::jsonb,'{selectionSequence}','3')::text WHERE request_id='f0000000-0000-4000-8000-000000000010';
ALTER TABLE engagement_synthesis_context_requests DISABLE TRIGGER synthesis_context_request_immutable;
UPDATE engagement_synthesis_context_requests SET context_text=jsonb_set(context_text::jsonb,'{selectionSequence}','3')::text WHERE request_id='f0000000-0000-4000-8000-000000000014';
ALTER TABLE engagement_synthesis_thematic_choices DISABLE TRIGGER synthesis_thematic_choice_immutable;
UPDATE engagement_synthesis_thematic_choices SET choice_text=jsonb_set(choice_text::jsonb,'{selectionSequence}','2')::text WHERE request_id='f0000000-0000-4000-8000-000000000010';
CREATE FUNCTION pg_temp.prep_expected(request uuid,seq bigint) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_array(jsonb_build_object('receiptText',receipt_text,'receiptSha256',receipt_sha256))
 FROM engagement_synthesis_generation_selections WHERE request_id=request AND sequence_no=seq;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.prep_expected(uuid,bigint) TO service_role;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(pg_temp.prep_page('parent',-1,1)->'entries'=pg_temp.prep_expected('f0000000-0000-4000-8000-000000000001',3)
 AND pg_temp.prep_page('parent',-1,1)->'hasMore'='true'::jsonb,'Anchored first parent page differs');
SELECT pg_temp.assert_true(pg_temp.prep_page('parent',0,1)->'entries'=pg_temp.prep_expected('f0000000-0000-4000-8000-000000000001',2)
 AND pg_temp.prep_page('parent',0,1)->'hasMore'='false'::jsonb,'Anchored final parent page differs');
SELECT pg_temp.assert_true(pg_temp.prep_page('context',-1,1)->'entries'=pg_temp.prep_expected('f0000000-0000-4000-8000-000000000014',1)
 AND pg_temp.prep_page('context',-1,1)->'throughSequence'='2'::jsonb,'Anchored earlier context page differs');
SELECT pg_temp.assert_true(pg_temp.prep_page('context',0,1)->'entries'=pg_temp.prep_expected('f0000000-0000-4000-8000-000000000014',2)
 AND pg_temp.prep_page('context',1,1)->'entries'='[]'::jsonb,'Anchored context tail differs');
RESET ROLE;

-- Keep original parent cancellation and departure. Cancel the new request only.
SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.gen_cancel('f0000000-0000-4000-8000-000000000010','f0000000-0000-4000-8000-000000000110');
RESET ROLE; SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('SELECT pg_temp.prep_read()','PT409','Cancelled thematic request prepared new input');
SELECT pg_temp.expect_error('SELECT pg_temp.prep_page()','PT409','Cancelled thematic request read new page');
RESET ROLE;
SELECT 'synthesis-thematic-preparation-verified';
