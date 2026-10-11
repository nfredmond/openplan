-- Map packages: a client-ready map and GIS package for one project, built by an
-- agent on the planner's own computer or added by hand. Workspace members read
-- the record; bytes move only through signed URLs that a route issues after it
-- checks access. A connector never receives a Supabase session or service key:
-- it presents the same digest-checked project connection token as Planner Agent.
BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'project-map-packages',
  'project-map-packages',
  false,
  1073741824,
  ARRAY['application/zip','image/png','text/markdown']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE public.project_map_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  source text NOT NULL CHECK (source IN ('agent','upload')),
  deliverable text NOT NULL CHECK (deliverable IN
    ('grant_application','corridor_study','safety_plan','active_transportation_plan','transportation_plan','general')),
  funding_opportunity_id uuid REFERENCES public.funding_opportunities(id) ON DELETE SET NULL,
  connection_id uuid REFERENCES public.assistant_provider_connections(id) ON DELETE SET NULL,
  provider text,
  auth_mode text,
  model_id text,
  effort text,
  brief jsonb,
  brief_canonical text,
  brief_hash text,
  skill_tree_hash text CHECK (skill_tree_hash IS NULL OR skill_tree_hash ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK (state IN ('queued','running','uploading','ready','failed','cancelled','interrupted')),
  attempt_id uuid,
  lease_expires_at timestamptz,
  last_heartbeat_at timestamptz,
  progress jsonb CHECK (progress IS NULL OR (jsonb_typeof(progress)='object' AND octet_length(progress::text)<=12000)),
  receipt jsonb CHECK (receipt IS NULL OR (jsonb_typeof(receipt)='object' AND octet_length(receipt::text)<=120000)),
  failure_code text CHECK (failure_code IS NULL OR failure_code ~ '^[a-z_]{1,120}$'),
  upload_file_name text CHECK (upload_file_name IS NULL OR upload_file_name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,155}\.zip$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE(workspace_id,request_id),
  UNIQUE(id,workspace_id,project_id),
  -- Nathaniel's rule (2026-10-10): only Claude Fable 5.1, or GPT-6 Astra as a
  -- far second, may run the skill. Uploaded packages name no runner.
  CONSTRAINT project_map_package_runner CHECK (
    (source='agent' AND effort='high' AND brief IS NOT NULL AND skill_tree_hash IS NOT NULL AND upload_file_name IS NULL AND (
      (provider='claude' AND auth_mode='claude_subscription' AND model_id='claude-fable-5-1') OR
      (provider='codex' AND auth_mode IN ('chatgpt','apiKey') AND model_id='gpt-6-astra')))
    OR (source='upload' AND provider IS NULL AND auth_mode IS NULL AND model_id IS NULL AND effort IS NULL
      AND connection_id IS NULL AND brief IS NULL AND brief_canonical IS NULL AND brief_hash IS NULL
      AND skill_tree_hash IS NULL AND attempt_id IS NULL AND lease_expires_at IS NULL AND receipt IS NULL
      AND upload_file_name IS NOT NULL)),
  CONSTRAINT project_map_package_brief CHECK (brief IS NULL OR (
    octet_length(brief_canonical)<=2000000
    AND brief=brief_canonical::jsonb
    AND brief_hash=encode(extensions.digest(convert_to(brief_canonical,'UTF8'),'sha256'),'hex')
    AND brief->>'version'='1'
    AND brief->>'workspaceId'=workspace_id::text
    AND brief->'project'->>'id'=project_id::text
    AND brief->>'deliverable'=deliverable
    AND brief->'skill'->>'treeHash'=skill_tree_hash)),
  CONSTRAINT project_map_package_state CHECK (
    (state='queued' AND source='agent' AND attempt_id IS NULL AND lease_expires_at IS NULL AND receipt IS NULL AND finished_at IS NULL AND failure_code IS NULL)
    OR (state='running' AND source='agent' AND attempt_id IS NOT NULL AND lease_expires_at IS NOT NULL AND receipt IS NULL AND finished_at IS NULL AND failure_code IS NULL)
    OR (state='uploading' AND finished_at IS NULL AND failure_code IS NULL
      AND (source='upload' OR (attempt_id IS NOT NULL AND lease_expires_at IS NOT NULL AND receipt IS NOT NULL)))
    OR (state='ready' AND finished_at IS NOT NULL AND failure_code IS NULL AND (source='upload' OR receipt IS NOT NULL))
    OR (state IN ('failed','cancelled','interrupted') AND finished_at IS NOT NULL AND failure_code IS NOT NULL))
);
CREATE INDEX project_map_package_queue ON public.project_map_packages(connection_id,created_at) WHERE state='queued';
CREATE INDEX project_map_package_project ON public.project_map_packages(workspace_id,project_id,created_at DESC);

