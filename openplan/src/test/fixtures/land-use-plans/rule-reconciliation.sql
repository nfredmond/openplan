CREATE FUNCTION pg_temp.reconciliation_assert(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION '%',message; END IF; END $$;
CREATE FUNCTION pg_temp.reconciliation_refuses(statement text, expected text, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE=expected THEN RETURN; END IF;
    RAISE EXCEPTION '%: unexpected % %',message,SQLSTATE,SQLERRM;
  END;
  RAISE EXCEPTION '%: accepted',message;
END $$;
CREATE FUNCTION pg_temp.reconciliation_fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('openplan.reconciliation_test_failure',true)=TG_TABLE_NAME||':'||TG_OP THEN
    RAISE EXCEPTION USING ERRCODE='PT499',MESSAGE='Synthetic reconciliation write failure';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reconciliation_fault AFTER INSERT ON public.land_use_plan_content_nodes FOR EACH ROW EXECUTE FUNCTION pg_temp.reconciliation_fault();
CREATE TRIGGER reconciliation_fault AFTER UPDATE ON public.land_use_plan_versions FOR EACH ROW EXECUTE FUNCTION pg_temp.reconciliation_fault();
CREATE TRIGGER reconciliation_fault AFTER INSERT ON public.land_use_plan_rule_reconciliation_commands FOR EACH ROW EXECUTE FUNCTION pg_temp.reconciliation_fault();
DO $test$
DECLARE
  actor uuid:=gen_random_uuid(); member uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  workspace uuid:=gen_random_uuid(); other_workspace uuid:=gen_random_uuid(); plan uuid:=gen_random_uuid(); version uuid:=gen_random_uuid();
  frozen uuid:=gen_random_uuid(); command_id uuid:=gen_random_uuid(); node uuid:=gen_random_uuid(); policy uuid:=gen_random_uuid();
  document uuid:=gen_random_uuid(); layer uuid:=gen_random_uuid(); layer_version uuid:=gen_random_uuid(); designation uuid:=gen_random_uuid();
  fresh_plan uuid:=gen_random_uuid(); fresh_version uuid:=gen_random_uuid();
  descriptor text:='{"id":"synthetic-family","planKinds":[{"key":"area","label":"SYNTHETIC area"}],"requirements":[{"key":"retained","label":"Current label must not overwrite authored title","applicability":"required"},{"key":"new_required","label":"New required section","applicability":"required"},{"key":"conditional","label":"Conditional section","applicability":"conditional"},{"key":"local","label":"Locally defined content","applicability":"locally_defined"}]}';
  command jsonb; raw text; statement text; result jsonb; replay jsonb; changed jsonb; altered_rules text;
  before_revision integer; after_revision integer; before_content jsonb; before_nodes jsonb; before_frozen jsonb; before_document jsonb;
  fault text; item jsonb; keys text[]; key_item text;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(actor,actor||'@synthetic.invalid'),(member,member||'@synthetic.invalid'),(viewer,viewer||'@synthetic.invalid'),(outsider,outsider||'@synthetic.invalid');
  INSERT INTO public.workspaces(id,name,slug) VALUES(workspace,'SYNTHETIC reconciliation',workspace::text),(other_workspace,'SYNTHETIC other',other_workspace::text);
  INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace,actor,'owner'),(workspace,member,'member'),(workspace,viewer,'viewer'),(other_workspace,actor,'owner');
  INSERT INTO public.land_use_plans(id,workspace_id,title,descriptor_id,plan_kind_key,authority_label,geography_label)
    VALUES(plan,workspace,'SYNTHETIC older plan','synthetic-family','area','SYNTHETIC body','SYNTHETIC area');
  INSERT INTO public.land_use_plan_versions(id,workspace_id,plan_id,version_number,version_kind,applicable_requirement_keys)
    VALUES(frozen,workspace,plan,1,'original',ARRAY['legacy_rule']),
      (version,workspace,plan,2,'amendment',ARRAY['legacy_rule','retained','earlier_optional']);
  UPDATE public.land_use_plan_versions SET based_on_version_id=frozen WHERE id=version;
  UPDATE public.land_use_plan_versions SET state='public_review',frozen_snapshot='{"synthetic":"earlier reviewed edition"}',
    content_hash=repeat('f',64),frozen_at=now(),frozen_by=actor WHERE id=frozen;
  UPDATE public.land_use_plans SET current_working_version_id=version WHERE id=plan;
  INSERT INTO public.kb_documents(id,workspace_id,title,source_kind,status) VALUES(document,workspace,'SYNTHETIC evidence','pasted_text','ready');
  INSERT INTO public.land_use_plan_content_nodes(id,workspace_id,version_id,node_kind,requirement_key,title,body,sort_order,evidence_document_id,evidence_url,created_by)
    VALUES(node,workspace,version,'section','legacy_rule','Original authored title','Retained original text',3,document,'https://synthetic.invalid/evidence',actor),
      (gen_random_uuid(),workspace,version,'section','retained','Authored retained title','Retained current-key text',8,document,NULL,actor),
      (policy,workspace,version,'policy','new_required','Existing policy is not a checklist section','Retained policy text',12,NULL,NULL,actor);
  INSERT INTO public.land_use_plan_relationships(workspace_id,plan_id,version_id,related_plan_label,relationship_kind,notes)
    VALUES(workspace,plan,version,'SYNTHETIC related plan','overlapping','Retained relationship');
  INSERT INTO public.workspace_gis_layers(id,workspace_id,name) VALUES(layer,workspace,'SYNTHETIC map');
  INSERT INTO public.workspace_gis_layer_versions(id,layer_id,workspace_id,version_number,source_format,source_filename,source_byte_size,srs_name,srs_basis,declared_feature_count,source_feature_count)
    VALUES(layer_version,layer,workspace,1,'geojson','SYNTHETIC.geojson',0,'WGS84','geojson_rfc7946_default',0,0);
  UPDATE public.workspace_gis_layer_versions SET ingest_status='ready',finalized_at=now() WHERE id=layer_version;
  INSERT INTO public.land_use_plan_designations(id,workspace_id,version_id,layer_id,layer_version_id,designation_set_label,map_note)
    VALUES(designation,workspace,version,layer,layer_version,'SYNTHETIC designations','Retained map note');
  INSERT INTO public.land_use_plan_designation_policy_links(workspace_id,version_id,designation_id,policy_node_id) VALUES(workspace,version,designation,policy);
  INSERT INTO public.land_use_plan_implementation_actions(workspace_id,version_id,title,content_node_id,evidence_document_id)
    VALUES(workspace,version,'SYNTHETIC implementation',policy,document);
  SELECT draft_revision INTO before_revision FROM public.land_use_plan_versions WHERE id=version;
  SELECT jsonb_agg(to_jsonb(n) ORDER BY id) INTO before_nodes FROM public.land_use_plan_content_nodes n WHERE version_id=version;
  before_content:=public.land_use_plan_freeze_content(version);
  SELECT to_jsonb(v) INTO before_frozen FROM public.land_use_plan_versions v WHERE id=frozen;
  SELECT to_jsonb(d) INTO before_document FROM public.kb_documents d WHERE id=document;
  command:=jsonb_build_object('operation','reconcile','commandId',command_id,'versionId',version,
    'expectedDraftRevision',before_revision,'expectedDescriptorHash',encode(extensions.digest(descriptor,'sha256'),'hex'));
  raw:=E' \n'||command::text||E'\n';
  statement:=format('SELECT public.reconcile_land_use_plan_rules(%L,%L,%L,%L,%L,%L)',plan,workspace,actor,command_id,raw,descriptor);
  PERFORM pg_temp.reconciliation_assert(NOT has_function_privilege('authenticated','public.reconcile_land_use_plan_rules(uuid,uuid,uuid,uuid,text,text)','EXECUTE'),'authenticated RPC denied');
  PERFORM pg_temp.reconciliation_assert(NOT has_function_privilege('anon','public.reconcile_land_use_plan_rules(uuid,uuid,uuid,uuid,text,text)','EXECUTE'),'anonymous RPC denied');
  PERFORM pg_temp.reconciliation_assert(NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.reconcile_land_use_plan_rules(uuid,uuid,uuid,uuid,text,text)'::regprocedure),'invoker function');
  PERFORM pg_temp.reconciliation_assert((SELECT relrowsecurity FROM pg_class WHERE oid='public.land_use_plan_rule_reconciliation_commands'::regclass),'journal RLS');
  PERFORM pg_temp.reconciliation_assert(NOT has_table_privilege('authenticated','public.land_use_plan_rule_reconciliation_commands','SELECT'),'journal private');
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.reconciliation_refuses(statement,'42501','authenticated invocation');
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.reconciliation_refuses(replace(statement,actor::text,viewer::text),'42501','viewer denied');
  PERFORM pg_temp.reconciliation_refuses(replace(statement,actor::text,outsider::text),'42501','outsider denied');
  PERFORM pg_temp.reconciliation_refuses(replace(statement,workspace::text,other_workspace::text),'PT404','wrong workspace denied');
  PERFORM pg_temp.reconciliation_refuses(format('SELECT public.reconcile_land_use_plan_rules(%L,%L,%L,NULL,%L,%L)',plan,workspace,actor,raw,descriptor),'PT400','missing command identity');
  PERFORM pg_temp.reconciliation_refuses(format('SELECT public.reconcile_land_use_plan_rules(%L,%L,%L,%L,%L,%L)',plan,workspace,actor,command_id,raw||repeat(' ',8193),descriptor),'PT400','oversized command');
  PERFORM pg_temp.reconciliation_refuses(format('SELECT public.reconcile_land_use_plan_rules(%L,%L,%L,%L,%L,NULL)',plan,workspace,actor,command_id,raw),'PT400','missing new descriptor');
  PERFORM pg_temp.reconciliation_refuses(format('SELECT public.reconcile_land_use_plan_rules(%L,%L,%L,%L,%L,%L)',plan,workspace,actor,command_id,raw,descriptor||repeat(' ',2000001)),'PT400','oversized descriptor');
  PERFORM pg_temp.reconciliation_refuses(format('SELECT public.reconcile_land_use_plan_rules(%L,%L,%L,%L,%L,%L)',plan,workspace,actor,command_id,'{',descriptor),'PT400','malformed command JSON');
  PERFORM pg_temp.reconciliation_refuses(format('SELECT public.reconcile_land_use_plan_rules(%L,%L,%L,%L,%L,%L)',plan,workspace,actor,command_id,raw,'{'),'PT400','malformed descriptor JSON');
  FOREACH key_item IN ARRAY ARRAY['operation','commandId','versionId','expectedDraftRevision','expectedDescriptorHash'] LOOP
    PERFORM pg_temp.reconciliation_refuses(format('SELECT public.reconcile_land_use_plan_rules(%L,%L,%L,%L,%L,%L)',plan,workspace,actor,command_id,(command-key_item)::text,descriptor),'PT400','missing command field '||key_item);
  END LOOP;
  FOREACH item IN ARRAY ARRAY['null'::jsonb,'[]'::jsonb,'1'::jsonb,'{"operation":"reconcile"}'::jsonb] LOOP
    PERFORM pg_temp.reconciliation_refuses(format('SELECT public.reconcile_land_use_plan_rules(%L,%L,%L,%L,%L,%L)',plan,workspace,actor,command_id,item::text,descriptor),'PT400','invalid command shape');
  END LOOP;
  FOREACH item IN ARRAY ARRAY['-1'::jsonb,'1.5'::jsonb,'2147483648'::jsonb,'"7"'::jsonb] LOOP
    changed:=jsonb_set(command,'{expectedDraftRevision}',item);
    PERFORM pg_temp.reconciliation_refuses(format('SELECT public.reconcile_land_use_plan_rules(%L,%L,%L,%L,%L,%L)',plan,workspace,actor,command_id,changed::text,descriptor),'PT400','invalid revision type or range');
  END LOOP;
  changed:=command||'{"extra":true}'::jsonb;
  PERFORM pg_temp.reconciliation_refuses(format('SELECT public.reconcile_land_use_plan_rules(%L,%L,%L,%L,%L,%L)',plan,workspace,actor,command_id,changed::text,descriptor),'PT400','extra command fields');
  changed:=jsonb_set(command,'{expectedDraftRevision}',to_jsonb(before_revision+1));
  PERFORM pg_temp.reconciliation_refuses(format('SELECT public.reconcile_land_use_plan_rules(%L,%L,%L,%L,%L,%L)',plan,workspace,actor,command_id,changed::text,descriptor),'PT409','changed draft revision');
  changed:=jsonb_set(command,'{versionId}',to_jsonb(frozen::text));
  PERFORM pg_temp.reconciliation_refuses(format('SELECT public.reconcile_land_use_plan_rules(%L,%L,%L,%L,%L,%L)',plan,workspace,actor,command_id,changed::text,descriptor),'PT409','frozen version refused');
  -- Isolate the frozen-state gate from pointer, revision and child-write guards.
  UPDATE public.land_use_plans SET current_working_version_id=frozen WHERE id=plan;
  altered_rules:=jsonb_set(descriptor::jsonb,'{requirements}','[]')::text;
  changed:=jsonb_set(jsonb_set(changed,'{expectedDraftRevision}','0'),'{expectedDescriptorHash}',to_jsonb(encode(extensions.digest(altered_rules,'sha256'),'hex')));
  PERFORM pg_temp.reconciliation_refuses(format('SELECT public.reconcile_land_use_plan_rules(%L,%L,%L,%L,%L,%L)',plan,workspace,actor,command_id,changed::text,altered_rules),'PT409','frozen state alone refused');
  UPDATE public.land_use_plans SET current_working_version_id=NULL WHERE id=plan;
  PERFORM pg_temp.reconciliation_refuses(statement,'PT409','noncurrent working version refused');
  UPDATE public.land_use_plans SET current_working_version_id=version WHERE id=plan;
  PERFORM pg_temp.reconciliation_refuses(format('SELECT public.reconcile_land_use_plan_rules(%L,%L,%L,%L,%L,%L)',plan,workspace,actor,command_id,raw,descriptor||' '),'PT409','changed descriptor bytes');
  FOREACH item IN ARRAY ARRAY[jsonb_set(descriptor::jsonb,'{id}','"another-family"'),
    jsonb_set(descriptor::jsonb,'{planKinds,0,key}','"other-kind"'),
    jsonb_set(descriptor::jsonb,'{planKinds}',(descriptor::jsonb->'planKinds')||'[{"key":"other","label":"Other"}]')] LOOP
    altered_rules:=item::text; changed:=jsonb_set(command,'{expectedDescriptorHash}',to_jsonb(encode(extensions.digest(altered_rules,'sha256'),'hex')));
    PERFORM pg_temp.reconciliation_refuses(format('SELECT public.reconcile_land_use_plan_rules(%L,%L,%L,%L,%L,%L)',plan,workspace,actor,command_id,changed::text,altered_rules),'PT409','mismatched rule selection');
  END LOOP;
  -- Each block restores its deliberately malformed or full-order fixture.
  FOREACH keys SLICE 1 IN ARRAY ARRAY[ARRAY['legacy_rule',NULL]::text[],ARRAY['legacy_rule','']::text[]] LOOP
    BEGIN
      UPDATE public.land_use_plan_versions SET applicable_requirement_keys=keys WHERE id=version;
      SELECT draft_revision INTO after_revision FROM public.land_use_plan_versions WHERE id=version;
      changed:=jsonb_set(command,'{expectedDraftRevision}',to_jsonb(after_revision));
      PERFORM pg_temp.reconciliation_refuses(format('SELECT public.reconcile_land_use_plan_rules(%L,%L,%L,%L,%L,%L)',plan,workspace,actor,command_id,changed::text,descriptor),'PT409','malformed existing applicability');
      RAISE EXCEPTION USING ERRCODE='PZ001',MESSAGE='Restore fixture';
    EXCEPTION WHEN SQLSTATE 'PZ001' THEN NULL;
    END;
  END LOOP;
  BEGIN
    UPDATE public.land_use_plan_content_nodes SET sort_order=2147483647 WHERE id=node;
    SELECT draft_revision INTO after_revision FROM public.land_use_plan_versions WHERE id=version;
    changed:=jsonb_set(command,'{expectedDraftRevision}',to_jsonb(after_revision));
    PERFORM pg_temp.reconciliation_refuses(format('SELECT public.reconcile_land_use_plan_rules(%L,%L,%L,%L,%L,%L)',plan,workspace,actor,command_id,changed::text,descriptor),'PT409','full section ordering refused');
    RAISE EXCEPTION USING ERRCODE='PZ001',MESSAGE='Restore fixture';
  EXCEPTION WHEN SQLSTATE 'PZ001' THEN NULL;
  END;
  FOREACH item IN ARRAY ARRAY['[null]'::jsonb,'[{"key":"bad","label":"","applicability":"required"}]'::jsonb,
    (descriptor::jsonb->'requirements')||jsonb_build_array(descriptor::jsonb#>'{requirements,0}')] LOOP
    altered_rules:=jsonb_set(descriptor::jsonb,'{requirements}',item)::text;
    changed:=jsonb_set(command,'{expectedDescriptorHash}',to_jsonb(encode(extensions.digest(altered_rules,'sha256'),'hex')));
    PERFORM pg_temp.reconciliation_refuses(format('SELECT public.reconcile_land_use_plan_rules(%L,%L,%L,%L,%L,%L)',plan,workspace,actor,command_id,changed::text,altered_rules),'PT400','invalid requirements');
  END LOOP;
  FOREACH fault IN ARRAY ARRAY['land_use_plan_content_nodes:INSERT','land_use_plan_versions:UPDATE','land_use_plan_rule_reconciliation_commands:INSERT'] LOOP
    PERFORM set_config('openplan.reconciliation_test_failure',fault,true);
    PERFORM pg_temp.reconciliation_refuses(statement,'PT499','rollback after '||fault);
    PERFORM pg_temp.reconciliation_assert(public.land_use_plan_freeze_content(version)=before_content,'partial content rollback');
    PERFORM pg_temp.reconciliation_assert((SELECT draft_revision=before_revision AND applicable_requirement_keys=ARRAY['legacy_rule','retained','earlier_optional'] FROM public.land_use_plan_versions WHERE id=version),'partial version rollback');
    PERFORM pg_temp.reconciliation_assert(NOT EXISTS(SELECT 1 FROM public.land_use_plan_rule_reconciliation_commands WHERE plan_id=plan),'partial journal rollback');
  END LOOP;
  PERFORM set_config('openplan.reconciliation_test_failure','',true);
  result:=public.reconcile_land_use_plan_rules(plan,workspace,actor,command_id,raw,descriptor);
  PERFORM pg_temp.reconciliation_assert(result->>'replayed'='false' AND result->>'actorId'=actor::text AND result->>'workspaceId'=workspace::text AND result->>'planId'=plan::text AND result->>'versionId'=version::text,'receipt scope');
  PERFORM pg_temp.reconciliation_assert(result->>'commandId'=command_id::text AND result->>'descriptorHash'=command->>'expectedDescriptorHash','receipt command and rules');
  PERFORM pg_temp.reconciliation_assert((SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM public.land_use_plan_content_nodes n WHERE version_id=version AND id NOT IN (SELECT (s->>'id')::uuid FROM jsonb_array_elements(result->'addedSections') s))=before_nodes,'authored nodes and evidence are byte-preserved');
  PERFORM pg_temp.reconciliation_assert(public.land_use_plan_freeze_content(version)-'nodes'=before_content-'nodes','relationships maps policy links and actions preserved');
  PERFORM pg_temp.reconciliation_assert((SELECT to_jsonb(v)=before_frozen FROM public.land_use_plan_versions v WHERE id=frozen),'earlier frozen edition preserved');
  PERFORM pg_temp.reconciliation_assert((SELECT to_jsonb(d)=before_document FROM public.kb_documents d WHERE id=document),'evidence document preserved');
  PERFORM pg_temp.reconciliation_assert(result->'previousDraftRevision'=to_jsonb(before_revision) AND result->'draftRevision'=to_jsonb(before_revision+4),'three inserts and applicability advance revision');
  PERFORM pg_temp.reconciliation_assert((SELECT array_agg(s->>'requirementKey' ORDER BY position) FROM jsonb_array_elements(result->'addedSections') WITH ORDINALITY AS rows(s,position))=ARRAY['new_required','conditional','local'],'only missing sections added in rule order');
  PERFORM pg_temp.reconciliation_assert((SELECT count(*)=3 AND bool_and(n.body IS NULL AND n.parent_node_id IS NULL AND n.evidence_document_id IS NULL AND n.evidence_url IS NULL AND n.node_kind='section' AND n.created_by=actor AND n.sort_order=12+position) FROM jsonb_array_elements(result->'addedSections') WITH ORDINALITY AS rows(s,position) JOIN public.land_use_plan_content_nodes n ON n.id=(s->>'id')::uuid WHERE n.version_id=version),'new sections are blank, attributed and appended');
  keys:=ARRAY['legacy_rule','retained','earlier_optional','new_required','local'];
  PERFORM pg_temp.reconciliation_assert(result->'applicableRequirementKeys'=to_jsonb(keys),'receipt preserves earlier and non-conditional keys');
  PERFORM pg_temp.reconciliation_assert((SELECT applicable_requirement_keys=keys AND version_kind='amendment' AND based_on_version_id=frozen AND state='working' FROM public.land_use_plan_versions WHERE id=version),'amendment identity preserved');
  PERFORM pg_temp.reconciliation_assert((SELECT command_text=raw AND descriptor_text=descriptor AND receipt=result AND actor_id=actor AND version_id=version FROM public.land_use_plan_rule_reconciliation_commands j WHERE j.plan_id=plan AND j.command_id=(command->>'commandId')::uuid),'exact journal bytes and result');
  SELECT draft_revision INTO after_revision FROM public.land_use_plan_versions WHERE id=version;
  replay:=public.reconcile_land_use_plan_rules(plan,workspace,actor,command_id,raw,NULL);
  PERFORM pg_temp.reconciliation_assert(replay->>'replayed'='true' AND replay-'replayed'=result-'replayed','exact retry receipt');
  PERFORM pg_temp.reconciliation_assert((SELECT draft_revision=after_revision FROM public.land_use_plan_versions WHERE id=version),'retry performs no draft writes');
  PERFORM pg_temp.reconciliation_refuses(format('SELECT public.reconcile_land_use_plan_rules(%L,%L,%L,%L,%L,NULL)',plan,workspace,actor,command_id,raw||' '),'PT409','changed retry bytes');
  PERFORM pg_temp.reconciliation_refuses(replace(statement,actor::text,member::text),'PT409','another staff member cannot reuse receipt');
  SET LOCAL ROLE postgres;
  UPDATE public.workspace_members SET role='owner' WHERE workspace_id=workspace AND user_id=member;
  UPDATE public.workspace_members SET role='viewer' WHERE workspace_id=workspace AND user_id=actor;
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.reconciliation_refuses(statement,'42501','revoked permission refuses replay');
  SET LOCAL ROLE postgres;
  UPDATE public.workspace_members SET role='owner' WHERE workspace_id=workspace AND user_id=actor;
  UPDATE public.land_use_plan_content_nodes SET body='Later authored edit' WHERE id=node;
  SET LOCAL ROLE service_role;
  replay:=public.reconcile_land_use_plan_rules(plan,workspace,actor,command_id,raw,NULL);
  PERFORM pg_temp.reconciliation_assert(replay-'replayed'=result-'replayed','later edits do not rewrite original receipt');
  PERFORM pg_temp.reconciliation_assert((SELECT body='Later authored edit' FROM public.land_use_plan_content_nodes WHERE id=node),'retry preserves later edit');
  UPDATE public.land_use_plans SET descriptor_id='later-installed-family' WHERE id=plan;
  replay:=public.reconcile_land_use_plan_rules(plan,workspace,actor,command_id,raw,NULL);
  PERFORM pg_temp.reconciliation_assert(replay-'replayed'=result-'replayed','later rule selection does not block exact replay');
  UPDATE public.land_use_plans SET descriptor_id='synthetic-family' WHERE id=plan;
  SELECT draft_revision INTO after_revision FROM public.land_use_plan_versions WHERE id=version;
  command_id:=gen_random_uuid(); command:=jsonb_set(jsonb_set(command,'{commandId}',to_jsonb(command_id::text)),'{expectedDraftRevision}',to_jsonb(after_revision));
  replay:=public.reconcile_land_use_plan_rules(plan,workspace,actor,command_id,command::text,descriptor);
  PERFORM pg_temp.reconciliation_assert(replay->'addedSections'='[]'::jsonb AND replay->'draftRevision'=to_jsonb(after_revision),'already reconciled draft creates no duplicate sections or counter writes');
  PERFORM pg_temp.reconciliation_refuses(format('UPDATE public.land_use_plan_rule_reconciliation_commands SET command_text=%L WHERE plan_id=%L','changed',plan),'42501','service journal rewrite denied');
  SET LOCAL ROLE postgres;
  PERFORM pg_temp.reconciliation_refuses(format('UPDATE public.land_use_plan_rule_reconciliation_commands SET command_text=%L WHERE plan_id=%L','changed',plan),'P0001','journal is append-only');
  INSERT INTO public.land_use_plans(id,workspace_id,title,descriptor_id,plan_kind_key,authority_label,geography_label)
    VALUES(fresh_plan,workspace,'SYNTHETIC fresh original','synthetic-family','area','SYNTHETIC body','SYNTHETIC area');
  INSERT INTO public.land_use_plan_versions(id,workspace_id,plan_id,version_number,version_kind) VALUES(fresh_version,workspace,fresh_plan,1,'original');
  UPDATE public.land_use_plans SET current_working_version_id=fresh_version WHERE id=fresh_plan;
  command_id:=gen_random_uuid(); command:=jsonb_set(jsonb_set(jsonb_set(command,'{commandId}',to_jsonb(command_id::text)),'{versionId}',to_jsonb(fresh_version::text)),'{expectedDraftRevision}','0');
  SET LOCAL ROLE service_role;
  replay:=public.reconcile_land_use_plan_rules(fresh_plan,workspace,actor,command_id,command::text,descriptor);
  PERFORM pg_temp.reconciliation_assert(jsonb_array_length(replay->'addedSections')=4 AND replay->'draftRevision'='5'::jsonb,'fresh original adds all sections and default applicability');
  SET LOCAL ROLE postgres;
END $test$;
SELECT 'atomic plan rule reconciliation verified';
