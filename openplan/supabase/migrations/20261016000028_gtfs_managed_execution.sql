-- Managed ingestion retains the existing feed/version identity. New routes must
-- not enroll work until the lifecycle, writer and worker are connected.
-- CLI generated 20261009230853; moved above the existing migration high-water.
BEGIN;
CREATE SCHEMA openplan_gtfs;
REVOKE ALL ON SCHEMA openplan_gtfs FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE openplan_gtfs.submissions (
  request_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL,
  payload jsonb NOT NULL,
  feed_id uuid NOT NULL,
  version_id uuid NOT NULL UNIQUE,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Submission identities survive individual feed deletion. A retry returns the
-- original identity rather than recreating a deliberately deleted import.
CREATE TABLE openplan_gtfs.executions (
  version_id uuid PRIMARY KEY REFERENCES public.gtfs_feed_versions(id) ON DELETE CASCADE,
  request_id uuid NOT NULL UNIQUE REFERENCES openplan_gtfs.submissions(request_id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('awaiting_archive','queued','running','ready','failed','cancelled')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  token uuid,
  lease_until timestamptz,
  archive_identity jsonb,
  archive_prepared_at timestamptz,
  archive_confirmed_at timestamptz,
  archive_available boolean NOT NULL DEFAULT false,
  prepared_token uuid,
  CHECK ((token IS NULL) = (lease_until IS NULL)),
  CHECK ((archive_identity IS NULL) = (archive_prepared_at IS NULL)),
  CHECK (archive_available = (archive_confirmed_at IS NOT NULL)),
  CHECK (NOT archive_available OR archive_identity IS NOT NULL)
);
CREATE TABLE openplan_gtfs.claims (
  token uuid PRIMARY KEY,
  version_id uuid NOT NULL REFERENCES public.gtfs_feed_versions(id) ON DELETE CASCADE,
  attempt integer NOT NULL CHECK (attempt > 0),
  claimed_at timestamptz NOT NULL,
  initial_lease_until timestamptz NOT NULL,
  UNIQUE(version_id, attempt)
);
CREATE TABLE openplan_gtfs.write_context (
  transaction_id bigint NOT NULL,
  version_id uuid NOT NULL,
  kind text NOT NULL,
  operation text NOT NULL,
  token uuid,
  PRIMARY KEY(transaction_id,version_id,kind,operation)
);
CREATE INDEX gtfs_execution_queue ON openplan_gtfs.executions(state,lease_until,version_id);
CREATE INDEX gtfs_submissions_workspace ON openplan_gtfs.submissions(workspace_id);
ALTER TABLE openplan_gtfs.submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE openplan_gtfs.executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE openplan_gtfs.claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE openplan_gtfs.write_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA openplan_gtfs FROM PUBLIC, anon, authenticated, service_role;

-- Service-only public commands use definer access to the private journal. The
-- original submitting actor must still have write membership at each boundary.
CREATE FUNCTION openplan_gtfs.actor_can_write(p_workspace uuid, p_actor uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM 1 FROM public.workspace_members
  WHERE workspace_id=p_workspace AND user_id=p_actor AND role IN ('owner','admin','member') FOR SHARE;
  RETURN FOUND;
END $$;

CREATE FUNCTION public.admit_gtfs_ingest(
  p_request uuid, p_workspace uuid, p_actor uuid, p_feed uuid, p_source jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE saved openplan_gtfs.submissions%ROWTYPE; payload jsonb; source_kind text;
  feed_id uuid; version_id uuid:=gen_random_uuid(); created_feed boolean:=false;
  response jsonb; archive jsonb;
BEGIN
  IF p_request IS NULL OR p_workspace IS NULL OR p_actor IS NULL
    OR p_source IS NULL OR jsonb_typeof(p_source)<>'object' THEN
    RAISE EXCEPTION 'GTFS admission identity is required' USING ERRCODE='22023';
  END IF;
  IF openplan_gtfs.actor_can_write(p_workspace,p_actor) IS NOT TRUE THEN
    RAISE EXCEPTION 'GTFS workspace write access is unavailable' USING ERRCODE='42501';
  END IF;
  source_kind:=p_source->>'kind';
  IF EXISTS(SELECT 1 FROM jsonb_each(p_source) field
    WHERE field.key<>'uploadBytes' AND jsonb_typeof(field.value) NOT IN ('string','null')) THEN
    RAISE EXCEPTION 'GTFS source fields must be text' USING ERRCODE='22023';
  END IF;
  IF source_kind IS NULL OR source_kind NOT IN ('upload','url','catalog')
    OR nullif(btrim(p_source->>'provisionalName'),'') IS NULL
    OR length(p_source->>'provisionalName')>120
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_source) key WHERE key NOT IN
      ('kind','provisionalName','sourceUrl','normalizedSourceUrl','catalogProvider',
       'catalogSourceId','catalogRowStatus','uploadSha256','uploadBytes')) THEN
    RAISE EXCEPTION 'Invalid GTFS source metadata' USING ERRCODE='22023';
  END IF;
  IF source_kind='upload' THEN
    IF jsonb_typeof(p_source->'uploadBytes') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'GTFS upload byte count must be numeric' USING ERRCODE='22023';
    END IF;
    IF (p_source->>'uploadBytes')::numeric NOT BETWEEN 1 AND 9007199254740991
      OR trunc((p_source->>'uploadBytes')::numeric)<>(p_source->>'uploadBytes')::numeric THEN
      RAISE EXCEPTION 'GTFS upload byte count must be an exact positive integer' USING ERRCODE='22023';
    END IF;
    IF p_source->>'uploadSha256' IS NULL OR p_source->>'uploadSha256' !~ '^[0-9a-f]{64}$'
      OR p_source->>'uploadBytes' IS NULL OR (p_source->>'uploadBytes')::numeric<=0
      OR p_source->>'sourceUrl' IS NOT NULL OR p_source->>'normalizedSourceUrl' IS NOT NULL THEN
      RAISE EXCEPTION 'Upload admission requires exact archive identity' USING ERRCODE='22023';
    END IF;
  ELSIF p_source->>'sourceUrl' IS NULL OR p_source->>'sourceUrl' !~ '^https?://'
    OR p_source->>'normalizedSourceUrl' IS NULL
    OR p_source->>'uploadSha256' IS NOT NULL OR p_source->>'uploadBytes' IS NOT NULL THEN
    RAISE EXCEPTION 'URL admission requires its resolved source' USING ERRCODE='22023';
  END IF;
  IF source_kind='catalog' AND nullif(p_source->>'catalogSourceId','') IS NULL THEN
    RAISE EXCEPTION 'Catalog admission requires its resolved entry' USING ERRCODE='22023';
  END IF;
  payload:=jsonb_build_object('workspace',p_workspace,'actor',p_actor,'feed',p_feed,'source',p_source);
  PERFORM pg_advisory_xact_lock(hashtextextended('gtfs-admission:'||p_request::text,0));
  SELECT * INTO saved FROM openplan_gtfs.submissions WHERE request_id=p_request;
  IF FOUND THEN
    IF saved.payload IS DISTINCT FROM payload THEN
      RAISE EXCEPTION 'GTFS admission request changed' USING ERRCODE='22023';
    END IF;
    RETURN saved.response;
  END IF;
  IF p_feed IS NOT NULL THEN
    SELECT id INTO feed_id FROM public.gtfs_feeds WHERE id=p_feed AND workspace_id=p_workspace FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'GTFS feed is unavailable' USING ERRCODE='42501'; END IF;
  ELSE
    INSERT INTO public.gtfs_feeds(workspace_id,agency_name,status,source_kind,feed_url,
      normalized_source_url,catalog_provider,catalog_source_id,created_by)
    VALUES(p_workspace,p_source->>'provisionalName','pending',source_kind,p_source->>'sourceUrl',
      p_source->>'normalizedSourceUrl',p_source->>'catalogProvider',p_source->>'catalogSourceId',p_actor)
    RETURNING id INTO feed_id;
    created_feed:=true;
  END IF;
  INSERT INTO public.gtfs_feed_versions(id,workspace_id,feed_id,source_kind,source_url,
    catalog_provider,catalog_source_id,catalog_row_status,requested_by,status)
  VALUES(version_id,p_workspace,feed_id,source_kind,p_source->>'sourceUrl',p_source->>'catalogProvider',
    p_source->>'catalogSourceId',p_source->>'catalogRowStatus',p_actor,'pending');
  response:=jsonb_build_object('requestId',p_request,'feedId',feed_id,'versionId',version_id,'createdFeed',created_feed);
  IF source_kind='upload' THEN
    archive:=jsonb_build_object('path',p_workspace::text||'/'||feed_id::text||'/'||version_id::text||'.zip',
      'sha256',p_source->>'uploadSha256','bytes',(p_source->>'uploadBytes')::numeric::bigint);
  END IF;
  INSERT INTO openplan_gtfs.submissions(request_id,workspace_id,actor_id,payload,feed_id,version_id,response)
  VALUES(p_request,p_workspace,p_actor,payload,feed_id,version_id,response);
  INSERT INTO openplan_gtfs.executions(version_id,request_id,state,archive_identity,archive_prepared_at)
  VALUES(version_id,p_request,CASE WHEN source_kind='upload' THEN 'awaiting_archive' ELSE 'queued' END,
    archive,CASE WHEN archive IS NOT NULL THEN clock_timestamp() END);
  RETURN response;
END $$;

CREATE FUNCTION openplan_gtfs.owns_attempt(p_version uuid,p_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.gtfs_feed_versions%ROWTYPE; j openplan_gtfs.executions%ROWTYPE;
  s openplan_gtfs.submissions%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.gtfs_feed_versions WHERE id=p_version FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO j FROM openplan_gtfs.executions WHERE version_id=p_version FOR UPDATE;
  IF NOT FOUND OR p_token IS NULL OR j.token IS DISTINCT FROM p_token
    OR j.state<>'running' OR j.lease_until<=clock_timestamp()
    OR v.status NOT IN ('pending','fetching','parsing')
    OR v.ingest_closed_at IS NOT NULL OR v.ingest_abandoned_at IS NOT NULL THEN RETURN false; END IF;
  SELECT * INTO s FROM openplan_gtfs.submissions WHERE request_id=j.request_id;
  RETURN openplan_gtfs.actor_can_write(s.workspace_id,s.actor_id);
END $$;

CREATE FUNCTION public.claim_gtfs_ingest(p_version uuid,p_token uuid,p_seconds integer DEFAULT 120)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.gtfs_feed_versions%ROWTYPE; j openplan_gtfs.executions%ROWTYPE;
  s openplan_gtfs.submissions%ROWTYPE; saved openplan_gtfs.claims%ROWTYPE; at_time timestamptz;
BEGIN
  IF p_version IS NULL OR p_token IS NULL OR p_seconds IS NULL OR p_seconds<10 OR p_seconds>300 THEN
    RAISE EXCEPTION 'GTFS claim requires identity and a bounded lease' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v FROM public.gtfs_feed_versions WHERE id=p_version FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO j FROM openplan_gtfs.executions WHERE version_id=p_version FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO s FROM openplan_gtfs.submissions WHERE request_id=j.request_id;
  IF openplan_gtfs.actor_can_write(s.workspace_id,s.actor_id) IS NOT TRUE THEN RETURN NULL; END IF;
  SELECT * INTO saved FROM openplan_gtfs.claims WHERE token=p_token;
  IF FOUND THEN
    IF saved.version_id<>p_version THEN
      RAISE EXCEPTION 'GTFS token belongs to another version' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('claim',to_jsonb(saved),'active',openplan_gtfs.owns_attempt(p_version,p_token));
  END IF;
  IF j.state NOT IN ('queued','running') OR j.lease_until>clock_timestamp()
    OR v.status NOT IN ('pending','fetching','parsing')
    OR v.ingest_closed_at IS NOT NULL OR v.ingest_abandoned_at IS NOT NULL THEN RETURN NULL; END IF;
  at_time:=clock_timestamp();
  INSERT INTO openplan_gtfs.claims(token,version_id,attempt,claimed_at,initial_lease_until)
  VALUES(p_token,p_version,j.attempt+1,at_time,at_time+make_interval(secs=>p_seconds)) RETURNING * INTO saved;
  UPDATE openplan_gtfs.executions SET state='running',attempt=saved.attempt,token=p_token,
    lease_until=saved.initial_lease_until,prepared_token=NULL WHERE version_id=p_version;
  RETURN jsonb_build_object('claim',to_jsonb(saved),'active',true);
END $$;

CREATE FUNCTION public.renew_gtfs_ingest(p_version uuid,p_token uuid,p_seconds integer DEFAULT 120)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_seconds IS NULL OR p_seconds<10 OR p_seconds>300 THEN
    RAISE EXCEPTION 'GTFS renewal requires a bounded lease' USING ERRCODE='22023';
  END IF;
  IF openplan_gtfs.owns_attempt(p_version,p_token) IS NOT TRUE THEN RETURN false; END IF;
  UPDATE openplan_gtfs.executions SET lease_until=clock_timestamp()+make_interval(secs=>p_seconds)
  WHERE version_id=p_version;
  RETURN true;
END $$;

CREATE FUNCTION public.prepare_gtfs_archive(p_version uuid,p_token uuid,p_archive jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.gtfs_feed_versions%ROWTYPE; j openplan_gtfs.executions%ROWTYPE;
BEGIN
  IF openplan_gtfs.owns_attempt(p_version,p_token) IS NOT TRUE THEN
    RAISE EXCEPTION 'GTFS attempt no longer owns archive preparation' USING ERRCODE='55000';
  END IF;
  SELECT * INTO v FROM public.gtfs_feed_versions WHERE id=p_version;
  SELECT * INTO j FROM openplan_gtfs.executions WHERE version_id=p_version;
  IF jsonb_typeof(p_archive->'bytes') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'GTFS archive byte count must be numeric' USING ERRCODE='22023';
  END IF;
  IF (p_archive->>'bytes')::numeric NOT BETWEEN 1 AND 9007199254740991
    OR trunc((p_archive->>'bytes')::numeric)<>(p_archive->>'bytes')::numeric THEN
    RAISE EXCEPTION 'GTFS archive byte count must be an exact positive integer' USING ERRCODE='22023';
  END IF;
  IF p_archive IS NULL OR jsonb_typeof(p_archive)<>'object'
    OR p_archive->>'path' IS DISTINCT FROM v.workspace_id::text||'/'||v.feed_id::text||'/'||v.id::text||'.zip'
    OR p_archive->>'sha256' IS NULL OR p_archive->>'sha256' !~ '^[0-9a-f]{64}$'
    OR p_archive->>'bytes' IS NULL OR (p_archive->>'bytes')::numeric<=0
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_archive) key WHERE key NOT IN ('path','sha256','bytes')) THEN
    RAISE EXCEPTION 'Invalid prepared GTFS archive identity' USING ERRCODE='22023';
  END IF;
  IF j.archive_identity IS NOT NULL THEN
    IF j.archive_identity IS DISTINCT FROM p_archive THEN
      RAISE EXCEPTION 'Prepared GTFS archive identity changed' USING ERRCODE='22023';
    END IF;
  ELSE
    UPDATE openplan_gtfs.executions SET archive_identity=p_archive,archive_prepared_at=clock_timestamp()
    WHERE version_id=p_version RETURNING * INTO j;
  END IF;
  RETURN jsonb_build_object('versionId',p_version,'archive',j.archive_identity,'preparedAt',j.archive_prepared_at);
END $$;

-- The trusted caller verifies actual private Storage bytes before confirmation.
-- This command records custody metadata atomically; SQL cannot verify the ZIP.
CREATE FUNCTION public.confirm_gtfs_archive(p_version uuid,p_token uuid,p_archive jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.gtfs_feed_versions%ROWTYPE; j openplan_gtfs.executions%ROWTYPE;
  s openplan_gtfs.submissions%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.gtfs_feed_versions WHERE id=p_version FOR UPDATE;
  SELECT * INTO j FROM openplan_gtfs.executions WHERE version_id=p_version FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Managed GTFS import is unavailable' USING ERRCODE='55000'; END IF;
  SELECT * INTO s FROM openplan_gtfs.submissions WHERE request_id=j.request_id;
  IF openplan_gtfs.actor_can_write(s.workspace_id,s.actor_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'GTFS workspace write access is unavailable' USING ERRCODE='42501';
  END IF;
  IF p_archive IS NULL OR j.archive_identity IS NULL OR j.archive_identity IS DISTINCT FROM p_archive THEN
    RAISE EXCEPTION 'GTFS archive confirmation differs from preparation' USING ERRCODE='22023';
  END IF;
  IF NOT j.archive_available THEN
    IF NOT (v.source_kind='upload' AND j.state='awaiting_archive' AND p_token IS NULL)
      AND openplan_gtfs.owns_attempt(p_version,p_token) IS NOT TRUE THEN
      RAISE EXCEPTION 'GTFS attempt no longer owns archive confirmation' USING ERRCODE='55000';
    END IF;
    INSERT INTO openplan_gtfs.write_context VALUES(txid_current(),p_version,'version','UPDATE',p_token);
    UPDATE public.gtfs_feed_versions SET storage_path=p_archive->>'path',checksum_sha256=p_archive->>'sha256',
      byte_size=(p_archive->>'bytes')::numeric::bigint,fetched_at=j.archive_prepared_at,last_checked_at=clock_timestamp()
    WHERE id=p_version;
    DELETE FROM openplan_gtfs.write_context WHERE transaction_id=txid_current() AND version_id=p_version;
    UPDATE openplan_gtfs.executions SET archive_available=true,archive_confirmed_at=clock_timestamp(),
      state=CASE WHEN state='awaiting_archive' THEN 'queued' ELSE state END
    WHERE version_id=p_version RETURNING * INTO j;
  END IF;
  RETURN jsonb_build_object('versionId',p_version,'archive',j.archive_identity,'confirmedAt',j.archive_confirmed_at);
END $$;

CREATE FUNCTION public.stage_gtfs_ingest(p_version uuid,p_token uuid,p_stage text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.gtfs_feed_versions%ROWTYPE; j openplan_gtfs.executions%ROWTYPE;
BEGIN
  IF p_stage IS NULL OR p_stage NOT IN ('fetching','parsing') THEN
    RAISE EXCEPTION 'Unknown GTFS execution stage' USING ERRCODE='22023';
  END IF;
  IF openplan_gtfs.owns_attempt(p_version,p_token) IS NOT TRUE THEN
    RAISE EXCEPTION 'GTFS attempt no longer owns stage transition' USING ERRCODE='55000';
  END IF;
  SELECT * INTO v FROM public.gtfs_feed_versions WHERE id=p_version;
  SELECT * INTO j FROM openplan_gtfs.executions WHERE version_id=p_version;
  IF (p_stage='fetching' AND (v.source_kind='upload' OR j.archive_identity IS NOT NULL OR v.status='parsing'))
    OR (p_stage='parsing' AND NOT j.archive_available) THEN
    RAISE EXCEPTION 'GTFS stage does not match retained archive custody' USING ERRCODE='55000';
  END IF;
  IF v.status<>p_stage THEN
    INSERT INTO openplan_gtfs.write_context VALUES(txid_current(),p_version,'version','UPDATE',p_token);
    UPDATE public.gtfs_feed_versions SET status=p_stage,last_checked_at=clock_timestamp() WHERE id=p_version;
    DELETE FROM openplan_gtfs.write_context WHERE transaction_id=txid_current() AND version_id=p_version;
  END IF;
  RETURN jsonb_build_object('versionId',p_version,'stage',p_stage);
END $$;

-- Preparation is idempotent per attempt. Receipts retain prior-attempt history.
CREATE TABLE openplan_gtfs.prepare_receipts (
 token uuid PRIMARY KEY REFERENCES openplan_gtfs.claims(token) ON DELETE CASCADE,
 version_id uuid NOT NULL REFERENCES public.gtfs_feed_versions(id) ON DELETE CASCADE,
 plan jsonb NOT NULL,
 response jsonb NOT NULL
);
CREATE TABLE openplan_gtfs.batch_receipts (
 command_id uuid PRIMARY KEY,
 version_id uuid NOT NULL REFERENCES public.gtfs_feed_versions(id) ON DELETE CASCADE,
 token uuid NOT NULL REFERENCES openplan_gtfs.claims(token) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('route','stop')),
 ordinal integer NOT NULL CHECK(ordinal>=0),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
 row_count integer NOT NULL CHECK(row_count BETWEEN 1 AND 1000),
 UNIQUE(version_id,token,kind,ordinal)
);
ALTER TABLE openplan_gtfs.prepare_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE openplan_gtfs.batch_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON openplan_gtfs.prepare_receipts,openplan_gtfs.batch_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX gtfs_prepare_receipts_version ON openplan_gtfs.prepare_receipts(version_id);
CREATE INDEX gtfs_batch_receipts_token ON openplan_gtfs.batch_receipts(token);

CREATE FUNCTION public.prepare_gtfs_derived(p_version uuid,p_token uuid,p_plan jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path='' AS $$
DECLARE saved openplan_gtfs.prepare_receipts%ROWTYPE; routes integer; stops integer; tracts integer; result jsonb; field text;
BEGIN
 IF openplan_gtfs.owns_attempt(p_version,p_token) IS NOT TRUE THEN
  RAISE EXCEPTION 'GTFS attempt no longer owns preparation' USING ERRCODE='55000';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.gtfs_feed_versions v JOIN openplan_gtfs.executions j ON j.version_id=v.id
   WHERE v.id=p_version AND v.status='parsing' AND j.archive_available) THEN
  RAISE EXCEPTION 'GTFS preparation requires confirmed archive and parsing stage' USING ERRCODE='55000';
 END IF;
 IF p_plan IS NULL OR jsonb_typeof(p_plan)<>'object'
   OR jsonb_typeof(p_plan->'sha256') IS DISTINCT FROM 'string' OR p_plan->>'sha256' !~ '^[0-9a-f]{64}$'
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_plan) key WHERE key NOT IN
     ('sha256','bytes','routeRows','stopRows','routeBatches','stopBatches')) THEN
  RAISE EXCEPTION 'Invalid GTFS derived output plan' USING ERRCODE='22023';
 END IF;
 FOREACH field IN ARRAY ARRAY['bytes','routeRows','stopRows','routeBatches','stopBatches'] LOOP
  IF jsonb_typeof(p_plan->field) IS DISTINCT FROM 'number' THEN
   RAISE EXCEPTION 'GTFS derived plan requires numeric counts' USING ERRCODE='22023';
  END IF;
  IF (p_plan->>field)::numeric NOT BETWEEN 1 AND 2147483647
    OR trunc((p_plan->>field)::numeric)<>(p_plan->>field)::numeric THEN
   RAISE EXCEPTION 'GTFS derived plan requires bounded positive integer counts' USING ERRCODE='22023';
  END IF;
 END LOOP;
 IF (p_plan->>'routeBatches')::numeric NOT BETWEEN ceil((p_plan->>'routeRows')::numeric/1000) AND (p_plan->>'routeRows')::numeric
   OR (p_plan->>'stopBatches')::numeric NOT BETWEEN ceil((p_plan->>'stopRows')::numeric/1000) AND (p_plan->>'stopRows')::numeric THEN
  RAISE EXCEPTION 'GTFS derived plan batch counts cannot hold its rows' USING ERRCODE='22023';
 END IF;
 SELECT * INTO saved FROM openplan_gtfs.prepare_receipts WHERE token=p_token;
 IF FOUND THEN
  IF saved.version_id IS DISTINCT FROM p_version OR saved.plan IS DISTINCT FROM p_plan THEN
   RAISE EXCEPTION 'Preparation identity or output plan differs' USING ERRCODE='22023';
  END IF;
  RETURN saved.response;
 END IF;
 INSERT INTO openplan_gtfs.write_context(transaction_id,version_id,token,kind,operation)
 VALUES(txid_current(),p_version,p_token,'route','DELETE'),
       (txid_current(),p_version,p_token,'stop','DELETE'),
       (txid_current(),p_version,p_token,'tract','DELETE');
 DELETE FROM public.gtfs_route_service_levels WHERE feed_version_id=p_version;
 GET DIAGNOSTICS routes=ROW_COUNT;
 DELETE FROM public.gtfs_stop_service_levels WHERE feed_version_id=p_version;
 GET DIAGNOSTICS stops=ROW_COUNT;
 DELETE FROM public.gtfs_tract_service WHERE feed_version_id=p_version;
 GET DIAGNOSTICS tracts=ROW_COUNT;
 DELETE FROM openplan_gtfs.write_context WHERE transaction_id=txid_current() AND version_id=p_version;
 UPDATE openplan_gtfs.executions SET prepared_token=p_token WHERE version_id=p_version;
 result:=jsonb_build_object('version',p_version,'token',p_token,'removedRoutes',routes,'removedStops',stops,'removedTracts',tracts,'plan',p_plan);
 INSERT INTO openplan_gtfs.prepare_receipts VALUES(p_token,p_version,p_plan,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.prepare_gtfs_derived(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_gtfs_derived(uuid,uuid,jsonb) TO service_role;

CREATE FUNCTION public.write_gtfs_ingest_batch(
 p_version uuid,p_token uuid,p_command uuid,p_kind text,p_ordinal integer,p_rows jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '' AS $$
DECLARE saved openplan_gtfs.batch_receipts%ROWTYPE; v public.gtfs_feed_versions%ROWTYPE;
 hash text; written integer; allowed text[]; output_plan jsonb;
BEGIN
 IF p_command IS NULL OR p_kind IS NULL OR p_kind NOT IN ('route','stop') OR p_ordinal IS NULL OR p_ordinal<0
 OR p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' THEN
  RAISE EXCEPTION 'Invalid batch envelope' USING ERRCODE='22023';
 END IF;
 IF jsonb_array_length(p_rows)<1 OR jsonb_array_length(p_rows)>1000 THEN
  RAISE EXCEPTION 'Batch size outside bounds' USING ERRCODE='22023';
 END IF;
 IF openplan_gtfs.owns_attempt(p_version,p_token) IS NOT TRUE THEN
  RAISE EXCEPTION 'GTFS attempt no longer owns batch' USING ERRCODE='55000';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM openplan_gtfs.executions j JOIN public.gtfs_feed_versions candidate_version ON candidate_version.id=j.version_id
   WHERE j.version_id=p_version AND j.prepared_token=p_token AND candidate_version.status='parsing') THEN
  RAISE EXCEPTION 'GTFS attempt not prepared' USING ERRCODE='55000';
 END IF;
 SELECT * INTO v FROM public.gtfs_feed_versions WHERE id=p_version;
 hash:=encode(extensions.digest(jsonb_build_object('version',p_version,'token',p_token,
  'kind',p_kind,'ordinal',p_ordinal,'rows',p_rows)::text,'sha256'),'hex');
 SELECT * INTO saved FROM openplan_gtfs.batch_receipts WHERE command_id=p_command;
 IF FOUND THEN
  IF saved.payload_hash IS DISTINCT FROM hash THEN
   RAISE EXCEPTION 'Batch command payload changed' USING ERRCODE='22023';
  END IF;
  RETURN jsonb_build_object('command',saved.command_id,'rows',saved.row_count,'hash',saved.payload_hash);
 END IF;
 IF p_ordinal IS DISTINCT FROM (SELECT count(*)::integer FROM openplan_gtfs.batch_receipts
   WHERE version_id=p_version AND token=p_token AND kind=p_kind) THEN
  RAISE EXCEPTION 'GTFS batch ordinal is not next' USING ERRCODE='22023';
 END IF;
 SELECT plan INTO output_plan FROM openplan_gtfs.prepare_receipts WHERE token=p_token AND version_id=p_version;
 IF output_plan IS NULL OR p_ordinal >= (output_plan->>(p_kind||'Batches'))::integer
  OR jsonb_array_length(p_rows)+(SELECT coalesce(sum(row_count),0) FROM openplan_gtfs.batch_receipts
    WHERE version_id=p_version AND token=p_token AND kind=p_kind) > (output_plan->>(p_kind||'Rows'))::integer THEN
  RAISE EXCEPTION 'GTFS batch exceeds declared output plan' USING ERRCODE='22023';
 END IF;
 INSERT INTO openplan_gtfs.write_context(transaction_id,version_id,token,kind,operation)
 VALUES(txid_current(),p_version,p_token,p_kind,'INSERT');
 IF p_kind='route' THEN
  allowed:=ARRAY['workspace_id','feed_version_id','route_id','direction_id','route_short_name','route_long_name','route_type','service_day','representative_date','trips_per_day','first_departure_seconds','last_departure_seconds','peak_headway_seconds','peak_headway_is_lower_bound','peak_window_start_seconds','median_headway_seconds','median_headway_basis','served_hours','span_hours','departures_beyond_bin_range','stops_served','derivation_method','scheduled_trips','frequency_trips'];
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) row
    WHERE jsonb_typeof(row)<>'object') THEN
   RAISE EXCEPTION 'Batch row must be an object' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) row
    CROSS JOIN LATERAL jsonb_object_keys(row) key WHERE NOT key=ANY(allowed)) THEN
   RAISE EXCEPTION 'Unexpected batch field' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) row WHERE
    row->>'feed_version_id' IS DISTINCT FROM p_version::text OR
    row->>'workspace_id' IS DISTINCT FROM v.workspace_id::text) THEN
   RAISE EXCEPTION 'Batch row scope differs' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.gtfs_route_service_levels(workspace_id, feed_version_id, route_id, direction_id, route_short_name, route_long_name, route_type, service_day, representative_date, trips_per_day, first_departure_seconds, last_departure_seconds, peak_headway_seconds, peak_headway_is_lower_bound, peak_window_start_seconds, median_headway_seconds, median_headway_basis, served_hours, span_hours, departures_beyond_bin_range, stops_served, derivation_method, scheduled_trips, frequency_trips)
  SELECT r.workspace_id, r.feed_version_id, r.route_id, r.direction_id, r.route_short_name, r.route_long_name, r.route_type, r.service_day, r.representative_date, r.trips_per_day, r.first_departure_seconds, r.last_departure_seconds, r.peak_headway_seconds, r.peak_headway_is_lower_bound, r.peak_window_start_seconds, r.median_headway_seconds, r.median_headway_basis, r.served_hours, r.span_hours, r.departures_beyond_bin_range, r.stops_served, r.derivation_method, r.scheduled_trips, r.frequency_trips FROM jsonb_populate_recordset(NULL::public.gtfs_route_service_levels,p_rows) r;
 ELSIF p_kind='stop' THEN
  allowed:=ARRAY['workspace_id','feed_version_id','stop_id','stop_name','latitude','longitude','service_day','representative_date','trips_per_day','first_departure_seconds','last_departure_seconds','peak_headway_seconds','peak_headway_is_lower_bound','peak_window_start_seconds','median_headway_seconds','median_headway_basis','served_hours','span_hours','departures_beyond_bin_range','routes_serving','route_ids','derivation_method','scheduled_trips','frequency_trips'];
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) row
    WHERE jsonb_typeof(row)<>'object') THEN
   RAISE EXCEPTION 'Batch row must be an object' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) row
    CROSS JOIN LATERAL jsonb_object_keys(row) key WHERE NOT key=ANY(allowed)) THEN
   RAISE EXCEPTION 'Unexpected batch field' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) row WHERE
    row->>'feed_version_id' IS DISTINCT FROM p_version::text OR
    row->>'workspace_id' IS DISTINCT FROM v.workspace_id::text) THEN
   RAISE EXCEPTION 'Batch row scope differs' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.gtfs_stop_service_levels(workspace_id, feed_version_id, stop_id, stop_name, latitude, longitude, service_day, representative_date, trips_per_day, first_departure_seconds, last_departure_seconds, peak_headway_seconds, peak_headway_is_lower_bound, peak_window_start_seconds, median_headway_seconds, median_headway_basis, served_hours, span_hours, departures_beyond_bin_range, routes_serving, route_ids, derivation_method, scheduled_trips, frequency_trips)
  SELECT r.workspace_id, r.feed_version_id, r.stop_id, r.stop_name, r.latitude, r.longitude, r.service_day, r.representative_date, r.trips_per_day, r.first_departure_seconds, r.last_departure_seconds, r.peak_headway_seconds, r.peak_headway_is_lower_bound, r.peak_window_start_seconds, r.median_headway_seconds, r.median_headway_basis, r.served_hours, r.span_hours, r.departures_beyond_bin_range, r.routes_serving, r.route_ids, r.derivation_method, r.scheduled_trips, r.frequency_trips FROM jsonb_populate_recordset(NULL::public.gtfs_stop_service_levels,p_rows) r;
 END IF;
 GET DIAGNOSTICS written=ROW_COUNT;
 DELETE FROM openplan_gtfs.write_context WHERE transaction_id=txid_current() AND version_id=p_version;
 INSERT INTO openplan_gtfs.batch_receipts VALUES(p_command,p_version,p_token,p_kind,p_ordinal,hash,written);
 RETURN jsonb_build_object('command',p_command,'rows',written,'hash',hash);