CREATE TABLE public.project_map_package_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('package_zip','figure_preview','run_report')),
  name text NOT NULL CHECK (name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$'),
  object_path text NOT NULL UNIQUE,
  bytes bigint NOT NULL CHECK (bytes > 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(package_id,name),
  FOREIGN KEY(package_id,workspace_id,project_id)
    REFERENCES public.project_map_packages(id,workspace_id,project_id) ON DELETE CASCADE,
  CHECK (object_path=workspace_id::text||'/'||project_id::text||'/'||package_id::text||'/'||name),
  CHECK ((role='package_zip' AND name ~* '\.zip$') OR (role='figure_preview' AND name ~* '\.png$') OR (role='run_report' AND name ~* '\.md$'))
);
CREATE UNIQUE INDEX project_map_package_one_zip ON public.project_map_package_files(package_id) WHERE role='package_zip';

ALTER TABLE public.project_map_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_map_package_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.project_map_packages,public.project_map_package_files FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.project_map_packages,public.project_map_package_files TO authenticated;
GRANT ALL ON public.project_map_packages,public.project_map_package_files TO service_role;

-- A map package is a project artifact: everyone in the workspace may read it.
-- Writes happen only in the functions below, called by authenticated routes.
CREATE POLICY project_map_packages_member_read ON public.project_map_packages
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=project_map_packages.workspace_id AND m.user_id=auth.uid()
      AND lower(trim(coalesce(m.role,''))) IN ('owner','admin','member','viewer')));
CREATE POLICY project_map_package_files_member_read ON public.project_map_package_files
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=project_map_package_files.workspace_id AND m.user_id=auth.uid()
      AND lower(trim(coalesce(m.role,''))) IN ('owner','admin','member','viewer')));

-- A revoked connection cannot finish its work, so its open packages close.
CREATE FUNCTION public.close_map_packages_for_revoked_connection() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL THEN
    UPDATE public.project_map_packages SET state='cancelled',finished_at=clock_timestamp(),failure_code='connection_revoked'
      WHERE connection_id=NEW.id AND state IN ('queued','running','uploading');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.close_map_packages_for_revoked_connection() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER close_map_packages_on_connection_revoke
  AFTER UPDATE OF revoked_at ON public.assistant_provider_connections
  FOR EACH ROW EXECUTE FUNCTION public.close_map_packages_for_revoked_connection();

-- When a deleted user or connection clears a package's link, an unfinished
-- package can no longer complete. Close it in the same row update the foreign
-- key makes, so no package waits forever and no cascade is blocked.
CREATE FUNCTION public.close_orphaned_map_package() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.state IN ('queued','running','uploading') AND (
      (NEW.connection_id IS NULL AND OLD.connection_id IS NOT NULL) OR (NEW.requested_by IS NULL AND OLD.requested_by IS NOT NULL)) THEN
    NEW.state:='cancelled';
    NEW.finished_at:=clock_timestamp();
    NEW.failure_code:=CASE WHEN NEW.connection_id IS NULL AND OLD.connection_id IS NOT NULL THEN 'connection_removed' ELSE 'requester_removed' END;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.close_orphaned_map_package() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER close_orphaned_map_package
  BEFORE UPDATE OF connection_id,requested_by ON public.project_map_packages
  FOR EACH ROW EXECUTE FUNCTION public.close_orphaned_map_package();

