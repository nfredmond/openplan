# OpenPlan County Onramp Manifest Schema

**Date:** 2026-03-24  
**Author:** Dr. Adrian Velasco, Principal Travel Demand Modeler  
**Purpose:** Define a stable backend-facing contract for county validation-onramp manifests

## Why this exists

The county onramp bootstrap helper now emits a machine-readable manifest that describes:
- what county/run was processed,
- what stage it reached,
- where artifacts live,
- and what high-level runtime/validation status is currently known.

If this is going to back a web workflow later, the fields need to be treated as a contract rather than an accidental byproduct.

## Current producer
- `scripts/modeling/bootstrap_county_validation_onramp.py`

## Current lightweight checker
- `scripts/modeling/check_county_onramp_manifest.py`

## Current JSON Schema artifact
- `schemas/county_onramp_manifest.schema.json`

## Example fixtures
- `schemas/examples/county_onramp_manifest.nevada.validated-screening.json`
- `schemas/examples/county_onramp_manifest.placer.runtime-complete.json`
- `schemas/examples/README.md`

## Intended consumers
Future examples:
- Supabase run/job tables
- Railway worker status callbacks
- Vercel API routes
- internal admin dashboards
- county onboarding review UIs

## Top-level fields

### `name`
- type: `string`
- meaning: run name / county onboarding job label

### `county_fips`
- type: `string | null`
- meaning: county FIPS when known at bootstrap time
- note: may be null when bootstrapping from an already-completed run directory

### `county_prefix`
- type: `string`
- meaning: station ID prefix used for validation scaffold rows

### `run_dir`
- type: `string`
- meaning: absolute path to the screening run directory

### `mode`
- type: `"build-and-bootstrap" | "existing-run"`
- meaning:
  - `build-and-bootstrap` = helper launched a new screening run first
  - `existing-run` = helper attached to a completed run directory

### `stage`
- type: enum string
- allowed values:
  - `bootstrap-incomplete`
  - `runtime-complete`
  - `validation-scaffolded`
  - `validated-screening`

## Stage semantics

### `bootstrap-incomplete`
Use when:
- expected run/bootstrap artifacts are not all present,
- or the helper cannot infer a meaningful completed state.

### `runtime-complete`
Use when:
- the screening run completed,
- but no validation summary is present yet.

### `validation-scaffolded`
Use when:
- validation-related artifacts exist,
- but the county does not currently show a `bounded screening-ready` result.

### `validated-screening`
Use when:
- a validation summary exists,
- and its `screening_gate.status_label` is `bounded screening-ready`.

## `artifacts` object

### `artifacts.scaffold_csv`
- type: `string`
- absolute path to generated scaffold CSV

### `artifacts.review_packet_md`
- type: `string`
- absolute path to generated review packet markdown

### `artifacts.run_summary_json`
- type: `string | null`
- absolute path to `run_summary.json` when present

### `artifacts.bundle_manifest_json`
- type: `string | null`
- absolute path to `bundle_manifest.json` when present

### `artifacts.validation_summary_json`
- type: `string | null`
- absolute path to `validation/validation_summary.json` when present

## `runtime` object
Captures the bootstrap/runtime settings that materially shape the run.

### Fields
- `keep_project: boolean`
- `force: boolean`
- `overall_demand_scalar: number | null`
- `external_demand_scalar: number | null`
- `hbw_scalar: number | null`
- `hbo_scalar: number | null`
- `nhb_scalar: number | null`

## `summary` object

### `summary.run`
A light snapshot of run-level metrics when available.

Expected fields:
- `zone_count: number | null`
- `population_total: number | null`
- `jobs_total: number | null`
- `loaded_links: number | null`
- `final_gap: number | null`
- `total_trips: number | null`

### `summary.validation`
- type: `object | null`
- meaning: embedded validation summary when available
- note: currently mirrors `validation_summary.json` directly

### `summary.bundle_validation`
- type: `object | null`
- meaning: validation sub-object from `bundle_manifest.json` when available

## Stability expectations

### Safe to depend on now
- top-level fields listed above
- `stage` enum values listed above
- `artifacts` object keys listed above
- `runtime` scalar fields listed above

### May evolve
- the precise contents of `summary.validation`
- the precise contents of `summary.bundle_validation`
- optional future fields such as timestamps, county name, geography metadata, or warning arrays

## Recommended backend posture
When consuming the manifest:
- treat `stage` as the primary workflow-state field
- treat `artifacts.*` as pointers to durable files
- treat `summary.*` as convenience snapshot data, not the sole source of truth
- preserve forward compatibility by ignoring unknown fields

## Example interpretation

### Nevada bounded run
- `stage = validated-screening`
- validation summary present
- review packet present
- scaffold present
- county can be shown as locally truth-gated at the screening level

### Placer transfer-only run
- likely `stage = runtime-complete`
- run summary present
- no validation summary yet
- county is runnable but not yet validated

## Product implication
This manifest is a small but important bridge between model execution and product orchestration.

It lets the future app ask a county run:
- what happened,
- what files exist,
- what stage is it in,
- and whether it has crossed into a truth-gated validation state.

Related backend-mapping note:
- `docs/ops/2026-03-24-openplan-county-onramp-backend-data-model.md`

## Bottom line
The county onramp manifest should now be treated as a **backend contract draft**.

It is not the final production schema, but it is stable enough to guide early web/API integration and to prevent workflow state from being hidden in human memory or terminal output.
