-- W1.1 — Pin search_path on 34 trigger/validator functions flagged by the Supabase
-- security advisor (lint: function_search_path_mutable). Each function is internal
-- (trigger body or CHECK predicate) with no public-facing side effects.
-- Reference: docs/ops/2026-04-20-security-advisor-backlog.md
--
-- W1.5 — Explicitly document billing_webhook_receipts as service-role only.
-- RLS is enabled with no policy by design; this COMMENT silences future reviewers
-- without opening an attack surface.

ALTER FUNCTION public.set_projects_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_project_subrecord_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_data_hub_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_reports_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_scenarios_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.validate_scenario_spine_entry() SET search_path = public, pg_temp;
ALTER FUNCTION public.sync_scenario_set_baseline_entry() SET search_path = public, pg_temp;
ALTER FUNCTION public.refresh_scenario_set_baseline_entry(target_scenario_set_id uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.validate_scenario_set_baseline_entry() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_engagement_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.validate_engagement_item_category() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_plans_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.touch_plan_updated_at_from_links() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_programs_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.touch_program_updated_at_from_links() SET search_path = public, pg_temp;
ALTER FUNCTION public.touch_program_updated_at_from_funding_opportunities() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_models_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.touch_model_updated_at_from_links() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_model_runs_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.touch_model_updated_at_from_model_runs() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_model_run_stages_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_model_run_artifacts_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_network_packages_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_network_package_versions_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_county_runs_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_billing_webhook_receipts_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_rtp_cycles_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_rtp_cycle_chapters_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.seed_default_rtp_cycle_chapters() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_funding_opportunities_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_funding_awards_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_project_funding_profiles_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.validate_scenario_comparison_snapshot() SET search_path = public, pg_temp;
ALTER FUNCTION public.validate_scenario_comparison_indicator_delta() SET search_path = public, pg_temp;

COMMENT ON TABLE public.billing_webhook_receipts IS
  'Service-role only. RLS is enabled with no policy by design so user roles (anon/authenticated) are fully blocked from reading raw Stripe webhook payloads. All reads/writes go through the webhook handler using the service-role key, which bypasses RLS. See docs/ops/2026-04-20-security-advisor-backlog.md W1.5.';
