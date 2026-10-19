-- Separate PL/pgSQL records from query aliases without changing validation or writes.
CREATE OR REPLACE FUNCTION public.award_handoff_state(p_actor uuid,p_award uuid,p_opportunity uuid,p_sources jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a public.funding_awards; o public.funding_opportunities; v_source jsonb; v_document public.kb_documents; e public.funding_opportunity_application_exports; obj storage.objects; refs jsonb:='[]'; proposal jsonb; application_snapshot jsonb;
BEGIN
 IF current_user NOT IN ('service_role','postgres') OR p_actor IS NULL THEN RAISE EXCEPTION 'Server actor required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(713,1);
 SELECT * INTO STRICT a FROM public.funding_awards WHERE id=p_award;
 PERFORM pg_advisory_xact_lock(hashtextextended(a.workspace_id::text,713));
 PERFORM FROM public.workspace_members WHERE workspace_id=a.workspace_id AND user_id=p_actor AND role IN ('owner','admin','member') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current programs writer required' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT a FROM public.funding_awards WHERE id=p_award FOR UPDATE;
 SELECT * INTO STRICT o FROM public.funding_opportunities WHERE id=p_opportunity FOR UPDATE;
 IF o.workspace_id<>a.workspace_id OR o.project_id IS DISTINCT FROM a.project_id OR o.pursuit_kind<>'grant' OR a.funding_opportunity_id IS NOT NULL AND a.funding_opportunity_id<>o.id THEN RAISE EXCEPTION 'Select a grant and matching award/project' USING ERRCODE='22023'; END IF;
 PERFORM FROM public.projects WHERE id=a.project_id AND workspace_id=a.workspace_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Project unavailable' USING ERRCODE='42501'; END IF;
 PERFORM FROM public.funding_opportunity_application_sections WHERE opportunity_id=o.id ORDER BY id FOR UPDATE;
 PERFORM FROM public.funding_opportunity_section_drafts WHERE opportunity_id=o.id ORDER BY id FOR SHARE;
 PERFORM FROM public.funding_opportunity_attachments WHERE opportunity_id=o.id ORDER BY id FOR SHARE;
 PERFORM FROM public.funding_opportunity_application_exports WHERE opportunity_id=o.id ORDER BY id FOR SHARE;
 IF EXISTS(SELECT FROM public.funding_opportunity_application_sections s WHERE s.opportunity_id=o.id AND (s.workspace_id<>a.workspace_id OR s.finalized_from_draft_id IS NOT NULL AND NOT EXISTS(SELECT FROM public.funding_opportunity_section_drafts d WHERE d.id=s.finalized_from_draft_id AND d.opportunity_id=o.id AND d.section_id=s.id AND d.workspace_id=a.workspace_id)))
 OR EXISTS(SELECT FROM public.funding_opportunity_section_drafts d WHERE d.opportunity_id=o.id AND d.workspace_id<>a.workspace_id)
 OR EXISTS(SELECT FROM public.funding_opportunity_attachments x WHERE x.opportunity_id=o.id AND x.workspace_id<>a.workspace_id)
 THEN RAISE EXCEPTION 'Application provenance scope is inconsistent' USING ERRCODE='42501'; END IF;
 -- Final text and finalizer/provenance identity share the application audience.
 -- Never copy private draft grounding, report text, attachment metadata or arbitrary URLs.
 proposal:=jsonb_build_object('label','Current reviewed application, not proof of submission','opportunityId',o.id,'title',o.title,
  'sections',coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'key',x.section_key,'title',x.title,'status',x.status,'finalText',x.final_markdown,'finalizer',x.finalized_by,'finalizedAt',x.finalized_at,'recordedEditor',x.updated_by,'finalizerBasis','Retained finalizer columns; null remains unrecorded legacy provenance','finalizedFromDraftId',x.finalized_from_draft_id,'updatedAt',x.updated_at) ORDER BY x.id) FROM public.funding_opportunity_application_sections x WHERE x.opportunity_id=o.id),'[]'),
  'draftProvenance',coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'sectionId',x.section_id,'author',x.created_by,'createdAt',x.created_at,'revisionOf',x.revision_of,'model',x.model,'origin',x.origin,'groundedSentenceCount',x.grounded_sentence_count,'totalSentenceCount',x.total_sentence_count) ORDER BY x.id) FROM public.funding_opportunity_section_drafts x WHERE x.opportunity_id=o.id),'[]'),
  'attachments',coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'key',x.attachment_key,'required',x.required,'status',x.status,'kbDocumentId',CASE WHEN EXISTS(SELECT FROM public.kb_documents d WHERE d.id=x.kb_document_id AND d.workspace_id=a.workspace_id AND public.handoff_ordinary_pdf(d)) THEN x.kb_document_id END,'availability',CASE WHEN x.report_artifact_id IS NOT NULL THEN 'Excluded source family; not retained' ELSE 'Select an allowed PDF separately' END) ORDER BY x.id) FROM public.funding_opportunity_attachments x WHERE x.opportunity_id=o.id),'[]'));
 application_snapshot:=proposal;
 IF a.latest_handoff_revision_id IS NOT NULL THEN SELECT r.proposal INTO proposal FROM public.funding_award_handoff_revisions r WHERE r.award_id=a.id ORDER BY r.sequence LIMIT 1; END IF;
 FOR v_source IN SELECT value FROM jsonb_array_elements(p_sources) ORDER BY value->>'family',value->>'id' LOOP
  IF v_source->>'family'='kb_pdf' THEN
   SELECT * INTO v_document FROM public.kb_documents WHERE id=(v_source->>'id')::uuid AND workspace_id=a.workspace_id FOR SHARE;
   IF v_document.id IS NULL OR NOT coalesce(public.handoff_ordinary_pdf(v_document),false) THEN RAISE EXCEPTION 'Only ordinary same-audience uploaded PDFs are allowed' USING ERRCODE='42501'; END IF;
   SELECT * INTO obj FROM storage.objects WHERE bucket_id='kb-documents' AND name=substring(v_document.storage_ref FROM length('storage://kb-documents/')+1) FOR SHARE;
   IF obj.id IS NULL THEN RAISE EXCEPTION 'Original PDF unavailable' USING ERRCODE='22023'; END IF;
   refs:=refs||jsonb_build_array(v_source||jsonb_build_object('bucket',obj.bucket_id,'objectName',obj.name,'objectIdentity',to_jsonb(obj)-'last_accessed_at'-'updated_at','checksum',v_document.checksum,'byteSize',v_document.byte_size));
  ELSIF v_source->>'family'='application_pdf' THEN
   SELECT * INTO e FROM public.funding_opportunity_application_exports WHERE id=(v_source->>'id')::uuid AND opportunity_id=o.id AND workspace_id=a.workspace_id FOR SHARE;
   IF e.id IS NULL OR e.storage_path NOT LIKE a.workspace_id||'/'||o.id||'/%' THEN RAISE EXCEPTION 'Application export unavailable' USING ERRCODE='42501'; END IF;
   -- Legacy exports have no checksum. Explicitly refuse rather than attest guessed bytes.
   RAISE EXCEPTION 'Application PDF exports lack an immutable upload checksum in this installation; use reviewed application rows and an ordinary uploaded notice PDF. Export retention is not enabled.' USING ERRCODE='22023';
  ELSE RAISE EXCEPTION 'Source family excluded' USING ERRCODE='42501'; END IF;
 END LOOP;
 PERFORM FROM public.project_submittals WHERE project_id=a.project_id ORDER BY id FOR UPDATE;
 PERFORM FROM public.project_milestones WHERE project_id=a.project_id ORDER BY id FOR UPDATE;
 PERFORM FROM public.billing_invoice_records WHERE funding_award_id=a.id ORDER BY id FOR UPDATE;
 RETURN jsonb_build_object('awardId',a.id,'workspaceId',a.workspace_id,'projectId',a.project_id,'opportunityId',o.id,
  'expectedLatest',a.latest_handoff_revision_id,'expectedCurrent',a.current_handoff_revision_id,'spendingStatus',a.spending_status,
  'proposal',proposal,'currentApplicationSnapshot',application_snapshot,'applicationMemberFingerprint',encode(sha256(convert_to(coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)::text FROM public.funding_opportunity_application_sections x WHERE x.opportunity_id=o.id),'[]')||coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)::text FROM public.funding_opportunity_section_drafts x WHERE x.opportunity_id=o.id),'[]')||coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)::text FROM public.funding_opportunity_attachments x WHERE x.opportunity_id=o.id),'[]')||coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)::text FROM public.funding_opportunity_application_exports x WHERE x.opportunity_id=o.id),'[]'),'UTF8')),'hex'),'sources',refs,
  'occurrences',coalesce((SELECT jsonb_agg(to_jsonb(x)||jsonb_build_object('outcome',coalesce((SELECT to_jsonb(t) FROM public.project_submittals t WHERE t.id=x.submittal_id),(SELECT to_jsonb(t) FROM public.project_milestones t WHERE t.id=x.milestone_id))) ORDER BY x.id) FROM public.funding_award_handoff_occurrences x WHERE x.revision_id=a.current_handoff_revision_id AND x.requirement->>'disposition'<>'withdraw'),'[]'),
  'legacyObligations',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.project_milestones m WHERE m.funding_award_id=a.id AND m.project_id=a.project_id AND m.milestone_type='obligation' AND m.handoff_origin_revision_id IS NULL),'[]'),
  'invoices',coalesce((SELECT jsonb_agg(to_jsonb(i)||jsonb_build_object('amount',i.amount::text,'retention_amount',i.retention_amount::text,'net_amount',i.net_amount::text) ORDER BY i.id) FROM public.billing_invoice_records i WHERE i.funding_award_id=a.id),'[]'));
