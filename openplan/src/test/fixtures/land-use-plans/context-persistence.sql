CREATE FUNCTION pg_temp.save_context(p uuid,v uuid,a uuid,c uuid,h text,raw text,prepared jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER AS $$
  SELECT public.save_land_use_plan_context(p,v,a,c,h,raw,prepared,'local-unconfigured','community');
$$;
CREATE FUNCTION pg_temp.context_assert(p_ok boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION '%', p_message; END IF;
END $$;
CREATE FUNCTION pg_temp.context_refuses(p_sql text, p_state text, p_message text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state THEN RETURN; END IF;
    RAISE EXCEPTION '%: unexpected % %', p_message, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION '%: accepted', p_message;
END $$;
DO $test$
DECLARE
  actor uuid := gen_random_uuid(); viewer uuid := gen_random_uuid(); outsider uuid := gen_random_uuid();
  member uuid := gen_random_uuid(); workspace uuid := gen_random_uuid();
  plan uuid := gen_random_uuid(); version uuid := gen_random_uuid(); other_version uuid := gen_random_uuid();
  command uuid := gen_random_uuid(); second_command uuid := gen_random_uuid();
  prepared jsonb := '{"schemaVersion":1,"place":{"source":"uploaded_file","label":"SYNTHETIC study","kind":null,"ref":null,"countryCode":null,"subdivisionCode":null,"bbox":{"minLon":0,"minLat":0,"maxLon":1,"maxLat":1},"geometry":{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}},"assessment":{"authorities":[{"id":"11111111-1111-4111-8111-111111111111","label":"SYNTHETIC body","role":"adopting","kind":"unassessed","jurisdiction":null,"sourceUrls":[]}],"applicability":{"status":"unresolved","explanation":"Synthetic persistence exercise, no legal assessment."}},"savedBy":"00000000-0000-0000-0000-000000000000","savedAt":"1900-01-01T00:00:00Z"}';
  raw_command text := '{"place":{"mode":"uploaded","label":"SYNTHETIC study","geometry":{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}},"assessment":{"authorities":[{"id":"11111111-1111-4111-8111-111111111111","label":"SYNTHETIC body","role":"adopting","kind":"unassessed","jurisdiction":null,"sourceUrls":[]}],"applicability":{"status":"unresolved","explanation":"Synthetic persistence exercise, no legal assessment."}}}';
  result jsonb; replay jsonb; second_result jsonb; call_sql text; freeze_sql text;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(actor,actor||'@example.test'),(viewer,viewer||'@example.test'),
    (outsider,outsider||'@example.test'),(member,member||'@example.test');
  INSERT INTO public.workspaces(id,name,slug) VALUES(workspace,'SYNTHETIC context transaction',workspace::text);
  INSERT INTO public.workspace_members(workspace_id,user_id,role)
    VALUES(workspace,actor,'owner'),(workspace,viewer,'viewer'),(workspace,member,'member');
  INSERT INTO public.land_use_plans(id,workspace_id,title,descriptor_id,plan_kind_key,authority_label,geography_label)
    VALUES(plan,workspace,'SYNTHETIC context','local-unconfigured','community','SYNTHETIC','SYNTHETIC');
  INSERT INTO public.land_use_plan_versions(id,workspace_id,plan_id,version_number,version_kind)
    VALUES(version,workspace,plan,1,'original'),(other_version,workspace,plan,2,'amendment');
  UPDATE public.land_use_plans SET current_working_version_id=version WHERE id=plan;
  raw_command := E' \n' || raw_command || E'\n ';
  call_sql := format('SELECT pg_temp.save_context(%L,%L,%L,%L,NULL,%L,%L)',plan,version,actor,command,raw_command,prepared);
  PERFORM pg_temp.context_assert(NOT has_function_privilege('authenticated','public.save_land_use_plan_context(uuid,uuid,uuid,uuid,text,text,jsonb,text,text)','EXECUTE'), 'authenticated RPC permission');
  PERFORM pg_temp.context_assert(NOT has_function_privilege('anon','public.save_land_use_plan_context(uuid,uuid,uuid,uuid,text,text,jsonb,text,text)','EXECUTE'), 'anonymous RPC permission');
  PERFORM pg_temp.context_assert(NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.save_land_use_plan_context(uuid,uuid,uuid,uuid,text,text,jsonb,text,text)'::regprocedure), 'RPC remains security invoker');
  PERFORM pg_temp.context_assert((SELECT relrowsecurity FROM pg_class WHERE oid='public.land_use_plan_context_commands'::regclass),'command journal RLS enabled');
  PERFORM pg_temp.context_assert(NOT has_table_privilege('authenticated','public.land_use_plan_context_commands','SELECT'), 'private command journal');
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.context_refuses(call_sql,'42501','authenticated RPC refused');
  PERFORM pg_temp.context_refuses(format('UPDATE public.land_use_plans SET plan_context=%L WHERE id=%L',prepared,plan),'42501','direct context update refused');
  PERFORM pg_temp.context_refuses(format('INSERT INTO public.land_use_plans(workspace_id,title,descriptor_id,plan_kind_key,authority_label,geography_label,plan_context) VALUES(%L,%L,%L,%L,%L,%L,%L)',workspace,'SYNTHETIC','local-unconfigured','community','SYNTHETIC','SYNTHETIC',prepared),'42501','direct context insert refused');
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.context_refuses(replace(call_sql,actor::text,outsider::text),'42501','outsider refused');
  PERFORM pg_temp.context_refuses(replace(call_sql,actor::text,viewer::text),'42501','viewer refused');
  PERFORM pg_temp.context_refuses(replace(call_sql,version::text,other_version::text),'PT409','noncurrent version refused');
  PERFORM pg_temp.context_refuses(format('SELECT pg_temp.save_context(%L,%L,%L,%L,%L,%L,%L)',plan,version,actor,command,repeat('f',64),raw_command,prepared),'PT409','stale first save refused');
  PERFORM pg_temp.context_refuses(format('SELECT pg_temp.save_context(%L,%L,%L,%L,NULL,%L,%L)',plan,version,actor,command,raw_command,jsonb_set(prepared,'{assessment,authorities}','[{"label":"changed"}]')),'PT400','assessment substitution refused');
  PERFORM pg_temp.context_refuses(format('SELECT pg_temp.save_context(%L,%L,%L,NULL,NULL,%L,%L)',plan,version,actor,raw_command,prepared),'PT400','null command refused');
  PERFORM pg_temp.context_refuses(format('SELECT pg_temp.save_context(%L,%L,%L,%L,NULL,%L,%L)',plan,version,actor,command,'not JSON',prepared),'PT400','invalid command JSON refused');
  PERFORM pg_temp.context_refuses(format('SELECT pg_temp.save_context(%L,%L,%L,%L,NULL,%L,NULL)',plan,version,actor,command,raw_command),'PT400','missing prepared context refused');
  PERFORM pg_temp.context_refuses(format('SELECT public.save_land_use_plan_context(%L,%L,%L,%L,NULL,%L,%L,%L,%L)',plan,version,actor,command,raw_command,prepared,'wrong-checklist','community'),'PT409','changed checklist refused');
  PERFORM pg_temp.context_refuses(format('SELECT public.save_land_use_plan_context(%L,%L,%L,%L,NULL,%L,%L,%L,%L)',plan,version,actor,command,raw_command,prepared,'local-unconfigured','wrong-kind'),'PT409','changed plan kind refused');
  PERFORM pg_temp.context_refuses(format('SELECT pg_temp.save_context(%L,%L,%L,%L,NULL,%L,%L)',plan,version,actor,gen_random_uuid(),jsonb_set(raw_command::jsonb,'{place}','{"mode":"retained"}')::text,prepared),'PT409','cannot retain an absent study area');
  EXECUTE call_sql INTO result;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.context_refuses(format('UPDATE public.land_use_plans SET descriptor_id=%L WHERE id=%L','wrong-checklist',plan),'42501','direct checklist change refused');
  PERFORM pg_temp.context_refuses(format('UPDATE public.land_use_plans SET plan_kind_key=%L WHERE id=%L','wrong-kind',plan),'42501','direct plan kind change refused');
  UPDATE public.land_use_plans SET title='SYNTHETIC permitted label edit' WHERE id=plan;
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.context_assert(result->>'replayed'='false','first save is new');
  PERFORM pg_temp.context_assert(result#>>'{context,savedBy}'=actor::text,'database actor attribution');
  PERFORM pg_temp.context_assert((result#>>'{context,savedAt}')::timestamptz BETWEEN transaction_timestamp() AND clock_timestamp(),'database time attribution');
  PERFORM pg_temp.context_assert(result->>'contextHash'=encode(extensions.digest((result->'context')::text,'sha256'),'hex'),'saved context hash');
  PERFORM pg_temp.context_assert((SELECT plan_context=result->'context' FROM public.land_use_plans WHERE id=plan),'plan context matches result');
  PERFORM pg_temp.context_assert((SELECT c.command_text = raw_command AND c.command_sha256=encode(extensions.digest(c.command_text,'sha256'),'hex') FROM public.land_use_plan_context_commands c WHERE c.plan_id=plan AND c.command_id=command),'exact command journal');
  PERFORM pg_temp.context_refuses(format('SELECT public.save_land_use_plan_context(%L,%L,%L,%L,NULL,%L,%L,%L,%L)',plan,version,actor,command,raw_command,prepared,'wrong-checklist','community'),'PT409','changed replay checklist refused');
  PERFORM pg_temp.context_refuses(format('SELECT public.save_land_use_plan_context(%L,%L,%L,%L,NULL,%L,%L,%L,%L)',plan,version,actor,command,raw_command,prepared,'local-unconfigured','wrong-kind'),'PT409','changed replay plan kind refused');
  EXECUTE call_sql INTO replay;
  PERFORM pg_temp.context_assert(replay->>'replayed'='true' AND replay-'replayed'=result-'replayed','exact replay preserves result');
  PERFORM pg_temp.context_refuses(replace(call_sql,actor::text,member::text),'PT409','other member cannot replay');
  PERFORM pg_temp.context_refuses(format('SELECT pg_temp.save_context(%L,%L,%L,%L,NULL,%L,NULL)',plan,version,actor,command,raw_command||' '),'PT409','changed command bytes refused');
  PERFORM pg_temp.context_refuses(format('SELECT pg_temp.save_context(%L,%L,%L,%L,%L,%L,NULL)',plan,version,actor,command,repeat('f',64),raw_command),'PT409','changed replay precondition refused');
  PERFORM pg_temp.context_refuses(replace(call_sql,version::text,other_version::text),'PT409','changed replay version refused');
  PERFORM pg_temp.context_refuses(replace(call_sql,command::text,second_command::text),'PT409','stale overwrite refused');
  second_result := pg_temp.save_context(plan,version,actor,second_command,result->>'contextHash',raw_command,prepared);
  replay := pg_temp.save_context(plan,version,actor,command,NULL,raw_command,NULL);
  PERFORM pg_temp.context_assert(replay-'replayed'=result-'replayed','old replay remains original');
  PERFORM pg_temp.context_assert((SELECT plan_context=second_result->'context' FROM public.land_use_plans WHERE id=plan),'old replay does not overwrite newer save');
  PERFORM pg_temp.context_refuses(format('SELECT pg_temp.save_context(%L,%L,%L,%L,%L,%L,%L)',plan,version,actor,gen_random_uuid(),second_result->>'contextHash',jsonb_set(raw_command::jsonb,'{place}','{"mode":"retained"}')::text,jsonb_set(prepared,'{place,label}','"Substituted area"')),'PT409','retained area substitution refused');
  second_result := pg_temp.save_context(plan,version,actor,gen_random_uuid(),second_result->>'contextHash',jsonb_set(raw_command::jsonb,'{place}','{"mode":"retained"}')::text,prepared);
  PERFORM pg_temp.context_assert(second_result#>'{context,place}'=prepared->'place','retained area stays exact');
  PERFORM pg_temp.context_assert((SELECT geography_label=prepared#>>'{place,label}' AND geography_geojson=prepared#>'{place,geometry}' FROM public.land_use_plans WHERE id=plan),'plan geography agrees with retained context');
  SET LOCAL ROLE postgres;
  UPDATE public.workspace_members SET role='owner' WHERE workspace_id=workspace AND user_id=member;
  UPDATE public.workspace_members SET role='viewer' WHERE workspace_id=workspace AND user_id=actor;
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.context_refuses(call_sql,'42501','revoked writer replay refused');
  SET LOCAL ROLE postgres;
  UPDATE public.workspace_members SET role='owner' WHERE workspace_id=workspace AND user_id=actor;
  PERFORM pg_temp.context_refuses(format('UPDATE public.land_use_plan_context_commands SET command_text=command_text||%L WHERE plan_id=%L',' ',plan),'P0001','journal rewrite refused');
  PERFORM pg_temp.context_refuses(format('DELETE FROM public.land_use_plan_context_commands WHERE plan_id=%L',plan),'P0001','journal delete refused');
  PERFORM pg_temp.context_refuses(format('INSERT INTO public.land_use_plan_versions(workspace_id,plan_id,version_number,version_kind,state,content_hash,frozen_snapshot,frozen_at,frozen_by) VALUES(%L,%L,3,%L,%L,%L,%L,now(),%L)',workspace,plan,'amendment','public_review',repeat('a',64),'{}',actor),'PT409','frozen insert omission refused');
  freeze_sql := format('UPDATE public.land_use_plan_versions SET state=%L,content_hash=%L,frozen_snapshot=%L,frozen_at=now(),frozen_by=%L WHERE id=%L','public_review',repeat('a',64),'{}',actor,version);
  PERFORM pg_temp.context_refuses(freeze_sql,'PT409','omitted frozen context refused');
  PERFORM pg_temp.context_refuses(replace(freeze_sql,quote_literal('{}'),quote_literal(jsonb_build_object('planContext',result->'context')::text)),'PT409','stale frozen context refused');
  EXECUTE replace(freeze_sql,quote_literal('{}'),quote_literal(jsonb_build_object('planContext',second_result->'context')::text));
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.context_refuses(format('SELECT pg_temp.save_context(%L,%L,%L,%L,%L,%L,%L)',plan,version,actor,gen_random_uuid(),second_result->>'contextHash',raw_command,prepared),'PT409','frozen version save refused');
  replay := pg_temp.save_context(plan,version,actor,command,NULL,raw_command,NULL);
  PERFORM pg_temp.context_assert(replay-'replayed'=result-'replayed','lost acknowledgment recoverable after freeze');
  SET LOCAL ROLE postgres;
  IF current_setting('openplan.test_cascade_workspace',true)='1' THEN
    DELETE FROM public.workspaces WHERE id=workspace;
    PERFORM pg_temp.context_assert(NOT EXISTS(SELECT 1 FROM public.land_use_plans WHERE id=plan),'workspace cascade removes contextual plan');
  ELSE
    DELETE FROM public.land_use_plans WHERE id=plan;
  END IF;
  PERFORM pg_temp.context_assert(NOT EXISTS(SELECT 1 FROM public.land_use_plan_context_commands WHERE plan_id=plan),'parent cascade retains no orphan journal');
END $test$;
SELECT 'context persistence verified';
