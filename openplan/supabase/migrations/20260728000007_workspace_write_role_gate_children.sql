-- Viewer write denial, part two: the tables that reach a workspace by parent.
--
-- 20260728000006 covers the 45 tables owning a `workspace_id` column. These 35
-- carry no such column — a report section belongs to a report, a scenario entry
-- to a scenario set — so their permissive policies already join to the parent to
-- find the workspace, and the restrictive policy has to make the same trip.
--
-- The parent chosen for each table is its NOT NULL owning foreign key, so the
-- lookup cannot silently resolve to NULL for a legitimately-shaped row. Three
-- shapes needed more than a plain one-hop lookup, and each is called out:
--
--   - model_run_kpis hangs off model_runs OR county_runs (a nullable XOR pair),
--     so the expression coalesces both lookups.
--   - network_zones / _corridors / _connectors reach a workspace two hops out,
--     through network_package_versions to network_packages.
--   - scenario_comparison_indicator_deltas reaches it through
--     scenario_comparison_snapshots to scenario_sets.
--
-- If a lookup finds nothing the expression is NULL, workspace_member_can_write
-- returns false, and the write is refused. An orphaned or malformed child row
-- fails closed; it does not fall through to permitted.
--
-- Everything else about the approach — why RESTRICTIVE rather than REVOKE, why
-- per-command rather than FOR ALL, why service_role and anon are unaffected, and
-- why all three commands are created whether or not a permissive policy exists
-- for them today — is argued once in 20260728000006 and not repeated here.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
    ('client_invoice_line_items', '(SELECT p.workspace_id FROM public.client_invoices p WHERE p.id = client_invoice_line_items.invoice_id)'),
    ('data_dataset_project_links', '(SELECT p.workspace_id FROM public.data_datasets p WHERE p.id = data_dataset_project_links.dataset_id)'),
    ('engagement_categories', '(SELECT p.workspace_id FROM public.engagement_campaigns p WHERE p.id = engagement_categories.campaign_id)'),
    ('engagement_closeloop_entries', '(SELECT p.workspace_id FROM public.engagement_campaigns p WHERE p.id = engagement_closeloop_entries.campaign_id)'),
    ('engagement_items', '(SELECT p.workspace_id FROM public.engagement_campaigns p WHERE p.id = engagement_items.campaign_id)'),
    ('engagement_survey_question_options', '(SELECT p.workspace_id FROM public.engagement_campaigns p WHERE p.id = engagement_survey_question_options.campaign_id)'),
    ('engagement_survey_questions', '(SELECT p.workspace_id FROM public.engagement_campaigns p WHERE p.id = engagement_survey_questions.campaign_id)'),
    ('invoicing_rate_entries', '(SELECT p.workspace_id FROM public.invoicing_rate_tables p WHERE p.id = invoicing_rate_entries.rate_table_id)'),
    ('model_links', '(SELECT p.workspace_id FROM public.models p WHERE p.id = model_links.model_id)'),
    ('model_run_artifacts', '(SELECT p.workspace_id FROM public.model_runs p WHERE p.id = model_run_artifacts.run_id)'),
    ('model_run_stages', '(SELECT p.workspace_id FROM public.model_runs p WHERE p.id = model_run_stages.run_id)'),
    ('network_package_versions', '(SELECT p.workspace_id FROM public.network_packages p WHERE p.id = network_package_versions.package_id)'),
    ('plan_links', '(SELECT p.workspace_id FROM public.plans p WHERE p.id = plan_links.plan_id)'),
    ('program_links', '(SELECT p.workspace_id FROM public.programs p WHERE p.id = program_links.program_id)'),
    ('project_decisions', '(SELECT p.workspace_id FROM public.projects p WHERE p.id = project_decisions.project_id)'),
    ('project_deliverables', '(SELECT p.workspace_id FROM public.projects p WHERE p.id = project_deliverables.project_id)'),
    ('project_issues', '(SELECT p.workspace_id FROM public.projects p WHERE p.id = project_issues.project_id)'),
    ('project_meetings', '(SELECT p.workspace_id FROM public.projects p WHERE p.id = project_meetings.project_id)'),
    ('project_milestones', '(SELECT p.workspace_id FROM public.projects p WHERE p.id = project_milestones.project_id)'),
    ('project_risks', '(SELECT p.workspace_id FROM public.projects p WHERE p.id = project_risks.project_id)'),
    ('project_spend_entries', '(SELECT p.workspace_id FROM public.projects p WHERE p.id = project_spend_entries.project_id)'),
    ('project_submittals', '(SELECT p.workspace_id FROM public.projects p WHERE p.id = project_submittals.project_id)'),
    ('report_artifacts', '(SELECT p.workspace_id FROM public.reports p WHERE p.id = report_artifacts.report_id)'),
    ('report_runs', '(SELECT p.workspace_id FROM public.reports p WHERE p.id = report_runs.report_id)'),
    ('report_sections', '(SELECT p.workspace_id FROM public.reports p WHERE p.id = report_sections.report_id)'),
    ('scenario_assumption_sets', '(SELECT p.workspace_id FROM public.scenario_sets p WHERE p.id = scenario_assumption_sets.scenario_set_id)'),
    ('scenario_comparison_snapshots', '(SELECT p.workspace_id FROM public.scenario_sets p WHERE p.id = scenario_comparison_snapshots.scenario_set_id)'),
    ('scenario_data_packages', '(SELECT p.workspace_id FROM public.scenario_sets p WHERE p.id = scenario_data_packages.scenario_set_id)'),
    ('scenario_entries', '(SELECT p.workspace_id FROM public.scenario_sets p WHERE p.id = scenario_entries.scenario_set_id)'),
    ('scenario_indicator_snapshots', '(SELECT p.workspace_id FROM public.scenario_sets p WHERE p.id = scenario_indicator_snapshots.scenario_set_id)'),
    ('model_run_kpis', 'coalesce((SELECT p.workspace_id FROM public.model_runs p WHERE p.id = model_run_kpis.run_id), (SELECT p.workspace_id FROM public.county_runs p WHERE p.id = model_run_kpis.county_run_id))'),
    ('network_zones', '(SELECT np.workspace_id FROM public.network_package_versions pv JOIN public.network_packages np ON np.id = pv.package_id WHERE pv.id = network_zones.package_version_id)'),
    ('network_corridors', '(SELECT np.workspace_id FROM public.network_package_versions pv JOIN public.network_packages np ON np.id = pv.package_id WHERE pv.id = network_corridors.package_version_id)'),
    ('network_connectors', '(SELECT np.workspace_id FROM public.network_package_versions pv JOIN public.network_packages np ON np.id = pv.package_id WHERE pv.id = network_connectors.package_version_id)'),
    ('scenario_comparison_indicator_deltas', '(SELECT ss.workspace_id FROM public.scenario_comparison_snapshots cs JOIN public.scenario_sets ss ON ss.id = cs.scenario_set_id WHERE cs.id = scenario_comparison_indicator_deltas.comparison_snapshot_id)')
    ) AS t(tbl, ws_expr)
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I', r.tbl || '_writer_only_insert', r.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR INSERT WITH CHECK (public.workspace_member_can_write(%s))',
      r.tbl || '_writer_only_insert', r.tbl, r.ws_expr);

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I', r.tbl || '_writer_only_update', r.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR UPDATE USING (public.workspace_member_can_write(%s)) WITH CHECK (public.workspace_member_can_write(%s))',
      r.tbl || '_writer_only_update', r.tbl, r.ws_expr, r.ws_expr);

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I', r.tbl || '_writer_only_delete', r.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR DELETE USING (public.workspace_member_can_write(%s))',
      r.tbl || '_writer_only_delete', r.tbl, r.ws_expr);
  END LOOP;
END
$$;
