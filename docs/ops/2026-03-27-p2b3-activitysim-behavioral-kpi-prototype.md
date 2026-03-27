# P2B.3 ActivitySim Behavioral KPI Prototype

**Date:** 2026-03-27  
**Status:** prototype implemented  
**Scope:** extract a lightweight behavioral KPI packet from ActivitySim runtime outputs that were actually produced

## Purpose

This slice moves OpenPlan from "ActivitySim outputs were ingested" to "OpenPlan can emit a small, honest KPI packet from the outputs that are really there."

It is deliberately conservative.

## What This Prototype Does

- accepts either:
  - an ActivitySim runtime directory
  - an `activitysim_output_ingestion_summary.json` path
- reads the existing runtime + ingestion contract rather than inventing a new one
- emits stable KPI artifacts under `kpis/` by default:
  - `activitysim_behavioral_kpi_summary.json`
  - `activitysim_behavioral_kpi_packet.md`
- derives only supportable prototype KPIs from actually present outputs:
  - simple totals for households, persons, tours, and trips
  - trip volumes by purpose when a trips table exposes a recognizable purpose column
  - mode shares when a trips table exposes a recognizable mode column
  - segment summaries when the needed columns or joins are supportable from discovered household/person/tour/trip tables

## Honest Runtime Handling

- `preflight_only` or blocked runtimes:
  - KPI availability is reported as `not_enough_behavioral_outputs`
  - the prototype does not emit fake zeroes for trips, purposes, or modes
  - the markdown packet explains why KPI extraction is not supportable
- failed runtimes with partial outputs:
  - KPI availability is reported as partial
  - any counts/shares are explicitly treated as partial-output summaries only

## Current Segment Logic

- direct summaries when a target table already carries the segment column
- person-linked summaries when `person_id` allows lookup into `final_persons`
- household-linked summaries when `household_id` allows lookup into `final_households`
- coarse income bins when numeric household income is available:
  - `under_25k`
  - `25k_to_49k`
  - `50k_to_99k`
  - `100k_to_149k`
  - `150k_plus`

## What This Prototype Does Not Prove

- It does not prove calibration quality, behavioral realism, or scenario meaning.
- It does not prove every ActivitySim output schema variant is covered.
- It does not claim VMT/VHT/logsum/accessibility coverage yet.
- It does not replace future scenario-comparison or validation packets.

## Intended Use

From a runtime directory:

```bash
python3 scripts/modeling/extract_activitysim_behavioral_kpis.py \
  --runtime-dir /path/to/runtime
```

From an ingestion summary:

```bash
python3 scripts/modeling/extract_activitysim_behavioral_kpis.py \
  --ingestion-summary /path/to/runtime/ingestion/activitysim_output_ingestion_summary.json
```
