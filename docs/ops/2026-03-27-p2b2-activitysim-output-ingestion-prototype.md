# P2B.2 ActivitySim Output Ingestion Prototype

**Date:** 2026-03-27  
**Status:** prototype implemented  
**Scope:** ingest an ActivitySim worker runtime directory into OpenPlan-native artifact metadata and lightweight output summaries

## Purpose

This slice moves OpenPlan from "an ActivitySim runtime directory exists" to "OpenPlan can honestly register what that runtime actually produced."

It is deliberately an ingestion layer, not a production analytics layer.

## What This Prototype Does

- accepts either:
  - an ActivitySim runtime directory
  - a `runtime_manifest.json` path
- reads the worker runtime contract emitted by `workers/activitysim_worker/`
- passes through runtime provenance:
  - `mode`
  - `status`
  - `caveats`
  - `errors`
  - stage statuses
- inventories files discovered under `output/`
- inspects CSV outputs when practical and records:
  - table name
  - row count
  - column count
  - column names
- derives a simple `activitysim_output_bundle` metadata payload aligned to the modeling-stack spec:
  - household/person/tour/trip counts when those tables are actually present
  - detected segment columns when visible in discovered tables
  - source stage provenance
- emits stable ingestion artifacts under `ingestion/` by default:
  - `activitysim_output_ingestion_summary.json`
  - `activitysim_output_artifacts.json`

## Honest Runtime Handling

- `preflight_only` or blocked runtimes:
  - ingestion preserves the blocked/preflight runtime state
  - if `output/` is empty, the summary says no behavioral tables were discovered
  - the prototype does not pretend trips/tours/KPIs exist
- `activitysim_cli` runtimes with real outputs:
  - ingestion registers the files that are actually present
  - CSV row counts are reported as lightweight file stats only
- failed runtimes with partial outputs:
  - ingestion preserves the failed status
  - any discovered files are treated as partial artifacts, not proof of a complete run

## What This Prototype Does Not Prove

- It does not prove KPI correctness, calibration quality, or scenario meaning.
- It does not prove a downstream app/storage registry is complete; it only emits registration-shaped metadata JSON.
- It does not prove every ActivitySim output schema variant is supported.
- It does not replace future postprocessing for behavioral KPIs, segmented summaries, or scenario comparisons.

## Intended Use

Run the prototype after a worker runtime completes or blocks:

```bash
python3 scripts/modeling/ingest_activitysim_runtime_outputs.py \
  --runtime-dir /path/to/runtime
```

or

```bash
python3 scripts/modeling/ingest_activitysim_runtime_outputs.py \
  --runtime-manifest /path/to/runtime/runtime_manifest.json
```
