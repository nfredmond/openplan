# P2C.1 Behavioral Demand Run Mode UI

**Date:** 2026-03-27  
**Status:** shipped  
**Scope:** planner-facing behavioral-demand run-mode surface in the existing model run manager and model detail evidence/comparison UI

## Naming decision
- Planner-facing run mode label: **Behavioral Demand**
- Launch-form label: **Behavioral Demand (ActivitySim prototype / preflight-backed)**

This keeps the UI aligned with the modeling-stack run-class language instead of exposing raw engine branding alone.

## Honest posture shipped
- Expected runtime copy states that a real ActivitySim-backed behavioral run is materially heavier than screening and should be read as **tens of minutes to hours** once the runtime lane is fully enabled.
- Calibration/caveat copy states that the current OpenPlan posture is **prototype/preflight-backed only** and must **not** be read as calibrated behavioral forecasting, county-transferable validation, or client-ready demand prediction.
- The model-run API now returns an explicit blocked/prototype response if a behavioral-demand launch is attempted through the current managed-run form before backend launch wiring is live.

## UI surfaces updated
- Model detail run manager:
  - run-mode selector now includes Behavioral Demand
  - runtime and caveat copy shown inline for the selected run mode
  - behavioral-demand selection is surfaced honestly as a prototype surface instead of a fake launch path
- Model detail run history:
  - Behavioral Demand runs render with the new planner-facing label
  - prototype/preflight posture badges and copy are shown when present
- Evidence panel / comparison area:
  - behavioral-demand caveats flow into evidence posture
  - comparison area now explains when behavioral artifacts/KPIs are present versus when the path is still only preflight/partial

## Acceptance note
This slice intentionally surfaces the run class and its artifact/comparison posture without overstating backend readiness. It does **not** claim that a production-calibrated ActivitySim launch path is already live through the managed model-run API.
