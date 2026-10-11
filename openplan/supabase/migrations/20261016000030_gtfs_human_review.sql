BEGIN;

-- Human review reads and adoption share the original completion and exact
-- predecessor checks. Read locks serialize counts with an adoption transaction.
CREATE FUNCTION public.read_gtfs_adoption_review(p_workspace uuid,p_version uuid,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE feed public.gtfs_feeds%ROWTYPE; incoming public.gtfs_feed_versions%ROWTYPE;
 previous public.gtfs_feed_versions%ROWTYPE; target_feed uuid; basis jsonb; shrinks boolean;
BEGIN
 PERFORM 1 FROM public.workspace_members WHERE workspace_id=p_workspace AND user_id=p_actor FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'GTFS review read access is unavailable' USING ERRCODE='42501'; END IF;
 SELECT feed_id INTO target_feed FROM public.gtfs_feed_versions WHERE id=p_version AND workspace_id=p_workspace;
 IF NOT FOUND THEN RAISE EXCEPTION 'GTFS review version is unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO feed FROM public.gtfs_feeds WHERE id=target_feed AND workspace_id=p_workspace FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'GTFS review feed is unavailable' USING ERRCODE='42501'; END IF;
 PERFORM v.id FROM public.gtfs_feed_versions v WHERE v.id IN (p_version,feed.current_version_id) ORDER BY v.id FOR SHARE;
 SELECT * INTO incoming FROM public.gtfs_feed_versions WHERE id=p_version AND feed_id=feed.id AND workspace_id=p_workspace;
 IF NOT FOUND OR incoming.status IS DISTINCT FROM 'ready' OR incoming.ingest_closed_at IS NOT NULL OR incoming.ingest_abandoned_at IS NOT NULL
  OR incoming.route_count IS NULL OR incoming.stop_count IS NULL THEN
  RAISE EXCEPTION 'GTFS review requires a ready version' USING ERRCODE='55000'; END IF;
 IF NOT EXISTS(SELECT 1 FROM openplan_gtfs.executions j JOIN openplan_gtfs.completion_receipts c ON c.version_id=j.version_id
  WHERE j.version_id=p_version AND j.state='ready') THEN
  RAISE EXCEPTION 'Managed GTFS review requires its completion receipt' USING ERRCODE='55000'; END IF;
 SELECT * INTO previous FROM public.gtfs_feed_versions WHERE id=feed.current_version_id;
 IF (feed.current_version_id IS NOT NULL AND (previous.id IS NULL OR previous.feed_id IS DISTINCT FROM feed.id
   OR previous.workspace_id IS DISTINCT FROM p_workspace OR previous.status IS DISTINCT FROM 'ready'
   OR previous.is_current IS DISTINCT FROM true OR feed.status IS DISTINCT FROM previous.status
   OR previous.route_count IS NULL OR previous.stop_count IS NULL))
  OR (feed.current_version_id IS NULL AND EXISTS(SELECT 1 FROM public.gtfs_feed_versions WHERE feed_id=feed.id AND is_current)) THEN
  RAISE EXCEPTION 'GTFS current review evidence is inconsistent' USING ERRCODE='55000'; END IF;
 basis:=jsonb_build_object('feedId',feed.id,'versionId',incoming.id,'routeCount',incoming.route_count,'stopCount',incoming.stop_count,
  'previousVersionId',previous.id,'previousRouteCount',previous.route_count,'previousStopCount',previous.stop_count);
 shrinks:=previous.id IS NOT NULL AND ((previous.route_count>0 AND incoming.route_count<previous.route_count*0.8)
  OR (previous.stop_count>0 AND incoming.stop_count<previous.stop_count*0.8));
 RETURN jsonb_build_object('basis',basis,'materialShrinkage',shrinks,'isCurrent',incoming.is_current);
END $$;
REVOKE ALL ON FUNCTION public.read_gtfs_adoption_review(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_gtfs_adoption_review(uuid,uuid,uuid) TO service_role;

-- The human command binds every reviewed count and the current predecessor.
-- Only a matching SQL receipt permits replay after the reviewed state changes.
CREATE FUNCTION public.adopt_reviewed_gtfs_ingest(p_workspace uuid,p_version uuid,p_command uuid,p_actor uuid,p_basis jsonb,p_accept_shrinkage boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE review jsonb; saved openplan_gtfs.adoption_receipts%ROWTYPE; expected jsonb; payload_hash text; target_feed uuid;
BEGIN
 IF p_workspace IS NULL OR p_version IS NULL OR p_command IS NULL OR p_actor IS NULL OR p_basis IS NULL OR p_accept_shrinkage IS NULL THEN
  RAISE EXCEPTION 'GTFS reviewed adoption requires complete identity' USING ERRCODE='22023'; END IF;
 IF openplan_gtfs.actor_can_write(p_workspace,p_actor) IS NOT TRUE THEN
  RAISE EXCEPTION 'GTFS reviewed adoption write access is unavailable' USING ERRCODE='42501'; END IF;
 -- The existing receipt hash includes the exact reviewed basis. A separate
 -- response marker retains human shrinkage acceptance, so changing that choice
 -- cannot be mistaken for the original command on replay.
 expected:=jsonb_build_object('acceptMaterialShrinkage',true,'basis',p_basis);
 payload_hash:=encode(extensions.digest(jsonb_build_object('workspace',p_workspace,'version',p_version,'actor',p_actor,'review',expected)::text,'sha256'),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('gtfs-adoption:'||p_command::text,0));
 SELECT * INTO saved FROM openplan_gtfs.adoption_receipts WHERE command_id=p_command;
 IF FOUND THEN
  IF saved.payload_hash IS DISTINCT FROM payload_hash OR (saved.response->>'humanAcceptShrinkage')::boolean IS DISTINCT FROM p_accept_shrinkage THEN
   RAISE EXCEPTION 'GTFS reviewed adoption command changed' USING ERRCODE='22023'; END IF;
  RETURN saved.response;
 END IF;
 SELECT feed_id INTO target_feed FROM public.gtfs_feed_versions WHERE id=p_version AND workspace_id=p_workspace;
 IF NOT FOUND THEN RAISE EXCEPTION 'GTFS reviewed version is unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.gtfs_feeds WHERE id=target_feed AND workspace_id=p_workspace FOR UPDATE;
 review:=public.read_gtfs_adoption_review(p_workspace,p_version,p_actor);
 IF review->'basis' IS DISTINCT FROM p_basis THEN RAISE EXCEPTION 'GTFS reviewed counts or predecessor changed' USING ERRCODE='22023'; END IF;
 IF (review->>'materialShrinkage')::boolean AND p_accept_shrinkage IS NOT TRUE THEN
  RAISE EXCEPTION 'GTFS material shrinkage requires human acceptance' USING ERRCODE='22023'; END IF;
 review:=public.adopt_gtfs_ingest(p_workspace,p_version,p_command,p_actor,expected)||jsonb_build_object('humanAcceptShrinkage',p_accept_shrinkage);
 UPDATE openplan_gtfs.adoption_receipts SET response=review WHERE command_id=p_command;
 RETURN review;
END $$;
REVOKE ALL ON FUNCTION public.adopt_reviewed_gtfs_ingest(uuid,uuid,uuid,uuid,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.adopt_reviewed_gtfs_ingest(uuid,uuid,uuid,uuid,jsonb,boolean) TO service_role;

COMMIT;
