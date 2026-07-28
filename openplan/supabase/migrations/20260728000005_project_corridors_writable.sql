-- project_corridors becomes writable from the product.
--
-- The table shipped in 20260421000066 with full RLS for INSERT / UPDATE /
-- DELETE, but nothing in the product ever issued one: there was no route, no
-- server action, and no UI. Its only writer was the NCTC demo seed, which was
-- deleted in aaae44fc. A corridor therefore could not be created at all, and
-- the "Study corridors" backdrop layer was permanently empty for any workspace
-- built by using the app. This migration prepares the table for the write path.
--
-- Two changes, both consequences of the table no longer being read-only:

-- 1. `updated_at`. The original table had only `created_at` because a row could
--    never change after the seed wrote it. Corridors are now editable — name,
--    type, LOS grade, and geometry — so "when did this last change" is a real
--    question a planner will ask of a shared workspace.
ALTER TABLE public.project_corridors
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.project_corridors.updated_at IS
  'Last modification time. Maintained by the API layer on PATCH, mirroring the projects/reports convention.';

-- 2. A WITH CHECK on the UPDATE policy.
--
--    The original policy had USING only. On a read-only table that was
--    harmless. Now that UPDATE is reachable, USING-without-WITH-CHECK means a
--    member of workspace A could edit a corridor they can see and, in the same
--    statement, reassign its workspace_id to workspace B — passing the USING
--    test on the old row while writing a row they should not be able to create.
--    WITH CHECK re-tests membership against the NEW row and closes that.
DROP POLICY IF EXISTS "project_corridors_update" ON public.project_corridors;
CREATE POLICY "project_corridors_update" ON public.project_corridors
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = project_corridors.workspace_id
        AND wm.user_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = project_corridors.workspace_id
        AND wm.user_id = auth.uid()
    )
  );
