# P1C.2: Evidence Packet Output — Technical Spec

**Date:** 2026-03-18  
**Author:** Bartholomew Hale (COO)  
**Status:** SHIPPED

## Objective
Make the first AequilibraE modeling package reportable by generating a structured evidence packet that captures run manifest, inputs, assumptions, outputs, and caveats in a client-safe format.

## Evidence Packet Structure

An evidence packet is a JSON document that captures everything needed to understand, audit, and present a model run's results.

```json
{
  "packet_version": "1.0",
  "generated_at": "2026-03-18T18:00:00Z",
  "run_id": "uuid",
  "model_id": "uuid",
  "model_title": "Nevada County 2025 Baseline",
  "engine": "aequilibrae",
  
  "inputs": {
    "network_package": { "id": "uuid", "name": "...", "version": "v1.0" },
    "zone_count": 142,
    "corridor_count": 12,
    "connector_count": 426,
    "skim_config": { "periods": ["am_peak", "pm_peak"], "modes": ["auto"] }
  },
  
  "assumptions": {
    "snapshot": { ... },
    "query_text": "...",
    "corridor_geojson_hash": "sha256-..."
  },
  
  "outputs": {
    "kpi_summary": {
      "accessibility": [...],
      "assignment": [...]
    },
    "artifacts": [
      { "type": "skim_matrix", "file": "skim_am_auto.omx", "hash": "sha256-..." },
      { "type": "assignment_results", "file": "assignment.csv", "hash": "sha256-..." }
    ],
    "stages": [
      { "name": "ingestion", "status": "succeeded", "duration_s": 12 },
      { "name": "skim_generation", "status": "succeeded", "duration_s": 45 },
      { "name": "assignment", "status": "succeeded", "duration_s": 30 },
      { "name": "kpi_extraction", "status": "succeeded", "duration_s": 8 }
    ]
  },
  
  "caveats": [
    "Model outputs are from an uncalibrated prototype engine.",
    "Accessibility thresholds are configurable and may not reflect local conditions.",
    "Transit skims are not included in this run (no transit network data)."
  ],
  
  "provenance": {
    "platform": "OpenPlan",
    "engine_version": "aequilibrae-prototype-v1",
    "run_started_at": "...",
    "run_completed_at": "...",
    "operator": "nathaniel@natfordplanning.com"
  }
}
```

## API Route
- `GET /api/models/[modelId]/runs/[runId]/evidence-packet` — Generate and return the full evidence packet for a completed run.

## Caveat Generation Rules
1. Always include the uncalibrated-model caveat for prototype runs.
2. Flag missing transit data when transit mode skims were not generated.
3. Flag if zone count < 10 (likely test/demo, not production-quality).
4. Flag if any stage failed or was skipped.
5. Flag if no KPIs were extracted.

## Acceptance Criteria
- [x] Run manifest visible (inputs, network package, zone/corridor counts)
- [x] Inputs/assumptions visible (query text, skim config, corridor hash)
- [x] Outputs visible (KPIs, artifacts, stages)
- [x] Caveats visible (auto-generated based on run state)
- [x] Export/report packet format drafted (JSON evidence packet)
