-- Current membership, working assignments and project response rows have no historical versions.
-- Retain only mutation timing; older issued snapshots already retain their exact inputs.
CREATE TABLE public.contract_source_changes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contract_source_change_cutoff ON public.contract_source_changes(workspace_id,changed_at);
ALTER TABLE public.contract_source_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contract_source_changes FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.contract_source_changes TO service_role;
CREATE TRIGGER immutable_contract_history BEFORE UPDATE OR DELETE ON public.contract_source_changes FOR EACH ROW EXECUTE FUNCTION public.guard_contract_history();
-- Do not reconstruct mutable inputs from before installation of this custody boundary.
INSERT INTO public.contract_source_changes(workspace_id) SELECT DISTINCT workspace_id FROM public.contract_baselines;
CREATE FUNCTION public.retain_contract_mutable_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE old_w uuid; new_w uuid; source jsonb;
BEGIN
 IF TG_OP='UPDATE' AND to_jsonb(NEW)=to_jsonb(OLD) THEN RETURN NEW; END IF;
 IF TG_OP<>'INSERT' THEN
  source:=to_jsonb(OLD);old_w:=(source->>'workspace_id')::uuid;
  IF old_w IS NULL THEN SELECT workspace_id INTO old_w FROM public.projects WHERE id=(source->>'project_id')::uuid; END IF;
 END IF;
 IF TG_OP<>'DELETE' THEN
  source:=to_jsonb(NEW);new_w:=(source->>'workspace_id')::uuid;
  IF new_w IS NULL THEN SELECT workspace_id INTO new_w FROM public.projects WHERE id=(source->>'project_id')::uuid; END IF;
 END IF;
 INSERT INTO public.contract_source_changes(workspace_id) SELECT DISTINCT w FROM unnest(ARRAY[old_w,new_w]) w WHERE w IS NOT NULL AND EXISTS(SELECT 1 FROM public.contract_baselines b WHERE b.workspace_id=w);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.retain_contract_mutable_change() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER retain_contract_mutable_change AFTER INSERT OR UPDATE OR DELETE ON public.contract_task_assignments FOR EACH ROW EXECUTE FUNCTION public.retain_contract_mutable_change();
CREATE TRIGGER retain_contract_mutable_change AFTER INSERT OR UPDATE OR DELETE ON public.invoicing_staff FOR EACH ROW EXECUTE FUNCTION public.retain_contract_mutable_change();
CREATE TRIGGER retain_contract_mutable_change AFTER INSERT OR UPDATE OR DELETE ON public.workspace_members FOR EACH ROW EXECUTE FUNCTION public.retain_contract_mutable_change();
CREATE TRIGGER retain_contract_mutable_change AFTER INSERT OR UPDATE OR DELETE ON public.invoicing_engagements FOR EACH ROW EXECUTE FUNCTION public.retain_contract_mutable_change();
CREATE TRIGGER retain_contract_mutable_change AFTER INSERT OR UPDATE OR DELETE ON public.project_risks FOR EACH ROW EXECUTE FUNCTION public.retain_contract_mutable_change();
CREATE TRIGGER retain_contract_mutable_change AFTER INSERT OR UPDATE OR DELETE ON public.project_issues FOR EACH ROW EXECUTE FUNCTION public.retain_contract_mutable_change();
CREATE TRIGGER retain_contract_mutable_change AFTER INSERT OR UPDATE OR DELETE ON public.project_decisions FOR EACH ROW EXECUTE FUNCTION public.retain_contract_mutable_change();
CREATE TRIGGER retain_contract_mutable_change AFTER INSERT OR UPDATE OR DELETE ON public.project_deliverables FOR EACH ROW EXECUTE FUNCTION public.retain_contract_mutable_change();
CREATE OR REPLACE FUNCTION public.read_contract_management(p_engagement_id uuid,p_actor_id uuid,p_cutoff timestamptz DEFAULT now()) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 result:=public.read_contract_management_closeout(p_engagement_id,p_actor_id,p_cutoff);
 IF result->>'role' IN ('owner','admin','pm','finance') THEN
  result:=result||jsonb_build_object('cutoffConflicts',coalesce((result->>'cutoffConflicts')::boolean,false) OR EXISTS(SELECT 1 FROM public.contract_source_changes c WHERE c.workspace_id=(result->'engagement'->>'workspace_id')::uuid AND c.changed_at>p_cutoff));
  result:=jsonb_set(result,'{responses,records}',coalesce((SELECT jsonb_agg(r) FROM jsonb_array_elements(result->'responses'->'records') r WHERE (r->>'updated_at')::timestamptz<=p_cutoff),'[]'::jsonb));
 END IF;
 IF result->>'role'='pm' THEN result:=result||jsonb_build_object('snapshots',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'created_at',s.created_at,'snapshot_hash',s.snapshot_hash) ORDER BY s.created_at DESC) FROM public.contract_snapshots s WHERE s.engagement_id=p_engagement_id AND s.created_at<=p_cutoff AND s.audience='management'),'[]')); END IF;
 RETURN result;
END $$;
