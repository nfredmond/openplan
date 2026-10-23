-- SOURCE ONLY, UNEXECUTED. Install only under root admission after independent review.
-- Lock graph: v2 save/generate: projects(id) -> reports(id) -> acquisition(id).
-- Existing SS4A: opportunity -> project -> report -> artifact/custody -> acquisition.
-- No new path takes opportunity. Legacy source/report/child guards use NOWAIT
-- on sorted project/acquisition parents: an inverse waiter REFUSES (55P03).
-- A captured acquisition is immutable; refresh selects a new acquisition.
-- Protected report children refuse all legacy mutations, including cascades.
-- Private transaction entries cannot be forged with an application GUC.
CREATE SCHEMA IF NOT EXISTS safety_comparison_private;
REVOKE ALL ON SCHEMA safety_comparison_private FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE safety_comparison_private.entries (
  transaction_id bigint NOT NULL, report_id uuid NOT NULL, purpose text NOT NULL,
  PRIMARY KEY (transaction_id, report_id)
);
REVOKE ALL ON safety_comparison_private.entries FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.safety_crash_ingests ADD COLUMN evidence_revision bigint NOT NULL DEFAULT 1 CHECK (evidence_revision > 0);
-- TRUNCATE bypasses row triggers and is not an application mutation protocol.
REVOKE TRUNCATE ON public.safety_crash_ingests,public.safety_crashes,public.safety_crash_parties,public.reports,public.report_runs,public.report_sections,public.report_artifacts FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON COLUMN public.safety_crash_ingests.evidence_revision IS 'Current mutation fence only. Initial 1 does not attest historical immutability or coverage.';

CREATE TABLE public.report_safety_comparison_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  report_id uuid NOT NULL REFERENCES public.reports(id),
  acquisition_id uuid NOT NULL REFERENCES public.safety_crash_ingests(id),
  parent_revision_id uuid REFERENCES public.report_safety_comparison_revisions(id),
  payload jsonb NOT NULL, content_text text NOT NULL,
  content_hash text GENERATED ALWAYS AS (encode(extensions.digest(content_text,'sha256'),'hex')) STORED,
  created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (content_text::jsonb = payload), CHECK (payload->>'version' = 'openplan.safety-comparison.v2'),
  CHECK (payload->>'effect' = 'unassessed'), CHECK (payload->>'programBasis' = 'missing_exact_fy_nofo')
);
CREATE INDEX report_safety_comparison_report_idx ON public.report_safety_comparison_revisions(report_id, created_at, id);
CREATE INDEX report_safety_comparison_acquisition_idx ON public.report_safety_comparison_revisions(acquisition_id);
CREATE TABLE public.report_safety_comparison_members (
  revision_id uuid PRIMARY KEY REFERENCES public.report_safety_comparison_revisions(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id), members jsonb NOT NULL,
  members_text text NOT NULL, members_hash text GENERATED ALWAYS AS (encode(extensions.digest(members_text,'sha256'),'hex')) STORED,
  CHECK (members_text::jsonb = members)
);
CREATE TABLE public.report_safety_comparison_requests (
  report_id uuid NOT NULL REFERENCES public.reports(id), actor_id uuid NOT NULL REFERENCES auth.users(id),
  request_id uuid NOT NULL, workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  command_text text NOT NULL, command_hash text GENERATED ALWAYS AS (encode(extensions.digest(command_text,'sha256'),'hex')) STORED,
  receipt jsonb NOT NULL, PRIMARY KEY(report_id, actor_id, request_id)
);
CREATE TABLE public.report_safety_comparison_generations (
  report_id uuid NOT NULL REFERENCES public.reports(id), actor_id uuid NOT NULL REFERENCES auth.users(id),
  request_id uuid NOT NULL, workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  command_text text NOT NULL, command_hash text GENERATED ALWAYS AS (encode(extensions.digest(command_text,'sha256'),'hex')) STORED,
  artifact_id uuid NOT NULL UNIQUE REFERENCES public.report_artifacts(id), receipt jsonb NOT NULL,
  PRIMARY KEY(report_id, actor_id, request_id)
);
ALTER TABLE public.report_safety_comparison_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_safety_comparison_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_safety_comparison_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_safety_comparison_generations ENABLE ROW LEVEL SECURITY;
CREATE POLICY comparison_revision_read ON public.report_safety_comparison_revisions FOR SELECT TO authenticated USING
 (EXISTS(SELECT FROM public.workspace_members m WHERE m.workspace_id = report_safety_comparison_revisions.workspace_id AND m.user_id = (SELECT auth.uid())));
-- Internal member manifests are retained for reproduction, never a public artifact.
CREATE POLICY comparison_members_read ON public.report_safety_comparison_members FOR SELECT TO authenticated USING
 (EXISTS(SELECT FROM public.workspace_members m WHERE m.workspace_id = report_safety_comparison_members.workspace_id AND m.user_id = (SELECT auth.uid())));
CREATE POLICY comparison_request_read ON public.report_safety_comparison_requests FOR SELECT TO authenticated USING
 (actor_id = (SELECT auth.uid()) AND EXISTS(SELECT FROM public.workspace_members m WHERE m.workspace_id = report_safety_comparison_requests.workspace_id AND m.user_id = (SELECT auth.uid())));
CREATE POLICY comparison_generation_read ON public.report_safety_comparison_generations FOR SELECT TO authenticated USING
 (EXISTS(SELECT FROM public.workspace_members m WHERE m.workspace_id = report_safety_comparison_generations.workspace_id AND m.user_id = (SELECT auth.uid())));
REVOKE ALL ON public.report_safety_comparison_revisions, public.report_safety_comparison_members, public.report_safety_comparison_requests, public.report_safety_comparison_generations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.report_safety_comparison_revisions, public.report_safety_comparison_members, public.report_safety_comparison_requests, public.report_safety_comparison_generations TO authenticated, service_role;

CREATE FUNCTION safety_comparison_private.immutable() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'Safety comparison history and receipts are immutable' USING ERRCODE='23514'; END;
$$;
CREATE TRIGGER comparison_revision_immutable BEFORE UPDATE OR DELETE ON public.report_safety_comparison_revisions FOR EACH ROW EXECUTE FUNCTION safety_comparison_private.immutable();
CREATE TRIGGER comparison_members_immutable BEFORE UPDATE OR DELETE ON public.report_safety_comparison_members FOR EACH ROW EXECUTE FUNCTION safety_comparison_private.immutable();
CREATE TRIGGER comparison_request_immutable BEFORE UPDATE OR DELETE ON public.report_safety_comparison_requests FOR EACH ROW EXECUTE FUNCTION safety_comparison_private.immutable();
CREATE TRIGGER comparison_generation_immutable BEFORE UPDATE OR DELETE ON public.report_safety_comparison_generations FOR EACH ROW EXECUTE FUNCTION safety_comparison_private.immutable();

