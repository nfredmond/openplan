-- Private review drafts retain original preparation and every reasoned correction.
-- Service-side code verifies full source/preparation/coverage semantics before retention.
CREATE TABLE public.engagement_synthesis_reviews (
 id uuid PRIMARY KEY,
 campaign_id uuid NOT NULL REFERENCES public.engagement_campaigns(id),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 source_id uuid NOT NULL REFERENCES public.engagement_synthesis_sources(id),
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 actor_id uuid NOT NULL,
 preparation_text text NOT NULL CHECK(preparation_text IS JSON OBJECT),
 preparation_sha256 text GENERATED ALWAYS AS (encode(extensions.digest(preparation_text,'sha256'),'hex')) STORED,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX engagement_synthesis_reviews_source ON public.engagement_synthesis_reviews(campaign_id,source_id,created_at,id);
CREATE TABLE public.engagement_synthesis_review_revisions (
 id uuid PRIMARY KEY,
 review_id uuid NOT NULL REFERENCES public.engagement_synthesis_reviews(id),
 revision_no integer NOT NULL CHECK(revision_no>0),
 parent_id uuid REFERENCES public.engagement_synthesis_review_revisions(id),
 parent_sha256 text CHECK(parent_sha256 ~ '^[a-f0-9]{64}$'),
 actor_id uuid NOT NULL,
 intent_json jsonb NOT NULL CHECK(jsonb_typeof(intent_json)='object'),
 reason text,
 content_text text NOT NULL CHECK(content_text IS JSON OBJECT),
 content_sha256 text GENERATED ALWAYS AS (encode(extensions.digest(content_text,'sha256'),'hex')) STORED,
 content_title text GENERATED ALWAYS AS (content_text::jsonb->>'title') STORED,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(review_id,revision_no),
 UNIQUE NULLS NOT DISTINCT(review_id,parent_id),
 CHECK((revision_no=1 AND parent_id IS NULL AND parent_sha256 IS NULL AND reason IS NULL)
    OR (revision_no>1 AND parent_id IS NOT NULL AND parent_sha256 IS NOT NULL AND length(btrim(reason))>0 AND reason IS NOT NULL))
);
ALTER TABLE public.engagement_synthesis_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_synthesis_review_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_synthesis_reviews,public.engagement_synthesis_review_revisions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.engagement_synthesis_reviews,public.engagement_synthesis_review_revisions TO service_role;
CREATE TRIGGER engagement_synthesis_reviews_immutable BEFORE UPDATE OR DELETE ON public.engagement_synthesis_reviews
 FOR EACH ROW EXECUTE FUNCTION public.refuse_engagement_history_change();
CREATE TRIGGER engagement_synthesis_review_revisions_immutable BEFORE UPDATE OR DELETE ON public.engagement_synthesis_review_revisions
 FOR EACH ROW EXECUTE FUNCTION public.refuse_engagement_history_change();

-- Called only from the checked SECURITY DEFINER entry points below.
CREATE FUNCTION public.engagement_synthesis_review_receipt(p_revision uuid,p_replayed boolean)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('requestId',v.id,'reviewId',r.id,'campaignId',r.campaign_id,'workspaceId',r.workspace_id,
  'sourceId',r.source_id,'sourceSha256',r.source_sha256,'preparationSha256',r.preparation_sha256,
  'revisionNo',v.revision_no,'revisionSha256',v.content_sha256,'createdAt',v.created_at,'replayed',p_replayed)
 FROM engagement_synthesis_reviews r JOIN engagement_synthesis_review_revisions v ON v.review_id=r.id WHERE v.id=p_revision;
$$;
REVOKE ALL ON FUNCTION public.engagement_synthesis_review_receipt(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

-- Clients send intent to the authenticated web route, never machine-preparation bytes.
CREATE FUNCTION public.retain_engagement_synthesis_review(p_campaign uuid,p_actor uuid,p_workspace uuid,p_intent jsonb,
 p_source uuid,p_source_sha256 text,p_preparation_text text,p_content_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE workspace uuid; request uuid; review uuid; operation text; saved public.engagement_synthesis_review_revisions;
 root public.engagement_synthesis_reviews; parent public.engagement_synthesis_review_revisions;
 source public.engagement_synthesis_sources; preparation jsonb; content jsonb;
BEGIN
 IF p_actor IS NULL OR p_workspace IS NULL THEN RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE='42501'; END IF;
 SELECT c.workspace_id INTO workspace FROM engagement_campaigns c WHERE c.id=p_campaign FOR SHARE NOWAIT;
 IF NOT FOUND OR workspace IS DISTINCT FROM p_workspace OR NOT EXISTS(SELECT 1 FROM workspace_members m
  WHERE m.workspace_id=workspace AND m.user_id=p_actor AND m.role IN ('owner','admin','member') FOR SHARE NOWAIT) THEN
  RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE='42501';
 END IF;
 IF jsonb_typeof(p_intent) IS DISTINCT FROM 'object' OR p_intent->>'actorId' IS DISTINCT FROM p_actor::text
  OR p_intent->>'workspaceId' IS DISTINCT FROM workspace::text OR p_intent->>'requestId' IS NULL THEN
  RAISE EXCEPTION 'Invalid synthesis review intent' USING ERRCODE='22023';
 END IF;
 operation:=p_intent->>'operation'; request:=(p_intent->>'requestId')::uuid;
 IF operation='create' THEN
  review:=request;
  IF NOT p_intent ?& ARRAY['requestId','actorId','workspaceId','operation','sourceId','sourceSha256']
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_intent) k WHERE k NOT IN ('requestId','actorId','workspaceId','operation','sourceId','sourceSha256'))
   OR p_intent->>'sourceId' IS DISTINCT FROM p_source::text OR p_intent->>'sourceSha256' IS DISTINCT FROM p_source_sha256 THEN
   RAISE EXCEPTION 'Invalid synthesis review creation' USING ERRCODE='22023';
  END IF;
 ELSIF operation='correct' THEN
  review:=(p_intent->>'reviewId')::uuid;
  IF NOT p_intent ?& ARRAY['requestId','actorId','workspaceId','operation','reviewId','expectedRevisionId','expectedRevisionSha256','reason','change']
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_intent) k WHERE k NOT IN ('requestId','actorId','workspaceId','operation','reviewId','expectedRevisionId','expectedRevisionSha256','reason','change'))
   OR review IS NULL OR (p_intent->>'expectedRevisionId') IS NULL OR (p_intent->>'expectedRevisionSha256') IS NULL
   OR jsonb_typeof(p_intent->'reason') IS DISTINCT FROM 'string' OR length(btrim(p_intent->>'reason'))=0
   OR jsonb_typeof(p_intent->'change') IS DISTINCT FROM 'object' THEN
   RAISE EXCEPTION 'Invalid synthesis review correction' USING ERRCODE='22023';
  END IF;
 ELSE RAISE EXCEPTION 'Invalid synthesis review operation' USING ERRCODE='22023';
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('engagement-synthesis-review-request:'||request::text,0))
  OR NOT pg_try_advisory_xact_lock(hashtextextended('engagement-synthesis-review:'||review::text,0)) THEN
  RAISE EXCEPTION 'Review is busy; retry the same request' USING ERRCODE='PT503';
 END IF;
 SELECT * INTO saved FROM engagement_synthesis_review_revisions WHERE id=request;
 IF FOUND THEN
  SELECT * INTO root FROM engagement_synthesis_reviews WHERE id=saved.review_id;
  IF saved.review_id IS DISTINCT FROM review OR saved.actor_id IS DISTINCT FROM p_actor OR saved.intent_json IS DISTINCT FROM p_intent
   OR root.campaign_id IS DISTINCT FROM p_campaign OR root.workspace_id IS DISTINCT FROM workspace
   OR root.source_id IS DISTINCT FROM p_source OR root.source_sha256 IS DISTINCT FROM p_source_sha256 THEN
   RAISE EXCEPTION 'Synthesis review retry differs' USING ERRCODE='PT409';
  END IF;
  RETURN public.engagement_synthesis_review_receipt(request,true);
 END IF;
 SELECT * INTO source FROM engagement_synthesis_sources WHERE id=p_source AND campaign_id=p_campaign AND workspace_id=workspace;
 IF NOT FOUND OR source.snapshot_sha256 IS DISTINCT FROM p_source_sha256 THEN
  RAISE EXCEPTION 'Retained review source differs' USING ERRCODE='PT409';
 END IF;
 IF (p_content_text IS JSON OBJECT) IS NOT TRUE THEN RAISE EXCEPTION 'Invalid review content' USING ERRCODE='22023'; END IF;
 content:=p_content_text::jsonb;
 IF content->>'schemaVersion' IS DISTINCT FROM '1' OR content->>'status' IS DISTINCT FROM 'staff_draft'
  OR content->>'sourceId' IS DISTINCT FROM p_source::text OR content->>'sourceSha256' IS DISTINCT FROM p_source_sha256 THEN
  RAISE EXCEPTION 'Review content source differs' USING ERRCODE='22023';
 END IF;
 IF operation='create' THEN
  IF (p_preparation_text IS JSON OBJECT) IS NOT TRUE THEN RAISE EXCEPTION 'Invalid review preparation' USING ERRCODE='22023'; END IF;
  preparation:=p_preparation_text::jsonb;
  IF preparation->>'algorithmVersion' IS DISTINCT FROM '1' OR preparation->>'interpretation' IS DISTINCT FROM 'not_assessed'
   OR preparation#>>'{source,requestId}' IS DISTINCT FROM p_source::text OR preparation#>>'{source,sha256}' IS DISTINCT FROM p_source_sha256
   OR preparation#>>'{source,campaignId}' IS DISTINCT FROM p_campaign::text OR preparation#>>'{source,workspaceId}' IS DISTINCT FROM workspace::text THEN
   RAISE EXCEPTION 'Review preparation source differs' USING ERRCODE='22023';
  END IF;
  INSERT INTO engagement_synthesis_reviews(id,campaign_id,workspace_id,source_id,source_sha256,actor_id,preparation_text)
   VALUES(review,p_campaign,workspace,p_source,p_source_sha256,p_actor,p_preparation_text);
  INSERT INTO engagement_synthesis_review_revisions(id,review_id,revision_no,actor_id,intent_json,content_text)
   VALUES(request,review,1,p_actor,p_intent,p_content_text);
 ELSE
  SELECT * INTO root FROM engagement_synthesis_reviews WHERE id=review;
  IF NOT FOUND OR root.campaign_id IS DISTINCT FROM p_campaign OR root.workspace_id IS DISTINCT FROM workspace
   OR root.source_id IS DISTINCT FROM p_source OR root.source_sha256 IS DISTINCT FROM p_source_sha256 OR p_preparation_text IS NOT NULL THEN
   RAISE EXCEPTION 'Review context differs' USING ERRCODE='PT409';
  END IF;
  SELECT * INTO parent FROM engagement_synthesis_review_revisions WHERE review_id=review ORDER BY revision_no DESC LIMIT 1;
  IF NOT FOUND OR parent.id::text IS DISTINCT FROM p_intent->>'expectedRevisionId'
   OR parent.content_sha256 IS DISTINCT FROM p_intent->>'expectedRevisionSha256' THEN
   RAISE EXCEPTION 'Review has a newer revision' USING ERRCODE='PT409';
  END IF;
  IF parent.content_text=p_content_text THEN RAISE EXCEPTION 'Review correction changes nothing' USING ERRCODE='22023'; END IF;
  INSERT INTO engagement_synthesis_review_revisions(id,review_id,revision_no,parent_id,parent_sha256,actor_id,intent_json,reason,content_text)
   VALUES(request,review,parent.revision_no+1,parent.id,parent.content_sha256,p_actor,p_intent,p_intent->>'reason',p_content_text);
 END IF;
 RETURN public.engagement_synthesis_review_receipt(request,false);
