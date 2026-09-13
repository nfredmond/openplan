-- Unapplied prototype companion. No provider calls occur in these functions.
CREATE TABLE public.engagement_response_broadcasts (
  campaign_id uuid NOT NULL,
  request_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  response_id uuid NOT NULL,
  response_json jsonb NOT NULL,
  campaign_title text NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','prepared','cancelled','no_share_token')),
  share_token text,
  prepared_count bigint,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  prepared_at timestamptz,
  PRIMARY KEY(campaign_id,request_id),
  FOREIGN KEY(campaign_id,request_id) REFERENCES public.engagement_response_write_receipts(campaign_id,request_id)
);
ALTER TABLE public.engagement_response_broadcasts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_response_broadcasts FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE public.engagement_response_broadcast_messages (
  outbox_id uuid PRIMARY KEY REFERENCES public.engagement_email_outbox(id),
  campaign_id uuid NOT NULL,
  request_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  content_sha256 text NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','attempting','accepted','skipped','failed','uncertain','cancelled')),
  attempt_token uuid UNIQUE,
  started_at timestamptz,
  finished_at timestamptz,
  transport text,
  error text,
  FOREIGN KEY(campaign_id,request_id) REFERENCES public.engagement_response_broadcasts(campaign_id,request_id),
  UNIQUE(campaign_id,request_id,subscription_id)
);
ALTER TABLE public.engagement_response_broadcast_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_response_broadcast_messages FROM PUBLIC,anon,authenticated,service_role;

-- The publication intent commits with its response and immutable receipt. A
-- replay returns that receipt without creating another publication or inbox row.
CREATE FUNCTION public.queue_engagement_response_broadcast()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE title text;
BEGIN
  IF OLD.result_json IS NULL AND NEW.result_json->>'becamePublished'='true' THEN
    SELECT c.title INTO STRICT title FROM engagement_campaigns c WHERE c.id=NEW.campaign_id;
    INSERT INTO engagement_response_broadcasts(campaign_id,request_id,workspace_id,response_id,response_json,campaign_title)
      VALUES(NEW.campaign_id,NEW.request_id,NEW.workspace_id,NEW.response_id,NEW.result_json->'entry',title);
    INSERT INTO engagement_notifications(workspace_id,campaign_id,type,title,body,payload_json)
      VALUES(NEW.workspace_id,NEW.campaign_id,'closeloop_published','Published a staff response on '||title,
        NEW.result_json->'entry'->>'theme_title',jsonb_build_object('entryId',NEW.response_id,'requestId',NEW.request_id));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.queue_engagement_response_broadcast() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER engagement_response_broadcast_queue AFTER UPDATE ON public.engagement_response_write_receipts
  FOR EACH ROW EXECUTE FUNCTION public.queue_engagement_response_broadcast();

-- Use an origin from the worker's installation configuration, never an origin
-- supplied by a participant or by a caller of the staff write RPC.
CREATE FUNCTION public.prepare_engagement_response_broadcast(p_origin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE job engagement_response_broadcasts%ROWTYPE; campaign engagement_campaigns%ROWTYPE; count_saved bigint;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Email preparation and claims require read committed isolation' USING ERRCODE='25001';
  END IF;
  IF p_origin IS NULL OR p_origin !~ '^https?://[^/@?#[:space:]]+$' THEN
    RAISE EXCEPTION 'Configure the public installation origin' USING ERRCODE='22023';
  END IF;
  SELECT * INTO job FROM engagement_response_broadcasts WHERE state='queued'
    ORDER BY created_at,campaign_id,request_id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('engagement-response:'||job.campaign_id::text,0));
  SELECT * INTO STRICT campaign FROM engagement_campaigns WHERE id=job.campaign_id;
  IF campaign.status<>'active' OR NOT EXISTS(SELECT 1 FROM engagement_closeloop_entries e
    WHERE e.id=job.response_id AND e.campaign_id=job.campaign_id AND e.status='published'
      AND e.updated_at=(job.response_json->>'updated_at')::timestamptz) THEN
    UPDATE engagement_response_broadcasts SET state='cancelled',prepared_at=clock_timestamp()
      WHERE campaign_id=job.campaign_id AND request_id=job.request_id;
    RETURN jsonb_build_object('campaignId',job.campaign_id,'requestId',job.request_id,'state','cancelled');
  END IF;
  IF NULLIF(campaign.share_token,'') IS NULL THEN
    UPDATE engagement_response_broadcasts SET state='no_share_token',prepared_at=clock_timestamp()
      WHERE campaign_id=job.campaign_id AND request_id=job.request_id;
    RETURN jsonb_build_object('campaignId',job.campaign_id,'requestId',job.request_id,'state','no_share_token');
  END IF;
  -- One statement snapshots all confirmed subscriptions and saves every message.
  -- A read/insert failure rolls back preparation; it cannot become a false zero.
  WITH recipients AS (
    SELECT s.id,s.email,s.unsubscribe_token FROM engagement_subscriptions s
    WHERE s.campaign_id=job.campaign_id AND s.confirmed AND s.unsubscribed_at IS NULL
  ), saved AS (
    INSERT INTO engagement_email_outbox(campaign_id,to_email,subject,body,template,payload_json)
    SELECT job.campaign_id,r.email,'Update on '||job.campaign_title,
      'The project team posted an update: "'||(job.response_json->>'theme_title')||'".'||E'\n\nYou said: '||
      (job.response_json->>'you_said')||E'\n\nWe did: '||(job.response_json->>'we_did')||
      E'\n\nUnsubscribe from these updates: '||p_origin||'/api/engage/'||campaign.share_token||
      '/subscribe/unsubscribe?token='||r.unsubscribe_token,'closeloop_published',
      jsonb_build_object('responseRequestId',job.request_id,'subscriptionId',r.id)
    FROM recipients r RETURNING *
  ) INSERT INTO engagement_response_broadcast_messages(outbox_id,campaign_id,request_id,subscription_id,content_sha256)
    SELECT s.id,job.campaign_id,job.request_id,(s.payload_json->>'subscriptionId')::uuid,
      encode(extensions.digest(jsonb_build_object('to',s.to_email,'subject',s.subject,'text',s.body)::text,'sha256'),'hex')
    FROM saved s;
  GET DIAGNOSTICS count_saved=ROW_COUNT;
  UPDATE engagement_response_broadcasts SET state='prepared',share_token=campaign.share_token,
    prepared_count=count_saved,prepared_at=clock_timestamp() WHERE campaign_id=job.campaign_id AND request_id=job.request_id;
  RETURN jsonb_build_object('campaignId',job.campaign_id,'requestId',job.request_id,'state','prepared','count',count_saved);
