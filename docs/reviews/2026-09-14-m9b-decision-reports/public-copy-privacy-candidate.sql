-- Honor explicit private metadata independently of review status.
-- Approval can concern a staff record; a private marker is not publication consent.
CREATE OR REPLACE FUNCTION public.engagement_item_public_copy_allowed(p_status text,p_metadata jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path=public,pg_temp AS $$
 -- Match JavaScript metadataString.trim(), including Unicode whitespace.
 WITH whitespace(chars) AS (VALUES (
 chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||
 chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||
 chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||
 chr(8287)||chr(12288)||chr(65279)))
 SELECT coalesce(p_status='approved'
  AND lower(btrim(coalesce(p_metadata->>'visibility',''),chars)) <> 'private'
  AND lower(btrim(coalesce(p_metadata->>'private_note',''),chars)) <> 'true'
  AND lower(btrim(coalesce(p_metadata->>'internal_note',''),chars)) <> 'true',false)
 FROM whitespace
$$;
REVOKE ALL ON FUNCTION public.engagement_item_public_copy_allowed(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.engagement_item_public_copy_allowed(text,jsonb) TO authenticated,service_role;

-- Server callers still establish active campaign/share-token access. This view
-- exposes only reviewed public copies and their reviewed root parents.
CREATE VIEW public.engagement_public_items WITH (security_barrier=true,security_invoker=true) AS
 SELECT i.id,i.campaign_id,i.configuration_version_id,i.category_id,i.title,i.body,
  i.submitted_by,i.latitude,i.longitude,i.geometry,i.photo_path,i.votes_count,
  i.parent_item_id,i.created_at,i.status
 FROM public.engagement_items i
 WHERE public.engagement_item_public_copy_allowed(i.status,i.metadata_json)
  AND (i.parent_item_id IS NULL OR EXISTS (
   SELECT 1 FROM public.engagement_items parent WHERE parent.id=i.parent_item_id
    AND parent.campaign_id=i.campaign_id AND parent.parent_item_id IS NULL
    AND public.engagement_item_public_copy_allowed(parent.status,parent.metadata_json)));
REVOKE ALL ON public.engagement_public_items FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.engagement_public_items TO service_role;

CREATE OR REPLACE FUNCTION public.lock_public_translation_source(p_campaign uuid, p_share_hash text, p_item uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE campaign public.engagement_campaigns; item public.engagement_items;
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('engagement-response:'||p_campaign::text,0)) THEN
  RAISE EXCEPTION 'Public translation source is busy' USING ERRCODE='PT503';
 END IF;
 SELECT * INTO campaign FROM engagement_campaigns WHERE id=p_campaign AND status='active'
  AND encode(extensions.digest(share_token,'sha256'),'hex')=p_share_hash FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'Public translation is unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO item FROM engagement_items WHERE id=p_item AND campaign_id=campaign.id AND public.engagement_item_public_copy_allowed(status,metadata_json) FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'Public translation is unavailable' USING ERRCODE='42501'; END IF;
 IF item.parent_item_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM engagement_items WHERE id=item.parent_item_id
  AND campaign_id=campaign.id AND public.engagement_item_public_copy_allowed(status,metadata_json) AND parent_item_id IS NULL FOR SHARE NOWAIT) THEN
  RAISE EXCEPTION 'Public translation is unavailable' USING ERRCODE='42501';
 END IF;
 RETURN jsonb_build_object('workspaceId',campaign.workspace_id,'campaignId',campaign.id,'itemId',item.id,'title',item.title,'body',item.body);
EXCEPTION WHEN lock_not_available OR deadlock_detected THEN RAISE EXCEPTION 'Public translation source is busy' USING ERRCODE='PT503';
END $function$;


CREATE OR REPLACE FUNCTION public.guard_engagement_response_publication()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 IF NEW.status='published' AND EXISTS(SELECT 1 FROM unnest(NEW.source_item_ids) source_id WHERE NOT EXISTS(
  SELECT 1 FROM engagement_items i WHERE i.id=source_id AND i.campaign_id=NEW.campaign_id AND public.engagement_item_public_copy_allowed(i.status,i.metadata_json)
    AND (i.parent_item_id IS NULL OR EXISTS(SELECT 1 FROM engagement_items p WHERE p.id=i.parent_item_id AND p.campaign_id=NEW.campaign_id AND public.engagement_item_public_copy_allowed(p.status,p.metadata_json) AND p.parent_item_id IS NULL))
 )) THEN RAISE EXCEPTION 'Review and publish linked contributions before publishing the staff response'; END IF;
 RETURN NEW;
END $function$;


CREATE OR REPLACE FUNCTION public.require_engagement_review_intent()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 IF TG_OP='UPDATE' AND (ROW(NEW.title,NEW.body,NEW.submitted_by,NEW.status,NEW.photo_path,NEW.geometry,NEW.latitude,NEW.longitude,NEW.category_id,NEW.source_type)
 IS DISTINCT FROM ROW(OLD.title,OLD.body,OLD.submitted_by,OLD.status,OLD.photo_path,OLD.geometry,OLD.latitude,OLD.longitude,OLD.category_id,OLD.source_type) OR ROW(NEW.metadata_json->'private_note',NEW.metadata_json->'internal_note',NEW.metadata_json->'visibility') IS DISTINCT FROM ROW(OLD.metadata_json->'private_note',OLD.metadata_json->'internal_note',OLD.metadata_json->'visibility')) THEN
  IF NEW.review_expected_updated_at IS DISTINCT FROM OLD.updated_at THEN
   RAISE EXCEPTION 'Contribution changed or review version missing' USING ERRCODE='PT409';
  END IF;
  IF NULLIF(btrim(NEW.review_reason),'') IS NULL THEN
   RAISE EXCEPTION 'A fresh human review reason is required';
  END IF;
  NEW.moderation_notes=NEW.review_reason;
 END IF;
 NEW.review_expected_updated_at=NULL;
 NEW.review_reason=NULL;
 RETURN NEW;
END $function$;


CREATE OR REPLACE FUNCTION public.guard_engagement_public_copy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE c record;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.source_type='public' THEN
      SELECT * INTO c FROM engagement_campaigns WHERE id=NEW.campaign_id FOR SHARE;
      IF c.status <> 'active' OR NOT c.allow_public_submissions OR c.submissions_closed_at IS NOT NULL
        OR c.participation_starts_at > clock_timestamp() OR c.participation_ends_at <= clock_timestamp() THEN
        RAISE EXCEPTION 'Campaign is not accepting contributions';
      END IF;
      IF NEW.configuration_version_id IS NOT NULL AND NEW.configuration_version_id IS DISTINCT FROM c.configuration_version_id THEN
        RAISE EXCEPTION 'Campaign configuration changed; review it before submitting';
      END IF;
      IF NEW.parent_item_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.engagement_items parent WHERE parent.id=NEW.parent_item_id
          AND parent.campaign_id=NEW.campaign_id AND parent.parent_item_id IS NULL
          AND public.engagement_item_public_copy_allowed(parent.status,parent.metadata_json)
          FOR SHARE
      ) THEN RAISE EXCEPTION 'Reply target is unavailable' USING ERRCODE='PT409'; END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.parent_item_id IS DISTINCT FROM OLD.parent_item_id OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id OR NEW.configuration_version_id IS DISTINCT FROM OLD.configuration_version_id
    OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.request_sha256 IS DISTINCT FROM OLD.request_sha256 THEN
    RAISE EXCEPTION 'Contribution identity and historical configuration are immutable';
  END IF;
  IF ROW(NEW.title,NEW.body,NEW.submitted_by,NEW.status,NEW.photo_path,NEW.geometry,NEW.latitude,NEW.longitude,NEW.category_id,NEW.source_type) IS DISTINCT FROM ROW(OLD.title,OLD.body,OLD.submitted_by,OLD.status,OLD.photo_path,OLD.geometry,OLD.latitude,OLD.longitude,OLD.category_id,OLD.source_type) OR ROW(NEW.metadata_json->'private_note',NEW.metadata_json->'internal_note',NEW.metadata_json->'visibility') IS DISTINCT FROM ROW(OLD.metadata_json->'private_note',OLD.metadata_json->'internal_note',OLD.metadata_json->'visibility') THEN
    IF NULLIF(btrim(NEW.moderation_notes),'') IS NULL THEN RAISE EXCEPTION 'A human review reason is required'; END IF;
    NEW.updated_at=clock_timestamp();
    NEW.metadata_json=NEW.metadata_json-'ai_translations';
    PERFORM public.withdraw_engagement_source_responses(NEW.campaign_id, NEW.id, to_jsonb(OLD), to_jsonb(NEW));
    UPDATE engagement_campaigns SET ai_synthesis_json=NULL,ai_synthesized_at=NULL WHERE id=NEW.campaign_id;
  END IF;
  RETURN NEW;