EXCEPTION WHEN lock_not_available THEN
 RAISE EXCEPTION 'Review is busy; retry the same request' USING ERRCODE='PT503';
END $$;
REVOKE ALL ON FUNCTION public.retain_engagement_synthesis_review(uuid,uuid,uuid,jsonb,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.retain_engagement_synthesis_review(uuid,uuid,uuid,jsonb,uuid,text,text,text) TO service_role;

-- A missing requested revision is null after staff access is checked. This lets
-- exact-request recovery distinguish absent work from an unreadable operation.
CREATE FUNCTION public.read_engagement_synthesis_review(p_campaign uuid,p_review uuid,p_revision uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE workspace uuid; root public.engagement_synthesis_reviews; revision public.engagement_synthesis_review_revisions; head uuid;
BEGIN
 SELECT c.workspace_id INTO workspace FROM engagement_campaigns c JOIN workspace_members m ON m.workspace_id=c.workspace_id
  WHERE c.id=p_campaign AND m.user_id=auth.uid() AND m.role IN ('owner','admin','member') FOR SHARE OF c,m NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE='42501'; END IF;
 SELECT * INTO root FROM engagement_synthesis_reviews WHERE id=p_review AND campaign_id=p_campaign AND workspace_id=workspace;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT id INTO head FROM engagement_synthesis_review_revisions WHERE review_id=p_review ORDER BY revision_no DESC LIMIT 1;
 SELECT * INTO revision FROM engagement_synthesis_review_revisions WHERE review_id=p_review AND id=COALESCE(p_revision,head);
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('reviewId',root.id,'campaignId',root.campaign_id,'workspaceId',root.workspace_id,
  'sourceId',root.source_id,'sourceSha256',root.source_sha256,'preparationText',root.preparation_text,'preparationSha256',root.preparation_sha256,
  'createdAt',root.created_at,'createdBy',root.actor_id,'currentRevisionId',head,
  'revision',jsonb_build_object('requestId',revision.id,'revisionNo',revision.revision_no,'parentId',revision.parent_id,
   'parentSha256',revision.parent_sha256,'actorId',revision.actor_id,'reason',revision.reason,'intent',revision.intent_json,
   'contentText',revision.content_text,'contentSha256',revision.content_sha256,'createdAt',revision.created_at));
END $$;
REVOKE ALL ON FUNCTION public.read_engagement_synthesis_review(uuid,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_engagement_synthesis_review(uuid,uuid,uuid) TO authenticated;

CREATE FUNCTION public.list_engagement_synthesis_reviews(p_campaign uuid,p_source uuid,p_before jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE workspace uuid; before_time timestamptz; before_id uuid; result jsonb;
BEGIN
 SELECT c.workspace_id INTO workspace FROM engagement_campaigns c JOIN workspace_members m ON m.workspace_id=c.workspace_id
  JOIN engagement_synthesis_sources s ON s.campaign_id=c.id AND s.workspace_id=c.workspace_id AND s.id=p_source
  WHERE c.id=p_campaign AND m.user_id=auth.uid() AND m.role IN ('owner','admin','member') FOR SHARE OF c,m NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'Staff source access required' USING ERRCODE='42501'; END IF;
 IF p_before IS NOT NULL THEN
  IF jsonb_typeof(p_before) IS DISTINCT FROM 'object' OR NOT p_before ?& ARRAY['createdAt','id']
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_before) k WHERE k NOT IN ('createdAt','id'))
   OR jsonb_typeof(p_before->'createdAt') IS DISTINCT FROM 'string' OR jsonb_typeof(p_before->'id') IS DISTINCT FROM 'string'
   OR p_before->>'createdAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' THEN
   RAISE EXCEPTION 'Invalid review cursor' USING ERRCODE='22023';
  END IF;
  before_time:=(p_before->>'createdAt')::timestamptz; before_id:=(p_before->>'id')::uuid;
  IF NOT isfinite(before_time) THEN RAISE EXCEPTION 'Invalid review cursor' USING ERRCODE='22023'; END IF;
 END IF;
 WITH page AS MATERIALIZED (
  SELECT r.id,r.created_at,v.revision_no,v.content_sha256,v.content_title title
   FROM engagement_synthesis_reviews r JOIN LATERAL (SELECT * FROM engagement_synthesis_review_revisions
    WHERE review_id=r.id ORDER BY revision_no DESC LIMIT 1) v ON true
   WHERE r.campaign_id=p_campaign AND r.workspace_id=workspace AND r.source_id=p_source
    AND (p_before IS NULL OR (r.created_at,r.id)<(before_time,before_id))
   ORDER BY r.created_at DESC,r.id DESC LIMIT 26
 ), visible AS MATERIALIZED (SELECT * FROM page ORDER BY created_at DESC,id DESC LIMIT 25)
 SELECT jsonb_build_object('campaignId',p_campaign,'workspaceId',workspace,'sourceId',p_source,'pageSize',25,
  'entries',COALESCE((SELECT jsonb_agg(jsonb_build_object('reviewId',v.id,'createdAt',v.created_at,'revisionNo',v.revision_no,
   'revisionSha256',v.content_sha256,'title',v.title) ORDER BY v.created_at DESC,v.id DESC) FROM visible v),'[]'::jsonb),
  'nextCursor',CASE WHEN (SELECT count(*) FROM page)>25 THEN (SELECT jsonb_build_object('createdAt',created_at,'id',id) FROM visible ORDER BY created_at,id LIMIT 1) ELSE NULL END
 ) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.list_engagement_synthesis_reviews(uuid,uuid,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.list_engagement_synthesis_reviews(uuid,uuid,jsonb) TO authenticated;

CREATE FUNCTION public.list_engagement_synthesis_review_revisions(p_campaign uuid,p_review uuid,p_before integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE workspace uuid; result jsonb;
BEGIN
 SELECT r.workspace_id INTO workspace FROM engagement_synthesis_reviews r JOIN engagement_campaigns c ON c.id=r.campaign_id AND c.workspace_id=r.workspace_id
  JOIN workspace_members m ON m.workspace_id=r.workspace_id AND m.user_id=auth.uid() AND m.role IN ('owner','admin','member')
  WHERE r.id=p_review AND r.campaign_id=p_campaign FOR SHARE OF c,m NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'Staff review access required' USING ERRCODE='42501'; END IF;
 IF p_before IS NOT NULL AND p_before<1 THEN RAISE EXCEPTION 'Invalid revision cursor' USING ERRCODE='22023'; END IF;
 WITH page AS MATERIALIZED (
  SELECT * FROM engagement_synthesis_review_revisions WHERE review_id=p_review AND (p_before IS NULL OR revision_no<p_before)
   ORDER BY revision_no DESC LIMIT 26
 ), visible AS MATERIALIZED (SELECT * FROM page ORDER BY revision_no DESC LIMIT 25)
 SELECT jsonb_build_object('campaignId',p_campaign,'workspaceId',workspace,'reviewId',p_review,'pageSize',25,
  'entries',COALESCE((SELECT jsonb_agg(jsonb_build_object('requestId',v.id,'revisionNo',v.revision_no,'parentId',v.parent_id,
    'parentSha256',v.parent_sha256,'revisionSha256',v.content_sha256,'actorId',v.actor_id,'reason',v.reason,'createdAt',v.created_at) ORDER BY v.revision_no DESC) FROM visible v),'[]'::jsonb),
  'nextCursor',CASE WHEN (SELECT count(*) FROM page)>25 THEN (SELECT min(revision_no) FROM visible) ELSE NULL END
 ) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.list_engagement_synthesis_review_revisions(uuid,uuid,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.list_engagement_synthesis_review_revisions(uuid,uuid,integer) TO authenticated;
