-- Retained staff response requests, exact-version corrections, and durable publication email outcomes.
-- This accompanies the editor request-contract change; existing response history hashes remain unchanged.

CREATE TABLE public.engagement_response_write_receipts (
  campaign_id uuid NOT NULL REFERENCES public.engagement_campaigns(id),
  request_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  response_id uuid NOT NULL,
  actor_id uuid,
  operation text NOT NULL CHECK (operation IN ('create', 'update', 'remove', 'source_withdrawal')),
  CHECK (actor_id IS NOT NULL OR operation = 'source_withdrawal'),
  payload_json jsonb NOT NULL,
  payload_sha256 text GENERATED ALWAYS AS
    (encode(extensions.digest(payload_json::text, 'sha256'), 'hex')) STORED,
  before_record jsonb,
  result_json jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (campaign_id, request_id)
);
ALTER TABLE public.engagement_response_write_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_response_write_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.engagement_response_write_receipts TO authenticated;
CREATE POLICY response_write_receipts_staff_read
  ON public.engagement_response_write_receipts FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.workspace_members m
      WHERE m.workspace_id = engagement_response_write_receipts.workspace_id
      AND m.user_id = auth.uid() AND m.role IN ('owner', 'admin', 'member'))
  );

-- Only one finalization is possible. App roles cannot insert or finalize receipts.
CREATE FUNCTION public.guard_engagement_response_write_receipt()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.result_json IS NULL AND NEW.result_json IS NOT NULL
    AND (to_jsonb(NEW) - ARRAY['result_json','payload_sha256'])
      = (to_jsonb(OLD) - ARRAY['result_json','payload_sha256']) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Response write receipts are immutable';
END $$;
REVOKE ALL ON FUNCTION public.guard_engagement_response_write_receipt() FROM PUBLIC;
CREATE TRIGGER response_write_receipts_immutable BEFORE UPDATE OR DELETE
  ON public.engagement_response_write_receipts FOR EACH ROW
  EXECUTE FUNCTION public.guard_engagement_response_write_receipt();

