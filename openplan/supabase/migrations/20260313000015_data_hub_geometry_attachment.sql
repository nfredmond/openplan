ALTER TABLE data_datasets
  ADD COLUMN IF NOT EXISTS geometry_attachment TEXT NOT NULL DEFAULT 'none'
    CHECK (geometry_attachment IN ('none', 'analysis_tracts')),
  ADD COLUMN IF NOT EXISTS thematic_metric_key TEXT NULL
    CHECK (
      thematic_metric_key IS NULL OR thematic_metric_key IN (
        'pctMinority',
        'pctBelowPoverty',
        'medianIncome',
        'isDisadvantaged',
        'zeroVehiclePct',
        'transitCommutePct'
      )
    ),
  ADD COLUMN IF NOT EXISTS thematic_metric_label TEXT NULL;
