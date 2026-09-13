-- Prototype companion. Apply only inside the rolled-back probe transaction.
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
