-- Relation checks apply even to privileged imports; public clients have no direct history writes.
CREATE FUNCTION public.guard_contract_delivery_relationship() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.invoicing_engagements; value jsonb:=to_jsonb(NEW);
BEGIN
 SELECT * INTO e FROM public.invoicing_engagements WHERE id=NEW.engagement_id;
 IF e.id IS NULL OR e.workspace_id IS DISTINCT FROM NEW.workspace_id THEN RAISE EXCEPTION 'Contract history must retain its assignment workspace' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='contract_management_responses' AND NOT EXISTS(SELECT 1 FROM public.contract_forecasts f WHERE f.id=(value->>'forecast_id')::uuid AND f.engagement_id=e.id) THEN RAISE EXCEPTION 'Response forecast belongs to another assignment' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='contract_response_applications' AND (NOT EXISTS(SELECT 1 FROM public.contract_management_responses r WHERE r.id=(value->>'response_id')::uuid AND r.engagement_id=e.id) OR NOT EXISTS(SELECT 1 FROM public.contract_schedules s WHERE s.id=(value->>'schedule_id')::uuid AND s.engagement_id=e.id)) THEN RAISE EXCEPTION 'Applied response and schedule must share the assignment' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='contract_deliverable_events' AND NOT EXISTS(SELECT 1 FROM public.project_deliverables d WHERE d.id=(value->>'deliverable_id')::uuid AND d.project_id=e.project_id) THEN RAISE EXCEPTION 'Accepted deliverable must belong to the assignment project' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='contract_closeouts' AND value->>'previous_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.contract_closeouts c WHERE c.id=(value->>'previous_id')::uuid AND c.engagement_id=e.id AND c.version=(value->>'version')::integer-1) THEN RAISE EXCEPTION 'Closeout predecessor must be the prior assignment revision' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER scope_response BEFORE INSERT ON public.contract_management_responses FOR EACH ROW EXECUTE FUNCTION public.guard_contract_delivery_relationship();
CREATE TRIGGER scope_response_application BEFORE INSERT ON public.contract_response_applications FOR EACH ROW EXECUTE FUNCTION public.guard_contract_delivery_relationship();
CREATE TRIGGER scope_settlement BEFORE INSERT ON public.contract_settlement_events FOR EACH ROW EXECUTE FUNCTION public.guard_contract_delivery_relationship();
CREATE TRIGGER scope_deliverable_event BEFORE INSERT ON public.contract_deliverable_events FOR EACH ROW EXECUTE FUNCTION public.guard_contract_delivery_relationship();
CREATE TRIGGER scope_closeout BEFORE INSERT ON public.contract_closeouts FOR EACH ROW EXECUTE FUNCTION public.guard_contract_delivery_relationship();

CREATE FUNCTION public.guard_closed_contract_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.invoicing_engagements; old_value jsonb:=to_jsonb(OLD); new_value jsonb:=to_jsonb(NEW);
BEGIN
 FOR e IN SELECT DISTINCT assignment.* FROM public.invoicing_engagements assignment WHERE
  assignment.id IN ((old_value->>'engagement_id')::uuid,(new_value->>'engagement_id')::uuid)
  OR (TG_TABLE_NAME='project_spend_entries' AND EXISTS(SELECT 1 FROM public.contract_actual_versions a WHERE a.engagement_id=assignment.id AND a.spend_entry_id IN ((old_value->>'id')::uuid,(new_value->>'id')::uuid)))
 LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(e.workspace_id::text,451));
  IF (SELECT state FROM public.contract_closeouts WHERE engagement_id=e.id ORDER BY version DESC LIMIT 1)='closed' THEN RAISE EXCEPTION 'Reopen the contract before changing its financial source' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;RETURN NEW;
END $$;
CREATE TRIGGER closed_contract_invoice BEFORE INSERT OR UPDATE OR DELETE ON public.client_invoices FOR EACH ROW EXECUTE FUNCTION public.guard_closed_contract_source();
CREATE TRIGGER closed_contract_time BEFORE INSERT OR UPDATE OR DELETE ON public.invoicing_time_entries FOR EACH ROW EXECUTE FUNCTION public.guard_closed_contract_source();
CREATE TRIGGER closed_contract_spend BEFORE UPDATE OR DELETE ON public.project_spend_entries FOR EACH ROW EXECUTE FUNCTION public.guard_closed_contract_source();
