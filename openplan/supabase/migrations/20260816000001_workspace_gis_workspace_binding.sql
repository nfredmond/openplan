-- A layer id is not an authorization, and RLS cannot make it one: Postgres
-- checks foreign keys with table-owner rights, so a member of workspace A
-- could insert a version/feature/reference row carrying workspace_id = A and
-- layer_id = one of workspace B's layers. The row passed A's INSERT policy,
-- the FK found B's layer, and the result was invisible to B under RLS while
-- squatting B's UNIQUE (layer_id, version_number) slots — jamming B's future
-- uploads with an unexplainable failure (found 2026-08-16).
--
-- The mechanism: bind (layer_id, workspace_id) to the layer's own pair, so a
-- row claiming a layer must carry that layer's workspace. Enforced by the
-- database, not by every route remembering to check.
--
-- If this migration fails on ADD CONSTRAINT, a rogue cross-workspace row
-- already exists; that is a finding to investigate, never a row to delete
-- silently.

ALTER TABLE public.workspace_gis_layers
  ADD CONSTRAINT workspace_gis_layers_id_workspace_unique UNIQUE (id, workspace_id);

ALTER TABLE public.workspace_gis_layer_versions
  ADD CONSTRAINT workspace_gis_layer_versions_layer_workspace_fkey
  FOREIGN KEY (layer_id, workspace_id)
  REFERENCES public.workspace_gis_layers (id, workspace_id)
  ON DELETE CASCADE;

ALTER TABLE public.workspace_gis_features
  ADD CONSTRAINT workspace_gis_features_layer_workspace_fkey
  FOREIGN KEY (layer_id, workspace_id)
  REFERENCES public.workspace_gis_layers (id, workspace_id)
  ON DELETE CASCADE;

ALTER TABLE public.workspace_gis_layer_references
  ADD CONSTRAINT workspace_gis_layer_references_layer_workspace_fkey
  FOREIGN KEY (layer_id, workspace_id)
  REFERENCES public.workspace_gis_layers (id, workspace_id)
  ON DELETE CASCADE;
