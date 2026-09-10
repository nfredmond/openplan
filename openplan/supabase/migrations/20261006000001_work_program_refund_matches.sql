-- Matching classifies existing payments; it never posts costs or changes retained approvals.
-- Missing refundPayments in older evidence means no explicitly matched disbursement.
CREATE FUNCTION public.guard_work_program_cash_matches() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE source jsonb:=NEW.content->'source'; assessment jsonb:=NEW.content->'assessment';
 row jsonb; match jsonb; actual jsonb; direction text; allocated numeric; reserved numeric; opposite boolean;
BEGIN
 -- Reopening must remain possible when a source version needs correction.
 IF NEW.state='reopened' THEN RETURN NEW; END IF;
 PERFORM 1 FROM public.programs WHERE id=NEW.program_id FOR UPDATE;
 FOR row IN SELECT * FROM jsonb_array_elements(assessment->'claims') LOOP
  IF row ? 'refundPayments' AND jsonb_typeof(row->'refundPayments') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'List the matched refund payments' USING ERRCODE='22023';
  END IF;
  FOR match IN SELECT * FROM jsonb_array_elements(coalesce(row->'refundPayments','[]')) LOOP
   SELECT a INTO actual FROM jsonb_array_elements(source->'actuals')a WHERE a->>'id'=match->>'actualVersionId' AND a->>'kind'='payment' AND a->>'status'='approved';
   IF actual IS NULL OR actual->>'currency' IS DISTINCT FROM source->'report'->'snapshot'->'baseline'->'content_json'->>'currency'
    OR actual->>'amount' IS NULL OR coalesce(match->>'amount','') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' OR (match->>'amount')::numeric<=0 THEN
    RAISE EXCEPTION 'Match a positive refund amount to a current approved payment in the baseline currency' USING ERRCODE='22023';
   END IF;
   IF coalesce(length(trim(row->>'evidence')),0)=0 THEN RAISE EXCEPTION 'Explain the outgoing refund payment and its reference in reconciliation evidence' USING ERRCODE='22023'; END IF;
  END LOOP;
 END LOOP;
 FOR direction IN SELECT unnest(ARRAY['receipts','refundPayments']) LOOP
  FOR match IN SELECT m FROM jsonb_array_elements(assessment->'claims')c CROSS JOIN LATERAL jsonb_array_elements(coalesce(c->direction,'[]'))m LOOP
   SELECT a INTO actual FROM jsonb_array_elements(source->'actuals')a WHERE a->>'id'=match->>'actualVersionId';
   SELECT coalesce(sum((m->>'amount')::numeric),0) INTO allocated FROM jsonb_array_elements(assessment->'claims')c CROSS JOIN LATERAL jsonb_array_elements(coalesce(c->direction,'[]'))m WHERE m->>'actualVersionId'=actual->>'id';
   SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(assessment->'claims')c CROSS JOIN LATERAL jsonb_array_elements(coalesce(c->CASE direction WHEN 'receipts' THEN 'refundPayments' ELSE 'receipts' END,'[]'))m WHERE m->>'actualVersionId'=actual->>'id') INTO opposite;
   IF opposite THEN RAISE EXCEPTION 'A physical payment cannot be both a claim receipt and an outgoing refund' USING ERRCODE='22023'; END IF;
   -- Other baselines keep their latest approved matches through drafts and reopening.
   -- Compare entry identity, so a correction version cannot evade a reservation.
   SELECT coalesce(sum(CASE WHEN lists.key=direction THEN (m->>'amount')::numeric ELSE 0 END),0),coalesce(bool_or(lists.key<>direction),false)
    INTO reserved,opposite
    FROM public.work_program_closeout_records retained
    CROSS JOIN LATERAL jsonb_array_elements(retained.content->'assessment'->'claims')c
    CROSS JOIN LATERAL jsonb_each(c)lists
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN lists.key IN ('receipts','refundPayments') THEN lists.value ELSE '[]'::jsonb END)m
    JOIN public.work_program_actual_versions a ON a.id=(m->>'actualVersionId')::uuid
    WHERE retained.program_id=NEW.program_id AND retained.state='approved'
     AND retained.content->'source'->'report'->'snapshot'->'baseline'->>'id'<>source->'report'->'snapshot'->'baseline'->>'id'
     AND NOT EXISTS(SELECT 1 FROM public.work_program_closeout_records newer WHERE newer.program_id=retained.program_id AND newer.state='approved' AND newer.version>retained.version
      AND newer.content->'source'->'report'->'snapshot'->'baseline'->>'id'=retained.content->'source'->'report'->'snapshot'->'baseline'->>'id')
     AND a.entry_id::text=actual->>'entry_id';
   IF opposite THEN RAISE EXCEPTION 'Another baseline reserves this payment in the opposite direction' USING ERRCODE='22023'; END IF;
   IF allocated+reserved>(actual->>'amount')::numeric THEN RAISE EXCEPTION 'Cash matches exceed the physical payment across approved baselines' USING ERRCODE='22023'; END IF;
  END LOOP;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_work_program_cash_matches() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER closeout_cash_matches BEFORE INSERT ON public.work_program_closeout_records FOR EACH ROW EXECUTE FUNCTION public.guard_work_program_cash_matches();

-- A linked refund remains protected even when paid after the closed dates.
CREATE OR REPLACE FUNCTION public.guard_closed_work_program_period() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
       OR EXISTS(SELECT 1 FROM jsonb_array_elements(closure.content->'reconciliation'->'content'->'assessment'->'claims')c CROSS JOIN LATERAL jsonb_array_elements((c->'receipts')||coalesce(c->'refundPayments','[]'))r
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
