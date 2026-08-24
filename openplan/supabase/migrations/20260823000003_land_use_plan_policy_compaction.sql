-- The first local application created separate INSERT, UPDATE, and DELETE
-- writer policies. One FOR ALL writer policy has the same role-aware result
-- beside the member SELECT policy and keeps the executable policy inventory
-- below the operating system's command-size ceiling.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'land_use_plans','land_use_plan_versions','land_use_plan_content_nodes',
    'land_use_plan_relationships','land_use_plan_review_events','land_use_plan_designations',
    'land_use_plan_designation_policy_links','land_use_plan_implementation_actions',
    'land_use_plan_decisions','land_use_plan_implementation_reports',
    'land_use_plan_consultation_records'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_writer_insert ON public.%I', table_name, table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I_writer_update ON public.%I', table_name, table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I_writer_delete ON public.%I', table_name, table_name);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = table_name
        AND policyname = table_name || '_writer_all'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I_writer_all ON public.%I FOR ALL USING (public.workspace_member_can_write(workspace_id)) WITH CHECK (public.workspace_member_can_write(workspace_id))',
        table_name, table_name
      );
    END IF;
  END LOOP;
END
$$;
