-- Period closure is independent of reconciliation approval; both retain exact evidence.
CREATE TABLE public.work_program_period_closures (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), program_id uuid NOT NULL REFERENCES public.programs(id),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id), period_id uuid NOT NULL REFERENCES public.work_program_reporting_periods(id),
 version integer NOT NULL CHECK(version>0), kind text NOT NULL CHECK(kind IN ('close_period','reopen_period')),
 starts_on date NOT NULL, ends_on date NOT NULL CHECK(ends_on>=starts_on),
 reconciliation_id uuid NOT NULL REFERENCES public.work_program_closeout_records(id),
 content jsonb NOT NULL, content_hash text NOT NULL, actor_id uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(program_id,version)
);
ALTER TABLE public.work_program_period_closures ENABLE ROW LEVEL SECURITY;
CREATE POLICY period_closure_private_read ON public.work_program_period_closures FOR SELECT TO authenticated USING (
 EXISTS(SELECT 1 FROM public.workspace_members m JOIN public.programs p ON p.workspace_id=m.workspace_id
 WHERE m.user_id=auth.uid() AND m.role IN ('owner','admin') AND p.id=program_id AND p.workspace_id=work_program_period_closures.workspace_id));
REVOKE ALL ON public.work_program_period_closures FROM anon,authenticated,service_role;
GRANT SELECT ON public.work_program_period_closures TO authenticated,service_role;
CREATE TRIGGER immutable_work_program_period_closure BEFORE UPDATE OR DELETE ON public.work_program_period_closures FOR EACH ROW EXECUTE FUNCTION public.guard_contract_history();

