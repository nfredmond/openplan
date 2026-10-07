CREATE FUNCTION pg_temp.freeze_assert(ok boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION '%',message; END IF; END $$;
CREATE FUNCTION pg_temp.freeze_refuses(statement text, expected_state text, label text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE=expected_state THEN RETURN; END IF;
    RAISE EXCEPTION '%: unexpected % %',label,SQLSTATE,SQLERRM;
  END;
  RAISE EXCEPTION '%: accepted',label;
END $$;
-- This private trigger lets the fixture prove rollback after earlier writes.
CREATE FUNCTION pg_temp.reject_test_freeze_event()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF (TG_TABLE_NAME='land_use_plan_review_events' AND current_setting('openplan.test_freeze_event_failure',true)='1')
    OR (TG_TABLE_NAME='land_use_plan_freeze_commands' AND current_setting('openplan.test_freeze_event_failure',true)='2') THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Synthetic review event failure';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER test_freeze_event_failure BEFORE INSERT ON public.land_use_plan_review_events
  FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_test_freeze_event();
CREATE TRIGGER test_freeze_journal_failure BEFORE INSERT ON public.land_use_plan_freeze_commands
  FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_test_freeze_event();
DO $test$
DECLARE
  actor uuid:=gen_random_uuid(); other_actor uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  workspace uuid:=gen_random_uuid(); plan uuid:=gen_random_uuid(); version uuid:=gen_random_uuid(); next_version uuid:=gen_random_uuid();
  section uuid:=gen_random_uuid(); policy uuid:=gen_random_uuid(); relation uuid:=gen_random_uuid(); designation uuid:=gen_random_uuid();
  action uuid:=gen_random_uuid(); process uuid:=gen_random_uuid(); consultation uuid:=gen_random_uuid();
  layer uuid:=gen_random_uuid(); layer_version uuid:=gen_random_uuid(); command_id uuid:=gen_random_uuid();
  revision integer; raw text; snapshot jsonb; descriptor jsonb; map_evidence jsonb; call_sql text;
  outcome jsonb; replay jsonb; key text; altered jsonb; scenario text; alt_revision integer; alt_raw text; alt_rules jsonb; stage text;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(actor,actor||'@example.test'),(other_actor,other_actor||'@example.test'),(viewer,viewer||'@example.test'),(outsider,outsider||'@example.test');
  INSERT INTO public.workspaces(id,name,slug) VALUES(workspace,'SYNTHETIC atomic freeze',workspace::text);
  INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace,actor,'owner'),(workspace,other_actor,'owner'),(workspace,viewer,'viewer');
  INSERT INTO public.land_use_plans(id,workspace_id,title,descriptor_id,plan_kind_key,authority_label,geography_label)
    VALUES(plan,workspace,'SYNTHETIC plan','local-unconfigured','community','SYNTHETIC body','SYNTHETIC area');
  INSERT INTO public.land_use_plan_versions(id,workspace_id,plan_id,version_number,version_kind,applicable_requirement_keys)
    VALUES(version,workspace,plan,1,'original',ARRAY['locally_defined']);
  UPDATE public.land_use_plans SET current_working_version_id=version WHERE id=plan;
  INSERT INTO public.land_use_plan_content_nodes(id,workspace_id,version_id,node_kind,requirement_key,title,body,sort_order)
    VALUES(section,workspace,version,'section','locally_defined','SYNTHETIC section','Public content',0),
      (policy,workspace,version,'policy',NULL,'SYNTHETIC policy','Policy text',1);
  INSERT INTO public.land_use_plan_relationships(id,workspace_id,plan_id,version_id,related_plan_label,relationship_kind,notes)
    VALUES(relation,workspace,plan,version,'SYNTHETIC related plan','overlapping','Relationship text');
  INSERT INTO public.workspace_gis_layers(id,workspace_id,name) VALUES(layer,workspace,'SYNTHETIC layer');
  INSERT INTO public.workspace_gis_layer_versions(id,layer_id,workspace_id,version_number,source_format,source_filename,source_byte_size,srs_name,srs_basis,declared_feature_count,source_feature_count)
    VALUES(layer_version,layer,workspace,1,'geojson','SYNTHETIC.geojson',0,'WGS84','geojson_rfc7946_default',0,0);
  UPDATE public.workspace_gis_layer_versions SET ingest_status='ready',finalized_at=now() WHERE id=layer_version;
  INSERT INTO public.land_use_plan_designations(id,workspace_id,version_id,layer_id,layer_version_id,designation_set_label,map_note)
    VALUES(designation,workspace,version,layer,layer_version,'SYNTHETIC designations','Policy illustration only');
  INSERT INTO public.land_use_plan_designation_policy_links(workspace_id,version_id,designation_id,policy_node_id)
    VALUES(workspace,version,designation,policy);
  INSERT INTO public.land_use_plan_implementation_actions(id,workspace_id,version_id,title,description,responsible_party)
    VALUES(action,workspace,version,'SYNTHETIC action','Action text','SYNTHETIC staff');
  INSERT INTO public.land_use_plan_process_records(id,workspace_id,plan_id,version_id,descriptor_id,process_key,status,completed_on)
    VALUES(process,workspace,plan,version,'local-unconfigured','local_process','complete','2026-10-07');
  INSERT INTO public.land_use_plan_consultation_records(id,workspace_id,plan_id,version_id,status,confidential_notes)
    VALUES(consultation,workspace,plan,version,'not_applicable','SYNTHETIC PRIVATE NOTE MUST NOT ENTER SNAPSHOT');
  SELECT draft_revision INTO revision FROM public.land_use_plan_versions WHERE id=version;
  descriptor:='{"id":"local-unconfigured","planKinds":[{"key":"community"}],"requirements":[{"key":"locally_defined","applicability":"required"}],"processSteps":[{"key":"local_process","required":true,"reviewPrerequisite":true},{"key":"tribal_consultation","required":true}]}';
  SELECT jsonb_build_object('id',id,'feature_hash',feature_hash,'feature_hash_computed_at',feature_hash_computed_at,
    'feature_count',0,'bbox',NULL,'geometry_kinds','[]'::jsonb) INTO map_evidence FROM public.workspace_gis_layer_versions WHERE id=layer_version;
  snapshot:=jsonb_build_object(
    'descriptorSnapshot',descriptor,'planContext',NULL,
    'plan',jsonb_build_object('id',plan,'descriptorId','local-unconfigured','planKindKey','community','title','SYNTHETIC plan','authorityLabel','SYNTHETIC body','geographyLabel','SYNTHETIC area'),
    'version',jsonb_build_object('id',version,'versionNumber',1,'versionKind','original','basedOnVersionId',NULL,'applicableRequirementKeys',jsonb_build_array('locally_defined'),'draftRevision',revision),
    'nodes',jsonb_build_array(
      jsonb_build_object('id',section,'parent_node_id',NULL,'node_kind','section','requirement_key','locally_defined','title','SYNTHETIC section','body','Public content','sort_order',0,'evidence_document_id',NULL,'evidence_url',NULL),
      jsonb_build_object('id',policy,'parent_node_id',NULL,'node_kind','policy','requirement_key',NULL,'title','SYNTHETIC policy','body','Policy text','sort_order',1,'evidence_document_id',NULL,'evidence_url',NULL)),
    'relationships',jsonb_build_array(jsonb_build_object('id',relation,'related_plan_id',NULL,'related_plan_label','SYNTHETIC related plan','relationship_kind','overlapping','notes','Relationship text')),
    'designations',jsonb_build_array(jsonb_build_object('id',designation,'layer_id',layer,'layer_version_id',layer_version,'designation_set_label','SYNTHETIC designations','legend_metadata','{}'::jsonb,
      'public_field_keys','[]'::jsonb,'legend_field',NULL,'map_note','Policy illustration only','land_use_plan_designation_policy_links',jsonb_build_array(jsonb_build_object('policy_node_id',policy)),'layer_version_evidence',map_evidence)),
    'implementationActions',jsonb_build_array(jsonb_build_object('id',action,'content_node_id',NULL,'title','SYNTHETIC action','description','Action text','responsible_party','SYNTHETIC staff',
      'due_on',NULL,'status','not_started','project_id',NULL,'program_id',NULL,'evidence_document_id',NULL)));
  raw:=E' \n'||jsonb_build_object('state','public_review','commandId',command_id,'versionId',version,'expectedDraftRevision',revision,'expectedDescriptorHash',encode(extensions.digest(descriptor::text,'sha256'),'hex'))::text||E'\n ';
  call_sql:=format('SELECT public.freeze_land_use_plan_version(%L,%L,%L,%L,%s,%L,%L,%L)',plan,version,actor,command_id,revision,raw,snapshot::text,descriptor::text);
  PERFORM pg_temp.freeze_assert(NOT has_function_privilege('authenticated','public.freeze_land_use_plan_version(uuid,uuid,uuid,uuid,integer,text,text,text)','EXECUTE'),'authenticated RPC permission');
  PERFORM pg_temp.freeze_assert(NOT has_function_privilege('anon','public.freeze_land_use_plan_version(uuid,uuid,uuid,uuid,integer,text,text,text)','EXECUTE'),'anonymous RPC permission');
  PERFORM pg_temp.freeze_assert(NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.freeze_land_use_plan_version(uuid,uuid,uuid,uuid,integer,text,text,text)'::regprocedure),'security invoker');
  PERFORM pg_temp.freeze_assert((SELECT relrowsecurity FROM pg_class WHERE oid='public.land_use_plan_freeze_commands'::regclass),'journal RLS enabled');
  PERFORM pg_temp.freeze_assert(NOT has_function_privilege('authenticated','public.land_use_plan_freeze_content(uuid)','EXECUTE'),'private snapshot helper');
  PERFORM pg_temp.freeze_assert(NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.land_use_plan_freeze_content(uuid)'::regprocedure),'snapshot helper security invoker');
  PERFORM pg_temp.freeze_assert(NOT has_table_privilege('authenticated','public.land_use_plan_freeze_commands','SELECT'),'private journal');
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.freeze_refuses(call_sql,'42501','direct authenticated freeze RPC refused');
  UPDATE public.land_use_plan_versions SET state='working' WHERE id=version;
  PERFORM pg_temp.freeze_assert((SELECT state='working' AND draft_revision=revision FROM public.land_use_plan_versions WHERE id=version),'authenticated harmless working update');
  PERFORM pg_temp.freeze_refuses(format('UPDATE public.land_use_plan_versions SET state=%L,content_hash=%L,frozen_snapshot=%L,frozen_at=now(),frozen_by=%L WHERE id=%L',
    'public_review',repeat('a',64),snapshot::text,actor,version),'42501','direct authenticated freeze update refused');
  PERFORM pg_temp.freeze_refuses(format('INSERT INTO public.land_use_plan_versions(workspace_id,plan_id,version_number,version_kind,state,content_hash,frozen_snapshot,frozen_at,frozen_by) VALUES(%L,%L,99,%L,%L,%L,%L,now(),%L)',
    workspace,plan,'revision','public_review',repeat('a',64),snapshot::text,actor),'42501','direct authenticated frozen insert refused');
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','service_role')::text,true);
  PERFORM pg_temp.freeze_refuses(format('UPDATE public.land_use_plan_versions SET state=%L,content_hash=%L,frozen_snapshot=%L,frozen_at=now(),frozen_by=%L WHERE id=%L',
    'public_review',repeat('a',64),snapshot::text,actor,version),'42501','forged JWT role cannot freeze directly');
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.freeze_refuses(replace(call_sql,actor::text,viewer::text),'42501','viewer freeze refused');
  PERFORM pg_temp.freeze_refuses(replace(call_sql,actor::text,outsider::text),'42501','outsider freeze refused');
  -- Expected content is independently built above, not copied from this helper.
  FOREACH key IN ARRAY ARRAY['nodes','relationships','designations','implementationActions'] LOOP
    PERFORM pg_temp.freeze_assert(public.land_use_plan_freeze_content(version)->key=snapshot->key,key||' exact projection');
    altered:=jsonb_set(snapshot,ARRAY[key],'[]'::jsonb);
    PERFORM pg_temp.freeze_refuses(replace(call_sql,quote_literal(snapshot::text),quote_literal(altered::text)),'PT409',key||' omission refused');
  END LOOP;
  PERFORM pg_temp.freeze_assert(position('PRIVATE NOTE' in public.land_use_plan_freeze_content(version)::text)=0,'confidential note excluded');
  PERFORM pg_temp.freeze_refuses(replace(call_sql,quote_literal(snapshot::text),quote_literal(jsonb_set(snapshot,'{plan,title}','"Substituted"')::text)),'PT409','plan identity substitution refused');
  PERFORM pg_temp.freeze_refuses(replace(call_sql,quote_literal(snapshot::text),quote_literal(jsonb_set(snapshot,'{version,draftRevision}','0')::text)),'PT409','snapshot revision substitution refused');
  PERFORM pg_temp.freeze_refuses(replace(call_sql,quote_literal(descriptor::text),quote_literal((descriptor||'{"changed":true}')::text)),'PT409','descriptor substitution refused');
  FOREACH scenario IN ARRAY ARRAY['stale-revision','noncurrent-version','section-whitespace','designations','actions','process','consultation','required-section'] LOOP
    BEGIN
      altered:=snapshot;alt_rules:=descriptor;alt_raw:=raw;alt_revision:=revision;
      IF scenario='stale-revision' THEN
        -- A conservative child write changes only the revision. Other snapshot
        -- comparisons cannot mask a missing revision-precondition guard.
        UPDATE public.land_use_plan_content_nodes SET body=body WHERE id=policy;
      ELSIF scenario='noncurrent-version' THEN
        UPDATE public.land_use_plans SET current_working_version_id=NULL WHERE id=plan;
      ELSIF scenario='section-whitespace' THEN
        UPDATE public.land_use_plan_content_nodes SET body=U&'\00A0\2000\FEFF' WHERE id=section;
        altered:=jsonb_set(altered,'{nodes,0,body}',to_jsonb(U&'\00A0\2000\FEFF'::text));
      ELSIF scenario='designations' THEN
        DELETE FROM public.land_use_plan_designations WHERE id=designation;
        altered:=jsonb_set(altered,'{designations}','[]');
      ELSIF scenario='actions' THEN
        DELETE FROM public.land_use_plan_implementation_actions WHERE id=action;
        altered:=jsonb_set(altered,'{implementationActions}','[]');
      ELSIF scenario='process' THEN
        UPDATE public.land_use_plan_process_records SET status='in_progress' WHERE id=process;
      ELSIF scenario='consultation' THEN
        UPDATE public.land_use_plan_consultation_records SET status='initiated' WHERE id=consultation;
      ELSIF scenario='required-section' THEN
        alt_rules:=jsonb_set(descriptor,'{requirements}',(descriptor->'requirements')||'[{"key":"additional_required","applicability":"required"}]');
        altered:=jsonb_set(altered,'{descriptorSnapshot}',alt_rules);
      END IF;
      IF scenario NOT IN ('stale-revision','noncurrent-version') THEN
        SELECT draft_revision INTO alt_revision FROM public.land_use_plan_versions WHERE id=version;
        altered:=jsonb_set(altered,'{version,draftRevision}',to_jsonb(alt_revision));
        alt_raw:=(raw::jsonb||jsonb_build_object('expectedDraftRevision',alt_revision,'expectedDescriptorHash',encode(extensions.digest(alt_rules::text,'sha256'),'hex')))::text;
      END IF;
      PERFORM pg_temp.freeze_refuses(format('SELECT public.freeze_land_use_plan_version(%L,%L,%L,%L,%s,%L,%L,%L)',plan,version,actor,command_id,alt_revision,alt_raw,altered::text,alt_rules::text),'PT409',scenario||' readiness or precondition refused');
      RAISE EXCEPTION USING ERRCODE='PT001',MESSAGE='Rollback this successful negative fixture';
    EXCEPTION WHEN SQLSTATE 'PT001' THEN NULL;
    END;
  END LOOP;
  -- Force a late failure after version/pointer writes and prove total rollback.
  FOREACH stage IN ARRAY ARRAY['1','2'] LOOP
  PERFORM set_config('openplan.test_freeze_event_failure',stage,true);
  PERFORM pg_temp.freeze_refuses(call_sql,'P0001','event failure reaches transaction');
  PERFORM pg_temp.freeze_assert((SELECT state='working' AND content_hash IS NULL FROM public.land_use_plan_versions WHERE id=version),'event failure rolls back version');
  PERFORM pg_temp.freeze_assert((SELECT current_working_version_id=version FROM public.land_use_plans WHERE id=plan),'event failure rolls back pointer');
  PERFORM pg_temp.freeze_assert(NOT EXISTS(SELECT 1 FROM public.land_use_plan_freeze_commands WHERE plan_id=plan),'event failure leaves no journal');
  PERFORM pg_temp.freeze_assert(NOT EXISTS(SELECT 1 FROM public.land_use_plan_review_events WHERE version_id=version),'late failure leaves no event');
  END LOOP;
  PERFORM set_config('openplan.test_freeze_event_failure','0',true);
  EXECUTE call_sql INTO outcome;
  PERFORM pg_temp.freeze_assert(outcome->>'replayed'='false','first freeze is new');
  PERFORM pg_temp.freeze_assert(outcome->>'contentHash'=encode(extensions.digest(snapshot::text,'sha256'),'hex'),'frozen hash covers original bytes');
  PERFORM pg_temp.freeze_assert((SELECT state='public_review' AND frozen_by=actor AND frozen_snapshot=snapshot AND content_hash=outcome->>'contentHash' FROM public.land_use_plan_versions WHERE id=version),'version frozen exactly');
  PERFORM pg_temp.freeze_assert((SELECT current_working_version_id IS NULL FROM public.land_use_plans WHERE id=plan),'working pointer cleared');
  PERFORM pg_temp.freeze_assert((SELECT count(*)=1 FROM public.land_use_plan_review_events WHERE version_id=version AND id=(outcome->>'reviewEventId')::uuid AND created_by=actor),'one attributed event');
  PERFORM pg_temp.freeze_assert((SELECT command_text=raw AND command_sha256=encode(extensions.digest(raw,'sha256'),'hex') AND frozen_snapshot_text=snapshot::text FROM public.land_use_plan_freeze_commands WHERE plan_id=plan),'exact request and snapshot bytes retained');
  EXECUTE call_sql INTO replay;
  PERFORM pg_temp.freeze_assert(replay->>'replayed'='true' AND replay-'replayed'=outcome-'replayed','exact replay original outcome');
  PERFORM pg_temp.freeze_assert((SELECT count(*)=1 FROM public.land_use_plan_review_events WHERE version_id=version),'replay no extra event');
  PERFORM pg_temp.freeze_refuses(replace(call_sql,quote_literal(raw),quote_literal(raw||' ')),'PT409','changed request bytes refused');
  PERFORM pg_temp.freeze_refuses(replace(call_sql,actor::text,other_actor::text),'PT409','other writer cannot reuse command');
  UPDATE public.workspace_members SET role='viewer' WHERE workspace_id=workspace AND user_id=actor;
  PERFORM pg_temp.freeze_refuses(call_sql,'42501','revoked replay refused');
  UPDATE public.workspace_members SET role='owner' WHERE workspace_id=workspace AND user_id=actor;
  INSERT INTO public.land_use_plan_versions(id,workspace_id,plan_id,version_number,version_kind) VALUES(next_version,workspace,plan,2,'revision');
  UPDATE public.land_use_plans SET current_working_version_id=next_version WHERE id=plan;
  PERFORM pg_temp.freeze_refuses(format('SELECT public.freeze_land_use_plan_version(%L,%L,%L,%L,%s,%L,NULL,NULL)',plan,next_version,actor,command_id,revision,raw),'PT409','changed replay version refused');
  PERFORM pg_temp.freeze_refuses(format('SELECT public.freeze_land_use_plan_version(%L,%L,%L,%L,%s,%L,NULL,NULL)',plan,version,actor,command_id,revision+1,raw),'PT409','changed replay revision refused');
  -- Replay bypasses preparation/installed rules, but never fresh permission.
  replay:=public.freeze_land_use_plan_version(plan,version,actor,command_id,revision,raw,NULL,NULL);
  PERFORM pg_temp.freeze_assert(replay-'replayed'=outcome-'replayed','replay after new version keeps original result');
  PERFORM pg_temp.freeze_assert((SELECT current_working_version_id=next_version FROM public.land_use_plans WHERE id=plan),'replay preserves newer pointer');
  PERFORM pg_temp.freeze_assert((SELECT state='working' FROM public.land_use_plan_versions WHERE id=next_version),'replay does not freeze next draft');
  SET LOCAL ROLE postgres;
  PERFORM pg_temp.freeze_refuses(format('UPDATE public.land_use_plan_freeze_commands SET actor_id=%L WHERE plan_id=%L',other_actor,plan),'P0001','journal rewrite refused');
  -- A live owner still forbids direct frozen edits under native writer RLS.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.freeze_refuses(format('DELETE FROM public.land_use_plan_content_nodes WHERE id=%L',section),'P0001','direct frozen content deletion refused');
  PERFORM pg_temp.freeze_refuses(format('UPDATE public.land_use_plan_content_nodes SET title=%L WHERE id=%L','changed',section),'P0001','direct frozen content update refused');
  PERFORM pg_temp.freeze_refuses(format('DELETE FROM public.land_use_plan_relationships WHERE id=%L',relation),'P0001','direct frozen relationship deletion refused');
  PERFORM pg_temp.freeze_refuses(format('DELETE FROM public.land_use_plan_implementation_actions WHERE id=%L',action),'P0001','direct frozen action deletion refused');
  PERFORM pg_temp.freeze_refuses(format('UPDATE public.land_use_plan_implementation_actions SET title=%L WHERE id=%L','changed',action),'P0001','direct frozen action rewrite refused');
  UPDATE public.land_use_plan_implementation_actions SET status='in_progress' WHERE id=action;
  PERFORM pg_temp.freeze_assert((SELECT status='in_progress' AND title='SYNTHETIC action' FROM public.land_use_plan_implementation_actions WHERE id=action),'frozen action status remains editable');
  SET LOCAL ROLE postgres;
  PERFORM pg_temp.freeze_refuses(format('DELETE FROM public.land_use_plan_freeze_commands WHERE plan_id=%L',plan),'P0001','direct journal deletion refused');
  IF current_setting('openplan.test_cascade_workspace',true)='1' THEN
    DELETE FROM public.workspaces WHERE id=workspace;
    PERFORM pg_temp.freeze_assert(NOT EXISTS(SELECT 1 FROM public.land_use_plans WHERE id=plan),'workspace cascade removes plan');
  ELSE
    DELETE FROM public.land_use_plans WHERE id=plan;
  END IF;
  PERFORM pg_temp.freeze_assert(NOT EXISTS(SELECT 1 FROM public.land_use_plan_versions WHERE plan_id=plan),'parent cascade removes versions');
  PERFORM pg_temp.freeze_assert(NOT EXISTS(SELECT 1 FROM public.land_use_plan_content_nodes WHERE version_id=version),'parent cascade removes content');
  PERFORM pg_temp.freeze_assert(NOT EXISTS(SELECT 1 FROM public.land_use_plan_relationships WHERE version_id=version),'parent cascade removes relationships');
  PERFORM pg_temp.freeze_assert(NOT EXISTS(SELECT 1 FROM public.land_use_plan_implementation_actions WHERE version_id=version),'parent cascade removes actions');
  PERFORM pg_temp.freeze_assert(NOT EXISTS(SELECT 1 FROM public.land_use_plan_freeze_commands WHERE plan_id=plan),'journal parent cascade allowed');
END $test$;
SELECT 'freeze persistence verified';
