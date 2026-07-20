-- Categorized pins: give engagement categories a display color (and an optional
-- icon name) so map contributions render per-category instead of one uniform
-- color. Additive; existing member RLS on engagement_categories already scopes
-- reads/writes. color is a hex string validated at the API layer (kept as TEXT
-- here so a NULL / legacy category simply falls back to the default map color).

ALTER TABLE engagement_categories
  ADD COLUMN IF NOT EXISTS color TEXT,
  ADD COLUMN IF NOT EXISTS icon TEXT;

COMMENT ON COLUMN engagement_categories.color IS
  'Optional hex display color (e.g. #38bdf8) for this category''s map pins/shapes and legend. NULL falls back to the default map color.';
COMMENT ON COLUMN engagement_categories.icon IS
  'Optional icon identifier (lucide name) for this category. Reserved for map/legend rendering.';
