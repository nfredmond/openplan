-- Rollback-only extension. Trusted writes reconcile stored publication with current evidence.
CREATE FUNCTION public.withdraw_ineligible_synthesis_responses(p_campaign uuid,p_actor uuid,p_kind text,p_before jsonb,p_after jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE previous engagement_closeloop_entries; saved engagement_closeloop_entries;
 request uuid; workspace uuid; previous_context text;
BEGIN
 -- A fixed snapshot could miss a publication committed before the shared campaign lock.
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Synthesis withdrawals require read committed isolation' USING ERRCODE='25001';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM engagement_synthesis_response_events WHERE campaign_id=p_campaign) THEN RETURN; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('engagement-response:'||p_campaign::text,0)) THEN
  RAISE EXCEPTION 'Response publication is busy; retry the source change' USING ERRCODE='PT503';
 END IF;
 SELECT workspace_id INTO STRICT workspace FROM engagement_campaigns WHERE id=p_campaign;
 FOR previous IN SELECT e.* FROM engagement_closeloop_entries e WHERE e.campaign_id=p_campaign AND e.status='published'
  AND NOT public.engagement_synthesis_response_public_allowed(p_campaign,e.id,to_jsonb(e)) ORDER BY e.id FOR UPDATE
 LOOP
  request:=gen_random_uuid();
  INSERT INTO engagement_response_write_receipts(campaign_id,request_id,workspace_id,response_id,actor_id,operation,payload_json,before_record)
  VALUES(p_campaign,request,workspace,previous.id,p_actor,'source_withdrawal',jsonb_build_object(
   'reason','Automatically withdrawn after reviewed synthesis evidence changed',
   'causeKind',p_kind,'causeBefore',p_before,'causeAfter',p_after),to_jsonb(previous));
  previous_context:=current_setting('openplan.response_request',true);
  PERFORM set_config('openplan.response_request',request::text,true);
  UPDATE engagement_closeloop_entries SET status='draft',published_at=NULL WHERE id=previous.id RETURNING * INTO saved;
  PERFORM set_config('openplan.response_request',COALESCE(previous_context,''),true);
  UPDATE engagement_response_write_receipts SET result_json=jsonb_build_object('entry',to_jsonb(saved),'entryId',saved.id,
   'requestId',request,'removed',false,'replayed',false,'becamePublished',false)
   WHERE campaign_id=p_campaign AND request_id=request;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.withdraw_ineligible_synthesis_responses(uuid,uuid,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Trigger callers own the changed row already; the nonblocking campaign lock avoids inversion.
CREATE FUNCTION public.reconcile_synthesis_source_publication()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE campaign uuid; actor uuid; before_record jsonb; after_record jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN before_record:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN after_record:=to_jsonb(NEW); END IF;
 IF before_record IS NOT DISTINCT FROM after_record THEN RETURN NULL; END IF;
 IF TG_TABLE_NAME IN ('engagement_synthesis_review_revisions','engagement_synthesis_approval_events') THEN
  SELECT campaign_id INTO STRICT campaign FROM engagement_synthesis_reviews WHERE id=NEW.review_id;
  actor:=NEW.actor_id;
 ELSE
  campaign:=COALESCE(after_record,before_record)->>'campaign_id'; actor:=auth.uid();
 END IF;
 PERFORM public.withdraw_ineligible_synthesis_responses(campaign,actor,TG_TABLE_NAME,before_record,after_record);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.reconcile_synthesis_source_publication() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER synthesis_item_publication AFTER UPDATE OR DELETE ON public.engagement_items
 FOR EACH ROW EXECUTE FUNCTION public.reconcile_synthesis_source_publication();
CREATE TRIGGER synthesis_answer_publication AFTER UPDATE OR DELETE ON public.engagement_survey_answers
 FOR EACH ROW EXECUTE FUNCTION public.reconcile_synthesis_source_publication();
CREATE TRIGGER synthesis_session_publication AFTER UPDATE OR DELETE ON public.engagement_survey_response_sessions
 FOR EACH ROW EXECUTE FUNCTION public.reconcile_synthesis_source_publication();
CREATE TRIGGER synthesis_revision_publication AFTER INSERT ON public.engagement_synthesis_review_revisions
 FOR EACH ROW EXECUTE FUNCTION public.reconcile_synthesis_source_publication();
CREATE TRIGGER synthesis_approval_publication AFTER INSERT ON public.engagement_synthesis_approval_events
 FOR EACH ROW EXECUTE FUNCTION public.reconcile_synthesis_source_publication();

-- Reconcile only after the event's complete dependency index is present, never during event insertion.
DO $writer$ DECLARE body text; seam text:=$seam$ RETURN jsonb_build_object('event',public.engagement_synthesis_response_packet(request),'replayed',false);$seam$; BEGIN
 body:=pg_get_functiondef('public.retain_engagement_synthesis_response_link(uuid,uuid,uuid,jsonb,text)'::regprocedure);
 IF (length(body)-length(replace(body,seam,'')))/length(seam)<>1 THEN RAISE EXCEPTION 'Response link reconciliation seam differs'; END IF;
 EXECUTE replace(body,seam,$call$ PERFORM public.withdraw_ineligible_synthesis_responses(p_campaign,p_actor,'synthesis_response_link',
  CASE WHEN previous.id IS NULL THEN NULL ELSE jsonb_build_object('id',previous.id,'eventSha256',previous.event_sha256) END,
  jsonb_build_object('id',request,'eventSha256',encode(extensions.digest(event_text,'sha256'),'hex')));
$call$||seam);
END $writer$;

-- A service-origin review has an explicit retained actor even when there is no end-user JWT.
-- Only an unfinished private receipt for this exact response can supply history metadata.
DO $history$ DECLARE body text; seam text:='AND r.actor_id IS NOT DISTINCT FROM auth.uid() AND r.result_json IS NULL;';
 actor_seam text:=', auth.uid(),'; BEGIN
 body:=pg_get_functiondef('public.retain_engagement_response_history()'::regprocedure);
 IF (length(body)-length(replace(body,seam,'')))/length(seam)<>1
  OR (length(body)-length(replace(body,actor_seam,'')))/length(actor_seam)<>3 THEN RAISE EXCEPTION 'Response history actor seam differs'; END IF;
 body:=replace(body,seam,'AND (r.actor_id IS NOT DISTINCT FROM auth.uid() OR r.operation = ''source_withdrawal'') AND r.result_json IS NULL;');
 EXECUTE replace(body,actor_seam,', CASE WHEN write_receipt.request_id IS NOT NULL THEN write_receipt.actor_id ELSE auth.uid() END,');
END $history$;
