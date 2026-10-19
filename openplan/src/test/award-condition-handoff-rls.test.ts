import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {isAbsolute} from 'node:path';
import {beforeAll,describe,it,expect} from 'vitest';
import {LIVE_RLS} from './local-supabase-env';
import {resolveLocalDbContainer} from './helpers/live-catalog';
import {awardTermsFixture} from './fixtures/grants/award-handoff';

// Prepared, unrun. Isolated SQL role/transaction controls only. Synthetic
// storage.objects rows are not uploaded PDF bytes or a Storage acceptance test.
(LIVE_RLS?describe:describe.skip)('award condition handoff transactional boundaries',()=>{
 let container:string;
 beforeAll(()=>{
  if(process.env.GITHUB_ACTIONS!=='true'&&!isAbsolute(process.env.OPENPLAN_SUPABASE_WORKDIR??''))throw new Error('Select an explicit isolated Supabase workdir.');
  container=resolveLocalDbContainer();
 });
 function exercise(body:string){
  const actor=randomUUID(),viewer=randomUUID(),project=randomUUID(),opp=randomUUID(),award=randomUUID(),document=randomUUID();
  const terms=awardTermsFixture();terms.noticeSourceId=document;terms.sources[0].id=document;
  const literal=JSON.stringify(terms).replaceAll("'","''");
  const sql=`BEGIN; SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='2s';
   INSERT INTO auth.users(id,email) VALUES('${actor}','${actor}@example.test'),('${viewer}','${viewer}@example.test');
   CREATE TEMP TABLE handoff_fixture AS SELECT workspace_id w FROM public.workspace_members WHERE user_id='${actor}' AND role='owner' LIMIT 1;
   GRANT SELECT ON handoff_fixture TO service_role,authenticated;
   INSERT INTO public.workspace_members(workspace_id,user_id,role) SELECT w,'${viewer}','viewer' FROM handoff_fixture;
   INSERT INTO public.projects(id,workspace_id,name) SELECT '${project}',w,'Synthetic handoff project' FROM handoff_fixture;
   INSERT INTO public.funding_opportunities(id,workspace_id,project_id,title,pursuit_kind) SELECT '${opp}',w,'${project}','Synthetic grant','grant' FROM handoff_fixture;
   INSERT INTO public.funding_awards(id,workspace_id,project_id,funding_opportunity_id,title) SELECT '${award}',w,'${project}','${opp}','Synthetic award' FROM handoff_fixture;
   INSERT INTO storage.objects(bucket_id,name,metadata) SELECT 'kb-documents',w||'/${document}/notice.pdf','{"size":5}' FROM handoff_fixture;
   INSERT INTO public.kb_documents(id,workspace_id,title,source_kind,content_type,byte_size,checksum,storage_ref,status) SELECT '${document}',w,'Synthetic notice identity','uploaded_pdf','application/pdf',5,repeat('a',64),'storage://kb-documents/'||w||'/${document}/notice.pdf','stored' FROM handoff_fixture;
   CREATE FUNCTION pg_temp.assert_handoff(ok boolean,reason text) RETURNS void LANGUAGE plpgsql AS $f$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%',reason;END IF;END $f$;
   CREATE FUNCTION pg_temp.handoff_preview(t jsonb DEFAULT '${literal}'::jsonb) RETURNS jsonb LANGUAGE sql AS $f$
    SELECT public.award_handoff_command('${actor}','${award}','preview',jsonb_build_object('requestKey',gen_random_uuid(),'opportunityId','${opp}','terms',t));$f$;
   CREATE FUNCTION pg_temp.handoff_apply(p jsonb) RETURNS jsonb LANGUAGE sql AS $f$
    SELECT public.award_handoff_command('${actor}','${award}','apply',p->'reviewed',p->>'reviewHash',(SELECT jsonb_agg(jsonb_build_object('id',s->>'id','checksum',s->>'checksum','byteSize',s->'byteSize','objectIdentity',s->'objectIdentity')) FROM jsonb_array_elements(p->'reviewed'->'state'->'sources') s));$f$;
   SET LOCAL ROLE service_role;
   ${body}
   RESET ROLE; SELECT 'AWARD_HANDOFF_ASSERTIONS_REACHED'; ROLLBACK;`;
  const result=spawnSync('docker',['exec','-i',container,'psql','-X','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],{input:sql.replaceAll('__ACTOR__',actor).replaceAll('__VIEWER__',viewer).replaceAll('__PROJECT__',project).replaceAll('__AWARD__',award).replaceAll('__OPPORTUNITY__',opp).replaceAll('__DOCUMENT__',document),encoding:'utf8',timeout:20000,maxBuffer:2*1024*1024});
  expect(result.error).toBeUndefined();expect(result.status,result.stderr).toBe(0);expect(result.stdout).toContain('AWARD_HANDOFF_ASSERTIONS_REACHED');
 }
 it('retains the legacy expenditure source through a first pending handoff, then switches at the first effective version',()=>exercise(`
  DO $$ DECLARE p jsonb; t jsonb; r jsonb; BEGIN
   UPDATE public.funding_awards SET expenditure_deadline_at='2027-05-01T00:00:00Z' WHERE id='__AWARD__';
   PERFORM pg_temp.assert_handoff((SELECT expenditure_deadline_at='2027-05-01T00:00:00Z' FROM public.legacy_calendar_funding_awards WHERE id='__AWARD__'),'Ordinary legacy deadline source missing');
   t:=jsonb_set(pg_temp.handoff_preview()->'reviewed'->'terms','{effective}','false');
   p:=pg_temp.handoff_preview(t);r:=pg_temp.handoff_apply(p);
   PERFORM pg_temp.assert_handoff((SELECT latest_handoff_revision_id=(r->>'revisionId')::uuid AND current_handoff_revision_id IS NULL AND expenditure_deadline_at='2027-05-01T00:00:00Z' FROM public.legacy_calendar_funding_awards WHERE id='__AWARD__'),'Pending first terms suppressed the legacy expenditure reminder source');
   PERFORM pg_temp.assert_handoff(NOT EXISTS(SELECT FROM public.current_award_handoff_records WHERE award_id='__AWARD__'),'Pending first terms materialized current work');
   t:=jsonb_set(t,'{effective}','true');
   t:=jsonb_set(t,'{occurrences}',jsonb_build_array((t->'occurrences'->0)||jsonb_build_object('kind','expenditure','clock',jsonb_build_object('kind','date_only','date','2027-06-01'))));
   r:=pg_temp.handoff_apply(pg_temp.handoff_preview(t));
   PERFORM pg_temp.assert_handoff(NOT EXISTS(SELECT FROM public.legacy_calendar_funding_awards WHERE id='__AWARD__'),'Effective terms left a duplicate legacy source');
   PERFORM pg_temp.assert_handoff((SELECT count(*)=1 FROM public.current_award_handoff_records WHERE award_id='__AWARD__'),'First effective expenditure occurrence lost or duplicated');
   PERFORM pg_temp.assert_handoff((SELECT target_date='2027-06-01' FROM public.active_project_milestones WHERE funding_award_id='__AWARD__'),'Effective current clock not projected');
  END $$;`));
 it('composes contract transaction entry before its existing locks without adding a mutex inside read-only scope helpers',()=>exercise(`
  DO $$ DECLARE name text; body text; BEGIN
   FOREACH name IN ARRAY ARRAY['record_contract_import','finish_contract_calculation','apply_ss4a_safety_seed'] LOOP
    SELECT prosrc INTO STRICT body FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=name;
    PERFORM pg_temp.assert_handoff(body ~* 'BEGIN[[:space:]]+PERFORM pg_catalog.pg_advisory_xact_lock\\(713,1\\);','Transaction entry lacks the first mutex statement: '||name);
   END LOOP;
   FOREACH name IN ARRAY ARRAY['assert_assistant_provider_scope','assert_map_package_writer','capture_engagement_configuration','retain_contract_agreements'] LOOP
    SELECT prosrc INTO STRICT body FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=name;
    PERFORM pg_temp.assert_handoff(position('pg_advisory_xact_lock(713,1)' IN body)=0,'Nested helper introduces row/global inversion: '||name);
   END LOOP;
  END $$;`));
 it('records two occurrences once, replays exact receipts and carries an accepted report through amendment',()=>exercise(`
  DO $$ DECLARE p jsonb:=pg_temp.handoff_preview(); receipt jsonb; t jsonb; next jsonb; old_target uuid; BEGIN
   receipt:=pg_temp.handoff_apply(p);
   PERFORM pg_temp.assert_handoff(receipt=pg_temp.handoff_apply(p),'Exact receipt replay changed');
   PERFORM pg_temp.assert_handoff((SELECT count(*)=2 FROM public.project_submittals WHERE funding_award_id='__AWARD__'),'Two dates duplicated or lost');
   SELECT submittal_id INTO old_target FROM public.funding_award_handoff_occurrences WHERE award_id='__AWARD__' AND occurrence_key='first';
   UPDATE public.project_submittals SET status='accepted',submitted_at='2027-01-16T12:00:00Z',notes='Synthetic actual receipt' WHERE id=old_target;
   t:=p->'reviewed'->'terms';
   SELECT jsonb_set(t,'{occurrences}',jsonb_agg(o.requirement||jsonb_build_object('disposition','carry','priorOccurrenceId',o.id,'reason','Same requirement','fulfillmentStillApplies',true) ORDER BY o.occurrence_key)) INTO t FROM public.funding_award_handoff_occurrences o WHERE revision_id=(receipt->>'revisionId')::uuid;
   next:=pg_temp.handoff_preview(t); PERFORM pg_temp.handoff_apply(next);
   PERFORM pg_temp.assert_handoff((SELECT count(*)=2 FROM public.project_submittals WHERE funding_award_id='__AWARD__'),'Unchanged work became new drafts');
   PERFORM pg_temp.assert_handoff((SELECT submittal_id=old_target FROM public.current_award_handoff_records WHERE award_id='__AWARD__' AND occurrence_key='first'),'Current link lost completed target');
   PERFORM pg_temp.assert_handoff((SELECT submittal_status='accepted' AND submitted_at IS NOT NULL FROM public.funding_award_handoff_fulfillment WHERE award_id='__AWARD__' AND occurrence_key='first'),'Accepted outcome lost');
   PERFORM pg_temp.assert_handoff(pg_temp.handoff_apply(p)=receipt,'Later terms changed committed replay');
   BEGIN PERFORM public.award_handoff_command('__ACTOR__','__AWARD__','apply',jsonb_set(p->'reviewed','{requestKey}',to_jsonb(gen_random_uuid())),p->>'reviewHash','[]');RAISE EXCEPTION 'Changed key/stale state accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
  END $$;`));
 it('rolls back calendar failure and refuses source edits, mutable history, source deletion and storage replacement',()=>exercise(`
  RESET ROLE;
  CREATE FUNCTION pg_temp.break_calendar() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'Synthetic calendar failure' USING ERRCODE='23514';END $f$;
  CREATE TRIGGER synthetic_calendar_failure BEFORE INSERT ON public.project_submittals FOR EACH ROW EXECUTE FUNCTION pg_temp.break_calendar();
  SET LOCAL ROLE service_role;
  DO $$ DECLARE p jsonb:=pg_temp.handoff_preview(); BEGIN
   BEGIN PERFORM pg_temp.handoff_apply(p);RAISE EXCEPTION 'Partial calendar apply accepted';EXCEPTION WHEN check_violation THEN NULL;END;
   PERFORM pg_temp.assert_handoff(NOT EXISTS(SELECT FROM public.funding_award_handoff_revisions WHERE award_id='__AWARD__'),'Failed calendar left revision');
   PERFORM pg_temp.assert_handoff((SELECT current_handoff_revision_id IS NULL FROM public.funding_awards WHERE id='__AWARD__'),'Failed calendar changed award');
  END $$;
  RESET ROLE;DROP TRIGGER synthetic_calendar_failure ON public.project_submittals;SET LOCAL ROLE service_role;
  SELECT pg_temp.handoff_apply(pg_temp.handoff_preview());
  DO $$ BEGIN
   BEGIN DELETE FROM public.kb_documents WHERE id='__DOCUMENT__';RAISE EXCEPTION 'Retained PDF deleted';EXCEPTION WHEN foreign_key_violation THEN NULL;END;
   BEGIN UPDATE storage.objects SET metadata='{}' WHERE bucket_id='kb-documents' AND name LIKE '%/__DOCUMENT__/notice.pdf';RAISE EXCEPTION 'Original object replaced';EXCEPTION WHEN check_violation THEN NULL;END;
   BEGIN UPDATE public.funding_awards SET awarded_amount=101 WHERE id='__AWARD__';RAISE EXCEPTION 'Managed money edited';EXCEPTION WHEN check_violation THEN NULL;END;
   BEGIN UPDATE public.funding_award_handoff_revisions SET receipt='{}' WHERE award_id='__AWARD__';RAISE EXCEPTION 'Revision rewritten';EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;END;
  END $$;`));
 it('refuses unbound paid coverage, stale closeout and viewer execution while retaining pursuit/decline independently',()=>exercise(`
  DO $$ DECLARE p jsonb:=pg_temp.handoff_preview(); r jsonb; other uuid:=gen_random_uuid(); t jsonb; second jsonb; BEGIN
   -- Legacy paid row before handoff remains unbound and cannot earn managed closure.
   INSERT INTO public.billing_invoice_records(workspace_id,project_id,funding_award_id,invoice_number,status,amount,net_amount)
   SELECT w,'__PROJECT__','__AWARD__','Synthetic legacy paid','paid',100.01,100.01 FROM handoff_fixture;
   p:=pg_temp.handoff_preview();r:=pg_temp.handoff_apply(p);
   BEGIN PERFORM public.managed_award_closeout('__ACTOR__','__AWARD__',(r->>'revisionId')::uuid,'earned_coverage',NULL);RAISE EXCEPTION 'Unbound paid row earned closure';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
   BEGIN PERFORM public.managed_award_closeout('__ACTOR__','__AWARD__',gen_random_uuid(),'earned_coverage',NULL);RAISE EXCEPTION 'Stale closure accepted';EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
   INSERT INTO public.funding_awards(id,workspace_id,project_id,funding_opportunity_id,title) SELECT other,w,'__PROJECT__','__OPPORTUNITY__','Synthetic second award' FROM handoff_fixture;
   t:=jsonb_set(jsonb_set(jsonb_set(p->'reviewed'->'terms','{acceptance}','"declined"'),'{acceptanceSourceId}','"__DOCUMENT__"'),'{acceptanceEvidence}','"Synthetic retained recipient decline provision"');
   second:=public.award_handoff_command('__ACTOR__',other,'preview',jsonb_build_object('requestKey',gen_random_uuid(),'opportunityId','__OPPORTUNITY__','terms',jsonb_set(t,'{effective}','false')));
   PERFORM public.award_handoff_command('__ACTOR__',other,'apply',second->'reviewed',second->>'reviewHash',(SELECT jsonb_agg(jsonb_build_object('id',s->>'id','checksum',s->>'checksum','byteSize',s->'byteSize','objectIdentity',s->'objectIdentity')) FROM jsonb_array_elements(second->'reviewed'->'state'->'sources') s));
   PERFORM pg_temp.assert_handoff((SELECT source_backed_award_count=2 FROM public.funding_opportunity_issuance WHERE opportunity_id='__OPPORTUNITY__'),'Distinct awards, pending terms or decline lost issuance');
   UPDATE public.funding_opportunities SET decision_state='denied',opportunity_status='archived' WHERE id='__OPPORTUNITY__';
   PERFORM pg_temp.assert_handoff((SELECT has_source_backed_issuance AND decision_state='denied' FROM public.funding_opportunities WHERE id='__OPPORTUNITY__'),'Pursuit edit erased issuance');
   BEGIN PERFORM public.award_handoff_command('__VIEWER__','__AWARD__','apply',p->'reviewed',p->>'reviewHash','[]');RAISE EXCEPTION 'Viewer replay accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
  END $$;
  RESET ROLE;SET LOCAL ROLE authenticated;
  DO $$ BEGIN
   PERFORM pg_temp.assert_handoff(NOT has_function_privilege(current_user,'public.award_handoff_command(uuid,uuid,text,jsonb,text,jsonb)','EXECUTE'),'Authenticated service RPC executable');
   PERFORM pg_temp.assert_handoff(NOT has_table_privilege(current_user,'public.funding_award_handoff_revisions','INSERT'),'Authenticated direct revision INSERT allowed');
  END $$;`));
 it('keeps bound invoice identity through null, currency-clear and reparent attempts',()=>exercise(`
  DO $$ DECLARE r jsonb:=pg_temp.handoff_apply(pg_temp.handoff_preview()); invoice uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); BEGIN
   INSERT INTO public.funding_awards(id,workspace_id,project_id,title) SELECT other,w,'__PROJECT__','Synthetic unmanaged destination' FROM handoff_fixture;
   INSERT INTO public.billing_invoice_records(id,workspace_id,project_id,funding_award_id,invoice_number,status,amount,retention_amount,net_amount,award_handoff_revision_id,currency_code)
   SELECT invoice,w,'__PROJECT__','__AWARD__','Synthetic bound invoice','draft',1.01,0,1.01,(r->>'revisionId')::uuid,'USD' FROM handoff_fixture;
  END $$;
  RESET ROLE;
  SELECT set_config('request.jwt.claims',jsonb_build_object('sub','__ACTOR__','role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  DO $$ DECLARE invoice uuid; original uuid; other uuid; BEGIN
   SELECT id,award_handoff_revision_id INTO invoice,original FROM public.billing_invoice_records WHERE funding_award_id='__AWARD__';
   SELECT id INTO other FROM public.funding_awards WHERE project_id='__PROJECT__' AND id<>'__AWARD__';
   -- A harmless outcome edit survives while original financial identity stays fixed.
   UPDATE public.billing_invoice_records SET notes='Synthetic ordinary note' WHERE id=invoice;
   BEGIN UPDATE public.billing_invoice_records SET award_handoff_revision_id=NULL,currency_code=NULL WHERE id=invoice;RAISE EXCEPTION 'Bound identity cleared';EXCEPTION WHEN check_violation THEN NULL;END;
   BEGIN UPDATE public.billing_invoice_records SET funding_award_id=other,award_handoff_revision_id=NULL,currency_code=NULL WHERE id=invoice;RAISE EXCEPTION 'Bound identity reparented';EXCEPTION WHEN check_violation THEN NULL;END;
   BEGIN UPDATE public.billing_invoice_records SET currency_code=NULL WHERE id=invoice;RAISE EXCEPTION 'Bound currency cleared';EXCEPTION WHEN check_violation THEN NULL;END;
   PERFORM pg_temp.assert_handoff((SELECT award_handoff_revision_id=original AND currency_code='USD' AND funding_award_id='__AWARD__' FROM public.billing_invoice_records WHERE id=invoice),'Original invoice binding lost');
  END $$;
  RESET ROLE;SET LOCAL ROLE service_role;`));
 it('clears unresolved report dates and later reuses the same actionable target',()=>exercise(`
  DO $$ DECLARE p jsonb:=pg_temp.handoff_preview(); r jsonb; t jsonb; target uuid; BEGIN
   r:=pg_temp.handoff_apply(p);
   SELECT submittal_id INTO target FROM public.current_award_handoff_records WHERE award_id='__AWARD__' AND occurrence_key='first';
   UPDATE public.project_submittals SET agency_label='Synthetic officer',assignee_user_id='__ACTOR__',notes='Synthetic history' WHERE id=target;
   SELECT jsonb_set(p->'reviewed'->'terms','{occurrences}',jsonb_agg(o.requirement||jsonb_build_object('disposition',CASE WHEN occurrence_key='first' THEN 'reschedule' ELSE 'carry' END,'priorOccurrenceId',o.id,'reason','Source trigger unresolved','fulfillmentStillApplies',true,'clock',CASE WHEN occurrence_key='first' THEN jsonb_build_object('kind','unresolved_trigger','trigger','Source confirmation pending') ELSE o.requirement->'clock' END) ORDER BY occurrence_key)) INTO t FROM public.current_award_handoff_records o WHERE award_id='__AWARD__';
   PERFORM pg_temp.handoff_apply(pg_temp.handoff_preview(t));
   PERFORM pg_temp.assert_handoff((SELECT due_date IS NULL AND agency_label='Synthetic officer' AND assignee_user_id='__ACTOR__' AND notes='Synthetic history' FROM public.active_project_submittals WHERE id=target),'Unresolved trigger retained actionable date or lost assignment/history');
   SELECT jsonb_set(t,'{occurrences}',jsonb_agg(o.requirement||jsonb_build_object('disposition',CASE WHEN occurrence_key='first' THEN 'reschedule' ELSE 'carry' END,'priorOccurrenceId',o.id,'reason','Source date confirmed','clock',CASE WHEN occurrence_key='first' THEN jsonb_build_object('kind','date_only','date','2027-02-01') ELSE o.requirement->'clock' END) ORDER BY occurrence_key)) INTO t FROM public.current_award_handoff_records o WHERE award_id='__AWARD__';
   PERFORM pg_temp.handoff_apply(pg_temp.handoff_preview(t));
   PERFORM pg_temp.assert_handoff((SELECT due_date='2027-02-01' FROM public.active_project_submittals WHERE id=target),'Resolution lost original target');
   PERFORM pg_temp.assert_handoff((SELECT count(*)=2 FROM public.project_submittals WHERE funding_award_id='__AWARD__'),'Resolution duplicated report work');
  END $$;`));
 it('adopts completed legacy obligation with actual history and reopens separate work deliberately',()=>exercise(`
  DO $$ DECLARE original uuid:=gen_random_uuid(); t jsonb; p jsonb; r jsonb; current_occ uuid; reopened uuid; BEGIN
   INSERT INTO public.project_milestones(id,project_id,funding_award_id,title,milestone_type,status,target_date,actual_date,assignee_user_id,owner_label,notes,created_by)
   VALUES(original,'__PROJECT__','__AWARD__','Synthetic legacy fulfilled obligation','obligation','complete','2026-10-01','2026-09-30','__ACTOR__','Synthetic assigned officer','Synthetic actual fulfillment evidence','__ACTOR__');
   p:=pg_temp.handoff_preview();
   t:=jsonb_set(p->'reviewed'->'terms','{occurrences}',jsonb_build_array((p->'reviewed'->'terms'->'occurrences'->0)||jsonb_build_object('kind','obligation','disposition','adopt_legacy','legacyObligationId',original,'fulfillmentStillApplies',true,'reason','Reviewed legacy actual work still fulfills this source requirement')));
   r:=pg_temp.handoff_apply(pg_temp.handoff_preview(t));
   PERFORM pg_temp.assert_handoff((SELECT milestone_id=original AND outcome_snapshot->>'actual_date'='2026-09-30' AND outcome_snapshot->>'assignee_user_id'='__ACTOR__' AND outcome_snapshot->>'notes'='Synthetic actual fulfillment evidence' FROM public.current_award_handoff_records WHERE award_id='__AWARD__'),'Adoption lost original actual evidence');
   SELECT id INTO current_occ FROM public.current_award_handoff_records WHERE award_id='__AWARD__';
   t:=jsonb_set(t,'{occurrences,0}',(t->'occurrences'->0)||jsonb_build_object('disposition','reschedule','legacyObligationId',NULL,'priorOccurrenceId',current_occ,'clock',jsonb_build_object('kind','unresolved_trigger','trigger','Source amendment awaits confirmation'),'reason','Reviewed unresolved source clock'));
   PERFORM pg_temp.handoff_apply(pg_temp.handoff_preview(t));
   PERFORM pg_temp.assert_handoff((SELECT target_date IS NULL AND actual_date='2026-09-30' AND status='complete' AND assignee_user_id='__ACTOR__' FROM public.project_milestones WHERE id=original),'Unresolved obligation changed actual fulfillment or kept due date');
   SELECT id INTO current_occ FROM public.current_award_handoff_records WHERE award_id='__AWARD__';
   t:=jsonb_set(t,'{occurrences,0}',(t->'occurrences'->0)||jsonb_build_object('disposition','reopen','priorOccurrenceId',current_occ,'clock',jsonb_build_object('kind','date_only','date','2027-02-01'),'reason','Source explicitly requires new obligation work; preserve original fulfillment','fulfillmentStillApplies',false));
   PERFORM pg_temp.handoff_apply(pg_temp.handoff_preview(t));
   SELECT milestone_id INTO reopened FROM public.current_award_handoff_records WHERE award_id='__AWARD__';
   PERFORM pg_temp.assert_handoff(reopened<>original,'Reopen reused completed target');
   PERFORM pg_temp.assert_handoff((SELECT status='complete' AND actual_date='2026-09-30' AND notes='Synthetic actual fulfillment evidence' AND assignee_user_id='__ACTOR__' FROM public.project_milestones WHERE id=original),'Reopen erased original fulfillment');
   PERFORM pg_temp.assert_handoff((SELECT milestone_type='schedule' AND status='scheduled' AND actual_date IS NULL AND assignee_user_id IS NULL FROM public.project_milestones WHERE id=reopened),'Reopen inherited fulfilled status/assignment');
   PERFORM pg_temp.assert_handoff((SELECT count(*)=1 FROM public.project_milestones WHERE funding_award_id='__AWARD__' AND milestone_type='obligation'),'Reopen duplicated unique original obligation');
   PERFORM pg_temp.assert_handoff(NOT EXISTS(SELECT FROM public.active_project_milestones WHERE id=original),'Historical original remained actionable');
  END $$;`));

});