-- This executes BEFORE the inherited AFTER project touch. NOWAIT cuts the inverse
-- edge even though PostgreSQL may already own the UPDATE/DELETE target tuple.
CREATE FUNCTION safety_comparison_private.source_fence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old_id uuid; new_id uuid; a uuid; p uuid; parent public.safety_crash_ingests%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME = 'safety_crash_ingests' THEN
  IF TG_OP <> 'INSERT' THEN old_id := OLD.id; END IF;
  IF TG_OP <> 'DELETE' THEN new_id := NEW.id; END IF;
 ELSE
  IF TG_OP <> 'INSERT' THEN old_id := OLD.ingest_id; END IF;
  IF TG_OP <> 'DELETE' THEN new_id := NEW.ingest_id; END IF;
 END IF;
 -- Both parents, sorted, including reassignment to a different project.
 FOR p IN SELECT DISTINCT project_id FROM (
   SELECT project_id FROM public.safety_crash_ingests WHERE id IN(old_id,new_id)
   UNION ALL SELECT CASE WHEN TG_TABLE_NAME='safety_crash_ingests' AND TG_OP<>'DELETE' THEN (to_jsonb(NEW)->>'project_id')::uuid END
 ) q WHERE project_id IS NOT NULL ORDER BY project_id LOOP
  PERFORM 1 FROM public.projects WHERE id=p FOR UPDATE NOWAIT;
 END LOOP;
 FOR a IN SELECT DISTINCT x FROM unnest(ARRAY[old_id,new_id]) x WHERE x IS NOT NULL ORDER BY x LOOP
  SELECT * INTO parent FROM public.safety_crash_ingests WHERE id=a FOR UPDATE NOWAIT;
  IF EXISTS(SELECT FROM public.report_safety_comparison_revisions WHERE acquisition_id=a) THEN
   RAISE EXCEPTION 'Captured acquisition is immutable. Retain it and acquire a new source.' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME <> 'safety_crash_ingests' THEN
   IF TG_OP <> 'DELETE' AND a=new_id AND (NOT FOUND OR parent.workspace_id IS DISTINCT FROM NEW.workspace_id OR parent.source_id IS DISTINCT FROM NEW.source_id) THEN
    RAISE EXCEPTION 'Observation source parent differs' USING ERRCODE='23514';
   END IF;
   UPDATE public.safety_crash_ingests SET evidence_revision=evidence_revision+1 WHERE id=a;
  END IF;
 END LOOP;
 IF TG_TABLE_NAME='safety_crash_ingests' AND TG_OP='UPDATE' THEN NEW.evidence_revision := OLD.evidence_revision+1; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$$;
CREATE TRIGGER safety_comparison_source_fence BEFORE INSERT OR UPDATE OR DELETE ON public.safety_crash_ingests FOR EACH ROW EXECUTE FUNCTION safety_comparison_private.source_fence();
CREATE TRIGGER safety_comparison_crash_fence BEFORE INSERT OR UPDATE OR DELETE ON public.safety_crashes FOR EACH ROW EXECUTE FUNCTION safety_comparison_private.source_fence();
CREATE TRIGGER safety_comparison_party_fence BEFORE INSERT OR UPDATE OR DELETE ON public.safety_crash_parties FOR EACH ROW EXECUTE FUNCTION safety_comparison_private.source_fence();

CREATE FUNCTION safety_comparison_private.report_fence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r uuid; p uuid; protected boolean; entry_purpose text; old_pointer jsonb; new_pointer jsonb;
 report_ids uuid[]; parent_before jsonb; locked_parent public.reports%ROWTYPE;
BEGIN
 -- Capture both report identities before fencing their projects. A legacy child
 -- must not continue against an old project after a report move commits.
 SELECT array_agg(x ORDER BY x) INTO report_ids FROM (
  SELECT DISTINCT x FROM unnest(ARRAY[
   CASE WHEN TG_OP<>'INSERT' THEN (to_jsonb(OLD)->>CASE WHEN TG_TABLE_NAME='reports' THEN 'id' ELSE 'report_id' END)::uuid END,
   CASE WHEN TG_OP<>'DELETE' THEN (to_jsonb(NEW)->>CASE WHEN TG_TABLE_NAME='reports' THEN 'id' ELSE 'report_id' END)::uuid END
  ]) x WHERE x IS NOT NULL
 ) ids;
 SELECT coalesce(jsonb_object_agg(v.id::text,jsonb_build_object('projectId',v.project_id,'workspaceId',v.workspace_id)),'{}'::jsonb)
 INTO parent_before FROM public.reports v WHERE v.id=ANY(report_ids);
 FOR p IN SELECT DISTINCT project_id FROM (
  SELECT (value->>'projectId')::uuid AS project_id FROM jsonb_each(parent_before)
  UNION ALL SELECT CASE WHEN TG_TABLE_NAME='reports' AND TG_OP<>'DELETE' THEN (to_jsonb(NEW)->>'project_id')::uuid END
 ) q WHERE project_id IS NOT NULL ORDER BY project_id LOOP
  PERFORM 1 FROM public.projects WHERE id=p FOR UPDATE NOWAIT;
 END LOOP;
 FOR r IN SELECT x FROM unnest(report_ids) x ORDER BY x LOOP
  SELECT * INTO locked_parent FROM public.reports WHERE id=r FOR UPDATE NOWAIT;
  IF FOUND THEN
   IF jsonb_build_object('projectId',locked_parent.project_id,'workspaceId',locked_parent.workspace_id) IS DISTINCT FROM parent_before->r::text THEN
    RAISE EXCEPTION 'Report parent changed while fencing projects. Reload before retrying.' USING ERRCODE='40001';
   END IF;
  ELSIF parent_before ? r::text OR (TG_TABLE_NAME<>'reports' AND TG_OP<>'DELETE') THEN
   RAISE EXCEPTION 'Report parent disappeared while fencing projects' USING ERRCODE='40001';
  END IF;
  -- An unprotected parent can already be absent during its own DELETE cascade.
  -- Protected history retains its parent through the existing foreign keys.
  SELECT purpose INTO entry_purpose FROM safety_comparison_private.entries WHERE transaction_id=txid_current() AND report_id=r;
  protected := EXISTS(SELECT FROM public.report_safety_comparison_revisions WHERE report_id=r);
  IF TG_TABLE_NAME='reports' THEN
   old_pointer := CASE WHEN TG_OP<>'INSERT' THEN OLD.metadata_json->'safetyComparisonV2' END;
   new_pointer := CASE WHEN TG_OP<>'DELETE' THEN NEW.metadata_json->'safetyComparisonV2' END;
   IF protected OR new_pointer IS NOT NULL OR old_pointer IS NOT NULL THEN
    IF entry_purpose IS NULL OR TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'Protected Safety report requires its atomic command' USING ERRCODE='23514'; END IF;
    IF NOT EXISTS(SELECT FROM public.report_safety_comparison_revisions v WHERE v.id=(new_pointer->>'revisionId')::uuid AND v.report_id=NEW.id AND v.project_id=NEW.project_id AND v.workspace_id=NEW.workspace_id AND v.content_hash=new_pointer->>'hash')
      OR new_pointer->>'version' IS DISTINCT FROM 'openplan.safety-comparison.v2' THEN
      RAISE EXCEPTION 'Safety comparison pointer differs from immutable owner' USING ERRCODE='23514';
    END IF;
   END IF;
  ELSIF protected THEN
   IF TG_TABLE_NAME <> 'report_artifacts' OR entry_purpose IS DISTINCT FROM 'generate' OR TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Protected Safety render children require a new comparison, not a legacy edit' USING ERRCODE='23514';
   END IF;
   IF NEW.metadata_json->'safetyPlanSnapshotV1' IS NOT NULL OR NEW.metadata_json->'safetyPlanSnapshotV2'->>'version' IS DISTINCT FROM 'openplan.safety-plan-snapshot.v2' THEN
    RAISE EXCEPTION 'Protected comparison requires a v2 artifact' USING ERRCODE='23514';
   END IF;
  ELSIF TG_TABLE_NAME='report_artifacts' AND TG_OP<>'DELETE' AND to_jsonb(NEW)->'metadata_json'->'safetyPlanSnapshotV2' IS NOT NULL THEN
   RAISE EXCEPTION 'V2 artifact requires protected comparison command' USING ERRCODE='23514';
  END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$$;
