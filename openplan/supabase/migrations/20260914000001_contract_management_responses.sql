-- Weekly PM responses retain the compared forecast, proposed schedule and project decision record.
CREATE TABLE public.contract_management_responses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), engagement_id uuid NOT NULL REFERENCES public.invoicing_engagements(id),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id), forecast_id uuid NOT NULL REFERENCES public.contract_forecasts(id),
 input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'), content jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.contract_response_applications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), engagement_id uuid NOT NULL REFERENCES public.invoicing_engagements(id),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id), response_id uuid NOT NULL UNIQUE REFERENCES public.contract_management_responses(id),
 schedule_id uuid NOT NULL REFERENCES public.contract_schedules(id), evidence text NOT NULL CHECK(length(trim(evidence))>0),
 created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.contract_management_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_response_applications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contract_management_responses,public.contract_response_applications FROM anon,authenticated;
GRANT SELECT ON public.contract_management_responses,public.contract_response_applications TO authenticated;
GRANT ALL ON public.contract_management_responses,public.contract_response_applications TO service_role;
CREATE POLICY management_read ON public.contract_management_responses FOR SELECT TO authenticated USING(public.contract_can_manage(engagement_id));
CREATE POLICY management_read ON public.contract_response_applications FOR SELECT TO authenticated USING(public.contract_can_manage(engagement_id));
CREATE TRIGGER immutable_response BEFORE UPDATE OR DELETE ON public.contract_management_responses FOR EACH ROW EXECUTE FUNCTION public.guard_contract_history();
CREATE TRIGGER immutable_application BEFORE UPDATE OR DELETE ON public.contract_response_applications FOR EACH ROW EXECUTE FUNCTION public.guard_contract_history();

