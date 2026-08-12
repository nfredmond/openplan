-- What would break if this layer went away.
--
-- THE PROBLEM THIS SOLVES BEFORE IT HAPPENS. A workspace GIS layer is meant to
-- be adopted: shown to residents through an engagement campaign, cited by a
-- report, attached to a plan. Once anything has adopted it, deleting it is not
-- a tidy-up — it is a plan that stops resolving, or a public map that loses the
-- alignment residents were commenting on. The usual shape of that defect is a
-- confirmation dialog saying "are you sure?", which asks the planner a question
-- only the database can answer.
--
-- SO THE REFUSAL IS STRUCTURAL. Every adoption writes a row here, and the
-- foreign key to the layer takes NO destructive action: a DELETE of a layer
-- that anything references fails in the database. The route reads this table to
-- LIST what would break, by name and by link, and offers archiving instead.
-- Neither half depends on the other being remembered.
--
-- WHY `NO ACTION` AND NOT `RESTRICT`, which is the subtle half. Both refuse the
-- delete; they differ in WHEN. RESTRICT fires immediately, before any other
-- cascade in the same statement has run, so deleting a WORKSPACE — which
-- cascades to layers and to these rows — would abort on the layer's reference
-- even though the referencing rows were themselves about to disappear. NO
-- ACTION is checked at the end of the statement, by which time the cascade has
-- cleared them. The result is exactly the intended pair of behaviours: deleting
-- one referenced layer is refused; deleting the whole workspace is not blocked
-- by rows that go with it.
--
-- NOTHING WRITES THIS TABLE YET, AND THAT IS STATED PLAINLY. Adoption into an
-- engagement campaign is a later phase (and will COPY the geometry rather than
-- point at it, so republishing a layer can never silently change what residents
-- see). Until an adopter exists, this table is empty and deleting a layer is
-- unblocked in practice. It ships now because the alternative is that the FIRST
-- adopter has to remember to build the safety net, and the cost of that
-- forgetting is paid by someone else's adopted plan.

CREATE TABLE IF NOT EXISTS public.workspace_gis_layer_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  -- NO ACTION: see the header. This is the refusal.
  layer_id UUID NOT NULL
    REFERENCES public.workspace_gis_layers(id) ON DELETE NO ACTION,

  -- WHAT adopted it. A closed vocabulary because each member needs a label and
  -- a link the delete dialog can render, and a kind nothing can render is a
  -- reference a planner cannot act on.
  reference_kind TEXT NOT NULL
    CHECK (reference_kind IN ('engagement_campaign', 'report', 'project')),
  reference_id UUID NOT NULL,

  -- Denormalized at adopt time so the delete dialog can name the thing even if
  -- the adopter's own table is unreadable to this member. A dialog that says
  -- "1 reference" and cannot say to what leaves the planner exactly where they
  -- started.
  reference_label TEXT NOT NULL CHECK (btrim(reference_label) <> ''),

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One adoption per adopter. Re-adopting is not a second reference.
  CONSTRAINT workspace_gis_layer_references_unique_adopter
    UNIQUE (layer_id, reference_kind, reference_id)
);

CREATE INDEX IF NOT EXISTS workspace_gis_layer_references_layer_idx
  ON public.workspace_gis_layer_references(layer_id, created_at);

ALTER TABLE public.workspace_gis_layer_references ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workspace_gis_layer_references'
      AND policyname = 'workspace_gis_layer_references_member_read'
  ) THEN
    CREATE POLICY workspace_gis_layer_references_member_read
      ON public.workspace_gis_layer_references
      FOR SELECT USING (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workspace_gis_layer_references'
      AND policyname = 'workspace_gis_layer_references_writer_insert'
  ) THEN
    CREATE POLICY workspace_gis_layer_references_writer_insert
      ON public.workspace_gis_layer_references
      FOR INSERT WITH CHECK (public.workspace_member_can_write(workspace_id));
  END IF;

  -- No UPDATE policy: an adoption is a fact with a date, not a field to edit.
  -- Un-adopting is a DELETE, which the adopting surface performs.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workspace_gis_layer_references'
      AND policyname = 'workspace_gis_layer_references_writer_delete'
  ) THEN
    CREATE POLICY workspace_gis_layer_references_writer_delete
      ON public.workspace_gis_layer_references
      FOR DELETE USING (public.workspace_member_can_write(workspace_id));
  END IF;
END
$$;

REVOKE ALL ON TABLE public.workspace_gis_layer_references FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON TABLE public.workspace_gis_layer_references TO authenticated;
GRANT ALL ON TABLE public.workspace_gis_layer_references TO service_role;

COMMENT ON TABLE public.workspace_gis_layer_references IS
  'One row per thing that has adopted a workspace GIS layer. The layer foreign key takes NO ACTION on delete, so deleting a referenced layer is refused by the database rather than by route code; the delete dialog reads this table to list what would break and offers archiving instead. NO ACTION rather than RESTRICT so that deleting a whole workspace, which cascades both tables, is not blocked by rows that go with it.';