CREATE TRIGGER safety_comparison_report_fence BEFORE INSERT OR UPDATE OR DELETE ON public.reports FOR EACH ROW EXECUTE FUNCTION safety_comparison_private.report_fence();
CREATE TRIGGER safety_comparison_runs_fence BEFORE INSERT OR UPDATE OR DELETE ON public.report_runs FOR EACH ROW EXECUTE FUNCTION safety_comparison_private.report_fence();
CREATE TRIGGER safety_comparison_sections_fence BEFORE INSERT OR UPDATE OR DELETE ON public.report_sections FOR EACH ROW EXECUTE FUNCTION safety_comparison_private.report_fence();
CREATE TRIGGER safety_comparison_artifacts_fence BEFORE INSERT OR UPDATE OR DELETE ON public.report_artifacts FOR EACH ROW EXECUTE FUNCTION safety_comparison_private.report_fence();

-- Dedicated server entry. SECURITY DEFINER is confined to this attributed command;
-- application roles have no write privilege on history or private entries.
CREATE FUNCTION public.save_safety_comparison(p_actor uuid, p_report uuid, p_command_text text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c jsonb := p_command_text::jsonb; i jsonb := c->'inputs'; p public.projects%ROWTYPE; r public.reports%ROWTYPE;
 a public.safety_crash_ingests%ROWTYPE; prior public.report_safety_comparison_requests%ROWTYPE;
 saved public.report_safety_comparison_revisions%ROWTYPE; area public.geometry; analysis public.geometry;
 members jsonb; content jsonb; costs jsonb := '[]'::jsonb; alt jsonb; doc jsonb; receipt jsonb; acquisition jsonb; reasons jsonb;
 n integer; inc integer; exc integer; ind integer; report_after timestamptz; project_after timestamptz; command_hash text;
BEGIN
 IF coalesce(current_setting('role',true),'') NOT IN ('service_role','postgres') OR p_actor IS NULL THEN
  RAISE EXCEPTION 'Attributed server required' USING ERRCODE='42501'; END IF;
 IF octet_length(p_command_text)>500000 OR coalesce(c->>'operation','') NOT IN('save','refresh') OR jsonb_typeof(i) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid comparison command' USING ERRCODE='23514'; END IF;
 IF NOT(c ?& ARRAY['operation','requestId','expectedReportRevision','expectedProjectRevision','expectedAcquisitionRevision','expectedComparison','inputs'])
 OR c-ARRAY['operation','requestId','expectedReportRevision','expectedProjectRevision','expectedAcquisitionRevision','expectedComparison','inputs']<>'{}'::jsonb
 OR NOT(i ?& ARRAY['title','acquisitionId','siteLabel','siteIdentity','influenceArea','influenceRationale','analysisGeometry','selectedYears','severities','involvement','siteFacts','alternatives','findings'])
 OR i-ARRAY['title','acquisitionId','siteLabel','siteIdentity','influenceArea','influenceRationale','analysisGeometry','selectedYears','severities','involvement','siteFacts','alternatives','findings']<>'{}'::jsonb
 OR coalesce(i->>'involvement','') NOT IN('all','pedestrian','bicyclist','motorcyclist') THEN RAISE EXCEPTION 'Unsupported comparison fields or predicate' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(i->'selectedYears') IS DISTINCT FROM 'array' OR jsonb_typeof(i->'severities') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Explicit year and severity sets required' USING ERRCODE='23514'; END IF;
 IF jsonb_array_length(i->'selectedYears') NOT BETWEEN 1 AND 100 OR jsonb_array_length(i->'severities') NOT BETWEEN 1 AND 5
 OR EXISTS(SELECT FROM jsonb_array_elements(i->'selectedYears') y WHERE jsonb_typeof(y)<>'number' OR y::text !~ '^[0-9]{4}$' OR (y::text)::integer NOT BETWEEN 1900 AND 2200)
 OR EXISTS(SELECT FROM jsonb_array_elements_text(i->'severities') s WHERE s NOT IN('fatal','severe_injury','injury','pdo','unknown'))
 OR (SELECT count(DISTINCT y) FROM jsonb_array_elements(i->'selectedYears') y)<>jsonb_array_length(i->'selectedYears')
 OR (SELECT count(DISTINCT s) FROM jsonb_array_elements(i->'severities') s)<>jsonb_array_length(i->'severities') THEN RAISE EXCEPTION 'Invalid or duplicate comparison predicate values' USING ERRCODE='23514'; END IF;
 SELECT * INTO STRICT r FROM public.reports WHERE id=p_report;
 SELECT * INTO STRICT p FROM public.projects WHERE id=r.project_id AND workspace_id=r.workspace_id FOR UPDATE;
 PERFORM 1 FROM public.workspace_members WHERE workspace_id=p.workspace_id AND user_id=p_actor AND role IN('owner','admin','member') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current reports writer required' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT r FROM public.reports WHERE id=p_report AND project_id=p.id AND workspace_id=p.workspace_id FOR UPDATE;
 command_hash := encode(extensions.digest(p_command_text,'sha256'),'hex');
 SELECT * INTO prior FROM public.report_safety_comparison_requests WHERE report_id=r.id AND actor_id=p_actor AND request_id=(c->>'requestId')::uuid;
 IF FOUND THEN
  IF prior.command_text IS DISTINCT FROM p_command_text THEN RAISE EXCEPTION 'Request key reused with changed input' USING ERRCODE='23514'; END IF;
  RETURN prior.receipt; -- Replay never moves a newer pointer.
 END IF;
 IF r.report_type <> 'project_status' OR r.land_use_plan_id IS NOT NULL OR r.rtp_cycle_id IS NOT NULL OR r.engagement_campaign_id IS NOT NULL THEN
  RAISE EXCEPTION 'Safety input comparison requires a standard project-status report' USING ERRCODE='23514'; END IF;
 IF r.updated_at IS DISTINCT FROM (c->>'expectedReportRevision')::timestamptz OR p.updated_at IS DISTINCT FROM (c->>'expectedProjectRevision')::timestamptz
 OR coalesce(r.metadata_json->'safetyComparisonV2','null'::jsonb) IS DISTINCT FROM (CASE WHEN c->'expectedComparison'='null'::jsonb THEN 'null'::jsonb ELSE jsonb_build_object('version','openplan.safety-comparison.v2','revisionId',c->'expectedComparison'->>'revisionId','hash',c->'expectedComparison'->>'hash') END) THEN
  RAISE EXCEPTION 'Comparison source changed' USING ERRCODE='40001'; END IF;
 SELECT * INTO STRICT a FROM public.safety_crash_ingests WHERE id=(i->>'acquisitionId')::uuid AND project_id=p.id AND workspace_id=p.workspace_id AND status='ready' FOR UPDATE;
 IF a.evidence_revision::text IS DISTINCT FROM c->>'expectedAcquisitionRevision' THEN RAISE EXCEPTION 'Acquisition source changed' USING ERRCODE='40001'; END IF;
 IF cardinality(a.years_requested)>100 OR char_length(btrim(p.name)) NOT BETWEEN 1 AND 4000
 OR char_length(btrim(a.source_id)) NOT BETWEEN 1 AND 4000 OR char_length(btrim(a.source_label)) NOT BETWEEN 1 AND 4000
 OR char_length(a.attribution) NOT BETWEEN 1 AND 20000 THEN RAISE EXCEPTION 'Source metadata exceeds this review contract' USING ERRCODE='23514'; END IF;
 IF jsonb_array_length(i->'alternatives') NOT BETWEEN 2 AND 11 OR (SELECT count(*) FROM jsonb_array_elements(i->'alternatives') x WHERE x->>'kind'='no_build')<>1
 OR (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(i->'alternatives') x)<>jsonb_array_length(i->'alternatives')
 OR EXISTS(SELECT FROM jsonb_array_elements(i->'alternatives') x WHERE x->>'effect' IS DISTINCT FROM 'unassessed' OR coalesce(x->>'kind','') NOT IN('no_build','treatment')
  OR NOT(x ?& ARRAY['id','kind','name','scope','operatingAssumptions','treatmentDescription','proposedTimeRange','applicability','applicabilityRationale','conditions','cost','effect','effectReason'])
  OR x-ARRAY['id','kind','name','scope','operatingAssumptions','treatmentDescription','proposedTimeRange','applicability','applicabilityRationale','conditions','cost','effect','effectReason']<>'{}'::jsonb)
 THEN RAISE EXCEPTION 'One No Build, up to ten alternatives, unassessed effects required' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(i->'alternatives') x WHERE
  (x->'cost'->>'kind'='missing' AND (NOT(x->'cost' ?& ARRAY['kind','reason']) OR (x->'cost')-ARRAY['kind','reason']<>'{}'::jsonb))
  OR (x->'cost'->>'kind'='project_estimate' AND (NOT(x->'cost' ?& ARRAY['kind','scopeRelationship','scopeRationale','estimatingBasis','includedElements']) OR (x->'cost')-ARRAY['kind','scopeRelationship','scopeRationale','estimatingBasis','includedElements']<>'{}'::jsonb))
  OR coalesce(x->'cost'->>'kind','') NOT IN('missing','project_estimate')) THEN RAISE EXCEPTION 'Only existing exact estimates or explicit missing costs are admitted' USING ERRCODE='23514'; END IF;
 area := public.ST_SetSRID(public.ST_GeomFromGeoJSON((i->'influenceArea')::text),4326);
 analysis := public.ST_SetSRID(public.ST_GeomFromGeoJSON((i->'analysisGeometry')::text),4326);
 IF NOT public.ST_IsValid(area) OR public.ST_IsEmpty(area) OR public.ST_GeometryType(area)<>'ST_Polygon' OR public.ST_NDims(area)<>2
 OR NOT public.ST_IsValid(analysis) OR public.ST_GeometryType(analysis)<>'ST_Polygon' OR public.ST_NDims(analysis)<>2 OR NOT public.ST_Covers(analysis,area)
 OR a.min_lon>a.max_lon OR public.ST_XMax(public.Box3D(area))-public.ST_XMin(public.Box3D(area))>180
 OR NOT public.ST_Covers(public.ST_MakeEnvelope(a.min_lon,a.min_lat,a.max_lon,a.max_lat,4326),analysis) THEN
  RAISE EXCEPTION 'Invalid, wrapped or out-of-acquisition influence/analysis polygon' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO n FROM public.safety_crashes WHERE ingest_id=a.id;
 IF n>20000 THEN RAISE EXCEPTION 'Comparison capture exceeds 20000 stored observations; nothing truncated' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT FROM public.safety_crashes WHERE ingest_id=a.id AND (workspace_id<>p.workspace_id OR source_id<>a.source_id OR longitude NOT BETWEEN -180 AND 180 OR latitude NOT BETWEEN -90 AND 90)) THEN
  RAISE EXCEPTION 'Stored observation provenance or geometry is invalid' USING ERRCODE='23514'; END IF;
 -- A single complete SQL read under the source fence. No HTTP cohort is accepted.
 -- Values are retained even for excluded/indeterminate members, with stable id order.
 WITH observations AS (SELECT jsonb_build_object(
  'id',s.id,'workspace_id',s.workspace_id,'ingest_id',s.ingest_id,'source_id',s.source_id,'external_id',s.external_id,
  'collision_date',s.collision_date,'collision_year',s.collision_year,'longitude',s.longitude,'latitude',s.latitude,
  'severity',s.severity,'pedestrian_involved',s.pedestrian_involved,'bicyclist_involved',s.bicyclist_involved,
  'motorcyclist_involved',s.motorcyclist_involved,'collision_type',s.collision_type,'lighting',s.lighting,'weather',s.weather) AS row,
  s.id, CASE
   WHEN NOT public.ST_Covers(area,s.geom) THEN 'excluded_spatial'
   WHEN s.collision_year IS NULL THEN 'indeterminate_year'
   WHEN s.collision_date IS NOT NULL AND extract(year FROM s.collision_date)::integer<>s.collision_year THEN 'indeterminate_year'
   WHEN NOT EXISTS(SELECT FROM jsonb_array_elements_text(i->'selectedYears') y WHERE y::integer=s.collision_year) THEN 'excluded_year'
   WHEN s.severity='unknown' AND NOT(i->'severities' ? 'unknown') THEN 'indeterminate_severity'
   WHEN NOT(i->'severities' ? s.severity) THEN 'excluded_severity'
   WHEN i->>'involvement'<>'all' AND (a.dimension_coverage->'party_role'->>'support' IS DISTINCT FROM 'supplied' OR a.involvement_basis IS NULL) THEN 'indeterminate_involvement'
   -- Storage has no per-crash flag completeness. False is not proven absence,
   -- even when some party rows were retrieved. Keep those records indeterminate.
   WHEN i->>'involvement'='pedestrian' AND s.pedestrian_involved IS NOT TRUE THEN 'indeterminate_involvement'
   WHEN i->>'involvement'='bicyclist' AND s.bicyclist_involved IS NOT TRUE THEN 'indeterminate_involvement'
   WHEN i->>'involvement'='motorcyclist' AND s.motorcyclist_involved IS NOT TRUE THEN 'indeterminate_involvement'
   ELSE 'included' END AS disposition
  FROM public.safety_crashes s WHERE s.ingest_id=a.id AND s.workspace_id=p.workspace_id)
 SELECT coalesce(jsonb_agg(jsonb_build_object('row',row,'disposition',disposition) ORDER BY id),'[]'::jsonb),
  count(*) FILTER(WHERE disposition='included'),count(*) FILTER(WHERE disposition LIKE 'excluded_%'),count(*) FILTER(WHERE disposition LIKE 'indeterminate_%')
 INTO members,inc,exc,ind FROM observations;
 SELECT coalesce(jsonb_object_agg(q.reason,q.disposition_count),'{}'::jsonb) INTO reasons FROM
  (SELECT value->>'disposition' reason,count(*) AS disposition_count FROM jsonb_array_elements(members) GROUP BY value->>'disposition') q;
 FOR alt IN SELECT value FROM jsonb_array_elements(i->'alternatives') LOOP
  IF alt->'cost'->>'kind'='project_estimate' THEN
   IF p.estimated_cost_amount IS NULL OR p.estimated_cost_amount<=0 OR p.estimated_cost_amount>1000000000000000 OR p.estimated_cost_amount<>trunc(p.estimated_cost_amount,2) THEN
    RAISE EXCEPTION 'Project estimate missing or invalid; record a missing cost instead' USING ERRCODE='23514'; END IF;
   doc := NULL;
   IF p.estimated_cost_source_document_id IS NOT NULL THEN
    -- NOWAIT cuts the existing document -> project freshness inverse edge.
    SELECT jsonb_build_object('id',d.id,'title',d.title,'checksum',d.checksum,'updatedAt',d.updated_at,'status',d.status)
    INTO STRICT doc FROM public.kb_documents d WHERE d.id=p.estimated_cost_source_document_id AND d.workspace_id=p.workspace_id AND d.project_id=p.id AND d.status IN ('stored','ready')
     AND d.work_program_report_id IS NULL AND d.contract_snapshot_id IS NULL FOR SHARE NOWAIT;
   END IF;
   costs := costs || jsonb_build_array(jsonb_build_object('alternativeId',alt->>'id','originProjectId',p.id,
    'amount',(p.estimated_cost_amount::numeric(18,2))::text,'currency',p.estimated_cost_currency,'priceYear',p.estimated_cost_basis_year,
    'recordedAt',p.estimated_cost_recorded_at,'recordedBy',p.estimated_cost_recorded_by,'sourceDocument',doc,'scopeRelationship',alt->'cost'->>'scopeRelationship',
    'estimatingBasis',alt->'cost'->'estimatingBasis','includedElements',alt->'cost'->'includedElements',
    'precision','retained_database_decimal_not_historical_precision_recovery','normalizedComparison','unassessed'));
  END IF;
 END LOOP;
 -- Separate explicit v2 projection. Never expand or pad a retained v1 snapshot.
 acquisition := jsonb_build_object('id',a.id,'workspace_id',a.workspace_id,'project_id',a.project_id,'evidence_revision',a.evidence_revision::text,
  'min_lon',a.min_lon,'min_lat',a.min_lat,'max_lon',a.max_lon,'max_lat',a.max_lat,'status',a.status,'source_id',a.source_id,'source_label',a.source_label,
  'attribution',a.attribution,'coverage_state',a.coverage_state,'severity_completeness',a.severity_completeness,'years_requested',a.years_requested,
  'crash_count',a.crash_count,'geocoded_count',a.geocoded_count,'stored_count',a.stored_count,'truncated',a.truncated,'created_at',a.created_at,'updated_at',a.updated_at,
  'dimension_coverage',a.dimension_coverage,'party_completeness',a.party_completeness,'party_count',a.party_count,'involvement_basis',a.involvement_basis,
  'published_through',a.published_through,'published_through_provenance',a.published_through_provenance);
 content := jsonb_build_object('version','openplan.safety-comparison.v2','inputs',i,
  'source',jsonb_build_object('acquisition',acquisition,'acquisitionHash',encode(extensions.digest(acquisition::text,'sha256'),'hex'),
    'projectId',p.id,'projectName',p.name,'projectRevision',p.updated_at,'reportRevision',r.updated_at,
    'geometryHash',encode(extensions.digest((i->'influenceArea')::text,'sha256'),'hex'),
    'analysisGeometryHash',encode(extensions.digest((i->'analysisGeometry')::text,'sha256'),'hex'),
    'vocabularyVersion','neutral-crash-storage-20260812','catalog','descriptive-only-no-numerical-cmf-consumed',
    'legacyDerivedFrom',CASE WHEN r.metadata_json->'safetyActionPlan' IS NOT NULL THEN jsonb_build_object('reportId',r.id,'reportRevision',r.updated_at,'note','Legacy report context retained. Geometry, site facts, costs and effects were not inferred from attachment labels.') ELSE 'null'::jsonb END,
    'rawSourceHash',NULL,'rawSourceState','unavailable','roadContext','unassessed_no_road_geometry_consumed'),
  'capture',jsonb_build_object('method','postgis-covers-wgs84-v1','unit','crash',
    'projection',jsonb_build_array('id','workspace_id','ingest_id','source_id','external_id','collision_date','collision_year','longitude','latitude','severity','pedestrian_involved','bicyclist_involved','motorcyclist_involved','collision_type','lighting','weather'),
    'membersHash',encode(extensions.digest(members::text,'sha256'),'hex'),'stored',n,'included',inc,'excluded',exc,'indeterminate',ind,'reasonCounts',reasons,
    'populationCoverage','unassessed','coverageReason','Stored mapped observations only. Requested years, publication cutoffs and stored counts do not prove complete observation intervals. No duration, exposure, person count or annualization is derived.'),
  'costs',costs,'effect','unassessed','programBasis','missing_exact_fy_nofo','authorship','human_entered_source_review');
 IF octet_length(content::text)>500000 THEN RAISE EXCEPTION 'Comparison exceeds the retained review size; nothing truncated' USING ERRCODE='23514'; END IF;
 INSERT INTO public.report_safety_comparison_revisions(workspace_id,project_id,report_id,acquisition_id,parent_revision_id,payload,content_text,created_by)
 VALUES(p.workspace_id,p.id,r.id,a.id,(c->'expectedComparison'->>'revisionId')::uuid,content,content::text,p_actor) RETURNING * INTO saved;
 INSERT INTO public.report_safety_comparison_members(revision_id,workspace_id,members,members_text) VALUES(saved.id,p.workspace_id,members,members::text);
 INSERT INTO safety_comparison_private.entries VALUES(txid_current(),r.id,'save');
 UPDATE public.reports SET metadata_json=coalesce(metadata_json,'{}'::jsonb)||jsonb_build_object('safetyComparisonV2',jsonb_build_object('version','openplan.safety-comparison.v2','revisionId',saved.id,'hash',saved.content_hash)), status='draft'
 WHERE id=r.id RETURNING updated_at INTO report_after;
 SELECT updated_at INTO project_after FROM public.projects WHERE id=p.id;
 receipt := jsonb_build_object('schema','openplan.safety-comparison-receipt.v2','requestId',c->>'requestId','requestHash',command_hash,'revisionId',saved.id,'contentHash',saved.content_hash,
  'reportId',r.id,'projectId',p.id,'workspaceId',p.workspace_id,'beforeReportRevision',r.updated_at,'reportRevision',report_after,'beforeProjectRevision',p.updated_at,'projectRevision',project_after);
 INSERT INTO public.report_safety_comparison_requests(report_id,actor_id,request_id,workspace_id,command_text,receipt) VALUES(r.id,p_actor,(c->>'requestId')::uuid,p.workspace_id,p_command_text,receipt);
 DELETE FROM safety_comparison_private.entries WHERE transaction_id=txid_current() AND report_id=r.id;
 RETURN receipt;
