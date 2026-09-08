-- A deleted legacy source cannot silently disappear from a historical cutoff.
-- Contract baselines are introduced by this migration series, so every report's
-- required approved baseline postdates installation of this custody boundary.
CREATE TABLE public.contract_source_deletions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 engagement_id uuid REFERENCES public.invoicing_engagements(id),
 project_id uuid REFERENCES public.projects(id),
 source_table text NOT NULL CHECK(source_table IN ('invoicing_time_entries','project_spend_entries','client_invoices')),
 source_id uuid NOT NULL,
 source_created_at timestamptz NOT NULL,
 deleted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX contract_source_deletion_cutoff ON public.contract_source_deletions(workspace_id,deleted_at);
ALTER TABLE public.contract_source_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contract_source_deletions FROM anon,authenticated,service_role;
GRANT SELECT ON public.contract_source_deletions TO service_role,authenticated;
CREATE POLICY management_read ON public.contract_source_deletions FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=contract_source_deletions.workspace_id AND m.user_id=auth.uid() AND m.role IN ('owner','admin')));
CREATE TRIGGER immutable_contract_history BEFORE UPDATE OR DELETE ON public.contract_source_deletions FOR EACH ROW EXECUTE FUNCTION public.guard_contract_history();

CREATE FUNCTION public.retain_contract_source_deletion() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE w uuid; project uuid; engagement uuid;
BEGIN
 IF TG_TABLE_NAME='project_spend_entries' THEN
  project:=OLD.project_id; SELECT workspace_id INTO w FROM public.projects WHERE id=project;
 ELSE
  w:=OLD.workspace_id; engagement:=OLD.engagement_id;
  SELECT project_id INTO project FROM public.invoicing_engagements WHERE id=engagement;
 END IF;
 IF EXISTS(SELECT 1 FROM public.contract_baselines b JOIN public.invoicing_engagements e ON e.id=b.engagement_id WHERE e.workspace_id=w AND (e.id=engagement OR e.project_id=project)) THEN
  INSERT INTO public.contract_source_deletions(workspace_id,engagement_id,project_id,source_table,source_id,source_created_at)
  VALUES(w,engagement,project,TG_TABLE_NAME,OLD.id,OLD.created_at);
 END IF;
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.retain_contract_source_deletion() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER retain_contract_source_deletion AFTER DELETE ON public.invoicing_time_entries FOR EACH ROW EXECUTE FUNCTION public.retain_contract_source_deletion();
CREATE TRIGGER retain_contract_source_deletion AFTER DELETE ON public.project_spend_entries FOR EACH ROW EXECUTE FUNCTION public.retain_contract_source_deletion();
CREATE TRIGGER retain_contract_source_deletion AFTER DELETE ON public.client_invoices FOR EACH ROW EXECUTE FUNCTION public.retain_contract_source_deletion();