CREATE FUNCTION public.contract_project_response_records(p_project_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(jsonb_agg(r ORDER BY r->>'recordType',r->>'id'),'[]') FROM (
 SELECT jsonb_build_object('id',id,'recordType','risk','title',title,'status',status,'updated_at',updated_at,'recordHash',encode(extensions.digest(to_jsonb(source)::text,'sha256'),'hex')) r FROM public.project_risks source WHERE project_id=p_project_id
 UNION ALL SELECT jsonb_build_object('id',id,'recordType','issue','title',title,'status',status,'updated_at',updated_at,'recordHash',encode(extensions.digest(to_jsonb(source)::text,'sha256'),'hex')) FROM public.project_issues source WHERE project_id=p_project_id
 UNION ALL SELECT jsonb_build_object('id',id,'recordType','decision','title',title,'status',status,'updated_at',updated_at,'recordHash',encode(extensions.digest(to_jsonb(source)::text,'sha256'),'hex')) FROM public.project_decisions source WHERE project_id=p_project_id
 ) records
$$;
REVOKE ALL ON FUNCTION public.contract_project_response_records(uuid) FROM PUBLIC,anon,authenticated,service_role;

ALTER FUNCTION public.record_contract_command(uuid,uuid,jsonb) RENAME TO record_contract_command_delivery;
REVOKE ALL ON FUNCTION public.record_contract_command_delivery(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.record_contract_command(p_engagement_id uuid,p_actor_id uuid,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.invoicing_engagements; k text:=p_command->>'kind'; req uuid:=(p_command->>'requestId')::uuid; original_command jsonb:=coalesce(p_command->'_request',p_command);
 cached public.contract_commands; f public.contract_forecasts; response public.contract_management_responses; result jsonb; record_json jsonb; source_json jsonb; record_id uuid; v integer;
BEGIN
 IF k NOT IN ('response','apply_response') THEN RETURN public.record_contract_command_delivery(p_engagement_id,p_actor_id,p_command); END IF;
 SELECT * INTO e FROM public.invoicing_engagements WHERE id=p_engagement_id;
 IF coalesce(public.contract_actor_role(e.id,p_actor_id) NOT IN ('owner','admin','pm','finance'),true) THEN RAISE EXCEPTION 'Contract PM authority required for responses' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(e.workspace_id::text,451));
 IF req IS NULL OR octet_length(p_command::text)>8000000 OR coalesce(length(trim(p_command->>'evidence')),0)=0 THEN RAISE EXCEPTION 'Document a bounded response request and evidence' USING ERRCODE='22023'; END IF;
 SELECT * INTO cached FROM public.contract_commands WHERE engagement_id=e.id AND request_id=req;
 IF cached.request_id IS NOT NULL THEN
  IF cached.actor_id<>p_actor_id OR cached.command<>original_command THEN RAISE EXCEPTION 'Response retry changed' USING ERRCODE='PT409'; END IF;
  RETURN cached.result;
 END IF;
 IF k='response' THEN
  SELECT * INTO f FROM public.contract_forecasts WHERE engagement_id=e.id ORDER BY version DESC LIMIT 1;
  IF f.id IS NULL OR f.id IS DISTINCT FROM (p_command->>'forecastId')::uuid OR f.input_hash IS DISTINCT FROM public.contract_delivery_hash(e.workspace_id) OR f.input_hash IS DISTINCT FROM p_command->>'_inputHash' THEN RAISE EXCEPTION 'Compare the current unchanged reviewed forecast' USING ERRCODE='PT409'; END IF;
  -- Lock the concrete mutable source while retaining its exact record, not just a title.
  IF p_command->>'recordType'='risk' THEN SELECT to_jsonb(r) INTO source_json FROM public.project_risks r WHERE r.id=(p_command->>'recordId')::uuid AND r.project_id=e.project_id FOR SHARE;
  ELSIF p_command->>'recordType'='issue' THEN SELECT to_jsonb(r) INTO source_json FROM public.project_issues r WHERE r.id=(p_command->>'recordId')::uuid AND r.project_id=e.project_id FOR SHARE;
  ELSIF p_command->>'recordType'='decision' THEN SELECT to_jsonb(r) INTO source_json FROM public.project_decisions r WHERE r.id=(p_command->>'recordId')::uuid AND r.project_id=e.project_id FOR SHARE; END IF;
  IF source_json IS NULL OR encode(extensions.digest(source_json::text,'sha256'),'hex') IS DISTINCT FROM p_command->>'recordHash' OR (source_json->>'updated_at')::timestamptz IS DISTINCT FROM (p_command->>'recordUpdatedAt')::timestamptz THEN RAISE EXCEPTION 'The linked project response record changed or is outside this project' USING ERRCODE='PT409'; END IF;
  record_json:=p_command->'_comparison';
  IF record_json IS NULL OR record_json->'request' IS DISTINCT FROM original_command OR record_json->'before' IS DISTINCT FROM f.content->'result' THEN RAISE EXCEPTION 'A server-calculated exact forecast comparison is required' USING ERRCODE='22023'; END IF;
  INSERT INTO public.contract_management_responses(engagement_id,workspace_id,forecast_id,input_hash,content,created_by)
   VALUES(e.id,e.workspace_id,f.id,f.input_hash,record_json||jsonb_build_object('sourceRecord',source_json),p_actor_id) RETURNING id INTO record_id;
  result:=jsonb_build_object('id',record_id);
 ELSE
  SELECT * INTO response FROM public.contract_management_responses WHERE id=(p_command->>'responseId')::uuid AND engagement_id=e.id;
  IF response.id IS NULL OR response.input_hash IS DISTINCT FROM public.contract_delivery_hash(e.workspace_id) OR response.forecast_id IS DISTINCT FROM (SELECT id FROM public.contract_forecasts WHERE engagement_id=e.id ORDER BY version DESC LIMIT 1) THEN RAISE EXCEPTION 'Response inputs changed; retain a new comparison before applying' USING ERRCODE='PT409'; END IF;
  IF EXISTS(SELECT 1 FROM public.contract_response_applications WHERE response_id=response.id) THEN RAISE EXCEPTION 'Response already applied' USING ERRCODE='PT409'; END IF;
  SELECT value INTO record_json FROM jsonb_array_elements(public.contract_project_response_records(e.project_id)) WHERE value->>'id'=response.content->'request'->>'recordId' AND value->>'recordType'=response.content->'request'->>'recordType';
  IF record_json IS NULL OR record_json->>'recordHash' IS DISTINCT FROM response.content->'request'->>'recordHash' OR (record_json->>'updated_at')::timestamptz IS DISTINCT FROM (response.content->'request'->>'recordUpdatedAt')::timestamptz THEN RAISE EXCEPTION 'Project decision changed after comparison' USING ERRCODE='PT409'; END IF;
  result:=public.record_contract_command_delivery(e.id,p_actor_id,jsonb_build_object('kind','schedule','requestId',gen_random_uuid(),'expectedVersion',p_command->'expectedVersion','content',response.content->'request'->'schedule'));
  INSERT INTO public.contract_response_applications(engagement_id,workspace_id,response_id,schedule_id,evidence,created_by) VALUES(e.id,e.workspace_id,response.id,(result->>'id')::uuid,p_command->>'evidence',p_actor_id) RETURNING id INTO record_id;
  result:=result||jsonb_build_object('applicationId',record_id);
  -- Scenario work assumptions are never inserted as accepted staff updates.
 END IF;
 INSERT INTO public.contract_commands(engagement_id,request_id,actor_id,command,result) VALUES(e.id,req,p_actor_id,original_command,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.record_contract_command(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_contract_command(uuid,uuid,jsonb) TO service_role;

ALTER FUNCTION public.read_contract_management(uuid,uuid,timestamptz) RENAME TO read_contract_management_delivery;
REVOKE ALL ON FUNCTION public.read_contract_management_delivery(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.read_contract_management(p_engagement_id uuid,p_actor_id uuid,p_cutoff timestamptz DEFAULT now()) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 result:=public.read_contract_management_delivery(p_engagement_id,p_actor_id,p_cutoff);
 IF result->>'role' IN ('owner','admin','pm','finance') THEN
  result:=result||jsonb_build_object('schemaVersion',4,'responses',jsonb_build_object(
   'records',public.contract_project_response_records((result->'engagement'->>'project_id')::uuid),
   'responses',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at,r.id) FROM public.contract_management_responses r WHERE r.engagement_id=p_engagement_id AND r.created_at<=p_cutoff),'[]'),
   'applications',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at,a.id) FROM public.contract_response_applications a WHERE a.engagement_id=p_engagement_id AND a.created_at<=p_cutoff),'[]')));
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_contract_management(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_contract_management(uuid,uuid,timestamptz) TO service_role;
