-- Module-link cleanup triggers: when a link TARGET row (a scenario set, campaign,
-- report, project, plan, dataset, or run) is deleted, remove the polymorphic rows
-- in plan_links / program_links / model_links that pointed at it. Those tables
-- store linked_id as a bare UUID with a link_type CHECK — deliberately no FK
-- (FK-per-type was considered and rejected) — so before this migration a deleted
-- target left its link rows dangling forever.
--
-- Pre-existing dangling rows are intentionally NOT swept here. Migrations in this
-- repo are strictly non-destructive DDL, never a data sweep against a hosted
-- database, and dangling rows are inert in practice: the plan, program, and model
-- detail routes resolve linked_id in batches via IN () reads, so a link whose
-- target is gone simply never renders. From this migration on, deletes clean up
-- after themselves; history is left untouched.
--
-- link_type → target table, each confirmed against the API resolvers in
-- src/app/api/{plans,programs,models}/**/route.ts:
--   scenario_set        → scenario_sets
--   engagement_campaign → engagement_campaigns
--   report              → reports
--   project_record      → projects
--   plan                → plans
--   data_dataset        → data_datasets
--   run                 → runs
-- Every link_type value in the three CHECK constraints is covered; none excluded.
-- src/test/module-link-cleanup-triggers-migration.test.ts fails the build if a
-- link_type is added to a CHECK without a trigger registration here (or a
-- follow-up migration).

CREATE OR REPLACE FUNCTION public.cleanup_module_links_for_target()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- TG_ARGV[0] carries the link_type this target table is registered under.
  -- Each link table's CHECK allows only a subset of link_type values, so some
  -- of these deletes are no-ops; running all three keeps the function shared
  -- and a registration one trigger per target table.
  DELETE FROM plan_links WHERE link_type = TG_ARGV[0] AND linked_id = OLD.id;
  DELETE FROM program_links WHERE link_type = TG_ARGV[0] AND linked_id = OLD.id;
  DELETE FROM model_links WHERE link_type = TG_ARGV[0] AND linked_id = OLD.id;
  RETURN OLD;
END;
$$;

-- The link tables are only indexed by their owner (plan_id / program_id /
-- model_id); the trigger deletes by (link_type, linked_id), so give that
-- predicate an index instead of a per-delete sequential scan.
CREATE INDEX IF NOT EXISTS idx_plan_links_target
  ON plan_links(link_type, linked_id);
CREATE INDEX IF NOT EXISTS idx_program_links_target
  ON program_links(link_type, linked_id);
CREATE INDEX IF NOT EXISTS idx_model_links_target
  ON model_links(link_type, linked_id);

DROP TRIGGER IF EXISTS trg_scenario_sets_cleanup_module_links ON scenario_sets;
CREATE TRIGGER trg_scenario_sets_cleanup_module_links
AFTER DELETE ON scenario_sets
FOR EACH ROW
EXECUTE FUNCTION cleanup_module_links_for_target('scenario_set');

DROP TRIGGER IF EXISTS trg_engagement_campaigns_cleanup_module_links ON engagement_campaigns;
CREATE TRIGGER trg_engagement_campaigns_cleanup_module_links
AFTER DELETE ON engagement_campaigns
FOR EACH ROW
EXECUTE FUNCTION cleanup_module_links_for_target('engagement_campaign');

DROP TRIGGER IF EXISTS trg_reports_cleanup_module_links ON reports;
CREATE TRIGGER trg_reports_cleanup_module_links
AFTER DELETE ON reports
FOR EACH ROW
EXECUTE FUNCTION cleanup_module_links_for_target('report');

DROP TRIGGER IF EXISTS trg_projects_cleanup_module_links ON projects;
CREATE TRIGGER trg_projects_cleanup_module_links
AFTER DELETE ON projects
FOR EACH ROW
EXECUTE FUNCTION cleanup_module_links_for_target('project_record');

DROP TRIGGER IF EXISTS trg_plans_cleanup_module_links ON plans;
CREATE TRIGGER trg_plans_cleanup_module_links
AFTER DELETE ON plans
FOR EACH ROW
EXECUTE FUNCTION cleanup_module_links_for_target('plan');

DROP TRIGGER IF EXISTS trg_data_datasets_cleanup_module_links ON data_datasets;
CREATE TRIGGER trg_data_datasets_cleanup_module_links
AFTER DELETE ON data_datasets
FOR EACH ROW
EXECUTE FUNCTION cleanup_module_links_for_target('data_dataset');

DROP TRIGGER IF EXISTS trg_runs_cleanup_module_links ON runs;
CREATE TRIGGER trg_runs_cleanup_module_links
AFTER DELETE ON runs
FOR EACH ROW
EXECUTE FUNCTION cleanup_module_links_for_target('run');
