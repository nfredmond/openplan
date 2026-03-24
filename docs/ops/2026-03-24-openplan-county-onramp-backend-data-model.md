# OpenPlan County Onramp Backend Data Model

**Date:** 2026-03-24  
**Author:** Dr. Adrian Velasco, Principal Travel Demand Modeler  
**Purpose:** Translate the county onramp manifest into a practical backend data model for future web product work

## Why this exists

The county onramp workflow now has:
- a runtime/bootstrap helper,
- a machine-readable manifest,
- a schema,
- a checker,
- and real example fixtures.

The next backend question is straightforward:

> If this were persisted in Supabase or another app backend today, what tables/records would actually matter?

This note answers that question at a practical level.

## Design principle

The manifest should remain the **durable workflow-state object** produced by the modeling lane.

A backend should not try to normalize every modeling detail into relational columns immediately. Instead, it should:
- store a compact run/job record,
- store key status fields for querying,
- store artifact pointers,
- and preserve the full manifest JSON as the canonical machine-readable snapshot.

## Recommended core tables

## 1. `county_runs`
Primary unit of county modeling workflow state.

### Recommended fields
- `id` — UUID primary key
- `workspace_id` — tenant/workspace foreign key
- `geography_type` — e.g. `county_fips`
- `geography_id` — e.g. `06061`
- `geography_label` — e.g. `Placer County, CA`
- `run_name` — e.g. `placer-county-runtime-connectorbias2-20260324`
- `stage` — enum:
  - `bootstrap-incomplete`
  - `runtime-complete`
  - `validation-scaffolded`
  - `validated-screening`
- `status_label` — nullable string for human-readable status such as `bounded screening-ready`
- `mode` — `build-and-bootstrap` or `existing-run`
- `manifest_json` — JSONB copy of county onramp manifest
- `run_summary_json` — JSONB optional extracted snapshot
- `validation_summary_json` — JSONB optional extracted snapshot
- `created_at`
- `updated_at`

### Why this table matters
This is the table a web UI would query first to answer:
- what counties exist,
- what state are they in,
- which ones are locally validated,
- and which ones still need count ingestion.

## 2. `county_run_artifacts`
Artifact registry for files associated with each county run.

### Recommended fields
- `id` — UUID primary key
- `county_run_id` — foreign key to `county_runs`
- `artifact_type` — enum/string, e.g.:
  - `run_summary_json`
  - `bundle_manifest_json`
  - `validation_summary_json`
  - `validation_scaffold_csv`
  - `validation_review_packet_md`
  - `loaded_links_geojson`
  - `top_loaded_links_geojson`
- `path` — durable storage path or local path during development
- `mime_type` — optional
- `size_bytes` — optional
- `created_at`

### Why this table matters
Backend/UI code should not parse every file path out of raw JSON every time. This table gives direct artifact listings and download/view links.

## 3. `county_validation_stations`
Optional but useful once count ingestion becomes a regular product workflow.

### Recommended fields
- `id` — UUID primary key
- `county_run_id` — foreign key
- `station_id`
- `label`
- `facility_name`
- `count_year`
- `count_type`
- `direction`
- `observed_volume`
- `source_agency`
- `source_description`
- `candidate_model_names` — text or JSON array
- `candidate_link_types` — text or JSON array
- `exclude_model_names` — text or JSON array
- `bbox_min_lon`
- `bbox_min_lat`
- `bbox_max_lon`
- `bbox_max_lat`
- `notes`
- `created_at`
- `updated_at`

### Why this table matters
This supports a future UI for:
- editing validation stations,
- reviewing candidate matches,
- and iterating on county truth-gating without direct file editing.

## 4. `county_run_events`
Append-only event log for workflow transitions.

### Recommended fields
- `id` — UUID primary key
- `county_run_id` — foreign key
- `event_type` — e.g.:
  - `run_started`
  - `run_completed`
  - `scaffold_generated`
  - `validation_completed`
  - `status_upgraded`
- `payload_json` — JSONB
- `created_at`

### Why this table matters
Useful for auditability, troubleshooting, and activity feeds without overloading the main run record.

## Minimal viable backend posture
If we want the leanest useful implementation, start with only:
- `county_runs`
- `county_run_artifacts`

Store the full manifest in `county_runs.manifest_json`, and expose the rest later as the product matures.

## Suggested status derivation rules

### `county_runs.stage`
Derived from manifest stage directly.

### `county_runs.status_label`
Suggested derivation:
- if `summary.validation.screening_gate.status_label` exists, copy it
- else null

### `county_runs.geography_label`
May start nullable if not yet generated automatically from county FIPS.

## Suggested API shapes

### List county runs
Return:
- `id`
- `geography_label`
- `run_name`
- `stage`
- `status_label`
- `updated_at`

### County run detail
Return:
- run metadata
- manifest snapshot
- artifact list
- validation summary if present

### Validation onboarding detail
Return:
- scaffold CSV metadata
- review packet metadata
- optional station rows if materialized into table form

## Mapping from current manifest

### Manifest → `county_runs`
- `name` → `run_name`
- `county_fips` → `geography_id`
- `stage` → `stage`
- `mode` → `mode`
- `summary.validation.screening_gate.status_label` → `status_label`
- full manifest → `manifest_json`

### Manifest → `county_run_artifacts`
Each `artifacts.*` file path becomes one artifact row.

## Guardrail
Do not over-normalize too early.

At this stage, the fastest honest backend pattern is:
- a compact indexed run table,
- an artifact table,
- and the full manifest retained intact.

That keeps the product adaptable while the modeling lane is still evolving.

## Product implication
This data model is enough to support an early web flow like:
1. user selects county,  
2. backend launches county onramp bootstrap job,  
3. worker writes manifest + artifacts,  
4. backend ingests manifest into `county_runs`,  
5. UI shows stage/status and links to artifacts,  
6. later, validation stations and counts are edited in-app.

That is a credible first bridge from today’s local modeling workflow to the eventual Vercel/Railway/Supabase product architecture.

Related API outline:
- `docs/ops/2026-03-24-openplan-county-onramp-api-outline.md`

## Bottom line
The county onramp manifest is now mature enough to anchor a practical backend data model.

The simplest correct posture is:
- keep the manifest as the canonical workflow snapshot,
- index the key status fields for queryability,
- and add more relational structure only where the product genuinely needs it.
