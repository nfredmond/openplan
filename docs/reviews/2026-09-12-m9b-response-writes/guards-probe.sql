SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','4a21e42f-27a7-474d-9a7a-5912c70af359',true);
DO $$
DECLARE
  campaign uuid := 'b76fe95e-3a5e-4791-a232-dd65d85b8a57';
  request_id uuid := gen_random_uuid();
  correction_request uuid := gen_random_uuid();
  parent uuid := gen_random_uuid();
  reply uuid := gen_random_uuid();
  source_time timestamptz;
  initial jsonb;
  corrected jsonb;
  direct_response jsonb;
  reply_response jsonb;
  original_hash text;
  refused boolean;
BEGIN
  initial = public.write_engagement_response(campaign, request_id, 'create', NULL, NULL, NULL,
    '{"theme_title":"SYNTHETIC guarded response","we_did":"Original wording"}');
  SELECT record_sha256 INTO STRICT original_hash FROM engagement_response_history
    WHERE response_id = (initial->>'entryId')::uuid AND revision = 1;
  refused = false;
  BEGIN
    INSERT INTO engagement_closeloop_entries(campaign_id, theme_title) VALUES(campaign, 'SYNTHETIC bypass');
  EXCEPTION WHEN insufficient_privilege THEN refused = true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'Direct INSERT bypassed the response transaction'; END IF;
  -- Reusing a completed receipt in caller-controlled session state grants nothing.
  PERFORM set_config('openplan.response_request', request_id::text, true);
  refused = false;
  BEGIN
    UPDATE engagement_closeloop_entries SET we_did = 'SYNTHETIC forged correction'
      WHERE id = (initial->>'entryId')::uuid;
  EXCEPTION WHEN insufficient_privilege THEN refused = true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'Direct UPDATE bypassed the response transaction'; END IF;
  refused = false;
  BEGIN
    DELETE FROM engagement_closeloop_entries WHERE id = (initial->>'entryId')::uuid;
  EXCEPTION WHEN insufficient_privilege THEN refused = true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'Direct DELETE bypassed the response transaction'; END IF;
  IF has_function_privilege(current_user,
    'public.withdraw_engagement_source_responses(uuid,uuid,jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Ordinary caller could invoke the trusted source helper';
  END IF;
  refused = false;
  BEGIN
    PERFORM public.withdraw_engagement_source_responses(campaign, parent, '{}', '{}');
  EXCEPTION WHEN insufficient_privilege THEN refused = true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'Ordinary caller could forge a source withdrawal'; END IF;
  corrected = public.write_engagement_response(campaign, correction_request, 'update',
    (initial->>'entryId')::uuid, (initial->'entry'->>'updated_at')::timestamptz,
    'SYNTHETIC exact correction reason', '{"we_did":"Corrected wording"}');
  IF NOT EXISTS(SELECT 1 FROM engagement_response_history
    WHERE response_id = (initial->>'entryId')::uuid AND revision = 2
      AND change_reason = 'SYNTHETIC exact correction reason' AND change_origin = 'staff'
      AND write_request_id = correction_request AND record_json->>'we_did' = 'Corrected wording') THEN
    RAISE EXCEPTION 'Correction reason or request was lost from private history';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM engagement_response_history
    WHERE response_id = (initial->>'entryId')::uuid AND revision = 1
      AND record_sha256 = original_hash AND record_json->>'we_did' = 'Original wording'
      AND change_reason IS NULL) THEN
    RAISE EXCEPTION 'Original history or unknown creation reason was rewritten';
  END IF;
  INSERT INTO engagement_items(id,campaign_id,body,source_type,status)
    VALUES(parent,campaign,'SYNTHETIC parent source','internal','approved') RETURNING updated_at INTO source_time;
  INSERT INTO engagement_items(id,campaign_id,body,source_type,status,parent_item_id)
    VALUES(reply,campaign,'SYNTHETIC reply source','internal','approved',parent);
  direct_response = public.write_engagement_response(campaign,gen_random_uuid(),'create',NULL,NULL,NULL,
    jsonb_build_object('theme_title','SYNTHETIC direct response','status','published','source_item_ids',jsonb_build_array(parent)));
  reply_response = public.write_engagement_response(campaign,gen_random_uuid(),'create',NULL,NULL,NULL,
    jsonb_build_object('theme_title','SYNTHETIC reply response','status','published','source_item_ids',jsonb_build_array(reply)));
  UPDATE engagement_items SET body = 'SYNTHETIC corrected parent', review_expected_updated_at = source_time,
    review_reason = 'SYNTHETIC moderator source reason' WHERE id = parent RETURNING updated_at INTO source_time;
  IF (SELECT status FROM engagement_closeloop_entries WHERE id = (direct_response->>'entryId')::uuid) <> 'draft' THEN
    RAISE EXCEPTION 'Direct source change did not withdraw its published response';
  END IF;
  IF (SELECT status FROM engagement_closeloop_entries WHERE id = (reply_response->>'entryId')::uuid) <> 'draft' THEN
    RAISE EXCEPTION 'Parent change left a linked reply response published';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM engagement_response_history h
    JOIN engagement_response_write_receipts r ON r.campaign_id=h.campaign_id AND r.request_id=h.write_request_id
    WHERE h.response_id = (reply_response->>'entryId')::uuid AND h.revision=2
      AND h.event='unpublished' AND h.change_origin='source_withdrawal'
      AND h.change_reason='Automatically withdrawn after a linked contribution or its parent changed'
      AND r.operation='source_withdrawal' AND r.actor_id=auth.uid() AND r.result_json IS NOT NULL
      AND r.payload_json->>'sourceId'=parent::text
      AND r.payload_json->'sourceBefore'->>'body'='SYNTHETIC parent source'
      AND r.payload_json->'sourceAfter'->>'body'='SYNTHETIC corrected parent'
      AND r.payload_json->'sourceAfter'->>'moderation_notes'='SYNTHETIC moderator source reason') THEN
    RAISE EXCEPTION 'Automatic withdrawal lost source provenance or invented a human response reason';
  END IF;
  UPDATE engagement_items SET status='rejected', review_expected_updated_at=source_time,
    review_reason='SYNTHETIC withhold parent' WHERE id=parent;
  refused=false;
  BEGIN
    PERFORM public.write_engagement_response(campaign,gen_random_uuid(),'create',NULL,NULL,NULL,
      jsonb_build_object('theme_title','SYNTHETIC private-parent leak','status','published','source_item_ids',jsonb_build_array(reply)));
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Review and publish linked contributions before publishing the staff response' THEN RAISE; END IF;
    refused=true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'A response disclosed a reply with a withheld parent'; END IF;
  -- Membership is checked even for an otherwise identical retained request.
  PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  refused=false;
  BEGIN
    PERFORM public.write_engagement_response(campaign,request_id,'create',NULL,NULL,NULL,
      '{"theme_title":"SYNTHETIC guarded response","we_did":"Original wording"}');
  EXCEPTION WHEN insufficient_privilege THEN refused=true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'Outsider replay disclosed a retained response'; END IF;
  IF EXISTS(SELECT 1 FROM engagement_response_write_receipts WHERE campaign_id=campaign) THEN
    RAISE EXCEPTION 'Private response receipts were visible to an outsider';
  END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$
DECLARE refused boolean := false;
BEGIN
  BEGIN
    UPDATE public.engagement_closeloop_entries SET we_did='SYNTHETIC service bypass'
      WHERE campaign_id='b76fe95e-3a5e-4791-a232-dd65d85b8a57';
  EXCEPTION WHEN insufficient_privilege THEN refused=true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'Service role bypassed the response transaction'; END IF;
END $$;
RESET ROLE;
