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
DO $test$
DECLARE
  actor uuid:=gen_random_uuid(); member uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  workspace uuid:=gen_random_uuid(); other_workspace uuid:=gen_random_uuid(); third_workspace uuid:=gen_random_uuid(); command_id uuid:=gen_random_uuid();
  prepared jsonb:='{"schemaVersion":1,"place":{"source":"uploaded_file","label":"SYNTHETIC area","kind":null,"ref":null,"countryCode":null,"subdivisionCode":null,"bbox":{"minLon":0,"minLat":0,"maxLon":1,"maxLat":1},"geometry":{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}},"assessment":{"authorities":[{"id":"11111111-1111-4111-8111-111111111111","label":"SYNTHETIC body","role":"sponsor","kind":"unassessed","jurisdiction":null,"sourceUrls":[]}],"applicability":{"status":"unresolved","explanation":"Synthetic transaction exercise only."}},"savedBy":"00000000-0000-0000-0000-000000000000","savedAt":"1900-01-01T00:00:00Z"}';
  descriptor text:='{"id":"synthetic-neutral","configured":false,"disclosure":"SYNTHETIC no configured law","planKinds":[{"key":"community","label":"Community"}],"requirements":[{"key":"required","label":"Required section","applicability":"required"},{"key":"conditional","label":"Conditional section","applicability":"conditional"}]}';
  command jsonb; raw text; stopping text; creation text; result jsonb; repeated jsonb; created jsonb;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(actor,actor||'@synthetic.invalid'),(member,member||'@synthetic.invalid'),(viewer,viewer||'@synthetic.invalid'),(outsider,outsider||'@synthetic.invalid');
  INSERT INTO public.workspaces(id,name,slug) VALUES(workspace,'SYNTHETIC creation stop',workspace::text),(other_workspace,'SYNTHETIC other stop',other_workspace::text),(third_workspace,'SYNTHETIC independent stop',third_workspace::text);
  INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace,actor,'owner'),(workspace,member,'member'),(workspace,viewer,'viewer'),(other_workspace,actor,'owner'),(other_workspace,member,'member'),(third_workspace,actor,'owner');
  command:=jsonb_build_object('commandId',command_id,'title','SYNTHETIC creation','authorityLabel','SYNTHETIC display body','descriptorId','synthetic-neutral','planKindKey','community',
    'expectedDescriptorHash',encode(extensions.digest(descriptor,'sha256'),'hex'),'assessment',prepared->'assessment','place',jsonb_build_object('mode','uploaded','label','SYNTHETIC area','geometry',prepared#>'{place,geometry}'));
  raw:=E' \n'||command::text||E'\n';
  stopping:=format('SELECT public.cancel_land_use_plan_creation(%L,%L,%L,%L)',workspace,actor,command_id,raw);
  creation:=format('SELECT public.create_land_use_plan_with_context(%L,%L,%L,%L,%L,%L)',workspace,actor,command_id,raw,prepared,descriptor);
  PERFORM pg_temp.creation_assert((SELECT relrowsecurity FROM pg_class WHERE oid='public.land_use_plan_creation_cancellations'::regclass),'stop journal RLS');
  PERFORM pg_temp.creation_assert(NOT has_table_privilege('authenticated','public.land_use_plan_creation_cancellations','SELECT'),'stop journal private');
  PERFORM pg_temp.creation_assert(NOT has_function_privilege('authenticated','public.cancel_land_use_plan_creation(uuid,uuid,uuid,text)','EXECUTE'),'stop RPC private');
  PERFORM pg_temp.creation_assert(NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.cancel_land_use_plan_creation(uuid,uuid,uuid,text)'::regprocedure),'stop RPC invoker');
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.creation_refuses(stopping,'42501','authenticated stop denied');
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.creation_refuses(replace(stopping,actor::text,viewer::text),'42501','viewer stop denied');
  PERFORM pg_temp.creation_refuses(replace(stopping,actor::text,outsider::text),'42501','outsider stop denied');
  PERFORM pg_temp.creation_refuses(format('SELECT public.cancel_land_use_plan_creation(%L,%L,%L,%L)',workspace,actor,gen_random_uuid(),raw),'PT400','stop command identity');
  result:=public.cancel_land_use_plan_creation(workspace,actor,command_id,raw);
  PERFORM pg_temp.creation_assert(result->>'outcome'='cancelled' AND result->>'commandId'=command_id::text AND result->>'actorId'=actor::text
    AND result->>'workspaceId'=workspace::text AND result->>'commandText'=raw AND result->>'replayed'='false' AND result->>'cancelledAt' IS NOT NULL,'retained stop receipt');
  repeated:=public.cancel_land_use_plan_creation(workspace,actor,command_id,raw);
  PERFORM pg_temp.creation_assert(repeated=result||jsonb_build_object('replayed',true),'exact stop replay');
  PERFORM pg_temp.creation_refuses(format('SELECT public.cancel_land_use_plan_creation(%L,%L,%L,%L)',workspace,actor,command_id,raw||' '),'PT409','stop changed bytes');
  PERFORM pg_temp.creation_refuses(replace(stopping,actor::text,member::text),'PT409','stop different actor');
  PERFORM pg_temp.creation_refuses(creation,'PT409','stopped request cannot create');
  PERFORM pg_temp.creation_assert(NOT EXISTS(SELECT 1 FROM public.land_use_plans WHERE workspace_id=workspace),'stopped plan rollback');
  PERFORM pg_temp.creation_assert(NOT EXISTS(SELECT 1 FROM public.land_use_plan_versions WHERE workspace_id=workspace),'stopped version rollback');
  PERFORM pg_temp.creation_assert(NOT EXISTS(SELECT 1 FROM public.land_use_plan_content_nodes WHERE workspace_id=workspace),'stopped sections rollback');
  PERFORM pg_temp.creation_assert(NOT EXISTS(SELECT 1 FROM public.land_use_plan_creation_commands WHERE workspace_id=workspace),'stopped creation receipt absent');
  RESET ROLE;
  PERFORM pg_temp.creation_refuses(format('UPDATE public.land_use_plan_creation_cancellations SET command_text=%L WHERE workspace_id=%L',raw||' ',workspace),'42501','stop append only');
  PERFORM pg_temp.creation_refuses(format('DELETE FROM public.land_use_plan_creation_cancellations WHERE workspace_id=%L',workspace),'42501','stop delete denied');
  SET LOCAL ROLE service_role;
  repeated:=public.cancel_land_use_plan_creation(third_workspace,actor,command_id,raw);
  PERFORM pg_temp.creation_assert(repeated->>'workspaceId'=third_workspace::text AND (SELECT count(*) FROM public.land_use_plan_creation_cancellations c WHERE c.command_id=(command->>'commandId')::uuid)=2,'independent stop workspace');
  created:=public.create_land_use_plan_with_context(other_workspace,actor,command_id,raw,prepared,descriptor);
  repeated:=public.cancel_land_use_plan_creation(other_workspace,actor,command_id,raw);
  PERFORM pg_temp.creation_assert(repeated->>'outcome'='created' AND repeated->'result'=created||jsonb_build_object('replayed',true),'existing creation returned');
  PERFORM pg_temp.creation_assert(NOT EXISTS(SELECT 1 FROM public.land_use_plan_creation_cancellations WHERE workspace_id=other_workspace),'creation not relabelled cancelled');
  PERFORM pg_temp.creation_refuses(format('SELECT public.cancel_land_use_plan_creation(%L,%L,%L,%L)',other_workspace,actor,command_id,raw||' '),'PT409','existing creation exact bytes');
  PERFORM pg_temp.creation_refuses(format('SELECT public.cancel_land_use_plan_creation(%L,%L,%L,%L)',other_workspace,member,command_id,raw),'PT409','existing creation actor');
  repeated:=public.cancel_land_use_plan_creation(workspace,actor,command_id,raw);
  PERFORM pg_temp.creation_assert(repeated=result||jsonb_build_object('replayed',true),'existing creation workspace scope');
  RESET ROLE;
  UPDATE public.workspace_members SET role='owner' WHERE workspace_id=workspace AND user_id=member;
  UPDATE public.workspace_members SET role='viewer' WHERE workspace_id=workspace AND user_id=actor;
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.creation_refuses(stopping,'42501','revoked stop replay denied');
  RESET ROLE;
  BEGIN
    DELETE FROM public.workspaces WHERE id=workspace;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'stop workspace cascade: %',SQLERRM; END;
  PERFORM pg_temp.creation_assert(NOT EXISTS(SELECT 1 FROM public.land_use_plan_creation_cancellations WHERE workspace_id=workspace),'stop workspace cascade');
END;
$test$;
SELECT 'creation cancellation verified';
