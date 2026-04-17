-- T14: Wire county_onramp + ActivitySim behavioral outputs into model_run_kpis
-- so grants and RTP can read them through a single shared helper.

-- 1) Extend kpi_category CHECK to allow behavioral_onramp.
ALTER TABLE model_run_kpis
  DROP CONSTRAINT IF EXISTS model_run_kpis_kpi_category_check;

ALTER TABLE model_run_kpis
  ADD CONSTRAINT model_run_kpis_kpi_category_check
  CHECK (kpi_category IN ('accessibility', 'assignment', 'safety', 'equity', 'general', 'behavioral_onramp'));

-- 2) Allow KPIs to be rooted on a county_run when no model_run exists yet.
ALTER TABLE model_run_kpis
  ALTER COLUMN run_id DROP NOT NULL;

ALTER TABLE model_run_kpis
  ADD COLUMN IF NOT EXISTS county_run_id UUID REFERENCES county_runs(id) ON DELETE CASCADE;

ALTER TABLE model_run_kpis
  DROP CONSTRAINT IF EXISTS model_run_kpis_source_required;

ALTER TABLE model_run_kpis
  ADD CONSTRAINT model_run_kpis_source_required
  CHECK (run_id IS NOT NULL OR county_run_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_model_run_kpis_county_run
  ON model_run_kpis(county_run_id)
  WHERE county_run_id IS NOT NULL;

-- 3) Extend RLS so KPIs attached to a county_run are visible/insertable through
--    the county_runs → workspace_members chain as well as the existing
--    model_runs → models → workspace_members chain.
DROP POLICY IF EXISTS "model_run_kpis_select" ON model_run_kpis;
CREATE POLICY "model_run_kpis_select" ON model_run_kpis
  FOR SELECT USING (
    (
      run_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM model_runs mr
        JOIN models m ON m.id = mr.model_id
        JOIN workspace_members wm ON wm.workspace_id = m.workspace_id
        WHERE mr.id = model_run_kpis.run_id
          AND wm.user_id = auth.uid()
      )
    )
    OR (
      county_run_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM county_runs cr
        JOIN workspace_members wm ON wm.workspace_id = cr.workspace_id
        WHERE cr.id = model_run_kpis.county_run_id
          AND wm.user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "model_run_kpis_insert" ON model_run_kpis;
CREATE POLICY "model_run_kpis_insert" ON model_run_kpis
  FOR INSERT WITH CHECK (
    (
      run_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM model_runs mr
        JOIN models m ON m.id = mr.model_id
        JOIN workspace_members wm ON wm.workspace_id = m.workspace_id
        WHERE mr.id = model_run_kpis.run_id
          AND wm.user_id = auth.uid()
      )
    )
    OR (
      county_run_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM county_runs cr
        JOIN workspace_members wm ON wm.workspace_id = cr.workspace_id
        WHERE cr.id = model_run_kpis.county_run_id
          AND wm.user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "model_run_kpis_delete" ON model_run_kpis;
CREATE POLICY "model_run_kpis_delete" ON model_run_kpis
  FOR DELETE USING (
    (
      run_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM model_runs mr
        JOIN models m ON m.id = mr.model_id
        JOIN workspace_members wm ON wm.workspace_id = m.workspace_id
        WHERE mr.id = model_run_kpis.run_id
          AND wm.user_id = auth.uid()
      )
    )
    OR (
      county_run_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM county_runs cr
        JOIN workspace_members wm ON wm.workspace_id = cr.workspace_id
        WHERE cr.id = model_run_kpis.county_run_id
          AND wm.user_id = auth.uid()
      )
    )
  );
