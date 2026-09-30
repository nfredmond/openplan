-- Historical inspection belongs to current campaign staff. It does not renew
-- the original requester's execution permission or change result choices.
CREATE FUNCTION public.read_engagement_synthesis_generation_selection_history(
 p_campaign uuid,p_request uuid,p_through_sequence bigint DEFAULT NULL,
 p_after_task_index bigint DEFAULT -1,p_limit integer DEFAULT 128)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE workspace uuid; saved public.engagement_synthesis_generation_requests;
 sequence bigint; through_sequence bigint; entries jsonb;
BEGIN
 workspace:=lock_synthesis_generation_request_scope(p_campaign,p_request);
 SELECT * INTO saved FROM engagement_synthesis_generation_requests
  WHERE id=p_request AND campaign_id=p_campaign AND workspace_id=workspace;
 IF saved.id IS NULL THEN RAISE EXCEPTION 'Synthesis history not accessible' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(sequence_no),0) INTO sequence FROM engagement_synthesis_generation_selections WHERE request_id=p_request;
 through_sequence:=coalesce(p_through_sequence,sequence);
 IF through_sequence NOT BETWEEN 0 AND sequence OR p_after_task_index IS NULL
 OR p_after_task_index NOT BETWEEN -1 AND 9007199254740991 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 128 THEN
  RAISE EXCEPTION 'Invalid synthesis history cursor' USING ERRCODE='22023';
 END IF;
 SELECT coalesce(jsonb_agg(row.value ORDER BY row.task_index),'[]'::jsonb) INTO entries FROM (
  SELECT s.task_index,jsonb_build_object('receiptText',s.receipt_text,'receiptSha256',s.receipt_sha256) AS value
  FROM engagement_synthesis_generation_selections s WHERE s.request_id=p_request AND s.task_index>p_after_task_index AND s.sequence_no<=through_sequence
   AND NOT EXISTS(SELECT 1 FROM engagement_synthesis_generation_selections n WHERE n.previous_selection_id=s.id AND n.sequence_no<=through_sequence)
  ORDER BY s.task_index LIMIT p_limit+1
 ) row;
 RETURN jsonb_build_object('schemaVersion',1,'requestId',p_request,'throughSequence',through_sequence,'afterTaskIndex',p_after_task_index,
  'hasMore',jsonb_array_length(entries)>p_limit,'entries',CASE WHEN jsonb_array_length(entries)>p_limit THEN entries-p_limit ELSE entries END);
END $$;
REVOKE ALL ON FUNCTION public.read_engagement_synthesis_generation_selection_history(uuid,uuid,bigint,bigint,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_engagement_synthesis_generation_selection_history(uuid,uuid,bigint,bigint,integer) TO authenticated;
