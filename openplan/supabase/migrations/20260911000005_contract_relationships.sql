-- A complete stated allocation must reconcile. Incomplete quantities stay nullable and visible.
CREATE FUNCTION public.validate_contract_budget(content jsonb) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE metric text; task jsonb; header numeric; allocated numeric; missing integer;
BEGIN
 FOREACH metric IN ARRAY ARRAY['fee','cost','hours'] LOOP
  header:=(content->>metric)::numeric;
  SELECT sum((q->>metric)::numeric),count(*) FILTER(WHERE q->>metric IS NULL) INTO allocated,missing FROM jsonb_array_elements(content->'tasks') q;
  IF header IS NOT NULL AND (allocated>header OR (missing=0 AND allocated IS DISTINCT FROM header)) THEN RAISE EXCEPTION 'Task % allocations do not reconcile to the stated contract budget',metric USING ERRCODE='22023'; END IF;
 END LOOP;
 FOR task IN SELECT value FROM jsonb_array_elements(content->'tasks') LOOP
  FOREACH metric IN ARRAY ARRAY['cost','hours'] LOOP
   header:=(task->>metric)::numeric;
   SELECT sum((q->>metric)::numeric) INTO allocated FROM jsonb_array_elements(task->'staff') q;
   IF header IS NOT NULL AND allocated>header THEN RAISE EXCEPTION 'Staff % allocations exceed the task budget',metric USING ERRCODE='22023'; END IF;
  END LOOP;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.validate_contract_budget(jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.guard_contract_parent_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_TABLE_NAME='invoicing_engagements' AND EXISTS(SELECT 1 FROM public.contract_baselines WHERE engagement_id=OLD.id) THEN
  IF (NEW.workspace_id,NEW.project_id,NEW.client_id,NEW.parent_engagement_id,NEW.engagement_kind) IS DISTINCT FROM (OLD.workspace_id,OLD.project_id,OLD.client_id,OLD.parent_engagement_id,OLD.engagement_kind) THEN RAISE EXCEPTION 'Retained contract project and agreement identity cannot change' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='projects' THEN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id AND EXISTS(SELECT 1 FROM public.contract_tasks WHERE project_id=OLD.id) THEN RAISE EXCEPTION 'Retained contract project workspace cannot change' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='project_deliverables' THEN
  IF NEW.project_id IS DISTINCT FROM OLD.project_id AND EXISTS(SELECT 1 FROM public.contract_tasks WHERE deliverable_id=OLD.id) THEN RAISE EXCEPTION 'Retained contract deliverable project cannot change' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER retain_contract_engagement_parent BEFORE UPDATE ON public.invoicing_engagements FOR EACH ROW EXECUTE FUNCTION public.guard_contract_parent_identity();
CREATE TRIGGER retain_contract_project_parent BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.guard_contract_parent_identity();
CREATE TRIGGER retain_contract_deliverable_parent BEFORE UPDATE ON public.project_deliverables FOR EACH ROW EXECUTE FUNCTION public.guard_contract_parent_identity();
