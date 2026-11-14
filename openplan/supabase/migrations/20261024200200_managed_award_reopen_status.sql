-- Preserve the selected open state without rewriting applied migrations or receipts.
-- The six-argument entry has no defaults, so old five-argument calls stay unambiguous.
CREATE FUNCTION public.managed_award_closeout(p_actor uuid,p_award uuid,p_expected uuid,p_event text,p_note text,p_reopen_spending_status text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a public.funding_awards; paid numeric:=0; basis jsonb; result jsonb; closure_id uuid:=gen_random_uuid(); reopen_status text:=coalesce(p_reopen_spending_status,'active');
BEGIN
 IF current_user NOT IN ('service_role','postgres') OR p_actor IS NULL THEN RAISE EXCEPTION 'Server actor required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(713,1);
 SELECT * INTO STRICT a FROM public.funding_awards WHERE id=p_award;
 PERFORM FROM public.workspace_members WHERE workspace_id=a.workspace_id AND user_id=p_actor AND role IN ('owner','admin','member') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current programs writer required' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT a FROM public.funding_awards WHERE id=p_award FOR UPDATE;
 IF (p_event<>'reopen' AND a.current_handoff_revision_id IS NULL) OR a.current_handoff_revision_id IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Review current effective terms before closing or reopening' USING ERRCODE='PT409'; END IF;
 PERFORM FROM public.billing_invoice_records WHERE funding_award_id=a.id ORDER BY id FOR UPDATE;
 basis:=jsonb_build_object('previousClosure',jsonb_build_object('basis',a.closure_basis,'closedAt',a.closed_at,'note',a.closure_note),'expectedCurrent',p_expected,'note',p_note);
 IF p_reopen_spending_status IS NOT NULL AND p_event IS DISTINCT FROM 'reopen' THEN RAISE EXCEPTION 'Reopen destination belongs only to reopen' USING ERRCODE='22023'; END IF;
 IF p_event='earned_coverage' THEN
  IF a.spending_status='fully_spent' THEN RETURN jsonb_build_object('status','already_closed','awardId',a.id,'revisionId',p_expected,'closureBasis',a.closure_basis); END IF;
  IF a.awarded_amount<=0 OR a.currency_code IS NULL OR EXISTS(SELECT FROM public.billing_invoice_records i WHERE i.funding_award_id=a.id AND i.status='paid' AND (i.currency_code IS DISTINCT FROM a.currency_code OR i.award_handoff_revision_id IS NULL OR i.retention_amount>i.amount OR i.net_amount IS DISTINCT FROM i.amount-i.retention_amount OR NOT coalesce((i.award_handoff_revision_id=p_expected OR i.handoff_applicable_revision_id=p_expected),false))) THEN RAISE EXCEPTION 'Paid coverage is unassessed: require positive recorded ceiling, known matching currency and applicable version for every paid row' USING ERRCODE='22023'; END IF;
  SELECT coalesce(sum(net_amount),0) INTO paid FROM public.billing_invoice_records WHERE funding_award_id=a.id AND status='paid';
  IF paid<a.awarded_amount THEN RAISE EXCEPTION 'Paid coverage is below the recorded award ceiling' USING ERRCODE='22023'; END IF;
  basis:=basis||jsonb_build_object('ceiling',a.awarded_amount::text,'paid',paid::text,'currency',a.currency_code,'invoices',coalesce((SELECT jsonb_agg(to_jsonb(i)||jsonb_build_object('amount',i.amount::text,'net_amount',i.net_amount::text) ORDER BY i.id) FROM public.billing_invoice_records i WHERE i.funding_award_id=a.id AND i.status='paid'),'[]'));
 ELSIF p_event='reopen' THEN
  IF reopen_status NOT IN ('not_started','active','delayed') THEN RAISE EXCEPTION 'Reopen destination must be not_started, active or delayed' USING ERRCODE='22023'; END IF;
  basis:=basis||jsonb_build_object('reopenSpendingStatus',reopen_status);
  IF a.spending_status<>'fully_spent' OR coalesce(length(trim(p_note)),0)=0 THEN RAISE EXCEPTION 'Reopen requires a closed award and reason' USING ERRCODE='22023'; END IF;
 ELSE RAISE EXCEPTION 'Managed awards support earned closeout or explicit reopen' USING ERRCODE='22023'; END IF;
 INSERT INTO public.funding_award_closure_receipts(id,award_id,workspace_id,revision_id,event,basis,actor_id) VALUES(closure_id,a.id,a.workspace_id,p_expected,p_event,basis,p_actor);
 PERFORM set_config('openplan.award_closure_command',a.id::text,true);
 IF p_event='earned_coverage' THEN
  UPDATE public.funding_awards SET spending_status='fully_spent',closure_basis='earned_coverage',closed_at=clock_timestamp(),closed_by=p_actor,closure_note=p_note WHERE id=a.id;
  INSERT INTO public.project_milestones(project_id,title,milestone_type,status,actual_date,created_by,funding_award_id) VALUES(a.project_id,'Paid coverage against recorded award ceiling','closeout','complete',current_date,p_actor,a.id);
 ELSE
  UPDATE public.funding_awards SET spending_status=reopen_status,closure_basis=NULL,closed_at=NULL,closed_by=NULL,closure_note=NULL,reopened_at=clock_timestamp(),reopened_by=p_actor,reopen_reason=p_note WHERE id=a.id;
 END IF;
 UPDATE public.projects SET rtp_posture=NULL,rtp_posture_updated_at=NULL WHERE id=a.project_id;
 result:=jsonb_build_object('awardId',a.id,'revisionId',p_expected,'closureReceiptId',closure_id,'status',CASE WHEN p_event='reopen' THEN 'reopened' ELSE 'closed' END,'paid',paid::text,'closedAt',CASE WHEN p_event='earned_coverage' THEN clock_timestamp() END,'priorClosureBasis',a.closure_basis);
 IF p_event='reopen' THEN result:=result||jsonb_build_object('spendingStatus',reopen_status); END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.managed_award_closeout(uuid,uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.managed_award_closeout(uuid,uuid,uuid,text,text,text) TO service_role;

-- Keep the existing function identity, owner and ACL. Both call forms share every guard.
CREATE OR REPLACE FUNCTION public.managed_award_closeout(p_actor uuid,p_award uuid,p_expected uuid,p_event text,p_note text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT public.managed_award_closeout(p_actor,p_award,p_expected,p_event,p_note,NULL::text);
$$;
