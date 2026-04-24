REVOKE ALL ON FUNCTION public.report_modeling_county_run_matches_workspace(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_modeling_county_run_matches_workspace(UUID, UUID) TO authenticated, service_role;