END $$;
REVOKE ALL ON FUNCTION public.prepare_engagement_response_broadcast(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_engagement_response_broadcast(text) TO service_role;

-- The attempt commits before transport. A crashed attempt is never silently
-- reissued: only queued messages can be claimed, and uncertainty is retained.
CREATE FUNCTION public.claim_engagement_response_email(p_attempt uuid)
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
        AND c.share_token=job.share_token)
    OR NOT EXISTS(SELECT 1 FROM engagement_subscriptions s WHERE s.id=message.subscription_id
      AND s.campaign_id=job.campaign_id AND s.confirmed AND s.unsubscribed_at IS NULL AND s.email=outbox.to_email)
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
REVOKE ALL ON FUNCTION public.claim_engagement_response_email(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_engagement_response_email(uuid) TO service_role;

CREATE FUNCTION public.finish_engagement_response_email(
  p_outbox uuid,p_attempt uuid,p_state text,p_transport text,p_error text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE message engagement_response_broadcast_messages%ROWTYPE;
BEGIN
  IF p_state IS NULL OR p_state NOT IN ('accepted','skipped','failed','uncertain')
    OR p_transport IS NULL OR length(p_transport)>80 OR length(p_error)>500 THEN
    RAISE EXCEPTION 'Invalid delivery outcome' USING ERRCODE='22023';
  END IF;
  SELECT * INTO message FROM engagement_response_broadcast_messages WHERE outbox_id=p_outbox FOR UPDATE;
  IF NOT FOUND OR p_attempt IS NULL OR message.attempt_token IS DISTINCT FROM p_attempt THEN
    RAISE EXCEPTION 'Delivery attempt identity does not match' USING ERRCODE='42501';
  END IF;
  IF message.state<>'attempting' AND NOT (message.state='uncertain' AND message.finished_at IS NULL) THEN
    IF message.state=p_state AND message.transport=p_transport AND message.error IS NOT DISTINCT FROM p_error THEN RETURN true; END IF;
    RAISE EXCEPTION 'Completed delivery outcome cannot be replaced' USING ERRCODE='23505';
  END IF;
  UPDATE engagement_response_broadcast_messages SET state=p_state,transport=p_transport,error=p_error,
    finished_at=clock_timestamp() WHERE outbox_id=p_outbox;
  UPDATE engagement_email_outbox SET status=CASE p_state WHEN 'accepted' THEN 'sent'
      WHEN 'skipped' THEN 'skipped' WHEN 'failed' THEN 'failed' ELSE 'queued' END,
    transport=p_transport,error=p_error,sent_at=CASE WHEN p_state='accepted' THEN clock_timestamp() ELSE NULL END
    WHERE id=p_outbox;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.finish_engagement_response_email(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_engagement_response_email(uuid,uuid,text,text,text) TO service_role;

-- Staff see complete counts, never participant addresses or unsubscribe tokens.
CREATE FUNCTION public.read_engagement_response_broadcast(p_campaign uuid,p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE job engagement_response_broadcasts%ROWTYPE; counts jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM engagement_campaigns c JOIN workspace_members m ON m.workspace_id=c.workspace_id
    WHERE c.id=p_campaign AND m.user_id=auth.uid() AND m.role IN ('owner','admin','member')) THEN
    RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO job FROM engagement_response_broadcasts WHERE campaign_id=p_campaign AND request_id=p_request;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT jsonb_object_agg(state,n) INTO counts FROM (SELECT state,count(*) n FROM engagement_response_broadcast_messages
    WHERE campaign_id=p_campaign AND request_id=p_request GROUP BY state) summary;
  RETURN jsonb_build_object('campaignId',p_campaign,'requestId',p_request,'state',job.state,
    'preparedCount',job.prepared_count,'counts',COALESCE(counts,'{}'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.read_engagement_response_broadcast(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_engagement_response_broadcast(uuid,uuid) TO authenticated;
