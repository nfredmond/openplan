\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','4a21e42f-27a7-474d-9a7a-5912c70af359',true);
DO $probe$
DECLARE e public.engagement_closeloop_entries; first_text text; stale_text text; final_text text; touched integer;
BEGIN
 SELECT * INTO STRICT e FROM public.engagement_closeloop_entries
 WHERE campaign_id='a3c41566-bfd4-40f2-b467-96ee79054ec6' AND sort_order=0;
 IF e.status <> 'draft' THEN RAISE EXCEPTION 'Expected private synthetic draft'; END IF;
 first_text='SYNTHETIC first editor correction';
 stale_text='SYNTHETIC stale editor overwrote the correction';
 -- These writes mirror the current PATCH route: ID and campaign only.
 UPDATE public.engagement_closeloop_entries SET we_did=first_text
 WHERE id=e.id AND campaign_id=e.campaign_id;
 GET DIAGNOSTICS touched=ROW_COUNT;
 IF touched<>1 THEN RAISE EXCEPTION 'First permitted correction did not reach the row'; END IF;
 UPDATE public.engagement_closeloop_entries SET we_did=stale_text
 WHERE id=e.id AND campaign_id=e.campaign_id;
 GET DIAGNOSTICS touched=ROW_COUNT;
 SELECT we_did INTO final_text FROM public.engagement_closeloop_entries WHERE id=e.id;
 IF touched<>1 OR final_text<>stale_text THEN RAISE EXCEPTION 'Expected current stale overwrite was not reproduced'; END IF;
 RAISE NOTICE 'REPRODUCED: two scoped staff writes succeeded; stale edit replaced first correction without an expected version';
END $probe$;
ROLLBACK;
