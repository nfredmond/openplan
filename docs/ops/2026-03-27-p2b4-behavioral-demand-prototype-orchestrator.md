# P2B.4 Behavioral-Demand Prototype Orchestrator

**Date:** 2026-03-27  
**Status:** prototype implemented  
**Scope:** chain the shipped ActivitySim prototype slices into one end-to-end behavioral-demand flow starting from a completed screening run

## Purpose

This slice moves OpenPlan from "the ActivitySim prototype steps exist" to "the whole behavioral-demand prototype can be run and inspected from one top-level entrypoint."

It stays honest about what actually happened.

## What This Prototype Does

- adds `scripts/modeling/run_behavioral_demand_prototype.py`
- starts from a completed screening run directory
- reuses the shipped components in order:
  - `scripts/modeling/build_activitysim_input_bundle.py`
  - `workers/activitysim_worker/` runtime prototype
  - `scripts/modeling/ingest_activitysim_runtime_outputs.py`
  - `scripts/modeling/extract_activitysim_behavioral_kpis.py`
- emits one stable top-level manifest:
  - `behavioral_demand_prototype_manifest.json`
- writes stable subdirectories under one output root:
  - `activitysim_bundle/`
  - `runtime/`
  - `ingestion/`
  - `kpis/`

## Top-Level Statuses

- `prototype_preflight_complete`
  - the full prototype orchestration completed
  - ActivitySim runtime execution was honestly blocked or only preflight-capable
- `behavioral_runtime_succeeded`
  - a real runtime command executed successfully and downstream artifacts were produced
- `behavioral_runtime_failed`
  - the runtime attempted execution and failed
- `prototype_pipeline_failed`
  - the orchestrator failed before it could complete the planned flow

The manifest also records a lane-specific status:

- `behavioral_runtime_blocked`
- `behavioral_runtime_succeeded`
- `behavioral_runtime_failed`

## Honest Runtime Handling

- If ActivitySim is unavailable, the orchestrator still succeeds in a prototype sense.
- The runtime step is recorded as blocked, not succeeded.
- Ingestion and KPI extraction still run against the honest runtime contract and preserve those caveats.
- The top-level manifest does not claim behavioral success unless the runtime actually ran in `activitysim_cli` mode and succeeded.

## Intended Use

Default output root:

```bash
python3 scripts/modeling/run_behavioral_demand_prototype.py \
  --screening-run-dir /path/to/screening-run
```

With explicit runtime overrides:

```bash
python3 scripts/modeling/run_behavioral_demand_prototype.py \
  --screening-run-dir /path/to/screening-run \
  --output-root /path/to/behavioral-demand \
  --config-dir /path/to/activitysim-config \
  --activitysim-cli-template "activitysim run -c {config_dir} -d {data_dir} -o {output_dir} -w {working_dir}"
```

## What This Prototype Does Not Prove

- It does not prove OpenPlan has a calibrated production ActivitySim lane.
- It does not prove the scaffolded bundle schema is final.
- It does not turn preflight-only runs into behavioral-demand success.
- It does not replace future scenario comparison, QA gates, or production orchestration.
