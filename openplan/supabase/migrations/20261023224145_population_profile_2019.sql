-- Add explicit 2015-2019 ACS/PUMS compatibility; retain all prior profiles and permissions.
-- Technical source-profile membership only. No scientific or coverage acceptance.
-- Frozen catalog projection SHA-256 (compact sorted JSON, no newline): 38ad96e11dd29af6911f90bab1ff9d71a1df8f033de92b8bf5318769dd45703f
CREATE OR REPLACE FUNCTION public.model_common_population_profile_allowed(p_profile pg_catalog.jsonb, p_purpose pg_catalog.text)
RETURNS pg_catalog.bool
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT CASE WHEN pg_catalog.jsonb_typeof(p_profile) IS DISTINCT FROM 'object'
    OR p_purpose IS NULL OR p_purpose NOT IN ('new_guided_launch','retained_validation','aequilibrae_production','activitysim_consumption')
    THEN false ELSE EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements($population_catalog$[{"profile":{"acs_summary_endpoint":"https://api.census.gov/data/2022/acs/acs5","adapter":"us_census_acs5_pums","income_dollar_year":2022,"puma_fields":{"2010":"PUMA10","2020":"PUMA20"},"pums_endpoint":"https://api.census.gov/data/2022/acs/acs5/pums","sample_years":[2018,2022]},"purposes":["retained_validation","aequilibrae_production","activitysim_consumption"]},{"profile":{"acs_summary_endpoint":"https://api.census.gov/data/2023/acs/acs5","adapter":"us_census_acs5_pums","income_dollar_year":2023,"puma_fields":{"2020":"PUMA"},"pums_endpoint":"https://api.census.gov/data/2023/acs/acs5/pums","sample_years":[2019,2023]},"purposes":["new_guided_launch","retained_validation","aequilibrae_production","activitysim_consumption"]},{"profile":{"acs_summary_endpoint":"https://api.census.gov/data/2019/acs/acs5","adapter":"us_census_acs5_pums","income_dollar_year":2019,"puma_fields":{"2010":"PUMA"},"pums_endpoint":"https://api.census.gov/data/2019/acs/acs5/pums","sample_years":[2015,2019]},"purposes":["retained_validation","aequilibrae_production","activitysim_consumption"]}]$population_catalog$::pg_catalog.jsonb) AS entry(value)
      WHERE entry.value->'purposes' ? p_purpose
        AND public.model_truth_canonical_jsonb(p_profile) = public.model_truth_canonical_jsonb(entry.value->'profile')
    ) END;
$$;
REVOKE ALL ON FUNCTION public.model_common_population_profile_allowed(pg_catalog.jsonb,pg_catalog.text) FROM PUBLIC, anon, authenticated, service_role;
