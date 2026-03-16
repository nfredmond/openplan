DROP POLICY IF EXISTS "members_read" ON public.workspace_members;

CREATE POLICY "members_read_own" ON public.workspace_members
  FOR SELECT USING (
    user_id = auth.uid()
  );
