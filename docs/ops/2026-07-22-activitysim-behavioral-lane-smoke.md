# ActivitySim behavioral-demand lane — real-run smoke (Wave 3, Lane 3)

**Date:** 2026-07-22 · **Status:** L3 milestone verified locally (honest, uncalibrated)

## What was proven

A **real `activitysim==1.5.1` run executed end-to-end** through the full OpenPlan
behavioral-demand pipeline on an OpenPlan-built bundle for a real study area —
proving the lane is genuinely wired, not a preflight dressed as a forecast.

Command (from the repo root, using the Python-3.11 execution venv):

```bash
workers/activitysim_worker/.venv-exec/bin/python \
  scripts/modeling/run_behavioral_demand_prototype.py \
  --screening-run-dir data/screening-runs/nevada-county-runtime-mainline-scalar0369-20260324 \
  --activitysim-cli .../.venv-exec/bin/activitysim --force
```

Result:

| Field | Value |
|---|---|
| `pipeline_status` | `behavioral_runtime_succeeded` |
| `runtime_mode` | `activitysim_cli` (a REAL CLI run, not preflight) |
| runtime stages | validate_inputs / prepare_activitysim_inputs / run_activitysim / collect_outputs — **all succeeded** |
| pipeline steps | build → runtime → ingest → extract — **all succeeded** |
| bundle zones | 26 |
| synthetic households / persons | 41,415 / 102,322 (deterministic scaffold — NOT calibrated) |
| ActivitySim artifacts | `output/mem.csv`, `output/settings_checker.log`, `runtime/stages/030-run-activitysim/activitysim_stdout.log` |
| peak RSS | ~360 MB (26-zone starter) |

ActivitySim's own stdout confirms the run: *"Settings checker … No runtime errors
were raised"*, *"run single process simulation"*, *"Time to execute run_model
(0 models)"*.

## Why this is honest

The OpenPlan starter config kit (`v0`) contains **0 demand models**, so the run
completes the settings-check + pipeline scaffold but generates **no trips/tours**.
The KPI extractor therefore reports `totals: null` and the worker writes **zero**
behavioral KPIs — no fabricated demand. On the default ($0) infra with no
ActivitySim installed, the same lane stays `preflight_only` and writes only
structural scaffold KPIs. **No VMT/trip/mode-share number is ever emitted without a
real run behind it, and even a real run is labeled `uncalibrated`.**

## The infra wall (STOP — needs Nathaniel)

Real production behavioral runs are **not $0**:

1. **A dedicated modeling host.** The AequilibraE screening worker runs on a 512 MB
   Fly VM; ActivitySim cannot co-run there. A 26-zone starter already used ~360 MB;
   a calibrated multi-model metro run needs **several GB of RAM** + several vCPUs +
   minutes-to-hours + an always-on poller. Ballpark: a Fly `performance-2x` /
   Railway 8 GB / small self-host box — quote from the chosen provider. Run the
   Python-3.11 `Dockerfile.exec` image with `ACTIVITYSIM_CLI=activitysim`,
   co-located (shared volume) with the AequilibraE worker (the skim/zone handoff
   is `local://`).
2. **County-specific calibration.** The starter config is not forecast-grade;
   calibrated settings/coefficients + household/person schema alignment are
   required before any forecast/regulatory use. Until then the lane stays
   prototype / preflight / uncalibrated by construction.

## Cleanup

`workers/activitysim_worker/.venv-exec/` and the scratch proof output are local,
untracked, and disposable. No `db reset` was performed; no worker was left polling.
