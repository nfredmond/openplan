CREATE FUNCTION pg_temp.creation_assert(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION '%',message; END IF; END $$;
CREATE FUNCTION pg_temp.creation_refuses(statement text, expected text, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE=expected THEN RETURN; END IF;
    RAISE EXCEPTION '%: unexpected % %',message,SQLSTATE,SQLERRM;
  END;
  RAISE EXCEPTION '%: accepted',message;
END $$;
CREATE FUNCTION pg_temp.creation_fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('openplan.creation_test_failure',true)=TG_TABLE_NAME||':'||TG_OP THEN
    RAISE EXCEPTION USING ERRCODE='PT499',MESSAGE='Synthetic creation write failure';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER creation_fault AFTER INSERT OR UPDATE ON public.land_use_plans FOR EACH ROW EXECUTE FUNCTION pg_temp.creation_fault();
CREATE TRIGGER creation_fault AFTER INSERT ON public.land_use_plan_versions FOR EACH ROW EXECUTE FUNCTION pg_temp.creation_fault();
CREATE TRIGGER creation_fault AFTER INSERT ON public.land_use_plan_content_nodes FOR EACH ROW EXECUTE FUNCTION pg_temp.creation_fault();
CREATE TRIGGER creation_fault AFTER INSERT ON public.land_use_plan_creation_commands FOR EACH ROW EXECUTE FUNCTION pg_temp.creation_fault();
DO $test$
DECLARE
  actor uuid:=gen_random_uuid(); member uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  workspace uuid:=gen_random_uuid(); other_workspace uuid:=gen_random_uuid(); command_id uuid:=gen_random_uuid();
  prepared jsonb:='{"schemaVersion":1,"place":{"source":"uploaded_file","label":"SYNTHETIC area","kind":null,"ref":null,"countryCode":null,"subdivisionCode":null,"bbox":{"minLon":0,"minLat":0,"maxLon":1,"maxLat":1},"geometry":{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}},"assessment":{"authorities":[{"id":"11111111-1111-4111-8111-111111111111","label":"SYNTHETIC body","role":"sponsor","kind":"unassessed","jurisdiction":null,"sourceUrls":[]}],"applicability":{"status":"unresolved","explanation":"Synthetic transaction exercise only."}},"savedBy":"00000000-0000-0000-0000-000000000000","savedAt":"1900-01-01T00:00:00Z"}';
  descriptor text:='{"id":"synthetic-neutral","configured":false,"disclosure":"SYNTHETIC no configured law","planKinds":[{"key":"community","label":"Community"}],"requirements":[{"key":"required","label":"Required section","applicability":"required"},{"key":"conditional","label":"Conditional section","applicability":"conditional"}]}';
  command jsonb; raw text; statement text; result jsonb; replay jsonb; changed jsonb;
  version_revision bigint; before_plans bigint; before_versions bigint; before_nodes bigint; fault text;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(actor,actor||'@synthetic.invalid'),(member,member||'@synthetic.invalid'),(viewer,viewer||'@synthetic.invalid'),(outsider,outsider||'@synthetic.invalid');
  INSERT INTO public.workspaces(id,name,slug) VALUES(workspace,'SYNTHETIC creation',workspace::text),(other_workspace,'SYNTHETIC other',other_workspace::text);
  INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace,actor,'owner'),(workspace,member,'member'),(workspace,viewer,'viewer'),(other_workspace,actor,'owner');
  command:=jsonb_build_object('commandId',command_id,'title','SYNTHETIC creation','authorityLabel','SYNTHETIC display body','descriptorId','synthetic-neutral','planKindKey','community',
    'expectedDescriptorHash',encode(extensions.digest(descriptor,'sha256'),'hex'),'assessment',prepared->'assessment','place',jsonb_build_object('mode','uploaded','label','SYNTHETIC area','geometry',prepared#>'{place,geometry}'));
  raw:=E' \n'||command::text||E'\n';
  statement:=format('SELECT public.create_land_use_plan_with_context(%L,%L,%L,%L,%L,%L)',workspace,actor,command_id,raw,prepared,descriptor);
  PERFORM pg_temp.creation_assert(NOT has_function_privilege('authenticated','public.create_land_use_plan_with_context(uuid,uuid,uuid,text,jsonb,text)','EXECUTE'),'authenticated RPC permission');
  PERFORM pg_temp.creation_assert(NOT has_function_privilege('anon','public.create_land_use_plan_with_context(uuid,uuid,uuid,text,jsonb,text)','EXECUTE'),'anonymous RPC permission');
  PERFORM pg_temp.creation_assert(NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.create_land_use_plan_with_context(uuid,uuid,uuid,text,jsonb,text)'::regprocedure),'invoker function');
  PERFORM pg_temp.creation_assert((SELECT relrowsecurity FROM pg_class WHERE oid='public.land_use_plan_creation_commands'::regclass),'journal RLS');
  PERFORM pg_temp.creation_assert(NOT has_table_privilege('authenticated','public.land_use_plan_creation_commands','SELECT'),'journal private');
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.creation_refuses(statement,'42501','authenticated invocation');
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.creation_refuses(replace(statement,actor::text,viewer::text),'42501','viewer denied');
  PERFORM pg_temp.creation_refuses(replace(statement,actor::text,outsider::text),'42501','outsider denied');
  PERFORM pg_temp.creation_refuses(format('SELECT public.create_land_use_plan_with_context(%L,%L,NULL,%L,%L,%L)',workspace,actor,raw,prepared,descriptor),'PT400','missing command');
  PERFORM pg_temp.creation_refuses(format('SELECT public.create_land_use_plan_with_context(%L,%L,%L,%L,NULL,%L)',workspace,actor,command_id,raw,descriptor),'PT400','missing prepared context');
  PERFORM pg_temp.creation_refuses(format('SELECT public.create_land_use_plan_with_context(%L,%L,%L,%L,%L,%L)',workspace,actor,command_id,raw,jsonb_set(prepared,'{assessment,applicability,explanation}','"changed"'),descriptor),'PT400','assessment substitution');
  PERFORM pg_temp.creation_refuses(format('SELECT public.create_land_use_plan_with_context(%L,%L,%L,%L,%L,%L)',workspace,actor,command_id,raw,jsonb_set(prepared,'{place,geometry,coordinates}','[]'),descriptor),'PT400','geometry substitution');
  PERFORM pg_temp.creation_refuses(format('SELECT public.create_land_use_plan_with_context(%L,%L,%L,%L,%L,%L)',workspace,actor,command_id,raw,jsonb_set(prepared,'{place,countryCode}','"US"'),descriptor),'PT400','invented jurisdiction');
  PERFORM pg_temp.creation_refuses(format('SELECT public.create_land_use_plan_with_context(%L,%L,%L,%L,%L,%L)',workspace,actor,command_id,raw,prepared,descriptor||' '),'PT400','changed descriptor bytes');
  changed:=jsonb_set(command,'{planKindKey}','"absent"');
  PERFORM pg_temp.creation_refuses(format('SELECT public.create_land_use_plan_with_context(%L,%L,%L,%L,%L,%L)',workspace,actor,command_id,changed::text,prepared,descriptor),'PT409','unknown kind');
  changed:=jsonb_set(command,'{place,mode}','"retained"');
  PERFORM pg_temp.creation_refuses(format('SELECT public.create_land_use_plan_with_context(%L,%L,%L,%L,%L,%L)',workspace,actor,command_id,changed::text,prepared,descriptor),'PT400','retained boundary at creation');
  SELECT count(*) INTO before_plans FROM public.land_use_plans WHERE workspace_id=workspace;
  SELECT count(*) INTO before_versions FROM public.land_use_plan_versions WHERE workspace_id=workspace;
  SELECT count(*) INTO before_nodes FROM public.land_use_plan_content_nodes WHERE workspace_id=workspace;
  FOREACH fault IN ARRAY ARRAY['land_use_plans:INSERT','land_use_plan_versions:INSERT','land_use_plan_content_nodes:INSERT','land_use_plans:UPDATE','land_use_plan_creation_commands:INSERT'] LOOP
    PERFORM set_config('openplan.creation_test_failure',fault,true);
    PERFORM pg_temp.creation_refuses(statement,'PT499','rollback after '||fault);
    PERFORM pg_temp.creation_assert((SELECT count(*) FROM public.land_use_plans WHERE workspace_id=workspace)=before_plans,'partial plan rollback');
    PERFORM pg_temp.creation_assert((SELECT count(*) FROM public.land_use_plan_versions WHERE workspace_id=workspace)=before_versions,'partial version rollback');
    PERFORM pg_temp.creation_assert((SELECT count(*) FROM public.land_use_plan_content_nodes WHERE workspace_id=workspace)=before_nodes,'partial sections rollback');
    PERFORM pg_temp.creation_assert(NOT EXISTS(SELECT 1 FROM public.land_use_plan_creation_commands WHERE workspace_id=workspace),'partial receipt rollback');
  END LOOP;
  PERFORM set_config('openplan.creation_test_failure','',true);
  result:=public.create_land_use_plan_with_context(workspace,actor,command_id,raw,prepared,descriptor);
  PERFORM pg_temp.creation_assert(result->>'replayed'='false' AND result->>'actorId'=actor::text AND result->>'workspaceId'=workspace::text,'creation identity');
  PERFORM pg_temp.creation_assert(result#>>'{context,savedBy}'=actor::text AND result#>>'{context,savedAt}'<>prepared->>'savedAt','native context attribution');
  PERFORM pg_temp.creation_assert(result#>'{context,assessment}'=prepared->'assessment','retained assessment');
  PERFORM pg_temp.creation_assert((SELECT current_working_version_id::text=result->>'versionId' AND geography_label='SYNTHETIC area' AND geography_geojson=prepared#>'{place,geometry}' AND plan_context=result->'context' AND plan_context_hash=result->>'contextHash' FROM public.land_use_plans WHERE id=(result->>'planId')::uuid),'atomic plan context and active version');
  PERFORM pg_temp.creation_assert((SELECT applicable_requirement_keys=ARRAY['required']::text[] AND created_by=actor AND state='working' FROM public.land_use_plan_versions WHERE id=(result->>'versionId')::uuid),'initial version requirements');
  PERFORM pg_temp.creation_assert((SELECT count(*)=2 AND bool_and(node_kind='section' AND created_by=actor) FROM public.land_use_plan_content_nodes WHERE version_id=(result->>'versionId')::uuid),'complete initial sections');
  PERFORM pg_temp.creation_assert((SELECT jsonb_agg(jsonb_build_object('key',requirement_key,'label',title) ORDER BY sort_order) FROM public.land_use_plan_content_nodes WHERE version_id=(result->>'versionId')::uuid)='[{"key":"required","label":"Required section"},{"key":"conditional","label":"Conditional section"}]'::jsonb,'complete initial sections retain labels and order');
  SELECT draft_revision INTO version_revision FROM public.land_use_plan_versions WHERE id=(result->>'versionId')::uuid;
  replay:=public.create_land_use_plan_with_context(workspace,actor,command_id,raw,NULL,NULL);
  PERFORM pg_temp.creation_assert(replay->>'replayed'='true' AND replay-'replayed'=result-'replayed','exact original receipt replay');
  PERFORM pg_temp.creation_assert((SELECT count(*)=1 FROM public.land_use_plan_creation_commands WHERE workspace_id=workspace),'one command');
  PERFORM pg_temp.creation_assert((SELECT command_text=raw AND descriptor_text=descriptor AND descriptor_sha256=result->>'descriptorHash' FROM public.land_use_plan_creation_commands WHERE workspace_id=workspace),'exact original bytes');
  PERFORM pg_temp.creation_assert((SELECT draft_revision=version_revision FROM public.land_use_plan_versions WHERE id=(result->>'versionId')::uuid),'no duplicate revision');
  PERFORM pg_temp.creation_refuses(format('SELECT public.create_land_use_plan_with_context(%L,%L,%L,%L,NULL,NULL)',workspace,actor,command_id,raw||' '),'PT409','changed bytes replay');
  PERFORM pg_temp.creation_refuses(replace(statement,actor::text,member::text),'PT409','different staff replay');
  PERFORM pg_temp.creation_refuses(format('UPDATE public.land_use_plan_creation_commands SET command_text=%L WHERE workspace_id=%L','changed',workspace),'42501','service journal rewrite');
  SET LOCAL ROLE postgres;
  UPDATE public.workspace_members SET role='owner' WHERE workspace_id=workspace AND user_id=member;
  UPDATE public.workspace_members SET role='viewer' WHERE workspace_id=workspace AND user_id=actor;
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.creation_refuses(statement,'42501','revoked replay');
  SET LOCAL ROLE postgres;
  UPDATE public.workspace_members SET role='owner' WHERE workspace_id=workspace AND user_id=actor;
  SET LOCAL ROLE service_role;
  replay:=public.create_land_use_plan_with_context(other_workspace,actor,command_id,raw,prepared,descriptor);
  PERFORM pg_temp.creation_assert(replay->>'planId'<>result->>'planId' AND replay->>'workspaceId'=other_workspace::text,'same command ID independent workspace');
  SET LOCAL ROLE postgres;
  PERFORM pg_temp.creation_refuses(format('UPDATE public.land_use_plan_creation_commands SET command_text=%L WHERE workspace_id=%L','changed',workspace),'P0001','journal append-only');
  PERFORM pg_temp.creation_refuses(format('DELETE FROM public.land_use_plans WHERE id=%L',result->>'planId'),'23503','individual deletion retains creation identity');
  DELETE FROM public.workspaces WHERE id=workspace;
  PERFORM pg_temp.creation_assert(NOT EXISTS(SELECT 1 FROM public.land_use_plan_creation_commands WHERE workspace_id=workspace),'workspace deletion removes owned journal');
END $test$;
SELECT 'atomic plan creation verified';
