CREATE TABLE IF NOT EXISTS rtp_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'public_review', 'adopted', 'archived')),
  geography_label TEXT,
  horizon_start_year INTEGER CHECK (horizon_start_year IS NULL OR (horizon_start_year >= 1900 AND horizon_start_year <= 2200)),
  horizon_end_year INTEGER CHECK (horizon_end_year IS NULL OR (horizon_end_year >= 1900 AND horizon_end_year <= 2200)),
  adoption_target_date DATE,
  public_review_open_at TIMESTAMPTZ,
  public_review_close_at TIMESTAMPTZ,
  summary TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (horizon_start_year IS NULL AND horizon_end_year IS NULL)
    OR (
      horizon_start_year IS NOT NULL
      AND horizon_end_year IS NOT NULL
      AND horizon_end_year >= horizon_start_year
    )
  ),
  CHECK (
    public_review_open_at IS NULL
    OR public_review_close_at IS NULL
    OR public_review_close_at >= public_review_open_at
  )
);

CREATE INDEX IF NOT EXISTS idx_rtp_cycles_workspace_updated_at
  ON rtp_cycles(workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_rtp_cycles_workspace_status_updated_at
  ON rtp_cycles(workspace_id, status, updated_at DESC);

ALTER TABLE rtp_cycles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'rtp_cycles'
      AND policyname = 'rtp_cycles_read'
  ) THEN
    CREATE POLICY rtp_cycles_read ON rtp_cycles
      FOR SELECT USING (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'rtp_cycles'
      AND policyname = 'rtp_cycles_insert'
  ) THEN
    CREATE POLICY rtp_cycles_insert ON rtp_cycles
      FOR INSERT WITH CHECK (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'rtp_cycles'
      AND policyname = 'rtp_cycles_update'
  ) THEN
    CREATE POLICY rtp_cycles_update ON rtp_cycles
      FOR UPDATE USING (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      )
      WITH CHECK (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'rtp_cycles'
      AND policyname = 'rtp_cycles_delete'
  ) THEN
    CREATE POLICY rtp_cycles_delete ON rtp_cycles
      FOR DELETE USING (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION set_rtp_cycles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rtp_cycles_updated_at ON rtp_cycles;
CREATE TRIGGER trg_rtp_cycles_updated_at
BEFORE UPDATE ON rtp_cycles
FOR EACH ROW
EXECUTE FUNCTION set_rtp_cycles_updated_at();