-- Writers are owners, admins and members; viewers read only.
CREATE FUNCTION public.assert_map_package_writer(p_user_id uuid,p_workspace_id uuid,p_project_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE member_role text;
BEGIN
  SELECT role INTO member_role FROM public.workspace_members WHERE user_id=p_user_id AND workspace_id=p_workspace_id FOR SHARE;
  IF NOT FOUND OR lower(trim(coalesce(member_role,''))) NOT IN ('owner','admin','member') THEN
    RAISE EXCEPTION 'Map package access denied' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.projects WHERE id=p_project_id AND workspace_id=p_workspace_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Map package access denied' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.assert_map_package_writer(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- One request id makes a retried create return the same package, and refuses a
-- retry whose contents differ.
CREATE FUNCTION public.create_project_map_package(p_request_id uuid,p_user_id uuid,p_workspace_id uuid,p_project_id uuid,
  p_title text,p_source text,p_deliverable text,p_funding_opportunity_id uuid,p_connection_id uuid,
  p_provider text,p_auth_mode text,p_model_id text,p_effort text,p_brief_canonical text,p_skill_tree_hash text,p_upload_file_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE connection public.assistant_provider_connections; saved public.project_map_packages; created boolean;
BEGIN
  PERFORM public.assert_map_package_writer(p_user_id,p_workspace_id,p_project_id);
  IF p_funding_opportunity_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.funding_opportunities
      WHERE id=p_funding_opportunity_id AND workspace_id=p_workspace_id) THEN
    RAISE EXCEPTION 'Map package access denied' USING ERRCODE='42501';
  END IF;
  IF p_source='agent' THEN
    SELECT * INTO connection FROM public.assistant_provider_connections WHERE id=p_connection_id FOR SHARE;
    IF NOT FOUND OR connection.user_id IS DISTINCT FROM p_user_id OR connection.workspace_id IS DISTINCT FROM p_workspace_id
      OR connection.project_id IS DISTINCT FROM p_project_id OR connection.provider IS DISTINCT FROM p_provider
      OR connection.expected_auth_mode IS DISTINCT FROM p_auth_mode
      OR connection.revoked_at IS NOT NULL OR connection.expires_at<=clock_timestamp() THEN
      RAISE EXCEPTION 'Map package connection denied' USING ERRCODE='42501';
    END IF;
  END IF;
  INSERT INTO public.project_map_packages(request_id,workspace_id,project_id,requested_by,title,source,deliverable,funding_opportunity_id,
      connection_id,provider,auth_mode,model_id,effort,brief,brief_canonical,brief_hash,skill_tree_hash,upload_file_name,state)
    VALUES(p_request_id,p_workspace_id,p_project_id,p_user_id,trim(p_title),p_source,p_deliverable,p_funding_opportunity_id,
      p_connection_id,p_provider,p_auth_mode,p_model_id,p_effort,p_brief_canonical::jsonb,p_brief_canonical,
      CASE WHEN p_brief_canonical IS NULL THEN NULL ELSE encode(extensions.digest(convert_to(p_brief_canonical,'UTF8'),'sha256'),'hex') END,
      p_skill_tree_hash,p_upload_file_name,CASE WHEN p_source='agent' THEN 'queued' ELSE 'uploading' END)
    ON CONFLICT(workspace_id,request_id) DO NOTHING RETURNING * INTO saved;
  created:=FOUND;
  IF NOT created THEN
    SELECT * INTO saved FROM public.project_map_packages WHERE workspace_id=p_workspace_id AND request_id=p_request_id;
    IF saved.requested_by IS DISTINCT FROM p_user_id OR saved.project_id IS DISTINCT FROM p_project_id OR saved.source IS DISTINCT FROM p_source
      OR saved.title IS DISTINCT FROM trim(p_title) OR saved.deliverable IS DISTINCT FROM p_deliverable
      OR saved.funding_opportunity_id IS DISTINCT FROM p_funding_opportunity_id OR saved.connection_id IS DISTINCT FROM p_connection_id
      OR saved.model_id IS DISTINCT FROM p_model_id OR saved.skill_tree_hash IS DISTINCT FROM p_skill_tree_hash
      OR saved.upload_file_name IS DISTINCT FROM p_upload_file_name
      OR (saved.brief->'project') IS DISTINCT FROM (p_brief_canonical::jsonb->'project')
      OR (saved.brief->>'request') IS DISTINCT FROM (p_brief_canonical::jsonb->>'request') THEN
      RAISE EXCEPTION 'The saved map package request differs from this retry' USING ERRCODE='PT409';
    END IF;
  END IF;
  RETURN jsonb_build_object('created',created,'package',to_jsonb(saved)-'brief'-'brief_canonical');
END $$;
REVOKE ALL ON FUNCTION public.create_project_map_package(uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_project_map_package(uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,text,text) TO service_role;

-- A lost connector never starts the model again: a running package whose lease
-- passed becomes interrupted. An uploading package has finished its model work,
-- so only its upload may resume.
CREATE FUNCTION public.expire_map_package_lease(p_package public.project_map_packages)
RETURNS public.project_map_packages LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE saved public.project_map_packages;
BEGIN
  IF p_package.state='running' AND p_package.lease_expires_at<=clock_timestamp() THEN
    UPDATE public.project_map_packages SET state='interrupted',finished_at=clock_timestamp(),failure_code='map_package_attempt_expired'
      WHERE id=p_package.id RETURNING * INTO saved;
    RETURN saved;
  END IF;
  RETURN p_package;
END $$;
REVOKE ALL ON FUNCTION public.expire_map_package_lease(public.project_map_packages) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.claim_project_map_package(p_connection_id uuid,p_token_hash text,p_auth_mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE connection public.assistant_provider_connections; job public.project_map_packages; open_job public.project_map_packages;
BEGIN
  connection:=public.lock_assistant_provider_connection(p_connection_id,p_token_hash);
  IF p_auth_mode IS DISTINCT FROM connection.expected_auth_mode THEN
    UPDATE public.assistant_provider_connections SET last_seen_at=clock_timestamp(),last_status='auth_mode_changed' WHERE id=connection.id;
    RETURN jsonb_build_object('status','auth_mode_changed','package',NULL);
  END IF;
  UPDATE public.assistant_provider_connections SET last_seen_at=clock_timestamp(),last_status='connected' WHERE id=connection.id;
  FOR open_job IN SELECT * FROM public.project_map_packages WHERE connection_id=connection.id AND state='running' FOR UPDATE LOOP
    PERFORM public.expire_map_package_lease(open_job);
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.project_map_packages WHERE connection_id=connection.id AND state IN ('running','uploading')) THEN
    RETURN jsonb_build_object('status','busy','package',NULL);
  END IF;
  SELECT * INTO job FROM public.project_map_packages WHERE connection_id=connection.id AND state='queued' ORDER BY created_at,id LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','connected','package',NULL); END IF;
  PERFORM public.assert_map_package_writer(job.requested_by,job.workspace_id,job.project_id);
  UPDATE public.project_map_packages SET state='running',attempt_id=gen_random_uuid(),started_at=clock_timestamp(),
      lease_expires_at=clock_timestamp()+interval '10 minutes',last_heartbeat_at=clock_timestamp(),
      progress=jsonb_build_object('phase','starting','message','Starting','steps',0,'recent','[]'::jsonb)
    WHERE id=job.id RETURNING * INTO job;
  RETURN jsonb_build_object('status','connected','package',to_jsonb(job)-'receipt');
END $$;
REVOKE ALL ON FUNCTION public.claim_project_map_package(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_project_map_package(uuid,text,text) TO service_role;

-- Locks one package for its own connector attempt.
CREATE FUNCTION public.lock_map_package_attempt(p_package_id uuid,p_attempt_id uuid,p_connection_id uuid,p_token_hash text)
RETURNS public.project_map_packages LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE connection public.assistant_provider_connections; job public.project_map_packages;
BEGIN
  connection:=public.lock_assistant_provider_connection(p_connection_id,p_token_hash);
  SELECT * INTO job FROM public.project_map_packages WHERE id=p_package_id FOR UPDATE;
  IF NOT FOUND OR job.connection_id IS DISTINCT FROM connection.id OR job.attempt_id IS NULL OR job.attempt_id IS DISTINCT FROM p_attempt_id THEN
    RAISE EXCEPTION 'Map package attempt does not match' USING ERRCODE='42501';
  END IF;
  RETURN public.expire_map_package_lease(job);
END $$;
REVOKE ALL ON FUNCTION public.lock_map_package_attempt(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

-- The connector renews its lease about once a minute and reports what the agent
-- is doing. The answer tells it whether to keep going.
CREATE FUNCTION public.heartbeat_project_map_package(p_package_id uuid,p_attempt_id uuid,p_connection_id uuid,p_token_hash text,p_progress jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job public.project_map_packages;
BEGIN
  job:=public.lock_map_package_attempt(p_package_id,p_attempt_id,p_connection_id,p_token_hash);
  IF job.state IN ('running','uploading') THEN
    PERFORM public.assert_map_package_writer(job.requested_by,job.workspace_id,job.project_id);
    UPDATE public.project_map_packages SET lease_expires_at=clock_timestamp()+interval '10 minutes',last_heartbeat_at=clock_timestamp(),
        progress=coalesce(p_progress,progress)
      WHERE id=job.id RETURNING * INTO job;
  END IF;
  RETURN jsonb_build_object('state',job.state,'leaseExpiresAt',job.lease_expires_at);
END $$;
REVOKE ALL ON FUNCTION public.heartbeat_project_map_package(uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_project_map_package(uuid,uuid,uuid,text,jsonb) TO service_role;

-- The model work is done. Record what ran and which files will arrive. The
-- route has already checked the receipt and the file list against the limits.
CREATE FUNCTION public.begin_project_map_package_upload(p_package_id uuid,p_attempt_id uuid,p_connection_id uuid,p_token_hash text,
  p_receipt jsonb,p_files jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job public.project_map_packages; item jsonb;
BEGIN
  job:=public.lock_map_package_attempt(p_package_id,p_attempt_id,p_connection_id,p_token_hash);
  IF job.state='uploading' THEN
    IF job.receipt IS DISTINCT FROM p_receipt OR (SELECT coalesce(jsonb_agg(jsonb_build_object('role',f.role,'name',f.name,'bytes',f.bytes,'sha256',f.sha256) ORDER BY f.name),'[]'::jsonb)
        FROM public.project_map_package_files f WHERE f.package_id=job.id)
        IS DISTINCT FROM (SELECT coalesce(jsonb_agg(value ORDER BY value->>'name'),'[]'::jsonb) FROM jsonb_array_elements(p_files)) THEN
      RAISE EXCEPTION 'The retained map package upload differs from this retry' USING ERRCODE='PT409';
    END IF;
    RETURN to_jsonb(job)-'brief'-'brief_canonical';
  END IF;
  IF job.state<>'running' THEN RAISE EXCEPTION 'Map package attempt is no longer running' USING ERRCODE='PT409'; END IF;
  PERFORM public.assert_map_package_writer(job.requested_by,job.workspace_id,job.project_id);
  IF jsonb_typeof(p_receipt) IS DISTINCT FROM 'object' OR p_receipt->>'schemaVersion' IS DISTINCT FROM '1'
    OR p_receipt->>'provider' IS DISTINCT FROM job.provider OR p_receipt->>'authMode' IS DISTINCT FROM job.auth_mode
    OR p_receipt->>'model' IS DISTINCT FROM job.model_id OR p_receipt->>'effort' IS DISTINCT FROM job.effort
    OR p_receipt->'modelsUsed' IS DISTINCT FROM jsonb_build_array(job.model_id)
    OR p_receipt->>'skillTreeHash' IS DISTINCT FROM job.skill_tree_hash THEN
    RAISE EXCEPTION 'Map package receipt differs from this request' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(p_files) IS DISTINCT FROM 'array' OR jsonb_array_length(p_files) NOT BETWEEN 1 AND 62 THEN
    RAISE EXCEPTION 'Invalid map package files' USING ERRCODE='22023';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_files) LOOP
    INSERT INTO public.project_map_package_files(package_id,workspace_id,project_id,role,name,object_path,bytes,sha256)
      VALUES(job.id,job.workspace_id,job.project_id,item->>'role',item->>'name',
        job.workspace_id::text||'/'||job.project_id::text||'/'||job.id::text||'/'||(item->>'name'),(item->>'bytes')::bigint,item->>'sha256');
  END LOOP;
  UPDATE public.project_map_packages SET state='uploading',receipt=p_receipt,lease_expires_at=clock_timestamp()+interval '10 minutes',
      last_heartbeat_at=clock_timestamp(),progress=jsonb_build_object('phase','uploading','message','Uploading the package','steps',coalesce((progress->>'steps')::int,0),'recent',coalesce(progress->'recent','[]'::jsonb))
    WHERE id=job.id RETURNING * INTO job;
  RETURN to_jsonb(job)-'brief'-'brief_canonical';
END $$;
REVOKE ALL ON FUNCTION public.begin_project_map_package_upload(uuid,uuid,uuid,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_project_map_package_upload(uuid,uuid,uuid,text,jsonb,jsonb) TO service_role;

-- The route has read every stored object back and matched its size and sha256
-- against what the connector declared.
CREATE FUNCTION public.complete_project_map_package(p_package_id uuid,p_attempt_id uuid,p_connection_id uuid,p_token_hash text,p_verified jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job public.project_map_packages;
BEGIN
  job:=public.lock_map_package_attempt(p_package_id,p_attempt_id,p_connection_id,p_token_hash);
  IF job.state='ready' THEN RETURN to_jsonb(job)-'brief'-'brief_canonical'; END IF;
  IF job.state<>'uploading' THEN RAISE EXCEPTION 'Map package is not uploading' USING ERRCODE='PT409'; END IF;
  PERFORM public.assert_map_package_writer(job.requested_by,job.workspace_id,job.project_id);
  IF (SELECT coalesce(jsonb_agg(jsonb_build_object('name',f.name,'bytes',f.bytes,'sha256',f.sha256) ORDER BY f.name),'[]'::jsonb)
      FROM public.project_map_package_files f WHERE f.package_id=job.id)
      IS DISTINCT FROM (SELECT coalesce(jsonb_agg(jsonb_build_object('name',value->>'name','bytes',(value->>'bytes')::bigint,'sha256',value->>'sha256') ORDER BY value->>'name'),'[]'::jsonb)
        FROM jsonb_array_elements(p_verified)) THEN
    RAISE EXCEPTION 'Stored map package files differ from the declared files' USING ERRCODE='22023';
  END IF;
  UPDATE public.project_map_package_files SET verified_at=clock_timestamp() WHERE package_id=job.id;
  UPDATE public.project_map_packages SET state='ready',finished_at=clock_timestamp(),
      progress=jsonb_build_object('phase','uploading','message','Ready','steps',coalesce((progress->>'steps')::int,0),'recent',coalesce(progress->'recent','[]'::jsonb))
    WHERE id=job.id RETURNING * INTO job;
  RETURN to_jsonb(job)-'brief'-'brief_canonical';
END $$;
REVOKE ALL ON FUNCTION public.complete_project_map_package(uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_project_map_package(uuid,uuid,uuid,text,jsonb) TO service_role;

-- A planner added a package they built themselves. The route streamed the
-- stored ZIP back and measured its size and sha256; that measurement is the record.
CREATE FUNCTION public.complete_uploaded_map_package(p_package_id uuid,p_user_id uuid,p_bytes bigint,p_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job public.project_map_packages;
BEGIN
  SELECT * INTO job FROM public.project_map_packages WHERE id=p_package_id FOR UPDATE;
  IF NOT FOUND OR job.source<>'upload' OR job.requested_by IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Map package access denied' USING ERRCODE='42501';
  END IF;
  PERFORM public.assert_map_package_writer(p_user_id,job.workspace_id,job.project_id);
  IF job.state='ready' THEN
    IF NOT EXISTS(SELECT 1 FROM public.project_map_package_files WHERE package_id=job.id AND bytes=p_bytes AND sha256=p_sha256) THEN
      RAISE EXCEPTION 'The retained map package upload differs from this retry' USING ERRCODE='PT409';
    END IF;
    RETURN to_jsonb(job)-'brief'-'brief_canonical';
  END IF;
  IF job.state<>'uploading' THEN RAISE EXCEPTION 'Map package is no longer accepting files' USING ERRCODE='PT409'; END IF;
  INSERT INTO public.project_map_package_files(package_id,workspace_id,project_id,role,name,object_path,bytes,sha256,verified_at)
    VALUES(job.id,job.workspace_id,job.project_id,'package_zip',job.upload_file_name,
      job.workspace_id::text||'/'||job.project_id::text||'/'||job.id::text||'/'||job.upload_file_name,p_bytes,p_sha256,clock_timestamp());
  UPDATE public.project_map_packages SET state='ready',finished_at=clock_timestamp() WHERE id=job.id RETURNING * INTO job;
  RETURN to_jsonb(job)-'brief'-'brief_canonical';
END $$;
REVOKE ALL ON FUNCTION public.complete_uploaded_map_package(uuid,uuid,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_uploaded_map_package(uuid,uuid,bigint,text) TO service_role;

CREATE FUNCTION public.fail_project_map_package(p_package_id uuid,p_attempt_id uuid,p_connection_id uuid,p_token_hash text,p_failure_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job public.project_map_packages;
BEGIN
  IF p_failure_code IS NULL OR p_failure_code !~ '^[a-z_]{1,120}$' THEN RAISE EXCEPTION 'Invalid map package failure' USING ERRCODE='22023'; END IF;
  job:=public.lock_map_package_attempt(p_package_id,p_attempt_id,p_connection_id,p_token_hash);
  IF job.state IN ('running','uploading') THEN
    UPDATE public.project_map_packages SET state='failed',failure_code=p_failure_code,finished_at=clock_timestamp()
      WHERE id=job.id RETURNING * INTO job;
  END IF;
  RETURN jsonb_build_object('state',job.state,'failureCode',job.failure_code);
END $$;
REVOKE ALL ON FUNCTION public.fail_project_map_package(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fail_project_map_package(uuid,uuid,uuid,text,text) TO service_role;

-- The person who asked, or a workspace owner or admin, may stop a package that
-- is not finished. The connector sees the change at its next heartbeat.
CREATE FUNCTION public.cancel_project_map_package(p_package_id uuid,p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job public.project_map_packages; member_role text;
BEGIN
  SELECT * INTO job FROM public.project_map_packages WHERE id=p_package_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Map package access denied' USING ERRCODE='42501'; END IF;
  SELECT lower(trim(coalesce(role,''))) INTO member_role FROM public.workspace_members WHERE user_id=p_user_id AND workspace_id=job.workspace_id;
  IF member_role IS NULL OR NOT (member_role IN ('owner','admin') OR (member_role='member' AND job.requested_by=p_user_id)) THEN
    RAISE EXCEPTION 'Map package access denied' USING ERRCODE='42501';
  END IF;
  IF job.state IN ('queued','running','uploading') THEN
    UPDATE public.project_map_packages SET state='cancelled',finished_at=clock_timestamp(),failure_code='cancelled_by_user'
      WHERE id=job.id RETURNING * INTO job;
  END IF;
  RETURN jsonb_build_object('state',job.state);
END $$;
REVOKE ALL ON FUNCTION public.cancel_project_map_package(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_project_map_package(uuid,uuid) TO service_role;

COMMENT ON TABLE public.project_map_packages IS
  'Map and GIS packages for one project: built by an agent on the planner''s computer (Claude Fable 5.1, or GPT-6 Astra) or added by hand. Bytes live in the private project-map-packages bucket.';

COMMIT;