END $$;

CREATE OR REPLACE FUNCTION public.award_handoff_command(p_actor uuid,p_award uuid,p_operation text,p_payload jsonb,p_hash text DEFAULT NULL,p_verified jsonb DEFAULT '[]') RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a public.funding_awards; r public.funding_award_handoff_revisions; t jsonb; state jsonb; reviewed jsonb; h text; rid uuid:=gen_random_uuid(); seq integer; receipt jsonb; x jsonb; src jsonb; prior public.funding_award_handoff_occurrences; sid uuid; mid uuid; oid uuid; outcome jsonb; due date; obligation timestamptz; expenditure timestamptz;
BEGIN
 IF current_user NOT IN ('service_role','postgres') OR p_actor IS NULL THEN RAISE EXCEPTION 'Server actor required' USING ERRCODE='42501'; END IF;
 -- Before row locks, take the same statement-level mutex as every affected writer.
 PERFORM pg_advisory_xact_lock(713,1);
 SELECT * INTO STRICT a FROM public.funding_awards WHERE id=p_award;
 PERFORM pg_advisory_xact_lock(hashtextextended(a.workspace_id::text,713));
 PERFORM FROM public.workspace_members WHERE workspace_id=a.workspace_id AND user_id=p_actor AND role IN ('owner','admin','member') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current programs writer required' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT a FROM public.funding_awards WHERE id=p_award FOR UPDATE;
 IF p_operation='apply' THEN
  SELECT * INTO r FROM public.funding_award_handoff_revisions WHERE workspace_id=a.workspace_id AND request_key=(p_payload->>'requestKey')::uuid;
  IF r.id IS NOT NULL THEN
   IF r.award_id<>a.id OR r.actor_id<>p_actor OR r.reviewed_payload IS DISTINCT FROM p_payload OR r.reviewed_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'Request key reused with changed actor/payload' USING ERRCODE='PT409'; END IF;
   RETURN r.receipt;
  END IF;
  t:=p_payload->'terms';
 ELSE t:=p_payload->'terms'; END IF;
 PERFORM public.handoff_validate_terms(t);
 IF t->'issuanceDisposition'->>'state' IN ('rescinded','corrected') AND NOT EXISTS(SELECT FROM public.funding_award_handoff_revisions prior_revision WHERE prior_revision.id=(t->'issuanceDisposition'->>'priorRevisionId')::uuid AND prior_revision.award_id=a.id) THEN RAISE EXCEPTION 'Correction/rescission must link this awards earlier retained issuance' USING ERRCODE='22023'; END IF;
 state:=public.award_handoff_state(p_actor,a.id,(p_payload->>'opportunityId')::uuid,t->'sources');
 IF p_operation='preview' THEN
  reviewed:=jsonb_build_object('schemaVersion',1,'requestKey',(p_payload->>'requestKey')::uuid,'opportunityId',p_payload->>'opportunityId','state',state,'terms',t);
  h:=encode(sha256(convert_to(reviewed::text,'UTF8')),'hex');
  RETURN jsonb_build_object('reviewed',reviewed,'reviewHash',h);
 END IF;
 IF p_operation<>'apply' THEN RAISE EXCEPTION 'Unknown handoff operation' USING ERRCODE='22023'; END IF;
 h:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
 IF p_hash IS DISTINCT FROM h OR p_payload->'state' IS DISTINCT FROM state THEN RAISE EXCEPTION 'Sources, outcomes or terms pointers changed; review again' USING ERRCODE='PT409'; END IF;
 IF jsonb_array_length(p_verified)<>jsonb_array_length(state->'sources') OR EXISTS(SELECT FROM jsonb_array_elements(state->'sources') s WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(p_verified) v WHERE v->>'id'=s->>'id' AND v->>'checksum'=s->>'checksum' AND v->>'byteSize'=s->>'byteSize' AND v->'objectIdentity'=s->'objectIdentity')) THEN RAISE EXCEPTION 'Server byte verification required' USING ERRCODE='22023'; END IF;
 IF (t->>'effective')::boolean AND a.spending_status='fully_spent' THEN RAISE EXCEPTION 'Explicitly reopen the closed award before changing effective terms' USING ERRCODE='22023'; END IF;
 -- Complete current set must be reconciled, including withdrawn requirements.
 IF (t->>'effective')::boolean AND EXISTS(SELECT FROM jsonb_array_elements(state->'occurrences') old WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(t->'occurrences') n WHERE n->>'priorOccurrenceId'=old->>'id')) THEN RAISE EXCEPTION 'Reconcile every current occurrence, including withdrawals' USING ERRCODE='22023'; END IF;
 seq:=coalesce((SELECT max(sequence) FROM public.funding_award_handoff_revisions WHERE award_id=a.id),0)+1;
 receipt:=jsonb_build_object('revisionId',rid,'awardId',a.id,'sequence',seq,'requestKey',p_payload->>'requestKey','reviewHash',h,'effective',(t->>'effective')::boolean,'amountMeaning','recorded_award_ceiling');
 INSERT INTO public.funding_award_handoff_revisions(id,workspace_id,project_id,opportunity_id,award_id,sequence,predecessor_id,request_key,reviewed_hash,reviewed_payload,proposal,proposal_hash,terms,receipt,actor_id)
 VALUES(rid,a.workspace_id,a.project_id,(p_payload->>'opportunityId')::uuid,a.id,seq,a.latest_handoff_revision_id,(p_payload->>'requestKey')::uuid,h,p_payload,state->'proposal',encode(sha256(convert_to((state->'proposal')::text,'UTF8')),'hex'),t,receipt,p_actor);
 PERFORM set_config('openplan.award_handoff_command',rid::text,true);
 FOR src IN SELECT value FROM jsonb_array_elements(state->'sources') LOOP
  INSERT INTO public.funding_award_handoff_sources(revision_id,family,source_id,kb_document_id,export_id,bucket,object_name,object_identity,checksum,byte_size,receipt)
  VALUES(rid,src->>'family',(src->>'id')::uuid,CASE WHEN src->>'family'='kb_pdf' THEN (src->>'id')::uuid END,CASE WHEN src->>'family'='application_pdf' THEN (src->>'id')::uuid END,src->>'bucket',src->>'objectName',src->'objectIdentity',src->>'checksum',(src->>'byteSize')::bigint,src);
 END LOOP;
 IF (t->>'effective')::boolean THEN
  FOR x IN SELECT value FROM jsonb_array_elements(t->'occurrences') LOOP
   sid:=NULL; mid:=NULL; outcome:=NULL; prior:=NULL;
   IF x->>'disposition'='adopt_legacy' THEN
    IF x->>'kind'<>'obligation' OR x->>'priorOccurrenceId' IS NOT NULL OR x->>'legacyObligationId' IS NULL OR x->>'fulfillmentStillApplies' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Explicit legacy obligation and applicability review required' USING ERRCODE='22023'; END IF;
    SELECT id,to_jsonb(m) INTO mid,outcome FROM public.project_milestones m WHERE m.id=(x->>'legacyObligationId')::uuid AND m.funding_award_id=a.id AND m.project_id=a.project_id AND m.milestone_type='obligation' AND m.handoff_origin_revision_id IS NULL;
    IF mid IS NULL THEN RAISE EXCEPTION 'Selected legacy obligation is unavailable or already managed' USING ERRCODE='PT409'; END IF;
   ELSIF x->>'legacyObligationId' IS NOT NULL THEN RAISE EXCEPTION 'Legacy selection requires explicit adoption' USING ERRCODE='22023'; END IF;
   IF x->>'disposition'='new' AND x->>'priorOccurrenceId' IS NOT NULL THEN RAISE EXCEPTION 'New work cannot replace an existing occurrence without a reviewed disposition' USING ERRCODE='22023'; END IF;
   IF x->>'priorOccurrenceId' IS NOT NULL THEN
    SELECT * INTO prior FROM public.funding_award_handoff_occurrences WHERE id=(x->>'priorOccurrenceId')::uuid AND revision_id=a.current_handoff_revision_id AND award_id=a.id;
    IF prior.id IS NULL THEN RAISE EXCEPTION 'Prior occurrence is not current for this award' USING ERRCODE='22023'; END IF;
    IF x->>'disposition' IN ('carry','reschedule','reopen','withdraw') AND (x->>'conditionKey'<>prior.condition_key OR x->>'occurrenceKey'<>prior.occurrence_key) THEN RAISE EXCEPTION 'Retain stable occurrence identity' USING ERRCODE='22023'; END IF;
    IF x->>'disposition'='replace' AND x->>'conditionKey'=prior.condition_key AND x->>'occurrenceKey'=prior.occurrence_key THEN RAISE EXCEPTION 'Replacement requires a new occurrence key' USING ERRCODE='22023'; END IF;
    IF x->>'disposition' IN ('carry','reschedule') THEN
     IF (x-'disposition'-'priorOccurrenceId'-'reason'-'fulfillmentStillApplies'-'clock'-'legacyObligationId') IS DISTINCT FROM (prior.requirement-'disposition'-'priorOccurrenceId'-'reason'-'fulfillmentStillApplies'-'clock'-'legacyObligationId') OR (x->>'disposition'='carry' AND x->'clock' IS DISTINCT FROM prior.requirement->'clock') THEN RAISE EXCEPTION 'Changed work needs explicit replacement/reopen/withdrawal' USING ERRCODE='22023'; END IF;
     sid:=prior.submittal_id; mid:=prior.milestone_id;
     outcome:=coalesce((SELECT to_jsonb(s) FROM public.project_submittals s WHERE id=sid),(SELECT to_jsonb(m) FROM public.project_milestones m WHERE id=mid));
     IF x->>'disposition'='reschedule' AND coalesce(outcome->>'status','') IN ('submitted','accepted','complete') AND x->>'fulfillmentStillApplies' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Resolve applicability of completed work before rescheduling' USING ERRCODE='22023'; END IF;
    END IF;
   ELSIF x->>'disposition' NOT IN ('new','adopt_legacy') THEN RAISE EXCEPTION 'Prior occurrence required' USING ERRCODE='22023'; END IF;
   IF prior.id IS NOT NULL AND outcome IS NULL THEN outcome:=coalesce((SELECT to_jsonb(s) FROM public.project_submittals s WHERE id=prior.submittal_id),(SELECT to_jsonb(m) FROM public.project_milestones m WHERE id=prior.milestone_id)); END IF;
   due:=CASE x->'clock'->>'kind' WHEN 'date_only' THEN (x->'clock'->>'date')::date WHEN 'instant' THEN (x->'clock'->>'calendarDate')::date END;
   IF x->>'kind'='obligation' AND x->>'disposition'='new' AND EXISTS(SELECT FROM public.project_milestones WHERE funding_award_id=a.id AND milestone_type='obligation') THEN RAISE EXCEPTION 'Explicitly adopt the existing legacy obligation; unresolved clocks cannot omit its actual fulfillment' USING ERRCODE='22023'; END IF;
   -- Reopened/replacement work has one target even while its date is unresolved.
   IF x->>'disposition'<>'withdraw' AND (due IS NOT NULL OR x->>'disposition' IN ('reopen','replace','adopt_legacy')) THEN
    IF x->>'kind'='report' AND sid IS NULL THEN
     sid:=gen_random_uuid();
     INSERT INTO public.project_submittals(id,project_id,title,submittal_type,status,due_date,notes,created_by,funding_award_id,handoff_origin_revision_id,handoff_condition_key,handoff_occurrence_key)
     VALUES(sid,a.project_id,x->>'requirement','progress_report','draft',due,x->>'citation',p_actor,a.id,rid,x->>'conditionKey',x->>'occurrenceKey');
    ELSIF x->>'kind'='obligation' THEN
     -- A completed original obligation remains fulfilled. Reopened/replacement
     -- work is a new schedule record linked to its immutable prior occurrence.
     IF mid IS NULL AND EXISTS(SELECT FROM public.project_milestones WHERE funding_award_id=a.id AND milestone_type='obligation') AND x->>'disposition' NOT IN ('reopen','replace') THEN RAISE EXCEPTION 'Select explicit legacy adoption or reconcile the current obligation' USING ERRCODE='22023'; END IF;
     IF mid IS NULL THEN
      mid:=gen_random_uuid(); INSERT INTO public.project_milestones(id,project_id,title,milestone_type,status,target_date,created_by,funding_award_id,handoff_origin_revision_id,handoff_condition_key,handoff_occurrence_key)
      VALUES(mid,a.project_id,x->>'requirement',CASE WHEN x->>'disposition' IN ('reopen','replace') AND EXISTS(SELECT FROM public.project_milestones WHERE funding_award_id=a.id AND milestone_type='obligation') THEN 'schedule' ELSE 'obligation' END,'scheduled',due,p_actor,a.id,rid,x->>'conditionKey',x->>'occurrenceKey');
     END IF;
     obligation:=CASE WHEN x->'clock'->>'kind'='instant' THEN (x->'clock'->>'value')::timestamptz ELSE due::timestamp AT TIME ZONE 'UTC' END;
    ELSIF x->>'kind'='expenditure' THEN
     IF mid IS NULL THEN
      mid:=gen_random_uuid(); INSERT INTO public.project_milestones(id,project_id,title,milestone_type,status,target_date,created_by,funding_award_id,handoff_origin_revision_id,handoff_condition_key,handoff_occurrence_key)
      VALUES(mid,a.project_id,x->>'requirement','schedule','scheduled',due,p_actor,a.id,rid,x->>'conditionKey',x->>'occurrenceKey');
     END IF;
     expenditure:=CASE WHEN x->'clock'->>'kind'='instant' THEN (x->'clock'->>'value')::timestamptz ELSE due::timestamp AT TIME ZONE 'UTC' END;
    END IF;
   END IF;
   IF x->>'disposition'<>'withdraw' THEN
    IF sid IS NOT NULL AND x->>'disposition'='reschedule' THEN UPDATE public.project_submittals SET due_date=due WHERE id=sid; END IF;
    IF mid IS NOT NULL THEN UPDATE public.project_milestones SET target_date=due,handoff_origin_revision_id=coalesce(handoff_origin_revision_id,rid),handoff_condition_key=coalesce(handoff_condition_key,x->>'conditionKey'),handoff_occurrence_key=coalesce(handoff_occurrence_key,x->>'occurrenceKey') WHERE id=mid; END IF;
    IF x->>'kind'='obligation' THEN obligation:=CASE WHEN x->'clock'->>'kind'='instant' THEN (x->'clock'->>'value')::timestamptz ELSE due::timestamp AT TIME ZONE 'UTC' END; END IF;
    IF x->>'kind'='expenditure' THEN expenditure:=CASE WHEN x->'clock'->>'kind'='instant' THEN (x->'clock'->>'value')::timestamptz ELSE due::timestamp AT TIME ZONE 'UTC' END; END IF;
   END IF;
   oid:=gen_random_uuid();
   INSERT INTO public.funding_award_handoff_occurrences(id,revision_id,award_id,project_id,workspace_id,condition_key,occurrence_key,requirement,prior_occurrence_id,submittal_id,milestone_id,outcome_snapshot)
   VALUES(oid,rid,a.id,a.project_id,a.workspace_id,x->>'conditionKey',x->>'occurrenceKey',x,prior.id,sid,mid,outcome);
  END LOOP;
  IF (SELECT count(*) FROM jsonb_array_elements(t->'occurrences') expenditure_item WHERE expenditure_item->>'kind'='expenditure' AND expenditure_item->>'disposition'<>'withdraw')>1 THEN expenditure:=NULL; END IF;
  FOR x IN SELECT value FROM jsonb_array_elements(t->'invoiceApplicability') LOOP
   UPDATE public.billing_invoice_records SET handoff_applicable_revision_id=rid WHERE id=(x->>'invoiceId')::uuid AND funding_award_id=a.id AND award_handoff_revision_id IS NOT NULL AND currency_code=t->'currency'->>'code';
   IF NOT FOUND THEN RAISE EXCEPTION 'Only known-currency version-bound invoices can be explicitly carried' USING ERRCODE='22023'; END IF;
  END LOOP;
 END IF;
 UPDATE public.funding_awards SET funding_opportunity_id=(p_payload->>'opportunityId')::uuid,latest_handoff_revision_id=rid,
  current_handoff_revision_id=CASE WHEN (t->>'effective')::boolean THEN rid ELSE current_handoff_revision_id END,
  awarded_amount=CASE WHEN (t->>'effective')::boolean THEN (t->>'ceiling')::numeric ELSE awarded_amount END,
  match_amount=CASE WHEN (t->>'effective')::boolean THEN (t->>'match')::numeric ELSE match_amount END,
  currency_code=CASE WHEN (t->>'effective')::boolean THEN t->'currency'->>'code' ELSE currency_code END,
  obligation_due_at=CASE WHEN (t->>'effective')::boolean THEN obligation ELSE obligation_due_at END,
  expenditure_deadline_at=CASE WHEN (t->>'effective')::boolean THEN expenditure ELSE expenditure_deadline_at END,
  has_source_backed_issuance=true,updated_at=clock_timestamp() WHERE id=a.id;
 UPDATE public.funding_opportunities SET has_source_backed_issuance=true WHERE id=(p_payload->>'opportunityId')::uuid;
 -- Invalidate stale cached posture in the transaction, before an optional later rebuild.
 UPDATE public.projects SET rtp_posture=NULL,rtp_posture_updated_at=NULL WHERE id=a.project_id;
 RETURN receipt;
END $$;
