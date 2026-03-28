# P2B.1 ActivitySim Worker Runtime Prototype

**Date:** 2026-03-27  
**Status:** prototype implemented  
**Scope:** runtime handoff from a built OpenPlan ActivitySim input bundle into an honest worker execution contract

## Purpose

This slice moves OpenPlan from "an ActivitySim input bundle exists" to "that bundle can be handed to a reproducible worker/runtime contract."

It intentionally does not claim that OpenPlan already has a production-calibrated ActivitySim lane.

## What This Prototype Does

- accepts either an ActivitySim bundle directory or the bundle `manifest.json`
- validates the input bundle contract emitted by `scripts/modeling/build_activitysim_input_bundle.py`
- stages a runtime directory with logs, stage manifests, and a runtime scaffold
- detects whether ActivitySim execution is actually supportable in the current environment
- runs a real CLI only when both of these are true:
  - an ActivitySim executable is available
  - an executable config package is present, including `settings.yaml`
- records an honest blocked/preflight outcome when the runtime is not actually runnable
- emits stable runtime artifacts:
  - `runtime_manifest.json`
  - `runtime_summary.json`
  - `logs/runtime.log`
  - per-stage `stage.json` records

## Runtime Modes

- `preflight_only`
  - bundle validation and runtime staging succeeded
  - ActivitySim execution was not attempted because the CLI and/or executable config package was unavailable
- `activitysim_cli`
  - a real command was executed
  - the runtime records the command, return code, logs, and collected output artifacts
- `activitysim_container_cli`
  - a real containerized command was executed through a configured engine such as Docker
  - the runtime records the image, mount plan, command, return code, logs, and collected output artifacts
  - this is currently the most credible path for real execution on BlackOpal because `activitysim==1.5.1` installs and runs successfully in a Python 3.11 container even though the host Python 3.12 path is not yet dependable

## Stage Keys

The runtime uses the doc-aligned stage vocabulary for this slice:

- `validate_inputs`
- `prepare_activitysim_inputs`
- `run_activitysim`
- `collect_outputs`

## Output Structure

Default output location:

```text
<bundle>/runtime/<timestamp>-<label>/
```

Stable artifacts inside each runtime directory:

```text
runtime_manifest.json
runtime_summary.json
logs/runtime.log
stages/010-validate-inputs/stage.json
stages/020-prepare-activitysim-inputs/stage.json
stages/030-run-activitysim/stage.json
stages/040-collect-outputs/stage.json
```

If a real CLI run happens, collected model outputs are enumerated from:

```text
output/
```

## What This Prototype Does Not Prove

- It does not prove OpenPlan has a calibrated ActivitySim configuration package.
- It does not prove the current bundle builder emits final production-ready ActivitySim household/person schemas.
- It does not prove cloud orchestration, callbacks, storage registration, or downstream ingestion are complete.
- It does not guarantee the default `activitysim run ...` command shape matches every future runtime image; the worker therefore supports an explicit CLI template override.
- It does not claim that a generic image like `python:3.11-slim` is sufficient by itself; operators still need either an image that already contains ActivitySim or a container command template that installs/launches it honestly.
- It does not yet prove a calibrated pilot geography with real ActivitySim models beyond the zero-model/starter smoke posture.

## Why This Is Honest

The worker will not mark `run_activitysim` as succeeded unless a real process was launched and exited successfully.

When the bundle only contains the current scaffolded `configs/README.md`, the runtime records:

- input validation succeeded
- staging/prep succeeded
- `run_activitysim` blocked
- outputs/logs/manifest still emitted for downstream inspection
