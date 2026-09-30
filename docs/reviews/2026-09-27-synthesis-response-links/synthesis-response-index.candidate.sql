-- Private navigation metadata. Read the verified event history before describing or changing a link.
CREATE FUNCTION public.list_engagement_synthesis_response_links(p_campaign uuid,p_review uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE workspace uuid; result jsonb;
BEGIN
 SELECT c.workspace_id INTO workspace FROM engagement_campaigns c JOIN workspace_members m ON m.workspace_id=c.workspace_id
  WHERE c.id=p_campaign AND m.user_id=auth.uid() AND m.role IN ('owner','admin','member') FOR SHARE OF c,m NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM engagement_synthesis_reviews r WHERE r.id=p_review AND r.campaign_id=p_campaign AND r.workspace_id=workspace) THEN RETURN NULL; END IF;
 WITH addresses AS MATERIALIZED (
  SELECT DISTINCT e.response_id,e.group_id FROM engagement_synthesis_response_events e
  WHERE e.campaign_id=p_campaign AND e.workspace_id=workspace AND e.review_id=p_review
 )
 SELECT jsonb_build_object('campaignId',p_campaign,'workspaceId',workspace,'reviewId',p_review,
  'entryCount',(SELECT count(*) FROM addresses),
  'entries',COALESCE((SELECT jsonb_agg(jsonb_build_object('responseId',response_id,'groupId',group_id)
   ORDER BY response_id,group_id COLLATE "C") FROM addresses),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.list_engagement_synthesis_response_links(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.list_engagement_synthesis_response_links(uuid,uuid) TO authenticated;
