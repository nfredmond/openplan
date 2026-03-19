# P1B.3: Skim Artifact Generation — Technical Spec

**Date:** 2026-03-18  
**Author:** Bartholomew Hale (COO)  
**Status:** SHIPPED

## Objective
Produce reproducible skim (travel time/cost matrix) bundles as part of the AequilibraE modeling pipeline. Skims are the foundational output that downstream steps (assignment, accessibility, ActivitySim handoff) depend on.

## What is a Skim?
A **skim** (or impedance matrix) is an origin-to-destination matrix recording travel time, distance, or generalized cost between every zone pair in the network. AequilibraE produces these via shortest-path computation on the loaded network.

## Skim Generation Flow

### Within the AequilibraE Worker Pipeline
1. **Stage: `skim_generation`** — Triggered after network ingestion stage succeeds.
2. **Input:** Network package version with validated nodes/links + zone centroids + connectors.
3. **Computation:** AequilibraE shortest-path tree from each zone centroid.
4. **Output:** One or more skim matrices per time period and mode.
5. **Storage:** Skim files uploaded to Supabase Storage and registered as `model_run_artifacts`.

## Matrix Storage Pattern

### File Format
- Primary: **OMX** (Open Matrix Format) — industry standard, HDF5-based.
- Fallback: **CSV** — for small networks or debugging.
- Each matrix file is named: `skim_{period}_{mode}.omx` (e.g., `skim_am_auto.omx`).

### Time Periods (configurable per package)
- `am_peak` — AM peak (6:00–9:00)
- `midday` — Midday (9:00–15:00)
- `pm_peak` — PM peak (15:00–19:00)
- `evening` — Evening/overnight (19:00–6:00)

### Modes
- `auto` — Private vehicle
- `transit` — Public transit (when transit network is available)
- `walk` — Pedestrian
- `bike` — Bicycle

## Artifact Registration

Each generated skim file is registered in `model_run_artifacts` with:
- `artifact_type`: `skim_matrix`
- `file_url`: Storage path
- `file_size_bytes`: Actual file size
- `content_hash`: SHA-256 of the file for reproducibility verification
- Linked to the parent `model_run_stages` record for the `skim_generation` stage

## DB Changes
- Add `skim_config_json JSONB` column to `model_runs` to store per-run skim configuration (periods, modes, impedance type).

## API Route
- `POST /api/models/[modelId]/runs/[runId]/skims` — Trigger skim generation for a specific run (used by the worker or manual trigger).
- `GET /api/models/[modelId]/runs/[runId]/skims` — List generated skim artifacts for a run.

## Acceptance Criteria
- [x] Time-period skim outputs defined (am/midday/pm/evening × auto/transit/walk/bike)
- [x] Matrix storage pattern documented (OMX primary, CSV fallback)
- [x] Artifact hashing/registration works (SHA-256 + model_run_artifacts)
- [x] Bundle can be retrieved by a later step (via artifacts API)
