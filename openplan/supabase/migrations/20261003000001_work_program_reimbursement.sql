-- Reimbursement packets reuse private report/file custody, with separate lifecycle and source reservations.
ALTER TABLE public.work_program_period_reports ADD COLUMN report_kind text NOT NULL DEFAULT 'management' CHECK(report_kind IN ('management','reimbursement'));
CREATE TABLE public.work_program_reimbursement_claims (
 id uuid PRIMARY KEY, program_id uuid NOT NULL REFERENCES public.programs(id), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 version integer NOT NULL DEFAULT 1, state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','reviewed','submitted','returned','accepted')),
 draft jsonb NOT NULL, current_report_id uuid REFERENCES public.work_program_period_reports(id), created_by uuid NOT NULL REFERENCES auth.users(id), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.work_program_reimbursement_sources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id), program_id uuid NOT NULL REFERENCES public.programs(id),
 claim_id uuid NOT NULL REFERENCES public.work_program_reimbursement_claims(id), source_identity text NOT NULL, entry_id uuid NOT NULL,
 UNIQUE(workspace_id,source_identity), UNIQUE(workspace_id,entry_id)
);
CREATE TABLE public.work_program_reimbursement_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), program_id uuid NOT NULL REFERENCES public.programs(id), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 claim_id uuid NOT NULL REFERENCES public.work_program_reimbursement_claims(id), sequence integer NOT NULL, kind text NOT NULL,
 report_id uuid REFERENCES public.work_program_period_reports(id), note text NOT NULL, actor_id uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(claim_id,sequence)
);
ALTER TABLE public.work_program_reimbursement_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_program_reimbursement_claims FROM anon,authenticated,service_role;
GRANT SELECT ON public.work_program_reimbursement_claims TO authenticated,service_role;
CREATE POLICY private_management_read ON public.work_program_reimbursement_claims FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=work_program_reimbursement_claims.workspace_id AND m.user_id=auth.uid() AND m.role IN ('owner','admin')));
ALTER TABLE public.work_program_reimbursement_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_program_reimbursement_sources FROM anon,authenticated,service_role;
GRANT SELECT ON public.work_program_reimbursement_sources TO authenticated,service_role;
CREATE POLICY private_management_read ON public.work_program_reimbursement_sources FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=work_program_reimbursement_sources.workspace_id AND m.user_id=auth.uid() AND m.role IN ('owner','admin')));
ALTER TABLE public.work_program_reimbursement_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_program_reimbursement_events FROM anon,authenticated,service_role;
GRANT SELECT ON public.work_program_reimbursement_events TO authenticated,service_role;
CREATE POLICY private_management_read ON public.work_program_reimbursement_events FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=work_program_reimbursement_events.workspace_id AND m.user_id=auth.uid() AND m.role IN ('owner','admin')));
CREATE TRIGGER immutable_reimbursement_sources BEFORE UPDATE OR DELETE ON public.work_program_reimbursement_sources FOR EACH ROW EXECUTE FUNCTION public.guard_contract_history();
CREATE TRIGGER immutable_reimbursement_events BEFORE UPDATE OR DELETE ON public.work_program_reimbursement_events FOR EACH ROW EXECUTE FUNCTION public.guard_contract_history();

