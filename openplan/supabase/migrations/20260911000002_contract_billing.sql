CREATE TABLE public.contract_billing_sources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), engagement_id uuid NOT NULL REFERENCES public.invoicing_engagements(id), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 entry_id uuid NOT NULL UNIQUE, actual_version_id uuid NOT NULL REFERENCES public.contract_actual_versions(id), invoice_id uuid NOT NULL REFERENCES public.client_invoices(id),
 billing_rate_id uuid REFERENCES public.contract_rates(id), lines jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.contract_billing_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contract_billing_sources FROM anon,authenticated,service_role;
GRANT SELECT ON public.contract_billing_sources TO authenticated,service_role;
CREATE POLICY management_read ON public.contract_billing_sources FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=contract_billing_sources.workspace_id AND m.user_id=auth.uid() AND m.role IN ('owner','admin')));
CREATE TRIGGER immutable_contract_billing BEFORE UPDATE OR DELETE ON public.contract_billing_sources FOR EACH ROW EXECUTE FUNCTION public.guard_contract_history();
CREATE FUNCTION public.bill_contract_actuals(p_engagement_id uuid,p_actor_id uuid,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
#variable_conflict use_column
DECLARE e public.invoicing_engagements; b public.contract_baselines; v public.contract_actual_versions; rate public.contract_rates; invoice_id uuid:=gen_random_uuid(); line_id uuid;
 source jsonb; allocation jsonb; lines jsonb; first_line uuid; amount numeric; total numeric:=0; gross numeric; allocated numeric; retention numeric; percent numeric:=(p_command->>'retentionPercent')::numeric; ix integer; pos integer:=0;
BEGIN
 SELECT * INTO e FROM public.invoicing_engagements WHERE id=p_engagement_id FOR UPDATE;
 IF e.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=e.workspace_id AND user_id=p_actor_id AND role IN ('owner','admin')) THEN RAISE EXCEPTION 'Billing requires contract management access' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(e.workspace_id::text,451));
 IF jsonb_typeof(p_command->'entryIds') IS DISTINCT FROM 'array' OR jsonb_array_length(p_command->'entryIds') NOT BETWEEN 1 AND 500 OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(p_command->'entryIds')) OR percent IS NULL OR percent NOT BETWEEN 0 AND 100 OR round(percent,2)<>percent OR coalesce(length(trim(p_command->>'invoiceNumber')),0)=0 OR (p_command->>'invoiceDate')::date IS NULL THEN RAISE EXCEPTION 'Choose unique actuals, exact retention and invoice identity' USING ERRCODE='22023'; END IF;
 SELECT * INTO b FROM public.contract_baselines WHERE engagement_id=e.id AND state='approved' ORDER BY version DESC LIMIT 1;
 IF b.id IS NULL THEN RAISE EXCEPTION 'Approved contract baseline required for billing' USING ERRCODE='22023'; END IF;
 INSERT INTO public.client_invoices(id,workspace_id,client_id,engagement_id,project_id,invoice_number,status,invoice_date,due_date,currency_code,retention_percent,created_by)
 VALUES(invoice_id,e.workspace_id,e.client_id,e.id,e.project_id,p_command->>'invoiceNumber','draft',(p_command->>'invoiceDate')::date,(p_command->>'dueDate')::date,b.content->>'currency',percent,p_actor_id);
 FOR source IN SELECT value FROM jsonb_array_elements(p_command->'entryIds') LOOP
  SELECT * INTO v FROM public.contract_actual_versions WHERE entry_id=(source#>>'{}')::uuid AND engagement_id=e.id ORDER BY version DESC LIMIT 1;
  IF public.contract_shared_source_stale(v) THEN RAISE EXCEPTION 'Reconcile the current shared OWP source before billing' USING ERRCODE='PT409'; END IF;
  IF v.id IS NULL OR v.command->>'status'<>'approved' OR NOT coalesce((v.command->>'billable')::boolean,false) OR v.command->>'category' NOT IN ('labor','expense') OR v.amount IS NULL OR jsonb_array_length(v.allocations)=0 OR EXISTS(SELECT 1 FROM public.contract_billing_sources x WHERE x.entry_id=v.entry_id) THEN RAISE EXCEPTION 'Only approved, allocated, unbilled labor and expenses may be billed' USING ERRCODE='PT409'; END IF;
  IF v.time_entry_id IS NOT NULL THEN
   PERFORM 1 FROM public.invoicing_time_entries WHERE id=v.time_entry_id FOR UPDATE;
   IF EXISTS(SELECT 1 FROM public.invoicing_time_entries WHERE id=v.time_entry_id AND billed_line_item_id IS NOT NULL) THEN RAISE EXCEPTION 'Time source already billed' USING ERRCODE='PT409'; END IF;
  END IF;
  rate:=NULL; gross:=v.amount;
  IF v.command->>'category'='labor' THEN
   SELECT * INTO rate FROM public.contract_rates WHERE engagement_id=e.id AND staff_id=(v.command->>'staffId')::uuid AND basis='billing' AND (v.command->>'entryDate')::date BETWEEN starts_on AND ends_on;
   IF rate.id IS NULL THEN RAISE EXCEPTION 'Effective billing rate required; internal cost is not a client fee' USING ERRCODE='22023'; END IF;
   gross:=round(v.hours*rate.hourly_rate,2);
  END IF;
  lines:='[]'; ix:=0; allocated:=0; first_line:=NULL;
  FOR allocation IN SELECT value FROM jsonb_array_elements(v.allocations) LOOP
   ix:=ix+1; pos:=pos+1;
   amount:=CASE WHEN ix=jsonb_array_length(v.allocations) THEN gross-allocated ELSE trunc(gross*(allocation->>'share')::numeric/10000,2) END; allocated:=allocated+amount;
   INSERT INTO public.client_invoice_line_items(invoice_id,position,description,quantity,unit_label,unit_amount,amount,deliverable_id)
   VALUES(invoice_id,pos,v.command->>'description',(allocation->>'hours')::numeric,CASE WHEN rate.id IS NOT NULL THEN 'hours' ELSE NULL END,rate.hourly_rate,amount,(allocation->>'deliverableId')::uuid) RETURNING id INTO line_id;
   first_line:=coalesce(first_line,line_id);
   lines:=lines||jsonb_build_array(jsonb_build_object('lineId',line_id,'taskId',allocation->>'taskId','deliverableId',allocation->>'deliverableId','share',allocation->'share','amount',amount::text,'hours',allocation->>'hours'));
  END LOOP;
  INSERT INTO public.contract_billing_sources(engagement_id,workspace_id,entry_id,actual_version_id,invoice_id,billing_rate_id,lines) VALUES(e.id,e.workspace_id,v.entry_id,v.id,invoice_id,rate.id,lines);
  IF v.time_entry_id IS NOT NULL THEN UPDATE public.invoicing_time_entries SET billed_line_item_id=first_line WHERE id=v.time_entry_id; END IF;
  total:=total+gross;
 END LOOP;
 retention:=round(total*percent/100,2);
 UPDATE public.client_invoices SET subtotal_amount=total,retention_amount=retention,total_amount=total-retention WHERE id=invoice_id;
 RETURN jsonb_build_object('invoiceId',invoice_id,'gross',total::text,'retention',retention::text,'net',(total-retention)::text);
END $$;
REVOKE ALL ON FUNCTION public.bill_contract_actuals(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bill_contract_actuals(uuid,uuid,jsonb) TO service_role;

-- Issued contract invoices retain their financial and source meaning. Cash and credit events live in the source history.
CREATE FUNCTION public.guard_contract_invoice() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_TABLE_NAME='client_invoices' THEN
  IF TG_OP='UPDATE' AND current_user='postgres' AND OLD.status='draft' THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM public.contract_billing_sources s WHERE s.invoice_id=OLD.id) AND (TG_OP='DELETE' OR (to_jsonb(NEW)-'status'-'sent_date'-'paid_date'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'sent_date'-'paid_date'-'updated_at') OR (OLD.status IN ('sent','paid') AND NEW.status NOT IN ('sent','paid'))) THEN RAISE EXCEPTION 'Contract billing identity is retained; record a documented credit or payment' USING ERRCODE='23514'; END IF;
 ELSE
  IF TG_OP='INSERT' THEN
   IF EXISTS(SELECT 1 FROM public.contract_billing_sources s WHERE s.invoice_id=NEW.invoice_id) AND NOT (current_user='postgres' AND EXISTS(SELECT 1 FROM public.client_invoices i WHERE i.id=NEW.invoice_id AND i.status='draft')) THEN RAISE EXCEPTION 'Cannot append lines to retained contract billing' USING ERRCODE='23514'; END IF;
   RETURN NEW;
  END IF;
  IF EXISTS(SELECT 1 FROM public.contract_billing_sources s WHERE s.invoice_id=OLD.invoice_id) THEN RAISE EXCEPTION 'Source-attributed invoice lines are immutable' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER retained_contract_invoice BEFORE UPDATE OR DELETE ON public.client_invoices FOR EACH ROW EXECUTE FUNCTION public.guard_contract_invoice();
CREATE TRIGGER retained_contract_invoice_line BEFORE INSERT OR UPDATE OR DELETE ON public.client_invoice_line_items FOR EACH ROW EXECUTE FUNCTION public.guard_contract_invoice();