END $$;
REVOKE ALL ON FUNCTION public.write_gtfs_ingest_batch(uuid,uuid,uuid,text,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.write_gtfs_ingest_batch(uuid,uuid,uuid,text,integer,jsonb) TO service_role;

-- The expected artifact and totals are committed before the first derived batch.
CREATE FUNCTION openplan_gtfs.check_derived(p_version uuid,p_token uuid,p_plan jsonb,p_manifest jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prepared openplan_gtfs.prepare_receipts%ROWTYPE; actual_manifest jsonb;
 routes integer; stops integer; route_batches integer; stop_batches integer;
BEGIN
 IF openplan_gtfs.owns_attempt(p_version,p_token) IS NOT TRUE OR NOT EXISTS(
   SELECT 1 FROM openplan_gtfs.executions j JOIN public.gtfs_feed_versions v ON v.id=j.version_id
   WHERE j.version_id=p_version AND j.prepared_token=p_token AND v.status='parsing') THEN
  RAISE EXCEPTION 'GTFS derived attempt is not active and prepared' USING ERRCODE='55000';
 END IF;
 SELECT * INTO prepared FROM openplan_gtfs.prepare_receipts WHERE token=p_token AND version_id=p_version;
 IF NOT FOUND OR prepared.plan IS DISTINCT FROM p_plan THEN
  RAISE EXCEPTION 'GTFS derived output plan differs' USING ERRCODE='22023';
 END IF;
 SELECT jsonb_agg(jsonb_build_object('kind',kind,'ordinal',ordinal,'hash',payload_hash,'rows',row_count)
   ORDER BY kind,ordinal) INTO actual_manifest FROM openplan_gtfs.batch_receipts WHERE version_id=p_version AND token=p_token;
 IF actual_manifest IS NULL OR actual_manifest IS DISTINCT FROM p_manifest THEN
  RAISE EXCEPTION 'GTFS derived batch manifest differs' USING ERRCODE='22023';
 END IF;
 SELECT count(*) INTO routes FROM public.gtfs_route_service_levels WHERE feed_version_id=p_version;
 SELECT count(*) INTO stops FROM public.gtfs_stop_service_levels WHERE feed_version_id=p_version;
 SELECT count(*) FILTER(WHERE kind='route'),count(*) FILTER(WHERE kind='stop') INTO route_batches,stop_batches
 FROM openplan_gtfs.batch_receipts WHERE version_id=p_version AND token=p_token;
 IF routes IS DISTINCT FROM (p_plan->>'routeRows')::integer OR stops IS DISTINCT FROM (p_plan->>'stopRows')::integer
   OR route_batches IS DISTINCT FROM (p_plan->>'routeBatches')::integer OR stop_batches IS DISTINCT FROM (p_plan->>'stopBatches')::integer THEN
  RAISE EXCEPTION 'GTFS derived output is incomplete' USING ERRCODE='22023';
 END IF;
 IF routes IS DISTINCT FROM (SELECT sum(row_count) FROM openplan_gtfs.batch_receipts WHERE version_id=p_version AND token=p_token AND kind='route')
   OR stops IS DISTINCT FROM (SELECT sum(row_count) FROM openplan_gtfs.batch_receipts WHERE version_id=p_version AND token=p_token AND kind='stop') THEN
  RAISE EXCEPTION 'GTFS derived stored counts differ from receipts' USING ERRCODE='22023';
 END IF;
 RETURN jsonb_build_object('routeRows',routes,'stopRows',stops);
END $$;

CREATE TABLE openplan_gtfs.tract_receipts (
 command_id uuid PRIMARY KEY,
 version_id uuid NOT NULL REFERENCES public.gtfs_feed_versions(id) ON DELETE CASCADE,
 token uuid NOT NULL REFERENCES openplan_gtfs.claims(token) ON DELETE CASCADE,
 payload_hash text NOT NULL,
 computed boolean NOT NULL,
 row_count integer,
 computed_at timestamptz,
 error_code text,
 error_detail text,
 response jsonb NOT NULL,
 UNIQUE(version_id,token),
 CHECK((computed AND row_count>=0 AND row_count IS NOT NULL AND computed_at IS NOT NULL AND error_code IS NULL)
   OR (NOT computed AND row_count IS NULL AND computed_at IS NULL AND error_code IS NOT NULL))
);
CREATE TABLE openplan_gtfs.completion_receipts (
 command_id uuid PRIMARY KEY,
 version_id uuid NOT NULL UNIQUE REFERENCES public.gtfs_feed_versions(id) ON DELETE CASCADE,
 token uuid NOT NULL REFERENCES openplan_gtfs.claims(token) ON DELETE CASCADE,
 payload_hash text NOT NULL,
 response jsonb NOT NULL
);
ALTER TABLE openplan_gtfs.tract_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE openplan_gtfs.completion_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON openplan_gtfs.tract_receipts,openplan_gtfs.completion_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX gtfs_tract_receipts_token ON openplan_gtfs.tract_receipts(token);
CREATE INDEX gtfs_completion_receipts_token ON openplan_gtfs.completion_receipts(token);

-- Record the existing spatial join once per attempt, including its failure.
-- SQL cannot verify the supplied parsed artifact bytes; the worker must do that.
CREATE FUNCTION public.compute_managed_gtfs_tracts(p_version uuid,p_token uuid,p_command uuid,p_plan jsonb,p_manifest jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE saved openplan_gtfs.tract_receipts%ROWTYPE; submission openplan_gtfs.submissions%ROWTYPE;
 hash text; computed boolean:=false; rows integer; at_time timestamptz; code text; detail text; result jsonb;
BEGIN
 IF p_version IS NULL OR p_token IS NULL OR p_command IS NULL THEN
  RAISE EXCEPTION 'GTFS tract command identity is required' USING ERRCODE='22023';
 END IF;
 PERFORM 1 FROM public.gtfs_feed_versions WHERE id=p_version FOR UPDATE;
 SELECT s.* INTO submission FROM openplan_gtfs.submissions s JOIN openplan_gtfs.executions j ON j.request_id=s.request_id WHERE j.version_id=p_version;
 IF NOT FOUND OR openplan_gtfs.actor_can_write(submission.workspace_id,submission.actor_id) IS NOT TRUE THEN
  RAISE EXCEPTION 'GTFS tract actor is unavailable' USING ERRCODE='42501';
 END IF;
 hash:=encode(extensions.digest(jsonb_build_object('version',p_version,'token',p_token,'plan',p_plan,'manifest',p_manifest)::text,'sha256'),'hex');
 SELECT * INTO saved FROM openplan_gtfs.tract_receipts WHERE command_id=p_command;
 IF FOUND THEN
  IF saved.payload_hash IS DISTINCT FROM hash THEN RAISE EXCEPTION 'GTFS tract command payload changed' USING ERRCODE='22023'; END IF;
  RETURN saved.response;
 END IF;
 PERFORM openplan_gtfs.check_derived(p_version,p_token,p_plan,p_manifest);
 IF EXISTS(SELECT 1 FROM openplan_gtfs.tract_receipts WHERE version_id=p_version AND token=p_token) THEN
  RAISE EXCEPTION 'GTFS tract outcome already recorded for this attempt' USING ERRCODE='55000';
 END IF;
 INSERT INTO openplan_gtfs.write_context VALUES(txid_current(),p_version,'tract','DELETE',p_token),
   (txid_current(),p_version,'tract','INSERT',p_token);
 BEGIN
  rows:=public.compute_gtfs_tract_service(p_version);
  IF rows IS NULL OR rows<0 THEN RAISE EXCEPTION 'Tract computation did not return a row count'; END IF;
  computed:=true; at_time:=clock_timestamp();
 EXCEPTION WHEN SQLSTATE '55000' OR query_canceled THEN RAISE;
 WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE,detail=MESSAGE_TEXT;
  rows:=NULL; at_time:=NULL; computed:=false; detail:=left(detail,500);
 END;
 DELETE FROM openplan_gtfs.write_context WHERE transaction_id=txid_current() AND version_id=p_version;
 IF openplan_gtfs.owns_attempt(p_version,p_token) IS NOT TRUE THEN
  RAISE EXCEPTION 'GTFS attempt lost ownership during tract computation' USING ERRCODE='55000';
 END IF;
 result:=jsonb_build_object('command',p_command,'version',p_version,'computed',computed,'rows',rows,'computedAt',at_time,'errorCode',code,'errorDetail',detail);
 INSERT INTO openplan_gtfs.tract_receipts VALUES(p_command,p_version,p_token,hash,computed,rows,at_time,code,detail,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.compute_managed_gtfs_tracts(uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.compute_managed_gtfs_tracts(uuid,uuid,uuid,jsonb,jsonb) TO service_role;

CREATE FUNCTION public.complete_gtfs_ingest(
 p_version uuid,p_token uuid,p_command uuid,p_archive jsonb,p_plan jsonb,p_manifest jsonb,p_metadata jsonb,p_tract_command uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.gtfs_feed_versions%ROWTYPE; m public.gtfs_feed_versions%ROWTYPE;
 saved openplan_gtfs.completion_receipts%ROWTYPE; tract openplan_gtfs.tract_receipts%ROWTYPE;
 submission openplan_gtfs.submissions%ROWTYPE; hash text; counts jsonb; result jsonb; field text; actual_tracts integer;
BEGIN
 IF p_version IS NULL OR p_token IS NULL OR p_command IS NULL OR p_tract_command IS NULL
   OR p_metadata IS NULL OR jsonb_typeof(p_metadata)<>'object' THEN
  RAISE EXCEPTION 'GTFS completion arguments are required' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v FROM public.gtfs_feed_versions WHERE id=p_version FOR UPDATE;
 SELECT s.* INTO submission FROM openplan_gtfs.submissions s JOIN openplan_gtfs.executions j ON j.request_id=s.request_id WHERE j.version_id=p_version;
 IF NOT FOUND OR openplan_gtfs.actor_can_write(submission.workspace_id,submission.actor_id) IS NOT TRUE THEN
  RAISE EXCEPTION 'GTFS completion actor is unavailable' USING ERRCODE='42501';
 END IF;
 hash:=encode(extensions.digest(jsonb_build_object('version',p_version,'token',p_token,'archive',p_archive,
   'plan',p_plan,'manifest',p_manifest,'metadata',p_metadata,'tractCommand',p_tract_command)::text,'sha256'),'hex');
 SELECT * INTO saved FROM openplan_gtfs.completion_receipts WHERE command_id=p_command;
 IF FOUND THEN
  IF saved.payload_hash IS DISTINCT FROM hash THEN RAISE EXCEPTION 'GTFS completion payload changed' USING ERRCODE='22023'; END IF;
  RETURN saved.response;
 END IF;
 counts:=openplan_gtfs.check_derived(p_version,p_token,p_plan,p_manifest);
 IF p_archive IS NULL OR p_archive IS DISTINCT FROM jsonb_build_object('path',v.storage_path,'sha256',v.checksum_sha256,'bytes',v.byte_size)
   OR NOT EXISTS(SELECT 1 FROM openplan_gtfs.executions WHERE version_id=p_version AND archive_available AND archive_identity=p_archive) THEN
  RAISE EXCEPTION 'GTFS completion archive identity differs' USING ERRCODE='22023';
 END IF;
 SELECT * INTO tract FROM openplan_gtfs.tract_receipts WHERE command_id=p_tract_command;
 IF NOT FOUND OR tract.version_id IS DISTINCT FROM p_version OR tract.token IS DISTINCT FROM p_token
  OR tract.payload_hash IS DISTINCT FROM encode(extensions.digest(jsonb_build_object('version',p_version,'token',p_token,'plan',p_plan,'manifest',p_manifest)::text,'sha256'),'hex') THEN
  RAISE EXCEPTION 'GTFS completion tract outcome differs' USING ERRCODE='22023';
 END IF;
 SELECT count(*) INTO actual_tracts FROM public.gtfs_tract_service WHERE feed_version_id=p_version;
 IF (tract.computed AND actual_tracts IS DISTINCT FROM tract.row_count) OR (NOT tract.computed AND actual_tracts<>0) THEN
  RAISE EXCEPTION 'GTFS completion tract rows differ' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_metadata) key WHERE NOT key=ANY(ARRAY['agency_count','route_count','stop_count','trip_count','stop_time_row_count','calendar_service_count','frequency_trip_count','scheduled_trip_count','service_start_date','service_end_date','feed_info_version','feed_info_publisher_name','feed_info_start_date','feed_info_end_date','parse_warnings'])) THEN
  RAISE EXCEPTION 'Unexpected GTFS completion metadata' USING ERRCODE='22023';
 END IF;
 FOREACH field IN ARRAY ARRAY['agency_count','route_count','stop_count','trip_count','stop_time_row_count','calendar_service_count','frequency_trip_count','scheduled_trip_count'] LOOP
  IF jsonb_typeof(p_metadata->field) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'GTFS parser counts must be numeric' USING ERRCODE='22023'; END IF;
  IF (p_metadata->>field)::numeric NOT BETWEEN 0 AND 2147483647 OR trunc((p_metadata->>field)::numeric)<>(p_metadata->>field)::numeric THEN
   RAISE EXCEPTION 'GTFS parser counts must be bounded nonnegative integers' USING ERRCODE='22023';
  END IF;
 END LOOP;
 IF (p_metadata->>'route_count')::numeric=0 OR (p_metadata->>'stop_count')::numeric=0 OR jsonb_typeof(p_metadata->'parse_warnings') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Invalid GTFS parser metadata' USING ERRCODE='22023';
 END IF;
 FOREACH field IN ARRAY ARRAY['service_start_date','service_end_date','feed_info_version','feed_info_publisher_name','feed_info_start_date','feed_info_end_date'] LOOP
  IF p_metadata ? field AND jsonb_typeof(p_metadata->field) NOT IN ('string','null') THEN
   RAISE EXCEPTION 'GTFS parser descriptive metadata must be text' USING ERRCODE='22023';
  END IF;
 END LOOP;
 SELECT * INTO m FROM jsonb_populate_record(NULL::public.gtfs_feed_versions,p_metadata);
 INSERT INTO openplan_gtfs.write_context VALUES(txid_current(),p_version,'version','UPDATE',p_token);
 UPDATE public.gtfs_feed_versions SET status='ready',failure_code=NULL,failure_detail=NULL,
  route_service_level_rows=(counts->>'routeRows')::integer,stop_service_level_rows=(counts->>'stopRows')::integer,
  tract_service_rows=tract.row_count,tract_service_computed_at=tract.computed_at,shape_count=0,shapes_status='not_ingested',
  agency_count=m.agency_count,route_count=m.route_count,stop_count=m.stop_count,trip_count=m.trip_count,
  stop_time_row_count=m.stop_time_row_count,calendar_service_count=m.calendar_service_count,
  frequency_trip_count=m.frequency_trip_count,scheduled_trip_count=m.scheduled_trip_count,
  service_start_date=m.service_start_date,service_end_date=m.service_end_date,feed_info_version=m.feed_info_version,
  feed_info_publisher_name=m.feed_info_publisher_name,feed_info_start_date=m.feed_info_start_date,feed_info_end_date=m.feed_info_end_date,
  parse_warnings=m.parse_warnings,last_checked_at=clock_timestamp() WHERE id=p_version;
 DELETE FROM openplan_gtfs.write_context WHERE transaction_id=txid_current() AND version_id=p_version;
 UPDATE openplan_gtfs.executions SET state='ready',token=NULL,lease_until=NULL WHERE version_id=p_version;
 result:=jsonb_build_object('command',p_command,'version',p_version,'status','ready','routeRows',counts->'routeRows','stopRows',counts->'stopRows','tractOutcome',tract.response);
 INSERT INTO openplan_gtfs.completion_receipts VALUES(p_command,p_version,p_token,hash,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.complete_gtfs_ingest(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_gtfs_ingest(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid) TO service_role;

-- Adoption receipts survive individual feed removal; command identity must not
-- be reused to make a different service decision after a lost reply.
CREATE TABLE openplan_gtfs.adoption_receipts (
 command_id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL,
 version_id uuid NOT NULL,
 payload_hash text NOT NULL,
 response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX gtfs_adoption_receipts_workspace ON openplan_gtfs.adoption_receipts(workspace_id);
CREATE INDEX gtfs_adoption_receipts_version ON openplan_gtfs.adoption_receipts(version_id);
ALTER TABLE openplan_gtfs.adoption_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON openplan_gtfs.adoption_receipts FROM PUBLIC,anon,authenticated,service_role;

-- A trusted route must bind p_actor to its authenticated user. Review is an
-- exact acceptance of the returned basis, never an agent-accessible force flag.
-- Legacy ready versions remain eligible, including a deliberate rollback.
CREATE FUNCTION public.adopt_gtfs_ingest(p_workspace uuid,p_version uuid,p_command uuid,p_actor uuid,p_review jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE saved openplan_gtfs.adoption_receipts%ROWTYPE; feed public.gtfs_feeds%ROWTYPE;
 incoming public.gtfs_feed_versions%ROWTYPE; previous public.gtfs_feed_versions%ROWTYPE;
 hash text; basis jsonb; result jsonb; shrinks boolean; target_feed_id uuid; adopted_at timestamptz;
BEGIN
 IF p_workspace IS NULL OR p_version IS NULL OR p_command IS NULL OR p_actor IS NULL THEN
  RAISE EXCEPTION 'GTFS adoption requires its complete identity' USING ERRCODE='22023';
 END IF;
 IF openplan_gtfs.actor_can_write(p_workspace,p_actor) IS NOT TRUE THEN
  RAISE EXCEPTION 'GTFS adoption write access is unavailable' USING ERRCODE='42501';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('gtfs-adoption:'||p_command::text,0));
 hash:=encode(extensions.digest(jsonb_build_object('workspace',p_workspace,'version',p_version,'actor',p_actor,'review',p_review)::text,'sha256'),'hex');
 SELECT * INTO saved FROM openplan_gtfs.adoption_receipts WHERE command_id=p_command;
 IF FOUND THEN
  IF saved.payload_hash IS DISTINCT FROM hash THEN
   RAISE EXCEPTION 'GTFS adoption command payload changed' USING ERRCODE='22023'; END IF;
  RETURN saved.response;
 END IF;
 SELECT v.feed_id INTO target_feed_id FROM public.gtfs_feed_versions v WHERE v.id=p_version AND v.workspace_id=p_workspace;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'GTFS adoption version is unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO feed FROM public.gtfs_feeds WHERE id=target_feed_id AND workspace_id=p_workspace FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'GTFS adoption feed is unavailable' USING ERRCODE='42501'; END IF;
 PERFORM v.id FROM public.gtfs_feed_versions v WHERE v.id IN (p_version,feed.current_version_id) ORDER BY v.id FOR UPDATE;
 SELECT * INTO incoming FROM public.gtfs_feed_versions WHERE id=p_version AND feed_id=feed.id AND workspace_id=p_workspace;
 IF NOT FOUND OR incoming.status IS DISTINCT FROM 'ready' OR incoming.ingest_closed_at IS NOT NULL OR incoming.ingest_abandoned_at IS NOT NULL THEN
  RAISE EXCEPTION 'GTFS adoption requires a ready version' USING ERRCODE='55000';
 END IF;
 IF EXISTS(SELECT 1 FROM openplan_gtfs.executions WHERE version_id=p_version) AND NOT EXISTS(
   SELECT 1 FROM openplan_gtfs.executions j JOIN openplan_gtfs.completion_receipts c ON c.version_id=j.version_id
   WHERE j.version_id=p_version AND j.state='ready') THEN
  RAISE EXCEPTION 'Managed GTFS adoption requires its completion receipt' USING ERRCODE='55000';
 END IF;
 SELECT * INTO previous FROM public.gtfs_feed_versions WHERE id=feed.current_version_id;
 IF (feed.current_version_id IS NOT NULL AND (previous.id IS NULL OR previous.feed_id IS DISTINCT FROM feed.id
     OR previous.workspace_id IS DISTINCT FROM p_workspace OR previous.status IS DISTINCT FROM 'ready'
     OR previous.is_current IS DISTINCT FROM true OR feed.status IS DISTINCT FROM previous.status
     OR previous.route_count IS NULL OR previous.stop_count IS NULL))
   OR (feed.current_version_id IS NULL AND EXISTS(SELECT 1 FROM public.gtfs_feed_versions WHERE feed_id=feed.id AND is_current)) THEN
  RAISE EXCEPTION 'GTFS current feed evidence is inconsistent' USING ERRCODE='55000';
 END IF;
 basis:=jsonb_build_object('feedId',feed.id,'versionId',incoming.id,'routeCount',incoming.route_count,'stopCount',incoming.stop_count,
  'previousVersionId',previous.id,'previousRouteCount',previous.route_count,'previousStopCount',previous.stop_count);
 -- Same policy as assessFeedVersionCollapse: a reduction greater than 20 percent.
 shrinks:=previous.id IS NOT NULL AND ((previous.route_count>0 AND incoming.route_count<previous.route_count*0.8)
   OR (previous.stop_count>0 AND incoming.stop_count<previous.stop_count*0.8));
 IF p_review IS NOT NULL AND p_review IS DISTINCT FROM jsonb_build_object('acceptMaterialShrinkage',true,'basis',basis) THEN
  RAISE EXCEPTION 'GTFS adoption review no longer matches current evidence' USING ERRCODE='22023';
 END IF;
 IF shrinks AND p_review IS NULL THEN
  result:=jsonb_build_object('command',p_command,'version',p_version,'adopted',false,'withheld',true,'basis',basis);
 ELSIF feed.current_version_id=p_version THEN
  result:=jsonb_build_object('command',p_command,'version',p_version,'adopted',true,'alreadyCurrent',true,'basis',basis,'adoptedAt',feed.loaded_at);
 ELSE
  INSERT INTO openplan_gtfs.write_context(transaction_id,version_id,kind,operation,token)
  SELECT txid_current(),v.id,'version','UPDATE',NULL FROM public.gtfs_feed_versions v
  WHERE v.feed_id=feed.id AND (v.id=p_version OR v.is_current);
  INSERT INTO openplan_gtfs.write_context VALUES(txid_current(),p_version,'adoption','UPDATE',NULL);
  PERFORM public.promote_gtfs_feed_version(p_version);
  DELETE FROM openplan_gtfs.write_context WHERE transaction_id=txid_current()
   AND version_id IN (SELECT id FROM public.gtfs_feed_versions WHERE feed_id=feed.id);
  SELECT loaded_at INTO adopted_at FROM public.gtfs_feeds WHERE id=feed.id;
  result:=jsonb_build_object('command',p_command,'version',p_version,'adopted',true,'alreadyCurrent',false,
    'basis',basis,'reviewAccepted',p_review IS NOT NULL,'adoptedAt',adopted_at);
 END IF;
 INSERT INTO openplan_gtfs.adoption_receipts(command_id,workspace_id,actor_id,version_id,payload_hash,response)
 VALUES(p_command,p_workspace,p_actor,p_version,hash,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.adopt_gtfs_ingest(uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.adopt_gtfs_ingest(uuid,uuid,uuid,uuid,jsonb) TO service_role;

-- Terminal decisions survive individual feed deletion, like admission/adoption.
CREATE TABLE openplan_gtfs.terminal_receipts (
 command_id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 version_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 payload_hash text NOT NULL,
 response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX gtfs_terminal_receipts_workspace ON openplan_gtfs.terminal_receipts(workspace_id);
CREATE INDEX gtfs_terminal_receipts_version ON openplan_gtfs.terminal_receipts(version_id);
ALTER TABLE openplan_gtfs.terminal_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON openplan_gtfs.terminal_receipts FROM PUBLIC,anon,authenticated,service_role;

-- Failure belongs to an active worker. Cancellation belongs to a current
-- workspace writer, including a different writer when the submitter is revoked.
CREATE FUNCTION openplan_gtfs.terminate_ingest(p_workspace uuid,p_version uuid,p_command uuid,p_actor uuid,
 p_token uuid,p_kind text,p_code text,p_detail text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE saved openplan_gtfs.terminal_receipts%ROWTYPE; v public.gtfs_feed_versions%ROWTYPE;
 j openplan_gtfs.executions%ROWTYPE; s openplan_gtfs.submissions%ROWTYPE;
 hash text; result jsonb; closure jsonb; target_feed uuid; object_path text;
BEGIN
 IF p_workspace IS NULL OR p_version IS NULL OR p_command IS NULL OR p_actor IS NULL
  OR p_kind IS NULL OR p_kind NOT IN ('failed','cancelled')
  OR (p_kind='failed' AND p_token IS NULL) OR (p_kind='cancelled' AND p_token IS NOT NULL)
  OR p_code IS NULL OR p_code NOT IN ('too_large','not_a_zip','ambiguous_archive','missing_required_file',
    'no_usable_stops','no_usable_service','fetch_failed','fetch_timed_out','host_not_allowed',
    'catalog_unavailable','catalog_entry_requires_key','catalog_entry_deprecated','partial_write','abandoned')
  OR p_detail IS NULL OR length(btrim(p_detail))=0 OR length(p_detail)>2000 THEN
  RAISE EXCEPTION 'Invalid GTFS terminal command' USING ERRCODE='22023';
 END IF;
 IF openplan_gtfs.actor_can_write(p_workspace,p_actor) IS NOT TRUE THEN
  RAISE EXCEPTION 'GTFS terminal write access is unavailable' USING ERRCODE='42501';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('gtfs-terminal:'||p_command::text,0));
 hash:=encode(extensions.digest(jsonb_build_object('workspace',p_workspace,'version',p_version,'actor',p_actor,
  'token',p_token,'kind',p_kind,'code',p_code,'detail',p_detail)::text,'sha256'),'hex');
 SELECT * INTO saved FROM openplan_gtfs.terminal_receipts WHERE command_id=p_command;
 IF FOUND THEN
  IF saved.payload_hash IS DISTINCT FROM hash THEN
   RAISE EXCEPTION 'GTFS terminal command payload changed' USING ERRCODE='22023';
  END IF;
  RETURN saved.response;
 END IF;
 SELECT feed_id INTO target_feed FROM public.gtfs_feed_versions WHERE id=p_version AND workspace_id=p_workspace;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'GTFS terminal version is unavailable' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM public.gtfs_feeds WHERE id=target_feed AND workspace_id=p_workspace FOR UPDATE;
 SELECT * INTO v FROM public.gtfs_feed_versions WHERE id=p_version AND workspace_id=p_workspace FOR UPDATE;
 SELECT * INTO j FROM openplan_gtfs.executions WHERE version_id=p_version FOR UPDATE;
 IF NOT FOUND OR j.state NOT IN ('awaiting_archive','queued','running')
  OR v.status NOT IN ('pending','fetching','parsing') OR v.is_current
  OR v.ingest_closed_at IS NOT NULL OR v.ingest_abandoned_at IS NOT NULL
  OR EXISTS(SELECT 1 FROM public.gtfs_feeds WHERE id=target_feed AND current_version_id=p_version) THEN
  RAISE EXCEPTION 'GTFS terminal command requires an unfinished managed import' USING ERRCODE='55000';
 END IF;
 SELECT * INTO s FROM openplan_gtfs.submissions WHERE request_id=j.request_id;
 IF p_kind='failed' AND (s.actor_id IS DISTINCT FROM p_actor OR openplan_gtfs.owns_attempt(p_version,p_token) IS NOT TRUE) THEN
  RAISE EXCEPTION 'GTFS failure requires current worker ownership' USING ERRCODE='55000';
 END IF;
 -- An upload may have reached Storage before its confirmation reply. Include
 -- the prepared deterministic key so cancellation can reconcile that object too.
 object_path:=coalesce(v.storage_path,j.archive_identity->>'path');
 INSERT INTO openplan_gtfs.write_context VALUES(txid_current(),p_version,'version','UPDATE',p_token);
 INSERT INTO openplan_gtfs.write_context VALUES(txid_current(),p_version,'termination','DELETE',p_token);
 closure:=public.close_failed_gtfs_version(p_version,p_code,p_detail,object_path);
 IF closure->>'recorded' IS DISTINCT FROM 'true' THEN
  RAISE EXCEPTION 'GTFS terminal closure was refused' USING ERRCODE='55000';
 END IF;
 DELETE FROM openplan_gtfs.write_context WHERE transaction_id=txid_current() AND version_id=p_version;
 UPDATE openplan_gtfs.executions SET state=p_kind,token=NULL,lease_until=NULL,prepared_token=NULL WHERE version_id=p_version;
 result:=jsonb_build_object('command',p_command,'version',p_version,'state',p_kind,'closure',closure,
  'cleanupPending',object_path IS NOT NULL,'closedAt',(SELECT ingest_closed_at FROM public.gtfs_feed_versions WHERE id=p_version));
 INSERT INTO openplan_gtfs.terminal_receipts(command_id,workspace_id,version_id,actor_id,payload_hash,response)
 VALUES(p_command,p_workspace,p_version,p_actor,hash,result);
 RETURN result;
END $$;

CREATE FUNCTION public.fail_gtfs_ingest(p_version uuid,p_token uuid,p_command uuid,p_code text,p_detail text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s openplan_gtfs.submissions%ROWTYPE;
BEGIN
 SELECT * INTO s FROM openplan_gtfs.submissions WHERE version_id=p_version;
 IF NOT FOUND THEN RAISE EXCEPTION 'GTFS failure submission is unavailable' USING ERRCODE='42501'; END IF;
 RETURN openplan_gtfs.terminate_ingest(s.workspace_id,p_version,p_command,s.actor_id,p_token,'failed',p_code,p_detail);
END $$;
CREATE FUNCTION public.cancel_gtfs_ingest(p_workspace uuid,p_version uuid,p_command uuid,p_actor uuid,p_reason text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT openplan_gtfs.terminate_ingest(p_workspace,p_version,p_command,p_actor,NULL,'cancelled','abandoned',p_reason);
$$;
REVOKE ALL ON FUNCTION public.fail_gtfs_ingest(uuid,uuid,uuid,text,text),public.cancel_gtfs_ingest(uuid,uuid,uuid,uuid,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fail_gtfs_ingest(uuid,uuid,uuid,text,text),public.cancel_gtfs_ingest(uuid,uuid,uuid,uuid,text) TO service_role;

-- Queue reads are hints. The claim transaction alone assigns worker ownership.
CREATE FUNCTION public.list_gtfs_ingest_candidates(p_limit integer DEFAULT 10)
RETURNS TABLE(version_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION 'GTFS queue limit must be between 1 and 100' USING ERRCODE='22023';
 END IF;
 RETURN QUERY
 SELECT v.id FROM openplan_gtfs.executions j
 JOIN openplan_gtfs.submissions s ON s.request_id=j.request_id
 JOIN public.gtfs_feed_versions v ON v.id=j.version_id AND v.workspace_id=s.workspace_id
 WHERE (j.state='queued' OR (j.state='running' AND j.lease_until<=clock_timestamp()))
  AND v.status IN ('pending','fetching','parsing') AND v.ingest_closed_at IS NULL AND v.ingest_abandoned_at IS NULL
  AND EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=s.workspace_id
    AND m.user_id=s.actor_id AND m.role IN ('owner','admin','member'))
 ORDER BY s.created_at,v.id LIMIT p_limit;
END $$;

-- Retained tokens can inspect their own historical claim and preparation.
-- No response exposes the replacement worker's token or changes a lease.
CREATE FUNCTION public.read_gtfs_ingest_attempt(p_version uuid,p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.gtfs_feed_versions%ROWTYPE; j openplan_gtfs.executions%ROWTYPE;
 s openplan_gtfs.submissions%ROWTYPE; claim openplan_gtfs.claims%ROWTYPE; output_plan jsonb;
BEGIN
 SELECT * INTO v FROM public.gtfs_feed_versions WHERE id=p_version FOR UPDATE;
 SELECT * INTO j FROM openplan_gtfs.executions WHERE version_id=p_version FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'GTFS attempt is unavailable' USING ERRCODE='42501';
 END IF;
 SELECT * INTO s FROM openplan_gtfs.submissions WHERE request_id=j.request_id;
 IF openplan_gtfs.actor_can_write(s.workspace_id,s.actor_id) IS NOT TRUE THEN
  RAISE EXCEPTION 'GTFS attempt read access is unavailable' USING ERRCODE='42501';
 END IF;
 SELECT * INTO claim FROM openplan_gtfs.claims WHERE token=p_token AND version_id=p_version;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'GTFS attempt read requires its retained claim' USING ERRCODE='42501';
 END IF;
 SELECT plan INTO output_plan FROM openplan_gtfs.prepare_receipts WHERE token=p_token AND version_id=p_version;
 RETURN jsonb_build_object('schemaVersion',1,'versionId',v.id,'feedId',v.feed_id,'workspaceId',v.workspace_id,
  'requestId',s.request_id,'actorId',s.actor_id,'state',j.state,'stage',v.status,'attempts',j.attempt,'claim',to_jsonb(claim),
  'active',openplan_gtfs.owns_attempt(p_version,p_token),'prepared',coalesce(j.prepared_token=p_token,false),
  'source',s.payload->'source','archive',j.archive_identity,'archiveConfirmed',j.archive_available,
  'plan',output_plan,'tract',(SELECT response FROM openplan_gtfs.tract_receipts WHERE token=p_token AND version_id=p_version),
  'completion',(SELECT response FROM openplan_gtfs.completion_receipts WHERE token=p_token AND version_id=p_version));
END $$;

-- A trusted route binds p_actor to the session. Members may inspect progress;
-- worker tokens, prepared object identity and submitted source arguments stay private.
CREATE FUNCTION public.read_gtfs_ingest_status(p_workspace uuid,p_version uuid,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM 1 FROM public.workspace_members WHERE workspace_id=p_workspace AND user_id=p_actor FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'GTFS status read access is unavailable' USING ERRCODE='42501';
 END IF;
 SELECT jsonb_build_object('schemaVersion',1,'requestId',s.request_id,'versionId',v.id,'feedId',v.feed_id,
  'workspaceId',v.workspace_id,'state',j.state,'stage',v.status,'attempts',j.attempt,'leaseUntil',j.lease_until,
  'archiveConfirmed',j.archive_available,'submittedAt',s.created_at,'isCurrent',v.is_current,
  'failureCode',v.failure_code,'failureDetail',v.failure_detail,
  'submitterAccessUnavailable',j.state IN ('awaiting_archive','queued','running') AND NOT EXISTS(
    SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=s.workspace_id AND m.user_id=s.actor_id
      AND m.role IN ('owner','admin','member')))
 INTO result FROM openplan_gtfs.executions j JOIN openplan_gtfs.submissions s ON s.request_id=j.request_id
 JOIN public.gtfs_feed_versions v ON v.id=j.version_id AND v.workspace_id=s.workspace_id
 WHERE v.id=p_version AND v.workspace_id=p_workspace;
 IF result IS NULL THEN
  RAISE EXCEPTION 'GTFS status version is unavailable' USING ERRCODE='42501';
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.list_gtfs_ingest_candidates(integer),public.read_gtfs_ingest_attempt(uuid,uuid),
 public.read_gtfs_ingest_status(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_gtfs_ingest_candidates(integer),public.read_gtfs_ingest_attempt(uuid,uuid),
 public.read_gtfs_ingest_status(uuid,uuid,uuid) TO service_role;

-- Lifecycle commands will populate this private transaction context. Until
-- they are connected, enrollment refuses every legacy mutation of managed work.
CREATE FUNCTION openplan_gtfs.guard_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM openplan_gtfs.executions WHERE version_id=OLD.id)
    AND EXISTS(SELECT 1 FROM public.gtfs_feeds WHERE id=OLD.feed_id)
    AND EXISTS(SELECT 1 FROM public.workspaces WHERE id=OLD.workspace_id)
    AND NOT EXISTS(SELECT 1 FROM openplan_gtfs.write_context
      WHERE transaction_id=txid_current() AND version_id=OLD.id AND kind='version' AND operation=TG_OP) THEN
    RAISE EXCEPTION 'Managed GTFS version requires a lifecycle command' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER gtfs_managed_version_guard BEFORE UPDATE OR DELETE ON public.gtfs_feed_versions
FOR EACH ROW EXECUTE FUNCTION openplan_gtfs.guard_version();

CREATE FUNCTION openplan_gtfs.guard_derived() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_version uuid; new_version uuid; managed boolean; row_kind text;
BEGIN
  IF TG_OP<>'INSERT' THEN old_version:=OLD.feed_version_id; END IF;
  IF TG_OP<>'DELETE' THEN new_version:=NEW.feed_version_id; END IF;
  PERFORM id FROM public.gtfs_feed_versions WHERE id IN (old_version,new_version) ORDER BY id FOR UPDATE;
  SELECT EXISTS(SELECT 1 FROM openplan_gtfs.executions WHERE version_id IN (old_version,new_version)) INTO managed;
  IF managed AND EXISTS(SELECT 1 FROM public.gtfs_feed_versions v JOIN public.gtfs_feeds f ON f.id=v.feed_id
    JOIN public.workspaces w ON w.id=v.workspace_id WHERE v.id=coalesce(old_version,new_version)) THEN
    row_kind:=CASE TG_TABLE_NAME WHEN 'gtfs_route_service_levels' THEN 'route'
      WHEN 'gtfs_stop_service_levels' THEN 'stop' WHEN 'gtfs_tract_service' THEN 'tract' END;
    IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM openplan_gtfs.write_context c
      WHERE c.transaction_id=txid_current() AND c.version_id=old_version AND c.kind='termination' AND c.operation='DELETE') THEN
      RETURN OLD;
    END IF;
    IF TG_OP='UPDATE' OR NOT EXISTS(SELECT 1 FROM openplan_gtfs.write_context c
      JOIN openplan_gtfs.executions j ON j.version_id=c.version_id AND j.token=c.token
      WHERE c.transaction_id=txid_current() AND c.version_id=coalesce(new_version,old_version)
        AND c.kind=row_kind AND c.operation=TG_OP AND j.state='running' AND j.lease_until>clock_timestamp()) THEN
      RAISE EXCEPTION 'Managed GTFS rows require an owned batch command' USING ERRCODE='55000';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER gtfs_managed_route_guard BEFORE INSERT OR UPDATE OR DELETE ON public.gtfs_route_service_levels
FOR EACH ROW EXECUTE FUNCTION openplan_gtfs.guard_derived();
CREATE TRIGGER gtfs_managed_stop_guard BEFORE INSERT OR UPDATE OR DELETE ON public.gtfs_stop_service_levels
FOR EACH ROW EXECUTE FUNCTION openplan_gtfs.guard_derived();
CREATE TRIGGER gtfs_managed_tract_guard BEFORE INSERT OR UPDATE OR DELETE ON public.gtfs_tract_service
FOR EACH ROW EXECUTE FUNCTION openplan_gtfs.guard_derived();

CREATE FUNCTION openplan_gtfs.guard_pointer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_version uuid;
BEGIN
  IF TG_OP='UPDATE' THEN old_version:=OLD.current_version_id; END IF;
  IF NEW.current_version_id IS DISTINCT FROM old_version
    AND EXISTS(SELECT 1 FROM openplan_gtfs.executions WHERE version_id IN (old_version,NEW.current_version_id))
    AND NOT EXISTS(SELECT 1 FROM openplan_gtfs.write_context WHERE transaction_id=txid_current()
      AND version_id=coalesce(NEW.current_version_id,old_version) AND kind='adoption' AND operation='UPDATE') THEN
    RAISE EXCEPTION 'Managed GTFS pointer requires an adoption command' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER gtfs_managed_pointer_guard BEFORE INSERT OR UPDATE ON public.gtfs_feeds
FOR EACH ROW EXECUTE FUNCTION openplan_gtfs.guard_pointer();

REVOKE TRUNCATE ON public.gtfs_feeds,public.gtfs_feed_versions,public.gtfs_route_service_levels,
  public.gtfs_stop_service_levels,public.gtfs_tract_service FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA openplan_gtfs FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.admit_gtfs_ingest(uuid,uuid,uuid,uuid,jsonb),
  public.claim_gtfs_ingest(uuid,uuid,integer),public.renew_gtfs_ingest(uuid,uuid,integer),
  public.prepare_gtfs_archive(uuid,uuid,jsonb),public.confirm_gtfs_archive(uuid,uuid,jsonb),public.stage_gtfs_ingest(uuid,uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admit_gtfs_ingest(uuid,uuid,uuid,uuid,jsonb),
  public.claim_gtfs_ingest(uuid,uuid,integer),public.renew_gtfs_ingest(uuid,uuid,integer),
  public.prepare_gtfs_archive(uuid,uuid,jsonb),public.confirm_gtfs_archive(uuid,uuid,jsonb),public.stage_gtfs_ingest(uuid,uuid,text) TO service_role;

-- Begin legacy feed lock order
-- These existing entry points share the managed adoption/termination lock order.
-- Existing privileges, readiness checks and exact failure receipts are retained.
CREATE OR REPLACE FUNCTION public.promote_gtfs_feed_version(p_version_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_feed_id uuid;
  v_status text;
BEGIN
  -- Serialize the feed before inspecting its incoming and current versions.
  -- Recheck the incoming association after waiting for the feed lock.
  SELECT feed_id INTO v_feed_id FROM public.gtfs_feed_versions WHERE id=p_version_id;
  IF v_feed_id IS NULL THEN
    RAISE EXCEPTION 'gtfs_feed_version % does not exist', p_version_id USING ERRCODE='no_data_found';
  END IF;
  PERFORM 1 FROM public.gtfs_feeds WHERE id=v_feed_id FOR UPDATE;
  SELECT status INTO v_status FROM public.gtfs_feed_versions
    WHERE id=p_version_id AND feed_id=v_feed_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'gtfs_feed_version % does not exist', p_version_id USING ERRCODE='no_data_found';
  END IF;

  -- Preserve the ready-only promotion rule after acquiring both locks.
  IF v_status IS DISTINCT FROM 'ready' THEN
    RAISE EXCEPTION
      'refusing to promote gtfs_feed_version % because its status is %, not ready',
      p_version_id, coalesce(v_status, '<null>')
      USING ERRCODE = 'check_violation';
  END IF;

  -- Order inside the transaction still matters, because the partial unique
  -- index is checked per statement: the outgoing version must lose the flag
  -- before the incoming one takes it.
  UPDATE public.gtfs_feed_versions
     SET is_current = false
   WHERE feed_id = v_feed_id
     AND is_current
     AND id <> p_version_id;

  UPDATE public.gtfs_feed_versions
     SET is_current = true
   WHERE id = p_version_id;

  -- `status` is the mirror; `loaded_at` is what the Data Hub card renders as
  -- "when this feed was last brought in", and the moment a version becomes
  -- current is exactly that moment.
  UPDATE public.gtfs_feeds
     SET current_version_id = p_version_id,
         status = v_status,
         loaded_at = now()
   WHERE id = v_feed_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reap_gtfs_feed_version(p_version_id uuid, p_cutoff timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE v public.gtfs_feed_versions%ROWTYPE; target_feed uuid;
BEGIN
  SELECT feed_id INTO target_feed FROM public.gtfs_feed_versions WHERE id=p_version_id;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM public.gtfs_feeds WHERE id=target_feed FOR UPDATE;
  SELECT candidate.* INTO v FROM public.gtfs_feed_versions candidate
    WHERE candidate.id=p_version_id AND candidate.feed_id=target_feed FOR UPDATE;
  IF NOT FOUND OR p_cutoff IS NULL OR v.status NOT IN ('pending','fetching','parsing')
    OR v.updated_at >= p_cutoff OR v.is_current OR v.ingest_abandoned_at IS NOT NULL THEN
    RETURN false;
  END IF;
  IF EXISTS(SELECT 1 FROM public.gtfs_feeds WHERE id=v.feed_id AND current_version_id=v.id) THEN
    RETURN false;
  END IF;
  IF v.storage_path IS NOT NULL THEN
    INSERT INTO public.gtfs_ingest_storage_cleanup(version_id,storage_path)
    VALUES(v.id,v.storage_path);
  END IF;
  DELETE FROM public.gtfs_route_service_levels WHERE feed_version_id=v.id;
  DELETE FROM public.gtfs_stop_service_levels WHERE feed_version_id=v.id;
  DELETE FROM public.gtfs_tract_service WHERE feed_version_id=v.id;
  UPDATE public.gtfs_feed_versions SET status='failed', failure_code='abandoned',
    failure_detail='This ingest stopped responding and was closed by the scheduled sweep. Start a new version to retry.',
    route_service_level_rows=0, stop_service_level_rows=0, tract_service_rows=NULL,
    tract_service_computed_at=NULL, last_checked_at=clock_timestamp(), ingest_abandoned_at=clock_timestamp()
  WHERE id=v.id;
  UPDATE public.gtfs_feeds SET status='failed' WHERE id=v.feed_id AND current_version_id IS NULL;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.close_failed_gtfs_version(p_version_id uuid,p_code text,p_detail text,p_storage_path text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v public.gtfs_feed_versions%ROWTYPE; target_feed uuid; object_path text; changed integer; request jsonb; receipt jsonb;
BEGIN
 SELECT feed_id INTO target_feed FROM public.gtfs_feed_versions WHERE id=p_version_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('recorded',false,'feedStatusChanged',false); END IF;
 PERFORM 1 FROM public.gtfs_feeds WHERE id=target_feed FOR UPDATE;
 SELECT candidate.* INTO v FROM public.gtfs_feed_versions candidate
   WHERE candidate.id=p_version_id AND candidate.feed_id=target_feed FOR UPDATE;
 request:=jsonb_build_object('code',p_code,'detail',p_detail,'storagePath',p_storage_path);
 IF FOUND AND v.ingest_closed_at IS NOT NULL AND v.ingest_failure_receipt->'request'=request THEN
  RETURN v.ingest_failure_receipt->'result';
 END IF;
 IF NOT FOUND OR p_code IS NULL OR p_detail IS NULL OR v.status NOT IN ('pending','fetching','parsing')
 OR v.is_current OR v.ingest_closed_at IS NOT NULL OR v.ingest_abandoned_at IS NOT NULL THEN
  RETURN jsonb_build_object('recorded',false,'feedStatusChanged',false);
 END IF;
 IF EXISTS(SELECT 1 FROM public.gtfs_feeds WHERE id=v.feed_id AND current_version_id=v.id) THEN
  RETURN jsonb_build_object('recorded',false,'feedStatusChanged',false);
 END IF;
 -- An object whose row update was refused can still be cleaned up, but only
 -- at this version's deterministic private key. Never accept another scope.
 IF p_storage_path IS NOT NULL AND p_storage_path IS DISTINCT FROM
  v.workspace_id::text||'/'||v.feed_id::text||'/'||v.id::text||'.zip' THEN
  RAISE EXCEPTION 'GTFS cleanup object does not belong to this version' USING ERRCODE='22023';
 END IF;
 IF v.storage_path IS NOT NULL AND p_storage_path IS NOT NULL AND v.storage_path<>p_storage_path THEN
  RAISE EXCEPTION 'GTFS cleanup object conflicts with recorded custody' USING ERRCODE='22023';
 END IF;
 object_path:=coalesce(v.storage_path,p_storage_path);
 IF object_path IS NOT NULL THEN
  INSERT INTO public.gtfs_ingest_storage_cleanup(version_id,storage_path) VALUES(v.id,object_path);
 END IF;
 DELETE FROM public.gtfs_route_service_levels WHERE feed_version_id=v.id;
 DELETE FROM public.gtfs_stop_service_levels WHERE feed_version_id=v.id;
 DELETE FROM public.gtfs_tract_service WHERE feed_version_id=v.id;
 UPDATE public.gtfs_feeds SET status='failed' WHERE id=v.feed_id AND current_version_id IS NULL;
 GET DIAGNOSTICS changed=ROW_COUNT;
 receipt:=jsonb_build_object('recorded',true,'feedStatusChanged',changed>0);
 UPDATE public.gtfs_feed_versions SET status='failed',failure_code=p_code,failure_detail=p_detail,
  route_service_level_rows=0,stop_service_level_rows=0,tract_service_rows=NULL,tract_service_computed_at=NULL,
  storage_path=object_path,ingest_closed_at=clock_timestamp(),
  ingest_failure_receipt=jsonb_build_object('request',request,'result',receipt),
  last_checked_at=clock_timestamp() WHERE id=v.id;
 RETURN receipt;
END $$;
-- End legacy feed lock order

COMMIT;