CREATE FUNCTION public.write_engagement_response(
  p_campaign uuid, p_request uuid, p_operation text, p_response uuid,
  p_expected_updated_at timestamptz, p_reason text, p_changes jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  campaign public.engagement_campaigns%ROWTYPE;
  previous public.engagement_closeloop_entries%ROWTYPE;
  saved public.engagement_closeloop_entries%ROWTYPE;
  receipt public.engagement_response_write_receipts%ROWTYPE;
  envelope jsonb;
  response_id uuid;
  result jsonb;
  previous_context text;
  sources uuid[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Staff authentication required' USING ERRCODE = '42501';
  END IF;
  -- Shared with source withdrawals; no contribution row lock is taken here.
  PERFORM pg_advisory_xact_lock(hashtextextended('engagement-response:' || p_campaign::text, 0));
  SELECT * INTO campaign FROM public.engagement_campaigns WHERE id = p_campaign FOR SHARE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.workspace_members
      WHERE workspace_id = campaign.workspace_id AND user_id = auth.uid()
      AND role IN ('owner', 'admin', 'member') FOR SHARE) THEN
    RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE = '42501';
  END IF;
  IF p_request IS NULL OR p_operation IS NULL OR p_operation NOT IN ('create','update','remove')
    OR p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object'
    OR (p_operation = 'create' AND (p_response IS NOT NULL OR p_expected_updated_at IS NOT NULL))
    OR (p_operation <> 'create' AND (p_response IS NULL OR p_expected_updated_at IS NULL))
    OR (p_operation <> 'create' AND NULLIF(btrim(p_reason), '') IS NULL)
    OR length(p_reason) > 2000 THEN
    RAISE EXCEPTION 'Invalid response write intent' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_changes) AS keys(key)
    WHERE key NOT IN ('theme_title','you_said','we_did','category_id','status','sort_order','source_item_ids','ai_assisted'))
    OR (p_operation = 'remove' AND p_changes <> '{}'::jsonb)
    OR (p_operation = 'update' AND p_changes = '{}'::jsonb) THEN
    RAISE EXCEPTION 'Invalid response fields' USING ERRCODE = '22023';
  END IF;
  IF (p_operation = 'create' AND NOT p_changes ? 'theme_title')
    OR (p_changes ? 'theme_title' AND (jsonb_typeof(p_changes->'theme_title') <> 'string'
      OR length(btrim(p_changes->>'theme_title')) NOT BETWEEN 1 AND 200))
    OR (p_changes ? 'you_said' AND (jsonb_typeof(p_changes->'you_said') <> 'string' OR length(p_changes->>'you_said') > 5000))
    OR (p_changes ? 'we_did' AND (jsonb_typeof(p_changes->'we_did') <> 'string' OR length(p_changes->>'we_did') > 5000))
    OR (p_changes ? 'status' AND (jsonb_typeof(p_changes->'status') <> 'string' OR p_changes->>'status' NOT IN ('draft','published')))
    OR (p_changes ? 'sort_order' AND (jsonb_typeof(p_changes->'sort_order') <> 'number'
      OR (p_changes->>'sort_order') !~ '^[0-9]+$' OR (p_changes->>'sort_order')::numeric > 10000))
    OR (p_changes ? 'ai_assisted' AND jsonb_typeof(p_changes->'ai_assisted') <> 'boolean') THEN
    RAISE EXCEPTION 'Invalid response content' USING ERRCODE = '22023';
  END IF;

  envelope = jsonb_build_object('operation',p_operation,'responseId',p_response,
    'expectedUpdatedAt',p_expected_updated_at,'reason',p_reason,'changes',p_changes);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_campaign::text || ':' || p_request::text, 0));
  SELECT * INTO receipt FROM public.engagement_response_write_receipts
    WHERE campaign_id = p_campaign AND request_id = p_request;
  IF FOUND THEN
    IF receipt.actor_id IS DISTINCT FROM auth.uid() OR receipt.payload_json <> envelope THEN
      RAISE EXCEPTION 'Request identity belongs to a different write' USING ERRCODE = '23505';
    END IF;
    IF receipt.result_json IS NULL THEN
      RAISE EXCEPTION 'Response write outcome is unavailable' USING ERRCODE = '40001';
    END IF;
    RETURN receipt.result_json || jsonb_build_object('replayed',true);
  END IF;

  IF p_operation <> 'create' THEN
    SELECT * INTO previous FROM public.engagement_closeloop_entries
      WHERE id = p_response AND campaign_id = p_campaign FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Response no longer exists' USING ERRCODE = 'P0002';
    END IF;
    IF previous.updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RAISE EXCEPTION 'Response changed; review the current copy' USING ERRCODE = '40001';
    END IF;
    IF previous.ai_assisted AND p_changes->'ai_assisted' = 'false'::jsonb THEN
      RAISE EXCEPTION 'Recorded AI assistance cannot be cleared' USING ERRCODE = '22023';
    END IF;
    response_id = previous.id;
  ELSE
    response_id = gen_random_uuid();
  END IF;

  IF p_changes ? 'category_id' AND p_changes->'category_id' <> 'null'::jsonb THEN
    IF jsonb_typeof(p_changes->'category_id') <> 'string' OR NOT EXISTS (
      SELECT 1 FROM public.engagement_categories WHERE id = (p_changes->>'category_id')::uuid AND campaign_id = p_campaign
    ) THEN RAISE EXCEPTION 'Category does not belong to campaign' USING ERRCODE = '22023'; END IF;
  END IF;
  IF p_changes ? 'source_item_ids' THEN
    IF jsonb_typeof(p_changes->'source_item_ids') <> 'array' OR jsonb_array_length(p_changes->'source_item_ids') > 300 THEN
      RAISE EXCEPTION 'Invalid source contributions' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(array_agg(value::uuid),'{}'::uuid[]) INTO sources
      FROM jsonb_array_elements_text(p_changes->'source_item_ids');
    IF EXISTS (SELECT 1 FROM unnest(sources) source_id WHERE source_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.engagement_items WHERE id = source_id AND campaign_id = p_campaign
    )) THEN RAISE EXCEPTION 'Source contribution does not belong to campaign' USING ERRCODE = '22023'; END IF;
  END IF;

  INSERT INTO public.engagement_response_write_receipts
    (campaign_id,request_id,workspace_id,response_id,actor_id,operation,payload_json,before_record)
  VALUES (p_campaign,p_request,campaign.workspace_id,response_id,auth.uid(),p_operation,envelope,
    CASE WHEN p_operation = 'create' THEN NULL ELSE to_jsonb(previous) END);
  previous_context = current_setting('openplan.response_request',true);
  PERFORM set_config('openplan.response_request',p_request::text,true);

  IF p_operation = 'create' THEN
    INSERT INTO public.engagement_closeloop_entries
      (id,campaign_id,category_id,theme_title,you_said,we_did,status,ai_assisted,source_item_ids,sort_order,created_by)
    VALUES (response_id,p_campaign,(p_changes->>'category_id')::uuid,btrim(p_changes->>'theme_title'),
      btrim(COALESCE(p_changes->>'you_said','')),btrim(COALESCE(p_changes->>'we_did','')),
      COALESCE(p_changes->>'status','draft'),COALESCE((p_changes->>'ai_assisted')::boolean,false),
      COALESCE(sources,'{}'::uuid[]),COALESCE((p_changes->>'sort_order')::integer,0),auth.uid())
    RETURNING * INTO saved;
  ELSIF p_operation = 'update' THEN
    UPDATE public.engagement_closeloop_entries SET
      theme_title = CASE WHEN p_changes ? 'theme_title' THEN btrim(p_changes->>'theme_title') ELSE previous.theme_title END,
      you_said = CASE WHEN p_changes ? 'you_said' THEN btrim(p_changes->>'you_said') ELSE previous.you_said END,
      we_did = CASE WHEN p_changes ? 'we_did' THEN btrim(p_changes->>'we_did') ELSE previous.we_did END,
      category_id = CASE WHEN p_changes ? 'category_id' THEN (p_changes->>'category_id')::uuid ELSE previous.category_id END,
      status = COALESCE(p_changes->>'status',previous.status),
      ai_assisted = COALESCE((p_changes->>'ai_assisted')::boolean,previous.ai_assisted),
      source_item_ids = COALESCE(sources,previous.source_item_ids),
      sort_order = COALESCE((p_changes->>'sort_order')::integer,previous.sort_order)
    WHERE id = response_id AND campaign_id = p_campaign RETURNING * INTO saved;
  ELSE
    DELETE FROM public.engagement_closeloop_entries WHERE id = response_id AND campaign_id = p_campaign;
    saved = previous;
  END IF;
  PERFORM set_config('openplan.response_request',COALESCE(previous_context,''),true);
  result = jsonb_build_object('entry',to_jsonb(saved),'entryId',response_id,
    'removed',p_operation = 'remove','requestId',p_request,'replayed',false,
    'becamePublished',p_operation <> 'remove' AND saved.status = 'published'
      AND (p_operation = 'create' OR previous.status <> 'published'));
  UPDATE public.engagement_response_write_receipts SET result_json = result
    WHERE campaign_id = p_campaign AND request_id = p_request;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.write_engagement_response(uuid,uuid,text,uuid,timestamptz,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.write_engagement_response(uuid,uuid,text,uuid,timestamptz,text,jsonb) TO authenticated;

-- The existing timestamp trigger uses now(), which is constant in a transaction.
-- A later trigger makes each response write a distinct, increasing version.
CREATE FUNCTION public.advance_engagement_response_clock()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at = greatest(clock_timestamp(), OLD.updated_at + interval '1 microsecond');
  ELSE
    NEW.updated_at = clock_timestamp();
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.advance_engagement_response_clock() FROM PUBLIC;
CREATE TRIGGER zz_engagement_response_clock BEFORE INSERT OR UPDATE
  ON public.engagement_closeloop_entries FOR EACH ROW
  EXECUTE FUNCTION public.advance_engagement_response_clock();

-- Ordinary clients must use the authorized write RPC. Existing security-definer
-- source review triggers retain their internal write authority.
REVOKE INSERT, UPDATE, DELETE ON public.engagement_closeloop_entries
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON public.engagement_response_write_receipts
  FROM service_role;

ALTER TABLE public.engagement_response_history
  ADD COLUMN write_request_id uuid,
  ADD COLUMN change_reason text,
  ADD COLUMN change_origin text CHECK (change_origin IN ('staff', 'source_withdrawal'));

-- This helper is callable only by the database owner through the contribution
-- review trigger. Its receipt distinguishes an automatic withdrawal from the
-- moderator's source edit, retaining the actual source versions and actor.
CREATE FUNCTION public.withdraw_engagement_source_responses(
  p_campaign uuid, p_source uuid, p_before jsonb, p_after jsonb
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
DECLARE
  previous public.engagement_closeloop_entries%ROWTYPE;
  saved public.engagement_closeloop_entries%ROWTYPE;
  withdrawal_request uuid;
  workspace uuid;
  previous_context text;
BEGIN
  -- A fixed snapshot can miss a response committed before this lock was acquired.
  -- The app uses READ COMMITTED; other callers must retry in that isolation mode.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Source withdrawals require read committed isolation' USING ERRCODE = '25001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('engagement-response:' || p_campaign::text, 0));
  SELECT workspace_id INTO STRICT workspace FROM public.engagement_campaigns WHERE id = p_campaign;
  FOR previous IN SELECT e.* FROM public.engagement_closeloop_entries e
    WHERE e.campaign_id = p_campaign AND e.status = 'published'
      AND (p_source = ANY(e.source_item_ids) OR EXISTS (
        SELECT 1 FROM public.engagement_items reply
        WHERE reply.id = ANY(e.source_item_ids) AND reply.campaign_id = p_campaign
          AND reply.parent_item_id = p_source
      )) ORDER BY e.id FOR UPDATE
  LOOP
    withdrawal_request = gen_random_uuid();
    INSERT INTO public.engagement_response_write_receipts
      (campaign_id, request_id, workspace_id, response_id, actor_id, operation, payload_json, before_record)
    VALUES (p_campaign, withdrawal_request, workspace, previous.id, auth.uid(), 'source_withdrawal',
      jsonb_build_object('reason', 'Automatically withdrawn after a linked contribution or its parent changed',
        'sourceId', p_source, 'sourceBefore', p_before, 'sourceAfter', p_after), to_jsonb(previous));
    previous_context = current_setting('openplan.response_request', true);
    PERFORM set_config('openplan.response_request', withdrawal_request::text, true);
    UPDATE public.engagement_closeloop_entries SET status = 'draft', published_at = NULL
      WHERE id = previous.id RETURNING * INTO saved;
    PERFORM set_config('openplan.response_request', COALESCE(previous_context, ''), true);
    UPDATE public.engagement_response_write_receipts
      SET result_json = jsonb_build_object('entry', to_jsonb(saved), 'entryId', saved.id,
        'requestId', withdrawal_request, 'removed', false, 'replayed', false, 'becamePublished', false)
      WHERE campaign_id = p_campaign AND engagement_response_write_receipts.request_id = withdrawal_request;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.withdraw_engagement_source_responses(uuid,uuid,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_engagement_public_copy() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
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
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.parent_item_id IS DISTINCT FROM OLD.parent_item_id OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id OR NEW.configuration_version_id IS DISTINCT FROM OLD.configuration_version_id
    OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.request_sha256 IS DISTINCT FROM OLD.request_sha256 THEN
    RAISE EXCEPTION 'Contribution identity and historical configuration are immutable';
  END IF;
  IF ROW(NEW.title,NEW.body,NEW.submitted_by,NEW.status,NEW.photo_path,NEW.geometry,NEW.latitude,NEW.longitude,NEW.category_id,NEW.source_type) IS DISTINCT FROM ROW(OLD.title,OLD.body,OLD.submitted_by,OLD.status,OLD.photo_path,OLD.geometry,OLD.latitude,OLD.longitude,OLD.category_id,OLD.source_type) THEN
    IF NULLIF(btrim(NEW.moderation_notes),'') IS NULL THEN RAISE EXCEPTION 'A human review reason is required'; END IF;
    NEW.updated_at=clock_timestamp();
    NEW.metadata_json=NEW.metadata_json-'ai_translations';
    PERFORM public.withdraw_engagement_source_responses(NEW.campaign_id, NEW.id, to_jsonb(OLD), to_jsonb(NEW));
    UPDATE engagement_campaigns SET ai_synthesis_json=NULL,ai_synthesized_at=NULL WHERE id=NEW.campaign_id;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.retain_engagement_response_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  next_revision bigint;
  history_event text;
  write_receipt public.engagement_response_write_receipts%ROWTYPE;
  affected_id uuid;
  affected_campaign uuid;
BEGIN
  affected_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  affected_campaign = CASE WHEN TG_OP = 'DELETE' THEN OLD.campaign_id ELSE NEW.campaign_id END;
  -- A caller-supplied GUC alone proves nothing. Metadata requires the matching
  -- unfinished private receipt created by a trusted write in this transaction.
  SELECT * INTO write_receipt FROM public.engagement_response_write_receipts r
  WHERE r.campaign_id = affected_campaign AND r.response_id = affected_id
    AND r.request_id::text = current_setting('openplan.response_request', true)
    AND r.actor_id IS NOT DISTINCT FROM auth.uid() AND r.result_json IS NULL;
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM engagement_response_history WHERE response_id = NEW.id) THEN
      RAISE EXCEPTION 'A retained response identity cannot be reused';
    END IF;
    INSERT INTO engagement_response_history(campaign_id, response_id, revision, actor_id, event, record_json, write_request_id, change_reason, change_origin)
    VALUES (NEW.campaign_id, NEW.id, 1, auth.uid(), 'created', to_jsonb(NEW), write_receipt.request_id, write_receipt.payload_json->>'reason',
      CASE WHEN write_receipt.operation = 'source_withdrawal' THEN 'source_withdrawal'
        WHEN write_receipt.request_id IS NOT NULL THEN 'staff' ELSE NULL END);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id THEN
      RAISE EXCEPTION 'Response identity and campaign are immutable';
    END IF;
    IF (to_jsonb(NEW) - 'updated_at') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Covers a pre-migration row first changed before the baseline sweep sees it.
  INSERT INTO engagement_response_history(campaign_id, response_id, revision, event, record_json)
  SELECT OLD.campaign_id, OLD.id, 1, 'legacy_baseline', to_jsonb(OLD)
  WHERE NOT EXISTS (SELECT 1 FROM engagement_response_history WHERE response_id = OLD.id)
  ON CONFLICT (response_id, revision) DO NOTHING;

  SELECT max(revision) + 1 INTO next_revision FROM engagement_response_history WHERE response_id = OLD.id;
  IF TG_OP = 'DELETE' THEN
    INSERT INTO engagement_response_history(campaign_id, response_id, revision, actor_id, event, record_json, write_request_id, change_reason, change_origin)
    VALUES (OLD.campaign_id, OLD.id, next_revision, auth.uid(), 'removed', to_jsonb(OLD), write_receipt.request_id, write_receipt.payload_json->>'reason',
      CASE WHEN write_receipt.operation = 'source_withdrawal' THEN 'source_withdrawal'
        WHEN write_receipt.request_id IS NOT NULL THEN 'staff' ELSE NULL END);
    RETURN OLD;
  END IF;

  history_event = CASE
    WHEN OLD.status <> 'published' AND NEW.status = 'published' THEN 'published'
    WHEN OLD.status = 'published' AND NEW.status <> 'published' THEN 'unpublished'
    ELSE 'corrected'
  END;
  INSERT INTO engagement_response_history(campaign_id, response_id, revision, actor_id, event, record_json, write_request_id, change_reason, change_origin)
  VALUES (NEW.campaign_id, NEW.id, next_revision, auth.uid(), history_event, to_jsonb(NEW), write_receipt.request_id, write_receipt.payload_json->>'reason',
      CASE WHEN write_receipt.operation = 'source_withdrawal' THEN 'source_withdrawal'
        WHEN write_receipt.request_id IS NOT NULL THEN 'staff' ELSE NULL END);
  RETURN NEW;
END $$;

-- One statement returns the complete private history, including removed responses.
-- Invoker RLS applies before aggregation; anonymous callers cannot execute it.
CREATE OR REPLACE FUNCTION public.read_engagement_response_history(p_campaign uuid)
RETURNS jsonb LANGUAGE sql STABLE STRICT SECURITY INVOKER
SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'campaignId', p_campaign,
    'count', count(*),
    'entries', COALESCE(jsonb_agg(jsonb_build_object(
      'id', h.id, 'campaign_id', h.campaign_id, 'response_id', h.response_id,
      'revision', h.revision, 'actor_id', h.actor_id, 'recorded_at', h.recorded_at,
      'event', h.event, 'record_text', h.record_json::text,
      'record_sha256', h.record_sha256, 'write_request_id', h.write_request_id,
      'change_reason', h.change_reason, 'change_origin', h.change_origin
    ) ORDER BY h.response_id, h.revision), '[]'::jsonb)
  ) FROM public.engagement_response_history h WHERE h.campaign_id = p_campaign;
$$;
REVOKE ALL ON FUNCTION public.read_engagement_response_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.read_engagement_response_history(uuid) TO authenticated;

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
