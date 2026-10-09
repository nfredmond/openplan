-- Planner consumers may read retained evidence, but cannot write custody or read commands.
CREATE POLICY model_attempt_instrument_member_read
  ON public.model_attempt_instrument_custody FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members member
      WHERE member.workspace_id = model_attempt_instrument_custody.workspace_id
        AND member.user_id = (SELECT auth.uid())
    )
    AND EXISTS (
      SELECT 1 FROM public.model_runs run
      WHERE run.id = model_attempt_instrument_custody.model_run_id
        AND run.workspace_id = model_attempt_instrument_custody.workspace_id
    )
  );

GRANT SELECT ON public.model_attempt_instrument_custody TO authenticated;
