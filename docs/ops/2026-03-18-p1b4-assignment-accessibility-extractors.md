# P1B.4: Assignment and Accessibility Extractors — Technical Spec

**Date:** 2026-03-18  
**Author:** Bartholomew Hale (COO)  
**Status:** SHIPPED

## Objective
Turn AequilibraE engine outputs (skims, loaded networks) into OpenPlan-native KPIs that planners can use for decision-making, scenario comparison, and reporting.

## Baseline KPI List

### Accessibility KPIs (derived from skim matrices)
1. **Jobs accessibility (30 min)** — Number of jobs reachable within 30 minutes by auto from each zone.
2. **Jobs accessibility (45 min)** — Same at 45-minute threshold.
3. **Population accessibility (30 min)** — Population reachable within 30 minutes.
4. **Essential services accessibility** — Count of essential destinations (schools, hospitals, grocery) within 30 minutes.
5. **Transit accessibility index** — Weighted reachability score via transit mode (when available).

### Assignment KPIs (derived from loaded network)
6. **V/C ratio by link** — Volume-to-capacity ratio on each network link.
7. **Corridor VMT** — Vehicle miles traveled along defined corridors.
8. **Corridor VHT** — Vehicle hours traveled along defined corridors.
9. **Average travel time** — Mean OD travel time across all zone pairs.
10. **Congested link count** — Links where V/C > 0.85.

## KPI Output Schema

### `model_run_kpis` table
| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `run_id` | UUID | FK to `model_runs` |
| `kpi_name` | TEXT | Machine-readable KPI identifier |
| `kpi_label` | TEXT | Human-readable display name |
| `kpi_category` | TEXT | `accessibility`, `assignment`, `safety`, `equity` |
| `value` | DOUBLE PRECISION | Scalar KPI value |
| `unit` | TEXT | Unit label (e.g., "jobs", "ratio", "miles", "minutes") |
| `geometry_ref` | TEXT | Optional zone/corridor/link ID for geometry-linked KPIs |
| `breakdown_json` | JSONB | Optional segmented breakdown (by mode, period, zone type) |
| `created_at` | TIMESTAMPTZ | Auto |

### Geometry-linked outputs
- Zone-level accessibility scores link back to `network_zones` via `geometry_ref`.
- Corridor-level assignment metrics link back to `network_corridors` via `geometry_ref`.
- Link-level V/C ratios can reference link IDs from the network package.

### Comparison-ready summaries
Each KPI record is self-describing with `kpi_name`, `kpi_category`, `value`, and `unit`. The scenario comparison UI can diff any two runs by matching on `kpi_name` + `geometry_ref`.

## API Routes
- `GET /api/models/[modelId]/runs/[runId]/kpis` — List all KPIs for a run.
- `POST /api/models/[modelId]/runs/[runId]/kpis` — Register KPI results (called by worker).
- `GET /api/models/[modelId]/runs/[runId]/kpis/compare?baseline_run_id=X` — Compare KPIs between two runs.

## Report-Safe Output Rules
1. Every KPI must include its `unit` and `kpi_label` for unambiguous display.
2. Accessibility KPIs must state the threshold used (e.g., 30 min).
3. Assignment KPIs must state the time period (e.g., AM peak).
4. Comparison deltas must show both absolute and percentage change.
5. Any KPI derived from uncalibrated models must carry a caveat flag.

## Acceptance Criteria
- [x] Baseline KPI list implemented (10 KPIs across accessibility + assignment)
- [x] Geometry-linked outputs available (zone/corridor/link references)
- [x] Comparison-ready summaries generated (self-describing records)
- [x] Report-safe outputs documented (unit/label/caveat rules)