END $function$;


CREATE OR REPLACE FUNCTION public.retain_engagement_item_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO engagement_item_history(campaign_id,item_id,actor_id,event,reason,record_json)
      VALUES(NEW.campaign_id,NEW.id,auth.uid(),'received',NULL,to_jsonb(NEW));
  ELSIF (to_jsonb(NEW)-ARRAY['updated_at','votes_count','metadata_json']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['updated_at','votes_count','metadata_json']) OR ROW(NEW.metadata_json->'private_note',NEW.metadata_json->'internal_note',NEW.metadata_json->'visibility') IS DISTINCT FROM ROW(OLD.metadata_json->'private_note',OLD.metadata_json->'internal_note',OLD.metadata_json->'visibility') THEN
    IF NOT EXISTS (SELECT 1 FROM engagement_item_history WHERE item_id=OLD.id) THEN
      INSERT INTO engagement_item_history(campaign_id,item_id,actor_id,event,record_json)
        VALUES(OLD.campaign_id,OLD.id,NULL,'legacy_before_edit',to_jsonb(OLD));
    END IF;
    INSERT INTO engagement_item_history(campaign_id,item_id,actor_id,event,reason,record_json)
      VALUES(NEW.campaign_id,NEW.id,auth.uid(),'reviewed',NEW.moderation_notes,to_jsonb(NEW));
  END IF;
  RETURN NEW;
