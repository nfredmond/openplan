-- Prototype, not an installable migration yet. The route/UI join and direct-write
-- guard must be completed before promoting this file into supabase/migrations.
CREATE TABLE public.engagement_response_write_receipts (
  campaign_id uuid NOT NULL REFERENCES public.engagement_campaigns(id),
  request_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  response_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('create', 'update', 'remove')),
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
  SELECT * INTO campaign FROM public.engagement_campaigns WHERE id = p_campaign FOR SHARE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.workspace_members
      WHERE workspace_id = campaign.workspace_id AND user_id = auth.uid()
      AND role IN ('owner', 'admin', 'member')) THEN
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
    IF receipt.actor_id <> auth.uid() OR receipt.payload_json <> envelope THEN
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
