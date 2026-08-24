-- RESTRICT fires before sibling workspace cascades can remove both ends of a
-- durable reference. NO ACTION still refuses a direct delete, but checks after
-- the workspace cascade has removed the dependent row.
ALTER TABLE public.land_use_plan_versions
  DROP CONSTRAINT land_use_plan_versions_based_on_version_id_fkey,
  ADD CONSTRAINT land_use_plan_versions_based_on_version_id_fkey
    FOREIGN KEY (based_on_version_id) REFERENCES public.land_use_plan_versions(id) ON DELETE NO ACTION;

ALTER TABLE public.land_use_plan_relationships
  DROP CONSTRAINT land_use_plan_relationships_related_plan_id_fkey,
  ADD CONSTRAINT land_use_plan_relationships_related_plan_id_fkey
    FOREIGN KEY (related_plan_id) REFERENCES public.land_use_plans(id) ON DELETE NO ACTION;

ALTER TABLE public.land_use_plan_decisions
  DROP CONSTRAINT land_use_plan_decisions_supporting_document_id_fkey,
  ADD CONSTRAINT land_use_plan_decisions_supporting_document_id_fkey
    FOREIGN KEY (supporting_document_id) REFERENCES public.kb_documents(id) ON DELETE NO ACTION,
  DROP CONSTRAINT land_use_plan_decisions_version_id_workspace_id_fkey,
  ADD CONSTRAINT land_use_plan_decisions_version_id_workspace_id_fkey
    FOREIGN KEY (version_id, workspace_id)
    REFERENCES public.land_use_plan_versions(id, workspace_id) ON DELETE NO ACTION;

ALTER TABLE public.land_use_plan_implementation_reports
  DROP CONSTRAINT land_use_plan_implementation__adopted_version_id_workspace_fkey,
  ADD CONSTRAINT land_use_plan_implementation__adopted_version_id_workspace_fkey
    FOREIGN KEY (adopted_version_id, workspace_id)
    REFERENCES public.land_use_plan_versions(id, workspace_id) ON DELETE NO ACTION;