END $function$;


CREATE OR REPLACE FUNCTION public.read_engagement_response_snapshot(p_campaign uuid, p_published_only boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE STRICT
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'campaignId', p_campaign,
    'publishedOnly', p_published_only,
    'count', count(*),
    'entries', COALESCE(
      jsonb_agg(to_jsonb(entry) ORDER BY entry.sort_order, entry.created_at, entry.id),
      '[]'::jsonb
    )
  )
  FROM (
    SELECT id, campaign_id, category_id, theme_title, you_said, we_did,
      status, ai_assisted, source_item_ids, sort_order, published_at,
      created_at, updated_at
    FROM public.engagement_closeloop_entries
    WHERE campaign_id = p_campaign
      AND (NOT p_published_only OR (status = 'published' AND NOT EXISTS (
        SELECT 1 FROM unnest(source_item_ids) source_id WHERE NOT EXISTS (
          SELECT 1 FROM public.engagement_items item WHERE item.id=source_id AND item.campaign_id=p_campaign
            AND public.engagement_item_public_copy_allowed(item.status,item.metadata_json)
            AND (item.parent_item_id IS NULL OR EXISTS (
              SELECT 1 FROM public.engagement_items parent WHERE parent.id=item.parent_item_id
                AND parent.campaign_id=p_campaign AND parent.parent_item_id IS NULL
                AND public.engagement_item_public_copy_allowed(parent.status,parent.metadata_json)
            ))
        )
      )))
  ) entry;
$function$;


CREATE OR REPLACE FUNCTION public.engagement_cache_item_translation(p_item_id uuid, p_language text, p_translation text)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  UPDATE engagement_items
  SET metadata_json =
        coalesce(metadata_json, '{}'::jsonb)
        || jsonb_build_object(
             'ai_translations',
             coalesce(metadata_json -> 'ai_translations', '{}'::jsonb)
               || jsonb_build_object(p_language, p_translation)
           )
  WHERE id = p_item_id
    AND public.engagement_item_public_copy_allowed(status,metadata_json)
    AND (parent_item_id IS NULL OR EXISTS (
      SELECT 1 FROM public.engagement_items parent WHERE parent.id=engagement_items.parent_item_id
        AND parent.campaign_id=engagement_items.campaign_id AND parent.parent_item_id IS NULL
        AND public.engagement_item_public_copy_allowed(parent.status,parent.metadata_json)));
$function$;


