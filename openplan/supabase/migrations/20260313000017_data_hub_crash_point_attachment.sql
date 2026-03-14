ALTER TABLE data_datasets
  DROP CONSTRAINT IF EXISTS data_datasets_geometry_attachment_check,
  ADD CONSTRAINT data_datasets_geometry_attachment_check
    CHECK (geometry_attachment IN ('none', 'analysis_tracts', 'analysis_corridor', 'analysis_crash_points'));

ALTER TABLE data_datasets
  DROP CONSTRAINT IF EXISTS data_datasets_thematic_metric_key_check,
  ADD CONSTRAINT data_datasets_thematic_metric_key_check
    CHECK (
      thematic_metric_key IS NULL OR thematic_metric_key IN (
        'pctMinority',
        'pctBelowPoverty',
        'medianIncome',
        'isDisadvantaged',
        'zeroVehiclePct',
        'transitCommutePct',
        'overallScore',
        'accessibilityScore',
        'safetyScore',
        'equityScore',
        'severityBucket',
        'pedestrianInvolved',
        'bicyclistInvolved',
        'fatalCount',
        'injuryCount'
      )
    );
