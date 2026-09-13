-- Extend the private history read without rewriting retained history or receipts.
-- Each receipt is returned once, including for a batch that changed many fields.
-- One statement and the existing invoker RLS preserve a complete private snapshot.
CREATE OR REPLACE FUNCTION public.read_engagement_translation_history(p_campaign uuid) RETURNS jsonb
 LANGUAGE sql STABLE STRICT SECURITY INVOKER SET search_path=public,pg_temp AS $$
 WITH history AS MATERIALIZED (
  SELECT * FROM public.engagement_translation_history WHERE campaign_id=p_campaign
 ), receipts AS MATERIALIZED (
  SELECT r.* FROM public.engagement_translation_write_receipts r
  WHERE r.campaign_id=p_campaign AND EXISTS(SELECT 1 FROM history h WHERE h.write_request_id=r.request_id)
 )
 SELECT jsonb_build_object('schema',2,'campaignId',p_campaign,
  'count',(SELECT count(*) FROM history),
  'entries',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'id',h.id,'campaign_id',h.campaign_id,'translation_id',h.translation_id,'revision',h.revision,
   'actor_id',h.actor_id,'recorded_at',h.recorded_at,'event',h.event,'write_request_id',h.write_request_id,
   'record_text',h.record_json::text,'record_sha256',h.record_sha256
  ) ORDER BY h.translation_id,h.revision),'[]'::jsonb) FROM history h),
  'receiptCount',(SELECT count(*) FROM receipts),
  'receipts',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'request_id',r.request_id,'actor_id',r.actor_id,
   'payload_text',r.payload::text,'payload_sha256',r.payload_sha256,
   'result_text',r.result_json::text,'result_sha256',r.result_sha256
  ) ORDER BY r.request_id),'[]'::jsonb) FROM receipts r));
$$;
REVOKE ALL ON FUNCTION public.read_engagement_translation_history(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_engagement_translation_history(uuid) TO authenticated;
