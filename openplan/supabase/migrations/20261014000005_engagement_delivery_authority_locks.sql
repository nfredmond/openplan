-- Serialize a delivery claim with subscription withdrawal and campaign closure.
-- A committed claim may already be in flight; an earlier authority change must
-- complete before a claim can release its retained message to the worker.

CREATE OR REPLACE FUNCTION public.claim_engagement_response_email(p_attempt uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE message engagement_response_broadcast_messages%ROWTYPE; job engagement_response_broadcasts%ROWTYPE;
  outbox engagement_email_outbox%ROWTYPE; text_record text;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Email preparation and claims require read committed isolation' USING ERRCODE='25001';
  END IF;
  IF p_attempt IS NULL THEN RAISE EXCEPTION 'Attempt identity required' USING ERRCODE='22023'; END IF;
  UPDATE engagement_response_broadcast_messages SET state='uncertain',
    error='The delivery attempt did not report a result. Do not resend automatically.'
    WHERE state='attempting' AND started_at<clock_timestamp()-interval '2 minutes';
  SELECT * INTO message FROM engagement_response_broadcast_messages WHERE state='queued'
    ORDER BY outbox_id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO STRICT job FROM engagement_response_broadcasts
    WHERE campaign_id=message.campaign_id AND request_id=message.request_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('engagement-response:'||job.campaign_id::text,0));
  SELECT * INTO STRICT outbox FROM engagement_email_outbox WHERE id=message.outbox_id;
  text_record=jsonb_build_object('to',outbox.to_email,'subject',outbox.subject,'text',outbox.body)::text;
  IF NOT EXISTS(SELECT 1 FROM engagement_closeloop_entries e JOIN engagement_campaigns c ON c.id=e.campaign_id
      WHERE e.id=job.response_id AND e.campaign_id=job.campaign_id AND e.status='published'
        AND e.updated_at=(job.response_json->>'updated_at')::timestamptz AND c.status='active'
        AND c.share_token=job.share_token FOR SHARE OF e,c)
    OR NOT EXISTS(SELECT 1 FROM engagement_subscriptions s WHERE s.id=message.subscription_id
      AND s.campaign_id=job.campaign_id AND s.confirmed AND s.unsubscribed_at IS NULL AND s.email=outbox.to_email FOR SHARE)
    OR encode(extensions.digest(text_record,'sha256'),'hex')<>message.content_sha256 THEN
    UPDATE engagement_response_broadcast_messages SET state='cancelled',finished_at=clock_timestamp(),
      error='Publication, subscription or retained message changed before delivery.' WHERE outbox_id=message.outbox_id;
    RETURN jsonb_build_object('outboxId',message.outbox_id,'state','cancelled');
  END IF;
  UPDATE engagement_response_broadcast_messages SET state='attempting',attempt_token=p_attempt,
    started_at=clock_timestamp() WHERE outbox_id=message.outbox_id;
  RETURN jsonb_build_object('outboxId',message.outbox_id,'attemptToken',p_attempt,'state','attempting',
    'messageText',text_record,'contentSha256',message.content_sha256);
END $$;