CREATE FUNCTION public.work_program_period_closure_command(p_program_id uuid,p_actor_id uuid,p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE w uuid; req uuid:=(p_command->>'requestId')::uuid; k text:=p_command->>'kind';
 cached public.work_program_reporting_commands; prior public.work_program_period_closures; reconciliation public.work_program_closeout_records;
 period public.work_program_reporting_periods; report public.work_program_period_reports; data jsonb; content jsonb; result jsonb; v integer; saved uuid;
BEGIN
 SELECT workspace_id INTO w FROM public.programs WHERE id=p_program_id;
 IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=w AND user_id=p_actor_id AND role IN ('owner','admin')) THEN RAISE EXCEPTION 'Period closure requires an owner or administrator' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.workspaces WHERE id=w FOR UPDATE;
 PERFORM 1 FROM public.programs WHERE workspace_id=w ORDER BY id FOR UPDATE;
 IF req IS NULL OR coalesce(k,'') NOT IN ('close_period','reopen_period') OR coalesce(length(trim(p_command->>'note')),0)=0 OR octet_length(p_command::text)>1000000 THEN RAISE EXCEPTION 'Record the period closure or reopening authority and reason' USING ERRCODE='22023'; END IF;
 SELECT * INTO cached FROM public.work_program_reporting_commands WHERE program_id=p_program_id AND request_id=req;
 IF FOUND THEN
  IF cached.actor_id<>p_actor_id OR cached.command<>p_command THEN RAISE EXCEPTION 'Period closure retry differs from saved command' USING ERRCODE='PT409'; END IF;
  RETURN cached.result;
 END IF;
 SELECT coalesce(max(version),0) INTO v FROM public.work_program_period_closures WHERE program_id=p_program_id;
 IF (p_command->>'expectedClosureVersion')::integer IS DISTINCT FROM v THEN RAISE EXCEPTION 'Period closure changed; reload reconciliation' USING ERRCODE='PT409'; END IF;
 SELECT * INTO report FROM public.work_program_period_reports WHERE id=(p_command->>'reportId')::uuid AND program_id=p_program_id AND report_kind='management';
 IF report.id IS NULL THEN RAISE EXCEPTION 'Select a retained management report in this program' USING ERRCODE='22023'; END IF;
 SELECT * INTO period FROM public.work_program_reporting_periods WHERE id=report.period_id;
 SELECT * INTO prior FROM public.work_program_period_closures WHERE program_id=p_program_id AND period_id=period.id ORDER BY version DESC LIMIT 1;
 IF k='reopen_period' THEN
  IF prior.kind IS DISTINCT FROM 'close_period' THEN RAISE EXCEPTION 'This reporting period is not closed' USING ERRCODE='PT409'; END IF;
  SELECT * INTO reconciliation FROM public.work_program_closeout_records WHERE id=prior.reconciliation_id;
  content:=jsonb_build_object('reopens',prior.id,'closedContentHash',prior.content_hash,'note',p_command->>'note');
 ELSE
  IF prior.kind='close_period' THEN RAISE EXCEPTION 'This reporting period is already closed' USING ERRCODE='PT409'; END IF;
  data:=public.read_work_program_closeout(p_program_id,p_actor_id,report.id);
  SELECT * INTO reconciliation FROM public.work_program_closeout_records WHERE program_id=p_program_id ORDER BY version DESC LIMIT 1;
  IF reconciliation.state IS DISTINCT FROM 'approved' OR reconciliation.report_id IS DISTINCT FROM report.id OR reconciliation.version IS DISTINCT FROM (p_command->>'expectedVersion')::integer
   OR (prior.kind='reopen_period' AND reconciliation.version<=(SELECT version FROM public.work_program_closeout_records WHERE id=prior.reconciliation_id))
   OR reconciliation.source_hash IS DISTINCT FROM data->>'sourceHash' OR data->>'sourceHash' IS DISTINCT FROM p_command->>'sourceHash'
  THEN RAISE EXCEPTION 'Approve a current reconciliation for this report before closing' USING ERRCODE='PT409'; END IF;
  IF period.state<>'issued' OR EXISTS(SELECT 1 FROM public.work_program_period_reports newer WHERE newer.period_id=period.id AND newer.report_kind='management' AND newer.version>report.version)
  THEN RAISE EXCEPTION 'Close only the latest issued management report' USING ERRCODE='PT409'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.program_work_program_events e WHERE e.revision_id=(report.snapshot->'baseline'->>'id')::uuid AND e.kind='adoption' AND NOT EXISTS(SELECT 1 FROM public.program_work_program_events n WHERE n.program_id=e.program_id AND n.kind='withdraw_authority' AND n.payload->>'targetEventId'=e.id::text))
  THEN RAISE EXCEPTION 'The closing baseline no longer has adoption authority' USING ERRCODE='PT409'; END IF;
  content:=jsonb_build_object('reconciliation',to_jsonb(reconciliation),'period',to_jsonb(period),'note',p_command->>'note',
   'limits','Closes the retained cumulative accounting period in OpenPlan only. Outstanding claims, commitments and refunds remain in the approved reconciliation. No funder acceptance, payment or external authority is implied.');
 END IF;
 INSERT INTO public.work_program_period_closures(program_id,workspace_id,period_id,version,kind,starts_on,ends_on,reconciliation_id,content,content_hash,actor_id)
 VALUES(p_program_id,w,period.id,v+1,k,CASE WHEN k='reopen_period' THEN prior.starts_on ELSE (report.snapshot->'baseline'->'content_json'->>'periodStart')::date END,CASE WHEN k='reopen_period' THEN prior.ends_on ELSE period.ends_on END,reconciliation.id,content,encode(extensions.digest(content::text,'sha256'),'hex'),p_actor_id) RETURNING id INTO saved;
 result:=jsonb_build_object('id',saved,'version',v+1,'kind',k);
 INSERT INTO public.work_program_reporting_commands(program_id,request_id,actor_id,command,result) VALUES(p_program_id,req,p_actor_id,p_command,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.work_program_period_closure_command(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.work_program_period_closure_command(uuid,uuid,jsonb) TO service_role;

-- Check both old and new identities, including corrections moved outside the closed dates.
-- Program locks serialize this decision with close/reopen, including direct mapped source writes.
CREATE FUNCTION public.guard_closed_work_program_period() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE row_data jsonb; p uuid; closure public.work_program_period_closures; covered boolean; entry uuid; source_report uuid;
BEGIN
 FOR p IN SELECT DISTINCT (value->>CASE WHEN TG_TABLE_NAME IN ('invoicing_time_entries','project_spend_entries') THEN 'work_program_id' ELSE 'program_id' END)::uuid
  FROM jsonb_array_elements(jsonb_build_array(CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END,CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END)) WHERE value<>'null'::jsonb ORDER BY 1
 LOOP
  IF p IS NULL THEN CONTINUE; END IF;
  PERFORM 1 FROM public.programs WHERE id=p FOR UPDATE;
  FOR closure IN SELECT c.* FROM public.work_program_period_closures c WHERE c.program_id=p AND c.kind='close_period'
   AND NOT EXISTS(SELECT 1 FROM public.work_program_period_closures n WHERE n.program_id=p AND n.period_id=c.period_id AND n.version>c.version)
  LOOP
   FOR row_data IN SELECT value FROM jsonb_array_elements(jsonb_build_array(CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END,CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END)) WHERE value<>'null'::jsonb
   LOOP
    covered:=false;
    IF TG_TABLE_NAME IN ('work_program_actual_versions','invoicing_time_entries','project_spend_entries') THEN
     entry:=(row_data->>'entry_id')::uuid;
     covered:=(row_data->>'entry_date')::date BETWEEN closure.starts_on AND closure.ends_on;
     IF TG_TABLE_NAME='work_program_actual_versions' THEN
      covered:=covered OR (row_data->>'kind'='opening' AND (row_data->'detail'->>'openingStart')::date<=closure.ends_on AND (row_data->'detail'->>'openingEnd')::date>=closure.starts_on)
       OR EXISTS(SELECT 1 FROM public.work_program_actual_versions a WHERE a.entry_id=entry AND a.entry_date BETWEEN closure.starts_on AND closure.ends_on)
       OR EXISTS(SELECT 1 FROM jsonb_array_elements(closure.content->'reconciliation'->'content'->'assessment'->'claims')c CROSS JOIN LATERAL jsonb_array_elements(c->'receipts')r
        JOIN public.work_program_actual_versions a ON a.id=(r->>'actualVersionId')::uuid WHERE a.entry_id=entry);
     END IF;
    ELSIF TG_TABLE_NAME='work_program_reporting_periods' THEN
     covered:=(row_data->>'id')::uuid=closure.period_id OR ((row_data->>'starts_on')::date<=closure.ends_on AND (row_data->>'ends_on')::date>=closure.starts_on);
    ELSIF TG_TABLE_NAME='work_program_period_reports' THEN
     covered:=(row_data->>'period_id')::uuid=closure.period_id;
    ELSIF TG_TABLE_NAME='work_program_reimbursement_claims' THEN
     source_report:=(row_data->'draft'->>'reportId')::uuid;
     covered:=EXISTS(SELECT 1 FROM public.work_program_period_reports r JOIN public.work_program_reporting_periods t ON t.id=r.period_id WHERE r.id=source_report AND t.starts_on<=closure.ends_on AND t.ends_on>=closure.starts_on)
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(closure.content->'reconciliation'->'content'->'source'->'reimbursement'->'claims')c WHERE c->>'id'=row_data->>'id');
    ELSIF TG_TABLE_NAME='work_program_closeout_records' THEN
     covered:=EXISTS(SELECT 1 FROM public.work_program_period_reports r WHERE r.id=(row_data->>'report_id')::uuid AND r.period_id=closure.period_id);
    ELSIF TG_TABLE_NAME='program_work_program_events' THEN
     covered:=row_data->>'kind'='withdraw_authority' AND EXISTS(SELECT 1 FROM public.program_work_program_events e WHERE e.id=(row_data->'payload'->>'targetEventId')::uuid AND e.revision_id::text=closure.content->'reconciliation'->'content'->'source'->'report'->'snapshot'->'baseline'->>'id');
    END IF;
    IF covered THEN RAISE EXCEPTION 'This accounting period is closed. Record authorized reopening in Saved reconciliation before changing its sources.' USING ERRCODE='PT409'; END IF;
   END LOOP;
  END LOOP;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_closed_work_program_period() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER closed_period_actual BEFORE INSERT OR UPDATE OR DELETE ON public.work_program_actual_versions FOR EACH ROW EXECUTE FUNCTION public.guard_closed_work_program_period();
CREATE TRIGGER closed_period_time BEFORE INSERT OR UPDATE OR DELETE ON public.invoicing_time_entries FOR EACH ROW EXECUTE FUNCTION public.guard_closed_work_program_period();
CREATE TRIGGER closed_period_spend BEFORE INSERT OR UPDATE OR DELETE ON public.project_spend_entries FOR EACH ROW EXECUTE FUNCTION public.guard_closed_work_program_period();
CREATE TRIGGER closed_period_reporting BEFORE INSERT OR UPDATE OR DELETE ON public.work_program_reporting_periods FOR EACH ROW EXECUTE FUNCTION public.guard_closed_work_program_period();
CREATE TRIGGER closed_period_report BEFORE INSERT OR UPDATE OR DELETE ON public.work_program_period_reports FOR EACH ROW EXECUTE FUNCTION public.guard_closed_work_program_period();
CREATE TRIGGER closed_period_claim BEFORE INSERT OR UPDATE OR DELETE ON public.work_program_reimbursement_claims FOR EACH ROW EXECUTE FUNCTION public.guard_closed_work_program_period();
CREATE TRIGGER closed_period_reconciliation BEFORE INSERT OR UPDATE OR DELETE ON public.work_program_closeout_records FOR EACH ROW EXECUTE FUNCTION public.guard_closed_work_program_period();
CREATE TRIGGER closed_period_authority BEFORE INSERT OR UPDATE OR DELETE ON public.program_work_program_events FOR EACH ROW EXECUTE FUNCTION public.guard_closed_work_program_period();

-- A closed prior period does not force reopening merely to reconcile a later report.
CREATE OR REPLACE FUNCTION public.work_program_closeout_command(p_program_id uuid,p_actor_id uuid,p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE w uuid; req uuid:=(p_command->>'requestId')::uuid; kind text:=p_command->>'kind';
 cached public.work_program_reporting_commands; previous public.work_program_closeout_records; v integer; result jsonb; data jsonb; source jsonb; assessment jsonb; content jsonb;
 row jsonb; receipt jsonb; actual jsonb; claim jsonb; packet jsonb; baseline jsonb; target jsonb; fund jsonb; total numeric; amount numeric; record_id uuid;
BEGIN
 SELECT workspace_id INTO w FROM public.programs WHERE id=p_program_id;
 IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=w AND user_id=p_actor_id AND role IN ('owner','admin')) THEN RAISE EXCEPTION 'Private closeout requires an owner or administrator' USING ERRCODE='42501'; END IF;
 -- Lock before comparing the source and successor baselines. Other OWP writes lock their program.
 PERFORM 1 FROM public.workspaces WHERE id=w FOR UPDATE;
 PERFORM 1 FROM public.programs WHERE workspace_id=w ORDER BY id FOR UPDATE;
 IF req IS NULL OR coalesce(kind,'') NOT IN ('save','approve','reopen') OR octet_length(p_command::text)>1000000 THEN RAISE EXCEPTION 'Invalid closeout command' USING ERRCODE='22023'; END IF;
 SELECT * INTO cached FROM public.work_program_reporting_commands WHERE program_id=p_program_id AND request_id=req;
 IF FOUND THEN
  IF cached.actor_id<>p_actor_id OR cached.command<>p_command THEN RAISE EXCEPTION 'Closeout retry differs from saved command' USING ERRCODE='PT409'; END IF;
  RETURN cached.result;
 END IF;
 SELECT * INTO previous FROM public.work_program_closeout_records WHERE program_id=p_program_id ORDER BY version DESC LIMIT 1;
 v:=coalesce(previous.version,0);
 IF (p_command->>'expectedVersion')::integer IS DISTINCT FROM v THEN RAISE EXCEPTION 'Closeout changed; reload retained history' USING ERRCODE='PT409'; END IF;
 data:=public.read_work_program_closeout(p_program_id,p_actor_id,(p_command->>'reportId')::uuid); source:=data->'source'; baseline:=source->'report'->'snapshot'->'baseline';
 IF data->>'sourceHash' IS DISTINCT FROM p_command->>'sourceHash' THEN RAISE EXCEPTION 'Closeout sources changed; reload and reconcile again' USING ERRCODE='PT409'; END IF;
 IF kind='reopen' THEN
  IF previous.state IS DISTINCT FROM 'approved' OR previous.report_id<>(p_command->>'reportId')::uuid THEN RAISE EXCEPTION 'Reopen the current approved reconciliation' USING ERRCODE='PT409'; END IF;
  assessment:=previous.content->'assessment';
 ELSE
  IF previous.state='approved' AND NOT (kind='save' AND EXISTS(SELECT 1 FROM public.work_program_period_closures c JOIN public.work_program_period_reports old_report ON old_report.id=previous.report_id
   WHERE c.program_id=p_program_id AND c.period_id=old_report.period_id AND c.kind='close_period' AND NOT EXISTS(SELECT 1 FROM public.work_program_period_closures n WHERE n.program_id=p_program_id AND n.period_id=c.period_id AND n.version>c.version)
   AND source->'report'->>'period_id'<>old_report.period_id::text AND (source->'report'->'snapshot'->'period'->>'ends_on')::date>c.ends_on)) THEN RAISE EXCEPTION 'Reopen the approved reconciliation before changing it' USING ERRCODE='PT409'; END IF;
  IF kind='approve' THEN
   IF previous.state NOT IN ('draft','reopened') OR previous.id IS NULL OR previous.source_hash<>data->>'sourceHash' OR previous.report_id<>(p_command->>'reportId')::uuid THEN RAISE EXCEPTION 'Save a current reconciliation before approval' USING ERRCODE='PT409'; END IF;
   assessment:=previous.content->'assessment';
  ELSE assessment:=p_command->'assessment'; END IF;
  IF jsonb_typeof(assessment) IS DISTINCT FROM 'object' OR jsonb_typeof(assessment->'claims') IS DISTINCT FROM 'array' OR jsonb_typeof(assessment->'commitments') IS DISTINCT FROM 'array' OR jsonb_typeof(assessment->'work') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Complete the reconciliation lists' USING ERRCODE='22023'; END IF;
  IF (SELECT count(*)<>count(DISTINCT x->>'claimId') FROM jsonb_array_elements(assessment->'claims')x)
   OR (SELECT count(*)<>count(DISTINCT x->>'actualVersionId') FROM jsonb_array_elements(assessment->'commitments')x)
   OR (SELECT count(*)<>count(DISTINCT x->>'elementId') FROM jsonb_array_elements(assessment->'work')x) THEN RAISE EXCEPTION 'Reconciliation repeats a source' USING ERRCODE='22023'; END IF;
  IF jsonb_array_length(assessment->'claims')<>jsonb_array_length(source->'reimbursement'->'claims')
   OR jsonb_array_length(assessment->'commitments')<>(SELECT count(*) FROM jsonb_array_elements(source->'report'->'snapshot'->'actuals')a WHERE a->>'kind'='commitment' AND a->>'status'='approved')
   OR jsonb_array_length(assessment->'work')<>jsonb_array_length(baseline->'content_json'->'elements') THEN RAISE EXCEPTION 'Reconcile every retained claim, commitment and work element' USING ERRCODE='22023'; END IF;
  FOR row IN SELECT * FROM jsonb_array_elements(assessment->'claims') LOOP
   SELECT c INTO claim FROM jsonb_array_elements(source->'reimbursement'->'claims')c WHERE c->>'id'=row->>'claimId';
   IF claim IS NULL THEN RAISE EXCEPTION 'Claim is outside the retained baseline' USING ERRCODE='22023'; END IF;
   SELECT p INTO packet FROM jsonb_array_elements(source->'reimbursement'->'reports')p WHERE p->>'id'=claim->>'current_report_id';
   IF jsonb_typeof(row->'receipts') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'List the matched receipts' USING ERRCODE='22023'; END IF;
   FOR receipt IN SELECT * FROM jsonb_array_elements(row->'receipts') LOOP
    SELECT a INTO actual FROM jsonb_array_elements(source->'actuals')a WHERE a->>'id'=receipt->>'actualVersionId' AND a->>'kind'='payment' AND a->>'status'='approved';
    IF actual IS NULL OR actual->>'currency' IS DISTINCT FROM baseline->'content_json'->>'currency' OR actual->>'amount' IS NULL OR coalesce(receipt->>'amount','') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' OR (receipt->>'amount')::numeric<=0 THEN RAISE EXCEPTION 'Match a positive amount to a current approved payment' USING ERRCODE='22023'; END IF;
    SELECT sum((r->>'amount')::numeric) INTO total FROM jsonb_array_elements(assessment->'claims')c CROSS JOIN LATERAL jsonb_array_elements(c->'receipts')r WHERE r->>'actualVersionId'=receipt->>'actualVersionId';
    IF total>(actual->>'amount')::numeric THEN RAISE EXCEPTION 'Receipt allocations exceed the physical payment' USING ERRCODE='22023'; END IF;
   END LOOP;
   IF row->>'refundDue' IS NOT NULL AND row->>'refundDue' !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' THEN RAISE EXCEPTION 'Enter refunds in whole cents or leave unknown' USING ERRCODE='22023'; END IF;
   IF kind='approve' AND (packet IS NULL OR packet->'snapshot'->'baseline'->>'content_sha256' IS DISTINCT FROM baseline->>'content_sha256' OR coalesce(length(trim(row->>'evidence')),0)=0 OR row->>'refundDue' IS NULL) THEN RAISE EXCEPTION 'Assess each current claim and refund with evidence before approval' USING ERRCODE='22023'; END IF;
  END LOOP;
  FOR row IN SELECT * FROM jsonb_array_elements(assessment->'commitments') LOOP
   SELECT a INTO actual FROM jsonb_array_elements(source->'report'->'snapshot'->'actuals')a WHERE a->>'id'=row->>'actualVersionId' AND a->>'kind'='commitment' AND a->>'status'='approved';
   IF actual IS NULL THEN RAISE EXCEPTION 'Commitment is outside the retained report' USING ERRCODE='22023'; END IF;
   IF row->>'outstandingAmount' IS NOT NULL THEN
    IF row->>'outstandingAmount' !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' OR actual->>'amount' IS NULL OR (row->>'outstandingAmount')::numeric>(actual->>'amount')::numeric THEN RAISE EXCEPTION 'Outstanding commitment exceeds its recorded value' USING ERRCODE='22023'; END IF;
   END IF;
   IF kind='approve' AND (row->>'outstandingAmount' IS NULL OR coalesce(length(trim(row->>'evidence')),0)=0) THEN RAISE EXCEPTION 'Assess each commitment with evidence before approval' USING ERRCODE='22023'; END IF;
  END LOOP;
  FOR row IN SELECT * FROM jsonb_array_elements(assessment->'work') LOOP
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(baseline->'content_json'->'elements')e WHERE e->>'id'=row->>'elementId') OR coalesce(row->>'disposition','') NOT IN ('unassessed','completed','carryover') THEN RAISE EXCEPTION 'Select a retained work element and disposition' USING ERRCODE='22023'; END IF;
   IF row->>'disposition'='carryover' THEN
    SELECT b INTO target FROM jsonb_array_elements(source->'successors')b WHERE b->>'id'=row->>'successorRevisionId';
    IF target IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(target->'content_json'->'elements')e WHERE e->>'id'=row->>'successorElementId') THEN RAISE EXCEPTION 'Carryover requires an adopted successor work element in this workspace and currency' USING ERRCODE='22023'; END IF;
    IF coalesce(row->>'amount','') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' THEN RAISE EXCEPTION 'Carryover requires an explicit amount in whole cents' USING ERRCODE='22023'; END IF;
    SELECT f INTO fund FROM jsonb_array_elements(baseline->'content_json'->'preparation'->'funds')f WHERE f->>'id'=row->>'sourceFundId';
    IF fund IS NULL OR fund->>'amount' IS NULL THEN RAISE EXCEPTION 'Carryover source fund has no assessed baseline amount' USING ERRCODE='22023'; END IF;
    SELECT sum((e->>'amount')::numeric) INTO total FROM jsonb_array_elements(assessment->'work')e WHERE e->>'disposition'='carryover' AND e->>'sourceFundId'=row->>'sourceFundId';
    IF total>(fund->>'amount')::numeric THEN RAISE EXCEPTION 'Carryover exceeds the source fund baseline' USING ERRCODE='22023'; END IF;
    SELECT f INTO fund FROM jsonb_array_elements(target->'content_json'->'preparation'->'funds')f WHERE f->>'id'=row->>'successorFundId';
    IF fund IS NULL OR fund->>'amount' IS NULL OR fund->>'kind' IS DISTINCT FROM 'carryover' THEN RAISE EXCEPTION 'Select an assessed carryover fund in the adopted successor' USING ERRCODE='22023'; END IF;
    SELECT sum((e->>'amount')::numeric) INTO total FROM jsonb_array_elements(assessment->'work')e WHERE e->>'disposition'='carryover' AND (SELECT b.program_id FROM public.program_work_program_revisions b WHERE b.id=(e->>'successorRevisionId')::uuid)=(target->>'program_id')::uuid AND e->>'successorFundId'=row->>'successorFundId';
    -- Reserve the latest approved allocation through reopening/draft corrections until a replacement is approved.
    SELECT total+coalesce(sum((e->>'amount')::numeric),0) INTO total FROM public.work_program_closeout_records c CROSS JOIN LATERAL jsonb_array_elements(c.content->'assessment'->'work')e
     WHERE c.workspace_id=w AND c.program_id<>p_program_id AND c.state='approved' AND NOT EXISTS(SELECT 1 FROM public.work_program_closeout_records newer WHERE newer.program_id=c.program_id AND newer.state='approved' AND newer.version>c.version)
     AND e->>'disposition'='carryover' AND (SELECT b.program_id FROM public.program_work_program_revisions b WHERE b.id=(e->>'successorRevisionId')::uuid)=(target->>'program_id')::uuid AND e->>'successorFundId'=row->>'successorFundId';
    IF total>(fund->>'amount')::numeric THEN RAISE EXCEPTION 'Carryover exceeds the successor fund baseline' USING ERRCODE='22023'; END IF;
   ELSIF row->>'successorRevisionId' IS NOT NULL OR row->>'successorElementId' IS NOT NULL OR row->>'sourceFundId' IS NOT NULL OR row->>'successorFundId' IS NOT NULL OR row->>'amount' IS NOT NULL THEN RAISE EXCEPTION 'Only carryover work may name a successor or amount' USING ERRCODE='22023'; END IF;
   IF kind='approve' AND (row->>'disposition'='unassessed' OR coalesce(length(trim(row->>'evidence')),0)=0) THEN RAISE EXCEPTION 'Assess completion or carryover authority for each element before approval' USING ERRCODE='22023'; END IF;
  END LOOP;
 END IF;
 IF kind IN ('approve','reopen') AND coalesce(length(trim(p_command->>'note')),0)=0 THEN RAISE EXCEPTION 'Record the approval or reopening evidence' USING ERRCODE='22023'; END IF;
 IF kind='approve' THEN
  IF coalesce(length(trim(assessment->>'registerEvidence')),0)=0 THEN RAISE EXCEPTION 'Record the register completeness and reconciliation evidence' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.program_work_program_events e WHERE e.revision_id=(baseline->>'id')::uuid AND e.kind='adoption' AND NOT EXISTS(SELECT 1 FROM public.program_work_program_events n WHERE n.program_id=e.program_id AND n.kind='withdraw_authority' AND n.payload->>'targetEventId'=e.id::text)) THEN RAISE EXCEPTION 'The retained baseline no longer has adoption authority' USING ERRCODE='PT409'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(source->'actuals')a WHERE a->>'entry_date' BETWEEN baseline->'content_json'->>'periodStart' AND source->'report'->'snapshot'->'period'->>'ends_on'
   AND a->>'kind' IN ('labor','expense','opening','commitment') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(source->'report'->'snapshot'->'actuals')b WHERE b->>'id'=a->>'id')) THEN RAISE EXCEPTION 'Issue a current management report before approving changed costs or commitments' USING ERRCODE='PT409'; END IF;
 END IF;
 content:=jsonb_build_object('source',source,'assessment',assessment,'note',coalesce(p_command->>'note',''),
  'limits','Human-recorded reconciliation and carryover evidence only. This does not close a period, post expenses, establish funder acceptance, or prove all external obligations were recorded.');
 INSERT INTO public.work_program_closeout_records(program_id,workspace_id,version,state,report_id,source_hash,content_hash,content,actor_id)
 VALUES(p_program_id,w,v+1,CASE kind WHEN 'approve' THEN 'approved' WHEN 'reopen' THEN 'reopened' ELSE 'draft' END,(p_command->>'reportId')::uuid,data->>'sourceHash',encode(extensions.digest(content::text,'sha256'),'hex'),content,p_actor_id) RETURNING id INTO record_id;
 result:=jsonb_build_object('id',record_id,'version',v+1);
 INSERT INTO public.work_program_reporting_commands(program_id,request_id,actor_id,command,result) VALUES(p_program_id,req,p_actor_id,p_command,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.work_program_closeout_command(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.work_program_closeout_command(uuid,uuid,jsonb) TO service_role;