CREATE OR REPLACE FUNCTION public.engagement_cache_reviewed_translation(p_item_id uuid, p_language text, p_translation text, p_title text, p_body text, p_source_hash text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE n integer;
BEGIN
  UPDATE engagement_items SET metadata_json=jsonb_set(metadata_json,'{ai_translations}',
    COALESCE(metadata_json->'ai_translations','{}'::jsonb)||jsonb_build_object(p_language,jsonb_build_object('text',p_translation,'sourceHash',p_source_hash)))
  WHERE id=p_item_id AND public.engagement_item_public_copy_allowed(status,metadata_json)
    AND (parent_item_id IS NULL OR EXISTS (
      SELECT 1 FROM public.engagement_items parent WHERE parent.id=engagement_items.parent_item_id
        AND parent.campaign_id=engagement_items.campaign_id AND parent.parent_item_id IS NULL
        AND public.engagement_item_public_copy_allowed(parent.status,parent.metadata_json))) AND title IS NOT DISTINCT FROM p_title AND body=p_body;
  GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
END $function$;


CREATE OR REPLACE FUNCTION public.queue_engagement_report(p_campaign uuid,p_request uuid,p_scope text,p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE c record; r uuid; j engagement_report_jobs; snap text; cats uuid[]; state_filter text; after_date timestamptz; before_date timestamptz;
BEGIN
 SELECT * INTO c FROM engagement_campaigns WHERE id=p_campaign FOR UPDATE;
 IF c.id IS NULL OR NOT EXISTS(SELECT 1 FROM workspace_members m WHERE m.workspace_id=c.workspace_id AND m.user_id=auth.uid() AND m.role IN ('owner','admin','member')) THEN RAISE EXCEPTION 'Engagement write access required'; END IF;
 IF p_scope NOT IN ('public','internal') THEN RAISE EXCEPTION 'Choose public or internal scope'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_filters) k WHERE k NOT IN ('categoryIds','status','from','to')) THEN RAISE EXCEPTION 'Unknown export filter'; END IF;
 SELECT * INTO j FROM engagement_report_jobs WHERE campaign_id=p_campaign AND request_id=p_request;
 IF FOUND THEN
  IF j.scope<>p_scope OR j.filters_json<>p_filters THEN RAISE EXCEPTION 'Request identifier belongs to different export filters'; END IF;
  RETURN jsonb_build_object('jobId',j.id,'reportId',j.report_id,'snapshotSha256',j.snapshot_sha256);
 END IF;
 SELECT array_agg(value::uuid) INTO cats FROM jsonb_array_elements_text(COALESCE(p_filters->'categoryIds','[]'::jsonb));
 state_filter=NULLIF(p_filters->>'status',''); after_date=(p_filters->>'from')::timestamptz; before_date=(p_filters->>'to')::timestamptz;
 IF state_filter IS NOT NULL AND state_filter NOT IN ('pending','approved','rejected','flagged') THEN RAISE EXCEPTION 'Unknown review state'; END IF;
 IF p_scope='public' AND state_filter IS NOT NULL AND state_filter<>'approved' THEN RAISE EXCEPTION 'Public reports contain only published contributions'; END IF;
 IF after_date IS NOT NULL AND before_date IS NOT NULL AND before_date<=after_date THEN RAISE EXCEPTION 'End must follow start'; END IF;
 -- One SQL statement observes one database snapshot for contributions, definitions,
 -- surveys, answers and reviewed follow-through. No offset scan of changing records.
 WITH selected_items AS (
  SELECT i.* FROM engagement_items i WHERE i.campaign_id=p_campaign
   AND (p_scope='internal' OR (public.engagement_item_public_copy_allowed(i.status,i.metadata_json) AND (i.parent_item_id IS NULL OR EXISTS(SELECT 1 FROM engagement_items parent WHERE parent.id=i.parent_item_id AND parent.campaign_id=p_campaign AND public.engagement_item_public_copy_allowed(parent.status,parent.metadata_json) AND parent.parent_item_id IS NULL))))
   AND (state_filter IS NULL OR i.status=state_filter) AND (cats IS NULL OR i.category_id=ANY(cats))
   AND (after_date IS NULL OR i.created_at>=after_date) AND (before_date IS NULL OR i.created_at<before_date)
 ), sessions AS (
  SELECT s.* FROM engagement_survey_response_sessions s WHERE s.campaign_id=p_campaign
   AND (p_scope='internal' OR s.status='approved') AND (state_filter IS NULL OR s.status=state_filter)
   AND (after_date IS NULL OR s.created_at>=after_date) AND (before_date IS NULL OR s.created_at<before_date)
 ), answers AS (
  SELECT a.* FROM engagement_survey_answers a JOIN sessions s ON s.id=a.session_id
  WHERE cats IS NULL OR EXISTS(SELECT 1 FROM engagement_configuration_versions v CROSS JOIN LATERAL jsonb_array_elements(v.definition_json->'questions') q WHERE v.id=s.configuration_version_id AND q->>'id'=a.question_id::text AND (q->>'category_id')::uuid=ANY(cats))
 )
 SELECT jsonb_build_object('schema',1,'capturedAt',clock_timestamp(),'scope',p_scope,'filters',p_filters,
  'campaign',jsonb_build_object('id',c.id,'title',c.title,'summary',c.summary,'projectId',c.project_id,'configurationVersionId',c.configuration_version_id),
  'items',COALESCE((SELECT jsonb_agg((to_jsonb(i)-ARRAY['metadata_json','request_id','request_sha256','created_by']) - CASE WHEN p_scope='public' THEN ARRAY['moderation_notes'] ELSE ARRAY[]::text[] END ORDER BY i.created_at,i.id) FROM selected_items i),'[]'::jsonb),
  'sessions',COALESCE((SELECT jsonb_agg(to_jsonb(s)-ARRAY['metadata_json','respondent_fingerprint','created_by','request_id','request_sha256'] - CASE WHEN p_scope='public' THEN ARRAY['moderation_notes','submitted_by'] ELSE ARRAY[]::text[] END ORDER BY s.created_at,s.id) FROM sessions s),'[]'::jsonb),
  'answers',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.session_id,a.id) FROM answers a),'[]'::jsonb),
  'definitions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',v.id,'sha256',v.definition_sha256,'definition',v.definition_json) ORDER BY v.created_at,v.id) FROM engagement_configuration_versions v WHERE v.campaign_id=p_campaign AND (v.id=c.configuration_version_id OR v.id IN(SELECT configuration_version_id FROM selected_items UNION SELECT configuration_version_id FROM sessions))),'[]'::jsonb),
  'responses',COALESCE((SELECT jsonb_agg(to_jsonb(e)-ARRAY['created_by','updated_by'] ORDER BY e.sort_order,e.id) FROM engagement_closeloop_entries e WHERE e.campaign_id=p_campaign AND e.status='published'
    AND NOT EXISTS(SELECT 1 FROM unnest(e.source_item_ids) source_id WHERE NOT EXISTS(SELECT 1 FROM selected_items i WHERE i.id=source_id))),'[]'::jsonb)
 )::text INTO snap;
 INSERT INTO reports(workspace_id,engagement_campaign_id,title,report_type,status,created_by)
 VALUES(c.workspace_id,c.id,c.title||' - engagement review','board_packet','draft',auth.uid()) RETURNING id INTO r;
 INSERT INTO engagement_report_jobs(workspace_id,campaign_id,report_id,requested_by,request_id,scope,filters_json,snapshot_text,snapshot_sha256)
 VALUES(c.workspace_id,c.id,r,auth.uid(),p_request,p_scope,p_filters,snap,encode(digest(snap,'sha256'),'hex')) RETURNING * INTO j;
 RETURN jsonb_build_object('jobId',j.id,'reportId',j.report_id,'snapshotSha256',j.snapshot_sha256);
END $$;
REVOKE ALL ON FUNCTION public.queue_engagement_report(uuid,uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.queue_engagement_report(uuid,uuid,text,jsonb) TO authenticated;

-- Recheck at the write, after any concurrent privacy edit has committed.
CREATE OR REPLACE FUNCTION public.guard_engagement_public_vote() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE item public.engagement_items;
BEGIN
 SELECT * INTO item FROM public.engagement_items WHERE id=NEW.item_id AND campaign_id=NEW.campaign_id
   AND public.engagement_item_public_copy_allowed(status,metadata_json) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Feedback item is unavailable' USING ERRCODE='PT409'; END IF;
 IF item.parent_item_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM public.engagement_items parent WHERE parent.id=item.parent_item_id
     AND parent.campaign_id=NEW.campaign_id AND parent.parent_item_id IS NULL
     AND public.engagement_item_public_copy_allowed(parent.status,parent.metadata_json) FOR SHARE
 ) THEN RAISE EXCEPTION 'Feedback item is unavailable' USING ERRCODE='PT409'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_engagement_public_vote() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER engagement_public_vote_guard BEFORE INSERT ON public.engagement_item_votes
 FOR EACH ROW EXECUTE FUNCTION public.guard_engagement_public_vote();