CREATE FUNCTION public.work_program_reimbursement_command(p_program_id uuid,p_actor_id uuid,p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE w uuid; k text:=p_command->>'kind'; req uuid:=(p_command->>'requestId')::uuid; cid uuid:=(p_command->>'claimId')::uuid;
 cached public.work_program_reporting_commands; claim public.work_program_reimbursement_claims; source_report public.work_program_period_reports; packet public.work_program_period_reports;
 cost jsonb; actual public.work_program_actual_versions; fund jsonb; share jsonb; allocation jsonb; snap jsonb; evidence jsonb; delivery jsonb; contract_cost public.contract_actual_versions; contract_costs jsonb:='[]'::jsonb;
 identity text; allowed numeric; allocated numeric; total numeric:=0; eligible numeric:=0; reimbursement numeric:=0; matching numeric:=0; result jsonb; next_packet integer;
BEGIN
 SELECT workspace_id INTO w FROM public.programs WHERE id=p_program_id;
 IF w IS NULL OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=w AND user_id=p_actor_id AND role IN ('owner','admin')) THEN RAISE EXCEPTION 'Owner or administrator required for reimbursement' USING ERRCODE='42501'; END IF;
 -- Shared with other program claims: serialize reservations across the workspace, not just one period.
 PERFORM 1 FROM public.workspaces WHERE id=w FOR UPDATE;
 PERFORM 1 FROM public.programs WHERE id=p_program_id FOR UPDATE;
 IF req IS NULL OR cid IS NULL OR k IS NULL OR octet_length(p_command::text)>500000 THEN RAISE EXCEPTION 'Invalid reimbursement command' USING ERRCODE='22023'; END IF;
 SELECT * INTO cached FROM public.work_program_reporting_commands WHERE program_id=p_program_id AND request_id=req;
 IF cached.request_id IS NOT NULL THEN
  IF cached.actor_id<>p_actor_id OR cached.command<>p_command THEN RAISE EXCEPTION 'Request identity reused with different content' USING ERRCODE='PT409'; END IF;
  RETURN cached.result;
 END IF;
 SELECT * INTO claim FROM public.work_program_reimbursement_claims WHERE id=cid;
 IF claim.id IS NOT NULL AND claim.program_id<>p_program_id THEN RAISE EXCEPTION 'Foreign reimbursement packet' USING ERRCODE='42501'; END IF;
 IF coalesce(claim.version,0) IS DISTINCT FROM (p_command->>'expectedVersion')::integer THEN RAISE EXCEPTION 'Packet changed; reload before saving' USING ERRCODE='PT409'; END IF;
 IF k='save' THEN
  IF claim.id IS NOT NULL AND claim.state NOT IN ('draft','returned') THEN RAISE EXCEPTION 'Return this packet before correcting it' USING ERRCODE='PT409'; END IF;
  IF jsonb_typeof(p_command->'draft') IS DISTINCT FROM 'object' OR jsonb_typeof(p_command->'draft'->'costs') IS DISTINCT FROM 'array' OR jsonb_array_length(p_command->'draft'->'costs') NOT BETWEEN 1 AND 3000 OR coalesce(length(trim(p_command->'draft'->>'title')),0)=0 THEN RAISE EXCEPTION 'Packet title and cost decisions required' USING ERRCODE='22023'; END IF;
  SELECT * INTO source_report FROM public.work_program_period_reports WHERE id=(p_command->'draft'->>'reportId')::uuid AND program_id=p_program_id AND report_kind='management';
  IF source_report.id IS NULL THEN RAISE EXCEPTION 'Select an issued management report from this program' USING ERRCODE='42501'; END IF;
  IF claim.current_report_id IS NOT NULL AND (SELECT period_id FROM public.work_program_period_reports WHERE id=claim.current_report_id)<>source_report.period_id THEN RAISE EXCEPTION 'A correction must retain the same reporting period' USING ERRCODE='22023'; END IF;
  INSERT INTO public.work_program_reimbursement_claims(id,program_id,workspace_id,draft,created_by) VALUES(cid,p_program_id,w,p_command->'draft',p_actor_id)
  ON CONFLICT(id) DO UPDATE SET draft=excluded.draft,state='draft',version=work_program_reimbursement_claims.version+1,updated_at=now() RETURNING * INTO claim;
 ELSE
  IF claim.id IS NULL THEN RAISE EXCEPTION 'Packet unavailable' USING ERRCODE='42501'; END IF;
  IF coalesce(length(trim(p_command->>'note')),0)=0 THEN RAISE EXCEPTION 'Review or external receipt evidence required' USING ERRCODE='22023'; END IF;
  IF k='review' THEN
   IF claim.state<>'draft' THEN RAISE EXCEPTION 'Save the corrected draft before review' USING ERRCODE='PT409'; END IF;
   SELECT * INTO source_report FROM public.work_program_period_reports WHERE id=(claim.draft->>'reportId')::uuid AND program_id=p_program_id AND report_kind='management';
   IF source_report.id IS NULL OR EXISTS(SELECT 1 FROM public.work_program_period_reports n WHERE n.period_id=source_report.period_id AND n.report_kind='management' AND n.version>source_report.version) OR EXISTS(SELECT 1 FROM public.work_program_reporting_periods p WHERE p.id=source_report.period_id AND p.state<>'issued') THEN RAISE EXCEPTION 'Issue and select the current corrected management report' USING ERRCODE='PT409'; END IF;
   IF coalesce(length(trim(claim.draft->>'authorityEvidence')),0)=0 OR coalesce(length(trim(claim.draft->>'formEvidence')),0)=0 THEN RAISE EXCEPTION 'Review funding authority and prescribed packet requirements' USING ERRCODE='22023'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.program_work_program_events e WHERE e.program_id=p_program_id AND e.revision_id=(source_report.snapshot->'baseline'->>'id')::uuid AND e.kind='adoption' AND NOT EXISTS(SELECT 1 FROM public.program_work_program_events n WHERE n.program_id=p_program_id AND n.kind='withdraw_authority' AND n.payload->>'targetEventId'=e.id::text)) THEN RAISE EXCEPTION 'Reporting baseline authority was withdrawn' USING ERRCODE='PT409'; END IF;
   IF (SELECT count(*) FROM jsonb_array_elements(claim.draft->'costs'))<>(SELECT count(DISTINCT value->>'actualVersionId') FROM jsonb_array_elements(claim.draft->'costs')) THEN RAISE EXCEPTION 'Duplicate source cost decision' USING ERRCODE='22023'; END IF;
   -- Every incurred cost in this period needs a decision, including zero eligible amounts.
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(source_report.snapshot->'actuals') v WHERE v->>'status'='approved' AND v->>'kind' IN ('labor','expense') AND (v->>'entry_date')::date BETWEEN (source_report.snapshot->'period'->>'starts_on')::date AND (source_report.snapshot->'period'->>'ends_on')::date AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(claim.draft->'costs') c WHERE c->>'actualVersionId'=v->>'id')) THEN RAISE EXCEPTION 'Record eligibility for every incurred source in this period' USING ERRCODE='22023'; END IF;
   FOR cost IN SELECT value FROM jsonb_array_elements(claim.draft->'costs') LOOP
    SELECT * INTO actual FROM public.work_program_actual_versions WHERE id=(cost->>'actualVersionId')::uuid AND program_id=p_program_id;
    IF actual.id IS NULL OR actual.status<>'approved' OR actual.kind NOT IN ('labor','expense') OR actual.amount IS NULL OR actual.entry_date NOT BETWEEN (source_report.snapshot->'period'->>'starts_on')::date AND (source_report.snapshot->'period'->>'ends_on')::date OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(source_report.snapshot->'actuals') v WHERE v->>'id'=actual.id::text) THEN RAISE EXCEPTION 'Select approved incurred costs within this report' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM public.work_program_actual_versions n WHERE n.entry_id=actual.entry_id AND n.version>actual.version) THEN RAISE EXCEPTION 'Source cost changed; correct and reissue the management report' USING ERRCODE='PT409'; END IF;
    -- A shared contract cost must carry the current approved M11 valuation of the same physical source.
    SELECT * INTO contract_cost FROM public.contract_actual_versions v WHERE v.workspace_id=w
     AND ((actual.time_entry_id IS NOT NULL AND v.time_entry_id=actual.time_entry_id) OR (actual.spend_entry_id IS NOT NULL AND v.spend_entry_id=actual.spend_entry_id))
     AND NOT EXISTS(SELECT 1 FROM public.contract_actual_versions n WHERE n.entry_id=v.entry_id AND n.version>v.version);
    IF actual.detail->>'contractId' IS NOT NULL OR contract_cost.id IS NOT NULL THEN
     IF contract_cost.id IS NULL OR (actual.detail->>'contractId' IS NOT NULL AND contract_cost.engagement_id::text<>actual.detail->>'contractId') OR contract_cost.command->>'status' IS DISTINCT FROM 'approved'
      OR contract_cost.amount IS DISTINCT FROM actual.amount OR contract_cost.hours IS DISTINCT FROM actual.hours OR public.contract_shared_source_stale(contract_cost)
     THEN RAISE EXCEPTION 'Reconcile and approve the current shared contract cost before packet review' USING ERRCODE='PT409'; END IF;
     contract_costs:=contract_costs||jsonb_build_array(to_jsonb(contract_cost)||jsonb_build_object('amount',contract_cost.amount::text,'hours',contract_cost.hours::text));
    END IF;
    IF coalesce(cost->>'eligibleAmount','') !~ '^\d{1,12}(\.\d{1,2})?$' OR coalesce(length(trim(cost->>'eligibilityEvidence')),0)=0 OR jsonb_typeof(cost->'shares') IS DISTINCT FROM 'array' OR jsonb_array_length(cost->'shares')>100 THEN RAISE EXCEPTION 'Exact eligible cost, evidence and funding shares required' USING ERRCODE='22023'; END IF;
    allowed:=(cost->>'eligibleAmount')::numeric;
    IF allowed>actual.amount THEN RAISE EXCEPTION 'Eligible cost exceeds source cost' USING ERRCODE='22023'; END IF;
    allocated:=0;
    IF (SELECT count(*) FROM jsonb_array_elements(cost->'shares'))<>(SELECT count(DISTINCT value->>'fundId') FROM jsonb_array_elements(cost->'shares')) THEN RAISE EXCEPTION 'Duplicate funding share' USING ERRCODE='22023'; END IF;
    FOR share IN SELECT value FROM jsonb_array_elements(cost->'shares') LOOP
     SELECT value INTO fund FROM jsonb_array_elements(source_report.snapshot->'baseline'->'content_json'->'preparation'->'funds') WHERE value->>'id'=share->>'fundId';
     IF fund IS NULL OR (fund->>'periodStart')::date IS NULL OR (fund->>'periodEnd')::date IS NULL OR actual.entry_date NOT BETWEEN (fund->>'periodStart')::date AND (fund->>'periodEnd')::date THEN RAISE EXCEPTION 'Fund or vintage does not cover this source cost' USING ERRCODE='22023'; END IF;
     IF coalesce(share->>'amount','') !~ '^\d{1,12}(\.\d{1,2})?$' OR (share->>'amount')::numeric<=0 OR coalesce(share->>'treatment','') NOT IN ('reimbursement','match') OR coalesce(length(trim(share->>'evidence')),0)=0 THEN RAISE EXCEPTION 'Reviewed positive share, treatment and evidence required' USING ERRCODE='22023'; END IF;
     allocated:=allocated+(share->>'amount')::numeric;
     IF share->>'treatment'='reimbursement' THEN reimbursement:=reimbursement+(share->>'amount')::numeric; ELSE matching:=matching+(share->>'amount')::numeric; END IF;
    END LOOP;
    IF allocated<>allowed THEN RAISE EXCEPTION 'Reimbursement and match shares must equal eligible cost' USING ERRCODE='22023'; END IF;
    FOR allocation IN SELECT to_jsonb(a) FROM public.work_program_actual_allocations a WHERE a.actual_version_id=actual.id LOOP
     IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(source_report.snapshot->'period'->'progress') p WHERE p->>'elementId'=allocation->>'element_id' AND (p->>'taskId' IS NULL OR p->>'taskId'=allocation->>'task_id') AND coalesce(length(trim(p->>'completed')),0)>0 AND coalesce(length(trim(p->>'outstanding')),0)>0 AND coalesce(length(trim(p->>'estimateBasis')),0)>0 AND (p->>'asOf')::date BETWEEN (source_report.snapshot->'period'->>'starts_on')::date AND (source_report.snapshot->'period'->>'ends_on')::date) THEN RAISE EXCEPTION 'Each cost needs dated progress, deliverables, remaining work and an estimate basis' USING ERRCODE='22023'; END IF;
    END LOOP;
    identity:=CASE WHEN actual.time_entry_id IS NOT NULL THEN 'time:'||actual.time_entry_id WHEN actual.spend_entry_id IS NOT NULL THEN 'spend:'||actual.spend_entry_id ELSE 'source:'||actual.source_key END;
    IF EXISTS(SELECT 1 FROM public.work_program_reimbursement_sources s WHERE s.workspace_id=w AND (s.source_identity=identity OR s.entry_id=actual.entry_id) AND s.claim_id<>cid) THEN RAISE EXCEPTION 'Source cost is already reserved by another reimbursement packet' USING ERRCODE='PT409'; END IF;
    INSERT INTO public.work_program_reimbursement_sources(workspace_id,program_id,claim_id,source_identity,entry_id) VALUES(w,p_program_id,cid,identity,actual.entry_id) ON CONFLICT DO NOTHING;
    total:=total+actual.amount; eligible:=eligible+allowed;
   END LOOP;
   SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.id),'[]') INTO delivery FROM public.project_deliverables d WHERE d.id IN(SELECT a.deliverable_id FROM public.work_program_actual_allocations a WHERE a.actual_version_id IN(SELECT (value->>'actualVersionId')::uuid FROM jsonb_array_elements(claim.draft->'costs')));
   SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.created_at,e.id),'[]') INTO evidence FROM public.contract_deliverable_events e WHERE e.workspace_id=w AND e.deliverable_id IN(SELECT (value->>'id')::uuid FROM jsonb_array_elements(delivery));
   next_packet:=coalesce((SELECT (snapshot->'reimbursement'->>'packetVersion')::integer FROM public.work_program_period_reports WHERE id=claim.current_report_id),0)+1;
   snap:=source_report.snapshot||jsonb_build_object('reimbursement',claim.draft||jsonb_build_object('claimId',cid,'packetVersion',next_packet,'sourceReportHash',source_report.snapshot_hash,'reviewedBy',p_actor_id,'reviewedAt',now(),'reviewNote',p_command->>'note','totalCost',round(total,2)::text,'eligibleTotal',round(eligible,2)::text,'reimbursementTotal',round(reimbursement,2)::text,'matchTotal',round(matching,2)::text,'contractCosts',contract_costs,'deliverables',delivery,'deliverableEvents',evidence,'history',coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.sequence) FROM public.work_program_reimbursement_events h WHERE h.claim_id=cid),'[]'::jsonb)));
   INSERT INTO public.work_program_period_reports(period_id,program_id,workspace_id,version,snapshot,snapshot_hash,issued_by,corrects_report_id,report_kind)
   VALUES(source_report.period_id,p_program_id,w,(SELECT coalesce(max(version),0)+1 FROM public.work_program_period_reports WHERE period_id=source_report.period_id),snap,encode(extensions.digest(convert_to(snap::text,'UTF8'),'sha256'),'hex'),p_actor_id,claim.current_report_id,'reimbursement') RETURNING * INTO packet;
   UPDATE public.work_program_reimbursement_claims SET state='reviewed',current_report_id=packet.id,version=version+1,updated_at=now() WHERE id=cid RETURNING * INTO claim;
  ELSE
   IF (k='submit' AND claim.state<>'reviewed') OR (k='return' AND claim.state NOT IN ('reviewed','submitted')) OR (k='accept' AND claim.state<>'submitted') OR k NOT IN ('submit','return','accept') THEN RAISE EXCEPTION 'Invalid reimbursement transition' USING ERRCODE='PT409'; END IF;
   UPDATE public.work_program_reimbursement_claims SET state=CASE k WHEN 'submit' THEN 'submitted' WHEN 'return' THEN 'returned' ELSE 'accepted' END,version=version+1,updated_at=now() WHERE id=cid RETURNING * INTO claim;
  END IF;
 END IF;
 INSERT INTO public.work_program_reimbursement_events(program_id,workspace_id,claim_id,sequence,kind,report_id,note,actor_id) VALUES(p_program_id,w,cid,claim.version,k,claim.current_report_id,coalesce(p_command->>'note','Draft saved'),p_actor_id);
 result:=jsonb_build_object('claimId',cid,'version',claim.version,'state',claim.state,'reportId',claim.current_report_id);
 INSERT INTO public.work_program_reporting_commands(program_id,request_id,actor_id,command,result) VALUES(p_program_id,req,p_actor_id,p_command,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.work_program_reimbursement_command(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.work_program_reimbursement_command(uuid,uuid,jsonb) TO service_role;

-- Management corrections retain management ancestry; packet reports share only file custody.
CREATE OR REPLACE FUNCTION public.work_program_management_command(p_program_id uuid,p_actor_id uuid,p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE w uuid; cached public.work_program_reporting_commands; req uuid:=(p_command->>'requestId')::uuid; k text:=p_command->>'kind'; result jsonb;
 period public.work_program_reporting_periods; baseline public.program_work_program_revisions; snap jsonb; records jsonb; history jsonb; rep public.work_program_period_reports;
 progress_row jsonb; latest_report uuid; rate public.work_program_cost_rates; adoption jsonb; period_id uuid:=(p_command->>'periodId')::uuid;
BEGIN
 SELECT workspace_id INTO w FROM public.programs WHERE id=p_program_id FOR UPDATE;
 IF w IS NULL OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=w AND user_id=p_actor_id AND role IN ('owner','admin')) THEN RAISE EXCEPTION 'Owner or administrator required for management reporting' USING ERRCODE='42501'; END IF;
 IF req IS NULL OR k IS NULL OR octet_length(p_command::text)>500000 THEN RAISE EXCEPTION 'Invalid command' USING ERRCODE='22023'; END IF;
 SELECT * INTO cached FROM public.work_program_reporting_commands WHERE program_id=p_program_id AND request_id=req;
 IF cached.request_id IS NOT NULL THEN
  IF cached.actor_id<>p_actor_id OR cached.command<>p_command THEN RAISE EXCEPTION 'Request identity reused with different content' USING ERRCODE='PT409'; END IF;
  RETURN cached.result;
 END IF;
 IF k='rate' THEN
  IF NOT EXISTS(SELECT 1 FROM public.invoicing_staff WHERE id=(p_command->>'staffId')::uuid AND workspace_id=w) THEN RAISE EXCEPTION 'Foreign staff rate' USING ERRCODE='42501'; END IF;
  IF (p_command->>'hourlyCost')::numeric<>round((p_command->>'hourlyCost')::numeric,2) THEN RAISE EXCEPTION 'Cost rate requires whole cents' USING ERRCODE='22023'; END IF;
  INSERT INTO public.work_program_cost_rates(id,workspace_id,staff_id,starts_on,ends_on,hourly_cost,source_reference,approved_by)
  VALUES((p_command->>'rateId')::uuid,w,(p_command->>'staffId')::uuid,(p_command->>'startsOn')::date,(p_command->>'endsOn')::date,(p_command->>'hourlyCost')::numeric,p_command->>'sourceReference',p_actor_id) RETURNING * INTO rate;
  result:=jsonb_build_object('rateId',rate.id);
 ELSE
  SELECT * INTO period FROM public.work_program_reporting_periods WHERE id=period_id;
  IF period.id IS NOT NULL AND period.program_id<>p_program_id THEN RAISE EXCEPTION 'Foreign reporting period' USING ERRCODE='42501'; END IF;
  IF coalesce(period.version,0) IS DISTINCT FROM (p_command->>'expectedVersion')::integer THEN RAISE EXCEPTION 'Reporting period changed; reload before saving' USING ERRCODE='PT409'; END IF;
  IF k='period' THEN
   IF period.state IN ('review','issued') THEN RAISE EXCEPTION 'Return or start a correction before changing this period' USING ERRCODE='PT409'; END IF;
   IF coalesce(length(trim(p_command->>'name')),0)=0 OR (p_command->>'sourceCutoff')::timestamptz IS NULL OR (p_command->>'sourceCutoff')::timestamptz>now() THEN RAISE EXCEPTION 'Name and source cutoff at or before now required' USING ERRCODE='22023'; END IF;
   SELECT * INTO baseline FROM public.program_work_program_revisions WHERE id=(p_command->>'baselineId')::uuid AND program_id=p_program_id;
   IF p_command->>'baselineId' IS NOT NULL AND (baseline.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.program_work_program_events e WHERE e.program_id=p_program_id AND e.revision_id=baseline.id AND e.kind='adoption' AND NOT EXISTS(SELECT 1 FROM public.program_work_program_events n WHERE n.program_id=p_program_id AND n.kind='withdraw_authority' AND n.payload->>'targetEventId'=e.id::text))) THEN RAISE EXCEPTION 'Select a recorded adopted baseline' USING ERRCODE='22023'; END IF;
   IF baseline.id IS NOT NULL AND ((p_command->>'startsOn')::date<(baseline.content_json->>'periodStart')::date OR (p_command->>'endsOn')::date>(baseline.content_json->>'periodEnd')::date) THEN RAISE EXCEPTION 'Period must be within the selected work program' USING ERRCODE='22023'; END IF;
   IF jsonb_typeof(p_command->'progress') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Progress records required' USING ERRCODE='22023'; END IF;
   FOR progress_row IN SELECT value FROM jsonb_array_elements(p_command->'progress') LOOP
    IF baseline.id IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(baseline.content_json->'elements') e WHERE e->>'id'=progress_row->>'elementId' AND (progress_row->>'taskId' IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(e->'tasks') t WHERE t->>'id'=progress_row->>'taskId'))) THEN RAISE EXCEPTION 'Progress target is outside the selected baseline' USING ERRCODE='42501'; END IF;
    IF (progress_row->>'remainingCost')::numeric<0 OR (progress_row->>'remainingHours')::numeric<0 OR (progress_row->>'asOf')::date IS NULL OR (progress_row->>'remainingCost')::numeric<>round((progress_row->>'remainingCost')::numeric,2) THEN RAISE EXCEPTION 'Dated nonnegative remaining estimates required' USING ERRCODE='22023'; END IF;
   END LOOP;
   IF (SELECT count(*) FROM jsonb_array_elements(p_command->'progress'))<>(SELECT count(DISTINCT (value->>'elementId',value->>'taskId')) FROM jsonb_array_elements(p_command->'progress')) THEN RAISE EXCEPTION 'Duplicate progress targets' USING ERRCODE='22023'; END IF;
   INSERT INTO public.work_program_reporting_periods(id,program_id,workspace_id,name,starts_on,ends_on,baseline_id,source_cutoff,progress,note,created_by)
   VALUES(period_id,p_program_id,w,p_command->>'name',(p_command->>'startsOn')::date,(p_command->>'endsOn')::date,baseline.id,(p_command->>'sourceCutoff')::timestamptz,p_command->'progress',coalesce(p_command->>'note',''),p_actor_id)
   ON CONFLICT(id) DO UPDATE SET name=excluded.name,starts_on=excluded.starts_on,ends_on=excluded.ends_on,baseline_id=excluded.baseline_id,source_cutoff=excluded.source_cutoff,progress=excluded.progress,note=excluded.note,version=work_program_reporting_periods.version+1,updated_at=now(),review_snapshot=NULL RETURNING * INTO period;
  ELSE
   IF period.id IS NULL THEN RAISE EXCEPTION 'Reporting period unavailable' USING ERRCODE='42501'; END IF;
   IF coalesce(length(trim(p_command->>'note')),0)=0 THEN RAISE EXCEPTION 'A review or correction note is required' USING ERRCODE='22023'; END IF;
   IF k='review' THEN
    IF period.state NOT IN ('draft','returned','correcting') THEN RAISE EXCEPTION 'Period is not ready for review' USING ERRCODE='PT409'; END IF;
    SELECT * INTO baseline FROM public.program_work_program_revisions WHERE id=period.baseline_id AND program_id=p_program_id;
    SELECT to_jsonb(e) INTO adoption FROM public.program_work_program_events e WHERE e.program_id=p_program_id AND e.revision_id=baseline.id AND e.kind='adoption' AND NOT EXISTS(SELECT 1 FROM public.program_work_program_events n WHERE n.program_id=p_program_id AND n.kind='withdraw_authority' AND n.payload->>'targetEventId'=e.id::text) ORDER BY e.sequence DESC LIMIT 1;
    IF baseline.id IS NULL OR adoption IS NULL THEN RAISE EXCEPTION 'An adopted baseline is required to review a budget report' USING ERRCODE='22023'; END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('amount',v.amount::text,'hours',v.hours::text,'staffName',s.name,'costRate',(SELECT to_jsonb(c)||jsonb_build_object('hourly_cost',c.hourly_cost::text) FROM public.work_program_cost_rates c WHERE c.id=v.cost_rate_id),'allocations',(SELECT coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('amount',a.amount::text,'hours',a.hours::text) ORDER BY a.id),'[]') FROM public.work_program_actual_allocations a WHERE a.actual_version_id=v.id)) ORDER BY v.entry_date,v.entry_id),'[]') INTO records
    FROM public.work_program_actual_versions v LEFT JOIN public.invoicing_staff s ON s.id=v.staff_id
    WHERE v.program_id=p_program_id AND v.created_at<=period.source_cutoff AND v.entry_date<=period.ends_on AND (v.entry_date>=(baseline.content_json->>'periodStart')::date OR v.kind='opening')
    AND NOT EXISTS(SELECT 1 FROM public.work_program_actual_versions n WHERE n.entry_id=v.entry_id AND n.version>v.version AND n.created_at<=period.source_cutoff);
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(records) v WHERE v->>'status'='draft' OR (v->>'status'='approved' AND (v->>'amount' IS NULL OR jsonb_array_length(v->'allocations')=0))) THEN RAISE EXCEPTION 'Approve or exclude unresolved actuals and allocations before review' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(records) v CROSS JOIN LATERAL jsonb_array_elements(v->'allocations') a WHERE v->>'status'='approved' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(baseline.content_json->'elements') e WHERE e->>'id'=a->>'element_id' AND (a->>'task_id' IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(e->'tasks') t WHERE t->>'id'=a->>'task_id')))) THEN RAISE EXCEPTION 'Reconcile actual allocations with the selected adopted baseline' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(records) v WHERE v->>'kind'='opening' AND v->>'status'='approved' AND ((v->'detail'->>'openingStart')::date<(baseline.content_json->>'periodStart')::date OR (v->'detail'->>'openingEnd')::date>=period.starts_on)) THEN RAISE EXCEPTION 'Opening coverage must be within the fiscal year and before the reporting period; reconcile a crossing balance before review' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(records) o CROSS JOIN jsonb_array_elements(records) v
     WHERE o->>'kind'='opening' AND o->>'status'='approved' AND v->>'status'='approved' AND o->>'entry_id'<>v->>'entry_id'
     AND v->>'kind' IN ('labor','expense','opening') AND (CASE WHEN v->>'kind'='opening' THEN (v->'detail'->>'openingStart')::date<=(o->'detail'->>'openingEnd')::date AND (v->'detail'->>'openingEnd')::date>=(o->'detail'->>'openingStart')::date ELSE (v->>'entry_date')::date BETWEEN (o->'detail'->>'openingStart')::date AND (o->'detail'->>'openingEnd')::date END)
     AND EXISTS(SELECT 1 FROM jsonb_array_elements(o->'allocations') a JOIN jsonb_array_elements(v->'allocations') b ON a->>'element_id'=b->>'element_id'))
    THEN RAISE EXCEPTION 'Opening balance overlaps detailed incurred costs; reconcile coverage before review' USING ERRCODE='22023'; END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('amount',v.amount::text,'hours',v.hours::text) ORDER BY v.created_at,v.id),'[]') INTO history FROM public.work_program_actual_versions v WHERE v.program_id=p_program_id AND v.created_at<=period.source_cutoff AND v.entry_id IN(SELECT (value->>'entry_id')::uuid FROM jsonb_array_elements(records));
    snap:=jsonb_build_object('schemaVersion',1,'period',to_jsonb(period)-'review_snapshot','baseline',to_jsonb(baseline),'baselineAdoption',adoption,'actuals',records,'valuationHistory',history,'reviewNote',p_command->>'note','reviewedAt',now(),'reviewedBy',p_actor_id);
    UPDATE public.work_program_reporting_periods SET state='review',review_snapshot=snap,version=version+1,updated_at=now() WHERE id=period.id RETURNING * INTO period;
   ELSIF k='return' THEN
    IF period.state<>'review' THEN RAISE EXCEPTION 'Only a reviewed period can be returned' USING ERRCODE='PT409'; END IF;
    UPDATE public.work_program_reporting_periods SET state='returned',note=p_command->>'note',review_snapshot=NULL,version=version+1,updated_at=now() WHERE id=period.id RETURNING * INTO period;
   ELSIF k='correct' THEN
    IF period.state<>'issued' THEN RAISE EXCEPTION 'Only an issued period starts a corrected version' USING ERRCODE='PT409'; END IF;
    UPDATE public.work_program_reporting_periods SET state='correcting',note=p_command->>'note',review_snapshot=NULL,version=version+1,updated_at=now() WHERE id=period.id RETURNING * INTO period;
   ELSIF k='issue' THEN
    IF period.state<>'review' OR period.review_snapshot IS NULL THEN RAISE EXCEPTION 'Review the exact report before issuing' USING ERRCODE='PT409'; END IF;
    SELECT id INTO latest_report FROM public.work_program_period_reports WHERE work_program_period_reports.period_id=period.id AND report_kind='management' ORDER BY version DESC LIMIT 1;
    snap:=period.review_snapshot||jsonb_build_object('issueNote',p_command->>'note');
    INSERT INTO public.work_program_period_reports(period_id,program_id,workspace_id,version,snapshot,snapshot_hash,issued_by,corrects_report_id)
    VALUES(period.id,p_program_id,w,coalesce((SELECT max(version) FROM public.work_program_period_reports WHERE work_program_period_reports.period_id=period.id),0)+1,snap,encode(extensions.digest(convert_to(snap::text,'UTF8'),'sha256'),'hex'),p_actor_id,latest_report) RETURNING * INTO rep;
    UPDATE public.work_program_reporting_periods SET state='issued',version=version+1,updated_at=now() WHERE id=period.id RETURNING * INTO period;
   ELSE RAISE EXCEPTION 'Unknown management command' USING ERRCODE='22023';
   END IF;
  END IF;
  result:=jsonb_build_object('periodId',period.id,'version',period.version,'reportId',rep.id);
 END IF;
 INSERT INTO public.work_program_reporting_commands(program_id,request_id,actor_id,command,result) VALUES(p_program_id,req,p_actor_id,p_command,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.work_program_management_command(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.work_program_management_command(uuid,uuid,jsonb) TO service_role;

-- Document titles and filenames identify the frozen packet version. Existing files remain unchanged.
CREATE OR REPLACE FUNCTION public.enqueue_work_program_report(p_report_id uuid,p_format text,p_actor_id uuid)
RETURNS public.kb_ocr_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.work_program_period_reports; d public.kb_documents; j public.kb_ocr_jobs;
BEGIN
 SELECT * INTO r FROM public.work_program_period_reports WHERE id=p_report_id FOR UPDATE;
 IF r.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=r.workspace_id AND user_id=p_actor_id AND role IN ('owner','admin')) THEN RAISE EXCEPTION 'Private management report access denied' USING ERRCODE='42501'; END IF;
 IF p_format IS NULL OR p_format NOT IN ('pdf','xlsx') THEN RAISE EXCEPTION 'Invalid report format' USING ERRCODE='22023'; END IF;
 SELECT * INTO d FROM public.kb_documents WHERE work_program_report_id=r.id AND work_program_report_format=p_format;
 IF d.id IS NULL THEN
  INSERT INTO public.kb_documents(workspace_id,uploaded_by,title,source_kind,original_filename,content_type,status,extraction_source,work_program_report_id,work_program_report_format)
  VALUES(r.workspace_id,p_actor_id,CASE WHEN r.report_kind='reimbursement' THEN 'Reimbursement: '||(r.snapshot->'reimbursement'->>'title')||' v'||(r.snapshot->'reimbursement'->>'packetVersion') ELSE 'Internal management: '||(r.snapshot->'period'->>'name')||' v'||r.version END,CASE p_format WHEN 'pdf' THEN 'uploaded_pdf' ELSE 'uploaded_spreadsheet' END,
  CASE WHEN r.report_kind='reimbursement' THEN 'reimbursement-'||(r.snapshot->'reimbursement'->>'claimId')||'-v'||(r.snapshot->'reimbursement'->>'packetVersion')||'.'||p_format ELSE 'management-report-'||r.id||'-v'||r.version||'.'||p_format END,CASE p_format WHEN 'pdf' THEN 'application/pdf' ELSE 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' END,'pending','none',r.id,p_format) RETURNING * INTO d;
 END IF;
 SELECT * INTO j FROM public.kb_ocr_jobs WHERE document_id=d.id AND job_kind='work_program_export' ORDER BY created_at DESC LIMIT 1;
 IF j.id IS NOT NULL THEN
  IF j.status='failed' THEN UPDATE public.kb_ocr_jobs SET status='queued',requested_by=p_actor_id,failure_detail=NULL,cancel_requested=false,lease_token=NULL,lease_until=NULL WHERE id=j.id RETURNING * INTO j; END IF;
  RETURN j;
 END IF;
 INSERT INTO public.kb_ocr_jobs(workspace_id,document_id,request_id,requested_by,job_kind) VALUES(r.workspace_id,d.id,gen_random_uuid()::text,p_actor_id,'work_program_export') RETURNING * INTO j;
 RETURN j;
END $$;
