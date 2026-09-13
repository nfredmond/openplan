-- Complete staff-only campaign outcomes. Durable attempt state overrides the
-- legacy outbox status; a message is counted once and queued publications remain
-- visible before their recipient messages exist. No participant strings leave.
CREATE FUNCTION public.read_engagement_email_delivery_summary(p_campaign uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb; broadcasts jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM engagement_campaigns c JOIN workspace_members m ON m.workspace_id=c.workspace_id
    WHERE c.id=p_campaign AND m.user_id=auth.uid() AND m.role IN ('owner','admin','member')) THEN
    RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE='42501';
  END IF;
  WITH outcomes AS (
    SELECT CASE WHEN m.state='accepted' THEN 'sent' ELSE COALESCE(m.state,o.status) END AS state,
      COALESCE(m.transport,o.transport) AS transport,o.created_at
    FROM engagement_email_outbox o
    LEFT JOIN engagement_response_broadcast_messages m ON m.outbox_id=o.id AND m.campaign_id=o.campaign_id
    WHERE o.campaign_id=p_campaign
  )
  SELECT jsonb_build_object('ok',true,'campaignId',p_campaign,'total',count(*),
    'counts',jsonb_build_object(
      'queued',count(*) FILTER(WHERE state='queued'),
      'sent',count(*) FILTER(WHERE state='sent'),
      'skipped',count(*) FILTER(WHERE state='skipped'),
      'failed',count(*) FILTER(WHERE state='failed'),
      'attempting',count(*) FILTER(WHERE state='attempting'),
      'uncertain',count(*) FILTER(WHERE state='uncertain'),
      'cancelled',count(*) FILTER(WHERE state='cancelled')),
    'lastRecordedAt',max(created_at),
    'lastFailure',CASE WHEN count(*) FILTER(WHERE state='failed')>0 THEN jsonb_build_object(
      'at',max(created_at) FILTER(WHERE state='failed'),
      'message','A delivery failure was recorded. This does not establish whether the message reached an inbox.') ELSE NULL END,
    'transports',COALESCE(jsonb_agg(DISTINCT CASE WHEN transport IN ('none','resend') THEN transport ELSE 'other' END)
      FILTER(WHERE transport IS NOT NULL),'[]'::jsonb))
  INTO result FROM outcomes;
  SELECT jsonb_build_object('queued',count(*) FILTER(WHERE state='queued'),
    'prepared',count(*) FILTER(WHERE state='prepared'),
    'cancelled',count(*) FILTER(WHERE state='cancelled'),
    'noShareToken',count(*) FILTER(WHERE state='no_share_token')) INTO broadcasts
    FROM engagement_response_broadcasts WHERE campaign_id=p_campaign;
  RETURN result || jsonb_build_object('broadcasts',broadcasts);
END $$;
REVOKE ALL ON FUNCTION public.read_engagement_email_delivery_summary(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_engagement_email_delivery_summary(uuid) TO authenticated;
