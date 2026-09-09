-- Transaction-start timestamps cannot establish visibility before a historical cutoff.
-- First observation is a conservative upper bound, not an invented commit timestamp.
ALTER TABLE public.contract_source_changes ADD COLUMN transaction_id xid8 NOT NULL DEFAULT pg_current_xact_id();
CREATE TABLE public.contract_source_observations (
 source_change_id uuid PRIMARY KEY REFERENCES public.contract_source_changes(id),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.contract_source_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contract_source_observations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.contract_source_observations TO service_role;
CREATE TRIGGER immutable_contract_history BEFORE UPDATE OR DELETE ON public.contract_source_observations
 FOR EACH ROW EXECUTE FUNCTION public.guard_contract_history();

-- Cover immutable versions as well as mutable rows: either can commit late.
-- Reports and document metadata are themselves included in management source reads.
DO $$ DECLARE source_table text; BEGIN
 FOREACH source_table IN ARRAY ARRAY[
  'client_invoices','contract_access_versions','contract_accounting_imports',
  'contract_accounting_reviews','contract_actual_versions','contract_baselines',
  'contract_billing_sources','contract_capacity_versions','contract_closeouts',
  'contract_deliverable_events','contract_estimates','contract_forecasts',
  'contract_imports','contract_management_responses','contract_master_terms',
  'contract_order_periods','contract_rates','contract_received_files',
  'contract_received_invoices','contract_response_applications','contract_schedules',
  'contract_settlement_events','contract_snapshots','contract_source_deletions',
  'contract_task_assignments','contract_work_updates','invoicing_engagements',
  'invoicing_staff','invoicing_time_entries','kb_documents','project_deliverables',
  'project_spend_entries','work_program_actual_versions','workspace_members',
  'project_risks','project_issues','project_decisions'
 ] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=('public.'||source_table)::regclass AND tgname='retain_contract_mutable_change') THEN
   EXECUTE format('CREATE TRIGGER retain_contract_mutable_change AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.retain_contract_mutable_change()',source_table);
  END IF;
 END LOOP;
END $$;
-- Earlier source visibility was not recorded. Preserve old issued snapshots;
-- refuse new reconstructions preceding this installation boundary.
INSERT INTO public.contract_source_changes(workspace_id) SELECT DISTINCT workspace_id FROM public.contract_baselines;

ALTER FUNCTION public.read_contract_management(uuid,uuid,timestamptz) RENAME TO read_contract_management_source_receipts;
REVOKE ALL ON FUNCTION public.read_contract_management_source_receipts(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.read_contract_management(p_engagement_id uuid,p_actor_id uuid,p_cutoff timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb; workspace uuid;
BEGIN
 result:=public.read_contract_management_source_receipts(p_engagement_id,p_actor_id,p_cutoff);
 IF result->>'role' IN ('owner','admin','pm','finance') THEN
  workspace:=(result->'engagement'->>'workspace_id')::uuid;
  INSERT INTO public.contract_source_observations(source_change_id)
   SELECT c.id FROM public.contract_source_changes c
   WHERE c.workspace_id=workspace AND NOT EXISTS(SELECT 1 FROM public.contract_source_observations o WHERE o.source_change_id=c.id)
   ORDER BY c.id
   ON CONFLICT(source_change_id) DO NOTHING;
  result:=result||jsonb_build_object('cutoffConflicts',coalesce((result->>'cutoffConflicts')::boolean,false) OR EXISTS(
   SELECT 1 FROM public.contract_source_changes c LEFT JOIN public.contract_source_observations o ON o.source_change_id=c.id
   WHERE c.workspace_id=workspace AND c.transaction_id<>pg_current_xact_id()
    AND (o.observed_at IS NULL OR o.observed_at>p_cutoff)
  ));
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_contract_management(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_contract_management(uuid,uuid,timestamptz) TO service_role;
COMMENT ON TABLE public.contract_source_observations IS 'First read of a source change: conservative visibility evidence, not its commit time. Own-transaction inputs are known to that transaction and publish atomically with its report.';
