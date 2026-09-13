CREATE FUNCTION pg_temp.require_output_refusal(statement text,expected text,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE=expected THEN RETURN; END IF;
  RAISE EXCEPTION 'Refusal % expected %, got %: %',label,expected,SQLSTATE,SQLERRM;
 END;
 RAISE EXCEPTION 'Guard failed: %',label;
END $$;
CREATE FUNCTION pg_temp.output_delivery(template jsonb,job jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE binding text:=template->>'bindingCanonical'; parsed jsonb:=binding::jsonb; key text; name text;
BEGIN
 FOREACH key IN ARRAY ARRAY['fieldId','attemptId','reservationId','leaseExpiresAt','packetHash'] LOOP
  name:=CASE key WHEN 'fieldId' THEN 'id' WHEN 'attemptId' THEN 'attempt_id' WHEN 'reservationId' THEN 'reservation_id' WHEN 'leaseExpiresAt' THEN 'lease_expires_at' ELSE 'packet_hash' END;
  binding:=replace(binding,to_jsonb(parsed->>key)::text,to_jsonb(job->>name)::text);
 END LOOP;
 template:=jsonb_set(template,'{bindingCanonical}',to_jsonb(binding));
 RETURN jsonb_set(template,'{digest}',to_jsonb(encode(extensions.digest(template->>'status'||chr(10)||(template->>'outputJson')||chr(10)||binding||chr(10)||(template->>'providerMetadataJson'),'sha256'),'hex')));
END $$;
CREATE FUNCTION pg_temp.send_output(field_id uuid,attempt_id uuid,value jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.retain_translation_generation_output(field_id,attempt_id,value->>'status',value->>'outputJson',value->>'bindingCanonical',value->>'providerMetadataJson',value->>'digest');
$$;
CREATE FUNCTION pg_temp.output_redigest(value jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_set(value,'{digest}',to_jsonb(encode(extensions.digest((value->>'status')||chr(10)||(value->>'outputJson')||chr(10)||(value->>'bindingCanonical')||chr(10)||(value->>'providerMetadataJson'),'sha256'),'hex')));
$$;
DO $probe$
DECLARE
 f jsonb:=current_setting('openplan.queue_fixture')::jsonb;
 w uuid:=(f->>'workspaceId')::uuid;c uuid:=(f->>'campaignId')::uuid;a uuid:=(f->>'actorId')::uuid;r uuid:=(f->>'requestId')::uuid;
 primary_field uuid:=(f#>>'{fields,0,id}')::uuid; second uuid:=(f#>>'{fields,1,id}')::uuid;
 job jsonb; other_job jsonb; delivery jsonb; changed jsonb; ack jsonb; again jsonb; template jsonb; visible bigint; late_case text; backup_owner uuid:=(f->>'viewerId')::uuid;
BEGIN
 INSERT INTO auth.users(id,aud,role,email) SELECT id,'authenticated','authenticated',id::text||'@output-probe.invalid' FROM unnest(ARRAY[a,backup_owner]) id;
 INSERT INTO workspaces(id,name,slug) VALUES(w,'SYNTHETIC output retention',w::text);
 INSERT INTO workspace_members(workspace_id,user_id,role) VALUES(w,a,'owner'),(w,backup_owner,'owner');
 INSERT INTO engagement_campaigns(id,workspace_id,title,summary,created_by,default_content_locale) VALUES(c,w,f->>'source',f->>'source',a,NULL);
 INSERT INTO workspace_integration_keys(workspace_id,provider,key_ciphertext,key_last4,configured_by) VALUES(w,'anthropic',f->>'keyCiphertext','-KEY',a);
 SET LOCAL ROLE service_role;
 PERFORM create_translation_generation_request(r,a,c,'es',f->'fields',f->'credential',f->>'selectedKeyHash');
 job:=claim_translation_generation_field(primary_field);
 delivery:=pg_temp.output_delivery(f#>'{deliveries,0}',job);
 PERFORM pg_temp.require_output_refusal(format('SELECT pg_temp.send_output(%L,%L,%L)',primary_field,job->>'attempt_id',delivery),'42501','output before dispatch authorization');
 PERFORM authorize_translation_generation_dispatch(primary_field,(job->>'attempt_id')::uuid,(job->>'reservation_id')::uuid);
 PERFORM pg_temp.require_output_refusal(format('SELECT pg_temp.send_output(%L,%L,%L)',primary_field,gen_random_uuid(),delivery),'42501','wrong output attempt');
 PERFORM pg_temp.require_output_refusal(format('SELECT pg_temp.send_output(%L,%L,%L)',primary_field,job->>'attempt_id',jsonb_set(delivery,'{digest}',to_jsonb(repeat('0',64)))),'22023','changed delivery digest');
 changed:=pg_temp.output_redigest(jsonb_set(delivery,'{bindingCanonical}',to_jsonb(replace(delivery->>'bindingCanonical',f->>'campaignId',gen_random_uuid()::text))));
 PERFORM pg_temp.require_output_refusal(format('SELECT pg_temp.send_output(%L,%L,%L)',primary_field,job->>'attempt_id',changed),'22023','foreign receipt campaign');
 changed:=pg_temp.output_redigest(jsonb_set(delivery,'{status}','"incomplete"'));
 PERFORM pg_temp.require_output_refusal(format('SELECT pg_temp.send_output(%L,%L,%L)',primary_field,job->>'attempt_id',changed),'22023','complete output marked incomplete');
 FOREACH late_case IN ARRAY ARRAY['source','key','access'] LOOP
  BEGIN
   RESET ROLE;
   IF late_case='source' THEN UPDATE engagement_campaigns SET title='SYNTHETIC changed after generation' WHERE id=c;
   ELSIF late_case='key' THEN UPDATE workspace_integration_keys SET key_ciphertext='SYNTHETIC changed key' WHERE workspace_id=w AND provider='anthropic';
   ELSE UPDATE workspace_members SET role='viewer' WHERE workspace_id=w AND user_id=a;
   END IF;
   SET LOCAL ROLE service_role;
   ack:=pg_temp.send_output(primary_field,(job->>'attempt_id')::uuid,delivery);
   IF ack->>'state' IS DISTINCT FROM 'interrupted' OR ack->>'status' IS DISTINCT FROM 'completed'
    OR (SELECT output_json FROM engagement_translation_generation_outputs WHERE field_id=primary_field) IS DISTINCT FROM delivery->>'outputJson' THEN
    RAISE EXCEPTION 'Late changed-scope output was discarded or reactivated: %',late_case;
   END IF;
   again:=pg_temp.send_output(primary_field,(job->>'attempt_id')::uuid,delivery);
   IF ack IS DISTINCT FROM again THEN RAISE EXCEPTION 'Late changed-scope replay changed: %',late_case; END IF;
   RAISE EXCEPTION 'Rollback synthetic late-scope delivery' USING ERRCODE='PT998';
  EXCEPTION WHEN SQLSTATE 'PT998' THEN NULL;
  END;
 END LOOP;
 -- Each alternative below is a separate rolled-back delivery of the same
 -- synthetic authorized attempt. The final normal output is retained afterward.
 FOR template IN SELECT value FROM jsonb_array_elements(f->'deliveries') LOOP
  delivery:=pg_temp.output_delivery(template,job);
  BEGIN
   ack:=pg_temp.send_output(primary_field,(job->>'attempt_id')::uuid,delivery);
   IF ack IS DISTINCT FROM jsonb_build_object('fieldId',primary_field,'attemptId',job->>'attempt_id','status',delivery->>'status','state',delivery->>'status','digest',delivery->>'digest') THEN
    RAISE EXCEPTION 'Positive delivery acknowledgement failed';
   END IF;
   IF (SELECT output_json FROM engagement_translation_generation_outputs WHERE field_id=(job->>'id')::uuid) IS DISTINCT FROM delivery->>'outputJson' THEN
    RAISE EXCEPTION 'Exact output JSON was lost';
   END IF;
   IF (SELECT provider_metadata_json FROM engagement_translation_generation_outputs WHERE field_id=(job->>'id')::uuid) IS DISTINCT FROM delivery->>'providerMetadataJson' THEN
    RAISE EXCEPTION 'Exact provider metadata was lost';
   END IF;
   again:=pg_temp.send_output(primary_field,(job->>'attempt_id')::uuid,delivery);
   IF again IS DISTINCT FROM ack THEN RAISE EXCEPTION 'Exact completion replay changed'; END IF;
   changed:=pg_temp.output_redigest(jsonb_set(delivery,'{outputJson}',to_jsonb(' '||(delivery->>'outputJson'))));
   PERFORM pg_temp.require_output_refusal(format('SELECT pg_temp.send_output(%L,%L,%L)',primary_field,job->>'attempt_id',changed),'PT409','equivalent words changed retained bytes');
   RAISE EXCEPTION 'Rollback this synthetic alternative' USING ERRCODE='PT998';
  EXCEPTION WHEN SQLSTATE 'PT998' THEN NULL;
  END;
 END LOOP;
 IF EXISTS(SELECT 1 FROM engagement_translation_generation_outputs WHERE field_id=(job->>'id')::uuid) THEN RAISE EXCEPTION 'Alternative output rollback failed'; END IF;
 delivery:=pg_temp.output_delivery(f#>'{deliveries,0}',job);
 ack:=pg_temp.send_output(primary_field,(job->>'attempt_id')::uuid,delivery);
 SET LOCAL ROLE anon;
 BEGIN SELECT count(*) INTO visible FROM engagement_translation_generation_outputs;
 EXCEPTION WHEN insufficient_privilege THEN visible:=0; END;
 IF visible<>0 THEN RAISE EXCEPTION 'Anonymous retained output leak'; END IF;
 SET LOCAL ROLE authenticated;
 BEGIN SELECT count(*) INTO visible FROM engagement_translation_generation_outputs;
 EXCEPTION WHEN insufficient_privilege THEN visible:=0; END;
 IF visible<>0 THEN RAISE EXCEPTION 'Authenticated retained output leak'; END IF;
 PERFORM pg_temp.require_output_refusal(format('SELECT pg_temp.send_output(%L,%L,%L)',primary_field,job->>'attempt_id',delivery),'42501','direct authenticated output write');
 SET LOCAL ROLE service_role;
 other_job:=claim_translation_generation_field(second);
 PERFORM authorize_translation_generation_dispatch(second,(other_job->>'attempt_id')::uuid,(other_job->>'reservation_id')::uuid);
 PERFORM stop_translation_generation_field(second,(other_job->>'attempt_id')::uuid,'cancelled','translation_cancelled');
 delivery:=pg_temp.output_delivery(f#>'{deliveries,0}',other_job);
 ack:=pg_temp.send_output(second,(other_job->>'attempt_id')::uuid,delivery);
 IF ack->>'state' IS DISTINCT FROM 'cancelled' OR ack->>'status' IS DISTINCT FROM 'completed'
 OR (SELECT state FROM engagement_translation_generation_fields WHERE id=second)<>'cancelled' THEN RAISE EXCEPTION 'Late output revived a cancelled job'; END IF;
 IF (SELECT output_json FROM engagement_translation_generation_outputs WHERE field_id=second) IS DISTINCT FROM delivery->>'outputJson' THEN RAISE EXCEPTION 'Late output was discarded'; END IF;
 IF (SELECT count(*) FROM usage_events WHERE workspace_id=w)<>2 THEN RAISE EXCEPTION 'Output delivery changed dispatch count'; END IF;
 RESET ROLE;
 PERFORM pg_temp.require_output_refusal(format('UPDATE engagement_translation_generation_outputs SET output_json=%L WHERE field_id=%L','"changed"',primary_field),'23514','output immutable');
 PERFORM set_config('openplan.output_probe_passed','true',true);
END $probe$;
SELECT jsonb_build_object('outputProbePassed',current_setting('openplan.output_probe_passed')='true');
