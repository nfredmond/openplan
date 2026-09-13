SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','4a21e42f-27a7-474d-9a7a-5912c70af359',true);
DO $$
DECLARE
  campaign uuid := 'b76fe95e-3a5e-4791-a232-dd65d85b8a57';
  request_id uuid := gen_random_uuid();
  correction_request uuid := gen_random_uuid();
  removal_request uuid := gen_random_uuid();
  initial jsonb;
  replay jsonb;
  corrected jsonb;
  refused boolean := false;
  original_time timestamptz;
BEGIN
  initial = public.write_engagement_response(campaign,request_id,'create',NULL,NULL,NULL,
    '{"theme_title":"SYNTHETIC rolled-back transaction","we_did":"Original words"}');
  replay = public.write_engagement_response(campaign,request_id,'create',NULL,NULL,NULL,
    '{"theme_title":"SYNTHETIC rolled-back transaction","we_did":"Original words"}');
  IF initial->'entry' <> replay->'entry' OR replay->>'replayed' <> 'true' THEN
    RAISE EXCEPTION 'Identical request did not return its retained record';
  END IF;
  IF (SELECT count(*) FROM public.engagement_response_history WHERE response_id=(initial->>'entryId')::uuid) <> 1 THEN
    RAISE EXCEPTION 'Identical create produced extra history';
  END IF;
  BEGIN
    PERFORM public.write_engagement_response(campaign,request_id,'create',NULL,NULL,NULL,
      '{"theme_title":"SYNTHETIC changed request","we_did":"Other words"}');
  EXCEPTION WHEN unique_violation THEN refused=true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'Changed-payload retry was accepted'; END IF;
  original_time=(initial->'entry'->>'updated_at')::timestamptz;
  corrected=public.write_engagement_response(campaign,correction_request,'update',
    (initial->>'entryId')::uuid,original_time,'SYNTHETIC first correction','{"we_did":"First correction"}');
  IF (corrected->'entry'->>'updated_at')::timestamptz <= original_time THEN
    RAISE EXCEPTION 'Response version did not advance';
  END IF;
  refused=false;
  BEGIN
    PERFORM public.write_engagement_response(campaign,gen_random_uuid(),'update',
      (initial->>'entryId')::uuid,original_time,'SYNTHETIC stale correction','{"we_did":"Stale words"}');
  EXCEPTION WHEN serialization_failure OR SQLSTATE 'PT409' THEN refused=true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'Stale editor overwrote the first correction'; END IF;
  IF corrected->'entry'->>'we_did' <> 'First correction' THEN RAISE EXCEPTION 'Correction was not retained'; END IF;
  replay=public.write_engagement_response(campaign,correction_request,'update',
    (initial->>'entryId')::uuid,original_time,'SYNTHETIC first correction','{"we_did":"First correction"}');
  IF replay->'entry' <> corrected->'entry' OR replay->>'replayed' <> 'true' THEN
    RAISE EXCEPTION 'Correction replay did not preserve the committed result';
  END IF;
  PERFORM public.write_engagement_response(campaign,removal_request,'remove',
    (initial->>'entryId')::uuid,(corrected->'entry'->>'updated_at')::timestamptz,'SYNTHETIC removal','{}');
  replay=public.write_engagement_response(campaign,removal_request,'remove',
    (initial->>'entryId')::uuid,(corrected->'entry'->>'updated_at')::timestamptz,'SYNTHETIC removal','{}');
  IF replay->>'removed' <> 'true' OR replay->>'replayed' <> 'true' THEN
    RAISE EXCEPTION 'Removal replay did not recover its receipt';
  END IF;
  IF EXISTS (SELECT 1 FROM public.engagement_closeloop_entries WHERE id=(initial->>'entryId')::uuid)
    OR (SELECT count(*) FROM public.engagement_response_history WHERE response_id=(initial->>'entryId')::uuid) <> 3 THEN
    RAISE EXCEPTION 'Removal or replay damaged response history';
  END IF;
  IF (SELECT record_json->>'we_did' FROM public.engagement_response_history
    WHERE response_id=(initial->>'entryId')::uuid AND revision=1) <> 'Original words' THEN
    RAISE EXCEPTION 'Original words changed';
  END IF;
  RAISE NOTICE 'Create/correct/remove replays, changed-payload and stale refusals, original history passed';
END $$;

RESET ROLE;
DO $$
DECLARE refused boolean := false;
BEGIN
  BEGIN
    UPDATE public.engagement_response_write_receipts SET result_json='{}'::jsonb WHERE result_json IS NOT NULL;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Response write receipts are immutable' THEN RAISE; END IF;
    refused=true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'Completed receipt could be changed'; END IF;
END $$;
