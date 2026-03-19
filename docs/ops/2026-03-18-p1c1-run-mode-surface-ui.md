# P1C.1: New Run-Mode Surface in UI — Completion Note

**Date:** 2026-03-18  
**Author:** Bartholomew Hale (COO)  
**Status:** SHIPPED

## Objective
Expose AequilibraE-backed runs as a planner-facing run class in the OpenPlan UI, completing P1C.1 from the Modeling Stack Phase 1 plan.

## What was delivered

### Run mode label
- Two engine options are now available in the Model Run Manager:
  - **Deterministic Corridor (Synchronous)** — the original analysis pipeline
  - **AequilibraE (Asynchronous Worker Prototype)** — the new worker-backed engine

### Launch form
- The engine selector dropdown is integrated into the launch form.
- Planners choose their execution engine before launching a managed run.
- The `engineKey` field is stored on each `model_runs` record for provenance.

### Run status UI
- Status badges support all five states: `queued`, `running`, `succeeded`, `failed`, `cancelled`.
- Engine label badges show which engine produced each run result.
- An in-progress indicator appears when any run is queued or running, prompting planners to refresh for updates.

### Artifact and KPI surfaces
- The `ModelRunStagingAndArtifacts` component shows:
  - Execution stages timeline (stage name + status badge)
  - Artifact cards with type labels and download links
- These are visible directly within each run record on the model detail page.

### Summary cards
- The engines-available summary card dynamically reflects the two available backends.

## Acceptance criteria
- [x] Run mode label chosen (Deterministic / AequilibraE)
- [x] Launch form fields defined (engine selector + existing query/corridor/scenario fields)
- [x] Run status UI supports queued/running/succeeded/failed
- [x] Artifact and KPI surfaces visible in model detail

## Build validation
- `npx next build` passes cleanly with zero TypeScript errors.