END;
$$;
REVOKE ALL ON FUNCTION public.save_safety_comparison(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_safety_comparison(uuid,uuid,text) TO service_role;

CREATE FUNCTION public.persist_safety_comparison_generation(p_actor uuid,p_report uuid,p_command_text text,p_artifact jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c jsonb:=p_command_text::jsonb; s jsonb:=p_artifact->'metadata_json'->'safetyPlanSnapshotV2';
 p public.projects%ROWTYPE; r public.reports%ROWTYPE; v public.report_safety_comparison_revisions%ROWTYPE;
 a public.safety_crash_ingests%ROWTYPE; old public.report_safety_comparison_generations%ROWTYPE;
 report_after timestamptz; project_after timestamptz; receipt jsonb; command_hash text; cost jsonb; document public.kb_documents%ROWTYPE;
BEGIN
 IF coalesce(current_setting('role',true),'') NOT IN('service_role','postgres') OR p_actor IS NULL THEN RAISE EXCEPTION 'Attributed server required' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT r FROM public.reports WHERE id=p_report;
 SELECT * INTO STRICT p FROM public.projects WHERE id=r.project_id AND workspace_id=r.workspace_id FOR UPDATE;
 PERFORM 1 FROM public.workspace_members WHERE workspace_id=p.workspace_id AND user_id=p_actor AND role IN('owner','admin','member') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current reports writer required' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT r FROM public.reports WHERE id=p_report AND project_id=p.id AND workspace_id=p.workspace_id FOR UPDATE;
 command_hash:=encode(extensions.digest(p_command_text,'sha256'),'hex');
 SELECT * INTO old FROM public.report_safety_comparison_generations WHERE report_id=r.id AND actor_id=p_actor AND request_id=(c->>'requestId')::uuid;
 IF FOUND THEN
  IF old.command_text IS DISTINCT FROM p_command_text THEN RAISE EXCEPTION 'Generation request key reused' USING ERRCODE='23514'; END IF;
  RETURN old.receipt;
 END IF;
 -- P0 before INSERT/UPDATE. No caller result revision and no fixed touch count.
 IF p.updated_at IS DISTINCT FROM (c->>'expectedProjectRevision')::timestamptz OR r.updated_at IS DISTINCT FROM (c->>'expectedReportRevision')::timestamptz
 OR r.metadata_json->'safetyComparisonV2'->>'revisionId' IS DISTINCT FROM c->>'revisionId'
 OR r.metadata_json->'safetyComparisonV2'->>'hash' IS DISTINCT FROM c->>'contentHash' THEN RAISE EXCEPTION 'Comparison generation source changed' USING ERRCODE='40001'; END IF;
 SELECT * INTO STRICT v FROM public.report_safety_comparison_revisions WHERE id=(c->>'revisionId')::uuid AND report_id=r.id AND project_id=p.id AND workspace_id=p.workspace_id;
 IF NOT EXISTS(
  SELECT FROM public.report_safety_comparison_requests q WHERE q.report_id=r.id AND q.receipt->>'revisionId'=v.id::text
   AND (q.receipt->>'reportRevision')::timestamptz=r.updated_at AND (q.receipt->>'projectRevision')::timestamptz=p.updated_at
  UNION ALL SELECT FROM public.report_safety_comparison_generations g WHERE g.report_id=r.id AND g.receipt->>'revisionId'=v.id::text
   AND (g.receipt->>'reportRevision')::timestamptz=r.updated_at AND (g.receipt->>'projectRevision')::timestamptz=p.updated_at
 ) THEN RAISE EXCEPTION 'Current source is not receipt-backed. Refresh the comparison before generation.' USING ERRCODE='40001'; END IF;
 SELECT * INTO STRICT a FROM public.safety_crash_ingests WHERE id=v.acquisition_id AND project_id=p.id AND workspace_id=p.workspace_id FOR UPDATE;
 IF a.evidence_revision::text IS DISTINCT FROM v.payload->'source'->'acquisition'->>'evidence_revision' THEN RAISE EXCEPTION 'Captured acquisition changed' USING ERRCODE='40001'; END IF;
 FOR cost IN SELECT value FROM jsonb_array_elements(v.payload->'costs') LOOP
  IF (cost->>'amount')::numeric IS DISTINCT FROM p.estimated_cost_amount OR cost->>'currency' IS DISTINCT FROM p.estimated_cost_currency
   OR (cost->>'priceYear')::integer IS DISTINCT FROM p.estimated_cost_basis_year OR (cost->>'recordedAt')::timestamptz IS DISTINCT FROM p.estimated_cost_recorded_at
   OR (cost->'sourceDocument'->>'id')::uuid IS DISTINCT FROM p.estimated_cost_source_document_id THEN
   RAISE EXCEPTION 'Estimate source changed. Save a successor comparison before generation.' USING ERRCODE='40001';
  END IF;
  IF p.estimated_cost_source_document_id IS NOT NULL THEN
   SELECT * INTO STRICT document FROM public.kb_documents WHERE id=p.estimated_cost_source_document_id AND workspace_id=p.workspace_id AND project_id=p.id
    AND work_program_report_id IS NULL AND contract_snapshot_id IS NULL FOR SHARE NOWAIT;
   IF document.status NOT IN ('stored','ready') OR document.status IS DISTINCT FROM cost->'sourceDocument'->>'status' OR document.checksum IS DISTINCT FROM cost->'sourceDocument'->>'checksum'
    OR document.updated_at IS DISTINCT FROM (cost->'sourceDocument'->>'updatedAt')::timestamptz THEN RAISE EXCEPTION 'Estimate document changed' USING ERRCODE='40001'; END IF;
  END IF;
 END LOOP;
 IF p_artifact->'metadata_json' ? 'safetyPlanSnapshotV1' OR s->>'version' IS DISTINCT FROM 'openplan.safety-plan-snapshot.v2'
 OR s->'comparison'->>'id' IS DISTINCT FROM v.id::text OR s->'comparison'->>'content_hash' IS DISTINCT FROM v.content_hash
 OR s->'comparison'->'payload' IS DISTINCT FROM v.payload OR s->>'artifactId' IS DISTINCT FROM c->>'requestId'
 OR s->'comparison'->>'content_text' IS DISTINCT FROM v.content_text
 OR s->'comparison'->>'workspace_id' IS DISTINCT FROM v.workspace_id::text OR s->'comparison'->>'project_id' IS DISTINCT FROM v.project_id::text
 OR s->'comparison'->>'report_id' IS DISTINCT FROM v.report_id::text OR s->'comparison'->>'created_by' IS DISTINCT FROM v.created_by::text
 OR (s->'comparison'->>'created_at')::timestamptz IS DISTINCT FROM v.created_at
 OR (s->'comparison'->>'parent_revision_id')::uuid IS DISTINCT FROM v.parent_revision_id
 OR s->>'reportId' IS DISTINCT FROM r.id::text OR s->>'workspaceId' IS DISTINCT FROM p.workspace_id::text OR s->>'projectId' IS DISTINCT FROM p.id::text
 OR (s->>'reportUpdatedAt')::timestamptz IS DISTINCT FROM r.updated_at OR (s->>'projectUpdatedAt')::timestamptz IS DISTINCT FROM p.updated_at
 OR s->>'renderVersion' IS DISTINCT FROM 'openplan.safety-input-review-render.v2'
 OR p_artifact->>'id' IS DISTINCT FROM c->>'requestId' OR p_artifact->>'report_id' IS DISTINCT FROM r.id::text OR p_artifact->>'generated_by' IS DISTINCT FROM p_actor::text
 OR p_artifact->>'artifact_kind' IS DISTINCT FROM c->>'format' OR c->>'format' NOT IN('html','pdf')
 OR (p_artifact->>'generated_at')::timestamptz IS DISTINCT FROM (s->>'generatedAt')::timestamptz
 OR p_artifact->'metadata_json'->>'sha256' IS NULL OR p_artifact->'metadata_json'->>'sha256' !~ '^[a-f0-9]{64}$'
 OR p_artifact->>'storage_path' IS DISTINCT FROM p.workspace_id::text||'/'||r.id::text||'/'||(c->>'requestId')||'-'||(p_artifact->'metadata_json'->>'sha256')||'.'||(c->>'format')
 OR s->>'hash' IS NULL OR s->>'hash' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'V2 artifact/source identity differs' USING ERRCODE='23514'; END IF;
 INSERT INTO safety_comparison_private.entries VALUES(txid_current(),r.id,'generate');
 INSERT INTO public.report_artifacts(id,report_id,artifact_kind,storage_path,generated_by,generated_at,metadata_json)
 VALUES((c->>'requestId')::uuid,r.id,c->>'format',p_artifact->>'storage_path',p_actor,(p_artifact->>'generated_at')::timestamptz,p_artifact->'metadata_json');
 UPDATE public.reports SET status='generated',generated_at=(p_artifact->>'generated_at')::timestamptz,latest_artifact_kind=c->>'format',
 latest_artifact_url='/reports/'||r.id::text||'#artifact-'||(c->>'requestId') WHERE id=r.id RETURNING updated_at INTO report_after;
 SELECT updated_at INTO project_after FROM public.projects WHERE id=p.id;
 receipt:=jsonb_build_object('schema','openplan.safety-comparison-generation.v2','requestId',c->>'requestId','requestHash',command_hash,
 'artifactId',c->>'requestId','reportId',r.id,'projectId',p.id,'workspaceId',p.workspace_id,'revisionId',v.id,'contentHash',v.content_hash,'snapshotHash',s->>'hash',
 'sourceProjectRevision',p.updated_at,'projectRevision',project_after,'sourceReportRevision',r.updated_at,'reportRevision',report_after);
 INSERT INTO public.report_safety_comparison_generations(report_id,actor_id,request_id,workspace_id,command_text,artifact_id,receipt)
 VALUES(r.id,p_actor,(c->>'requestId')::uuid,p.workspace_id,p_command_text,(c->>'requestId')::uuid,receipt);
 DELETE FROM safety_comparison_private.entries WHERE transaction_id=txid_current() AND report_id=r.id;
 RETURN receipt;
END;
$$;
REVOKE ALL ON FUNCTION public.persist_safety_comparison_generation(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.persist_safety_comparison_generation(uuid,uuid,text,jsonb) TO service_role;
-- Private functions are trigger-only, never callable entry points.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA safety_comparison_private FROM PUBLIC,anon,authenticated,service_role;

-- Unknown/dual snapshot versions refuse at storage, including old deployed servers.
CREATE FUNCTION safety_comparison_private.artifact_versions() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE keys text[];
BEGIN
 SELECT array_agg(key ORDER BY key) INTO keys FROM jsonb_each(coalesce(NEW.metadata_json,'{}'::jsonb))
 WHERE key LIKE 'safetyPlanSnapshot%' AND value<>'null'::jsonb;
 IF cardinality(keys)>1 OR (cardinality(keys)=1 AND keys[1] NOT IN('safetyPlanSnapshotV1','safetyPlanSnapshotV2'))
 OR (keys[1]='safetyPlanSnapshotV1' AND NEW.metadata_json->keys[1]->>'version' IS DISTINCT FROM 'openplan.safety-plan-snapshot.v1')
 OR (keys[1]='safetyPlanSnapshotV2' AND NEW.metadata_json->keys[1]->>'version' IS DISTINCT FROM 'openplan.safety-plan-snapshot.v2') THEN
  RAISE EXCEPTION 'Ambiguous or unsupported Safety snapshot version' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER safety_comparison_artifact_versions BEFORE INSERT OR UPDATE ON public.report_artifacts FOR EACH ROW EXECUTE FUNCTION safety_comparison_private.artifact_versions();
REVOKE ALL ON FUNCTION safety_comparison_private.artifact_versions() FROM PUBLIC,anon,authenticated,service_role;

-- Preserve the applied v1 implementation/signature through an attributed wrapper.
-- No new lock is taken before the original opportunity-first graph.
ALTER FUNCTION public.apply_ss4a_safety_seed(uuid,jsonb,text,jsonb) RENAME TO apply_ss4a_safety_seed_legacy_v1;
REVOKE ALL ON FUNCTION public.apply_ss4a_safety_seed_legacy_v1(uuid,jsonb,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.apply_ss4a_safety_seed(p_actor uuid,p_rows jsonb,p_preview_hash text,p_sections jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE metadata jsonb; keys text[];
BEGIN
 IF coalesce(current_setting('role',true),'') NOT IN('service_role','postgres') OR p_actor IS NULL THEN RAISE EXCEPTION 'Attributed server required' USING ERRCODE='42501'; END IF;
 SELECT a.metadata_json INTO STRICT metadata FROM public.report_artifacts a WHERE a.id=(p_rows->'artifact'->>'id')::uuid;
 SELECT array_agg(key ORDER BY key) INTO keys FROM jsonb_each(coalesce(metadata,'{}'::jsonb)) WHERE key LIKE 'safetyPlanSnapshot%' AND value<>'null'::jsonb;
 IF keys IS DISTINCT FROM ARRAY['safetyPlanSnapshotV1'] OR metadata->'safetyPlanSnapshotV1'->>'version' IS DISTINCT FROM 'openplan.safety-plan-snapshot.v1' THEN
  IF keys=ARRAY['safetyPlanSnapshotV2'] AND metadata->'safetyPlanSnapshotV2'->>'version'='openplan.safety-plan-snapshot.v2' THEN
   RAISE EXCEPTION 'Safety input comparison v2 recognized. Missing exact selected fiscal-year SS4A NOFO, amendments and reviewed application-section mapping. No notice-specific seed or eligibility determination.' USING ERRCODE='23514';
  END IF;
  RAISE EXCEPTION 'Ambiguous, missing or unsupported Safety snapshot; no legacy fallback' USING ERRCODE='23514';
 END IF;
 RETURN public.apply_ss4a_safety_seed_legacy_v1(p_actor,p_rows,p_preview_hash,p_sections);
END;
$$;
REVOKE ALL ON FUNCTION public.apply_ss4a_safety_seed(uuid,jsonb,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_ss4a_safety_seed(uuid,jsonb,text,jsonb) TO service_role;

-- Preserve v1 timestamp behavior; protected v2 revisions advance even when two
-- commands share a transaction or a clock reading. Alphabetical order follows
-- the inherited trg_reports_updated_at trigger.
CREATE FUNCTION safety_comparison_private.report_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF EXISTS(SELECT FROM public.report_safety_comparison_revisions WHERE report_id=OLD.id) THEN
  NEW.updated_at := greatest(clock_timestamp(),OLD.updated_at+interval '1 microsecond');
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER zz_safety_comparison_revision BEFORE UPDATE ON public.reports FOR EACH ROW EXECUTE FUNCTION safety_comparison_private.report_revision();
REVOKE ALL ON FUNCTION safety_comparison_private.report_revision() FROM PUBLIC,anon,authenticated,service_role;
