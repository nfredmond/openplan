-- T15: Shared scenario_comparison_summary view so Grants + RTP surfaces can
-- read the latest indicator deltas per scenario set without re-aggregating
-- comparison snapshots.

CREATE OR REPLACE VIEW scenario_comparison_summary
WITH (security_invoker = true) AS
WITH snapshot_deltas AS (
  SELECT
    cs.scenario_set_id,
    cs.id AS comparison_snapshot_id,
    cs.status AS snapshot_status,
    cs.updated_at AS snapshot_updated_at,
    d.indicator_key,
    d.indicator_label,
    d.unit_label,
    d.delta_json,
    d.summary_text,
    d.sort_order
  FROM scenario_comparison_indicator_deltas d
  JOIN scenario_comparison_snapshots cs
    ON cs.id = d.comparison_snapshot_id
),
latest_ready AS (
  SELECT DISTINCT ON (scenario_set_id, indicator_key)
    scenario_set_id,
    indicator_key,
    indicator_label,
    unit_label,
    delta_json,
    summary_text,
    snapshot_updated_at
  FROM snapshot_deltas
  WHERE snapshot_status = 'ready'
  ORDER BY scenario_set_id, indicator_key, snapshot_updated_at DESC, sort_order ASC
),
counts AS (
  SELECT
    scenario_set_id,
    indicator_key,
    COUNT(DISTINCT comparison_snapshot_id) FILTER (WHERE snapshot_status = 'ready') AS ready_snapshot_count,
    COUNT(DISTINCT comparison_snapshot_id) AS total_snapshot_count,
    MAX(snapshot_updated_at) FILTER (WHERE snapshot_status = 'ready') AS last_ready_updated_at
  FROM snapshot_deltas
  GROUP BY scenario_set_id, indicator_key
)
SELECT
  c.scenario_set_id,
  c.indicator_key,
  lr.indicator_label,
  lr.unit_label,
  lr.delta_json AS latest_delta_json,
  lr.summary_text AS latest_summary_text,
  c.last_ready_updated_at AS latest_ready_updated_at,
  c.ready_snapshot_count,
  c.total_snapshot_count
FROM counts c
LEFT JOIN latest_ready lr
  ON lr.scenario_set_id = c.scenario_set_id
  AND lr.indicator_key = c.indicator_key;

COMMENT ON VIEW scenario_comparison_summary IS
  'T15 shared read surface. Aggregates scenario_comparison_indicator_deltas by scenario_set_id + indicator_key, exposing the latest ready delta and ready snapshot count so Grants and RTP surfaces stop re-aggregating.';

GRANT SELECT ON scenario_comparison_summary TO authenticated;
