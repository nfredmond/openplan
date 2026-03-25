# OpenPlan County Onramp API Outline

**Date:** 2026-03-24  
**Author:** Dr. Adrian Velasco, Principal Travel Demand Modeler  
**Purpose:** Define the smallest useful API surface for a web-native county onboarding workflow

## Why this exists

The county onboarding lane now has:
- reusable runtime execution,
- validation-onramp automation,
- machine-readable manifests,
- schema + example fixtures,
- and a practical backend data model proposal.

The next natural question is:

> What API endpoints would the first Vercel/Railway/Supabase implementation actually need?

This note answers that in a deliberately minimal way.

## Design goal

Support this end-to-end flow:
1. user selects a county/geography in the web app,  
2. backend creates a county run record,  
3. worker executes the county onramp bootstrap,  
4. manifest + artifacts are ingested,  
5. UI shows county state and links to outputs,  
6. later, a validation slice can be completed and re-ingested.

## Minimal endpoint set

## 1. `POST /api/county-runs`
Create a new county onboarding job.

### Request body
```json
{
  "workspaceId": "uuid",
  "geographyType": "county_fips",
  "geographyId": "06061",
  "geographyLabel": "Placer County, CA",
  "runName": "placer-county-runtime-connectorbias2-20260324",
  "runtimeOptions": {
    "keepProject": true,
    "overallDemandScalar": null,
    "externalDemandScalar": null,
    "hbwScalar": null,
    "hboScalar": null,
    "nhbScalar": null
  }
}
```

### Behavior
- creates a `county_runs` record in `bootstrap-incomplete` state
- enqueues a Railway/background worker job
- returns `countyRunId`

### Response
```json
{
  "countyRunId": "uuid",
  "stage": "bootstrap-incomplete",
  "runName": "placer-county-runtime-connectorbias2-20260324"
}
```

## 2. `GET /api/county-runs`
List county runs for a workspace.

### Query params
- `workspaceId`
- optional `stage`
- optional `geographyId`
- optional `limit`

### Response shape
```json
{
  "items": [
    {
      "id": "uuid",
      "geographyLabel": "Nevada County, CA",
      "runName": "nevada-county-runtime-scalar0369-connectorbias2-20260324",
      "stage": "validated-screening",
      "statusLabel": "bounded screening-ready",
      "updatedAt": "2026-03-24T23:00:00Z"
    }
  ]
}
```

## 3. `GET /api/county-runs/:id`
Get one county run detail.

### Response should include
- run metadata
- stage
- status label
- manifest JSON
- artifact pointers
- validation summary if present

### Response shape
```json
{
  "id": "uuid",
  "workspaceId": "uuid",
  "geographyType": "county_fips",
  "geographyId": "06057",
  "geographyLabel": "Nevada County, CA",
  "runName": "nevada-county-runtime-scalar0369-connectorbias2-20260324",
  "stage": "validated-screening",
  "statusLabel": "bounded screening-ready",
  "manifest": { "...": "county onramp manifest" },
  "artifacts": [
    { "artifactType": "validation_scaffold_csv", "path": "..." },
    { "artifactType": "validation_review_packet_md", "path": "..." }
  ],
  "validationSummary": { "...": "validation summary json" }
}
```

## 4. `POST /api/county-runs/:id/manifest`
Worker callback / ingestion endpoint.

### Purpose
- worker submits the produced manifest after bootstrapping
- backend updates `county_runs`
- backend refreshes artifact rows
- backend derives stage/status from manifest

### Request body
```json
{
  "manifest": { "...": "county onramp manifest" }
}
```

### Behavior
- validate manifest shape
- update `county_runs.manifest_json`
- set `stage`
- set `statusLabel`
- upsert artifact records
- update timestamps

## 5. `POST /api/county-runs/:id/validation-stations/import`
Optional early endpoint for uploading or replacing a station CSV.

### Purpose
- allows a UI or admin flow to move from scaffold to real count file
- not required for the first backend milestone, but useful soon after

## 6. `POST /api/county-runs/:id/validate`
Optional later endpoint to trigger validation once a completed counts file exists.

### Purpose
- runs `validate_screening_observed_counts.py`
- ingests refreshed validation summary
- updates county run stage/status if appropriate

## Worker responsibilities

A background worker should:
1. receive county job payload,  
2. run `bootstrap_county_validation_onramp.py`,  
3. capture the produced manifest path,  
4. post that manifest to `/api/county-runs/:id/manifest`.

Detailed worker contract:
- `docs/ops/2026-03-24-openplan-county-onramp-worker-contract.md`

## Backend derivation rules

### `stage`
Use manifest stage directly.

### `statusLabel`
Suggested rule:
- if `manifest.summary.validation.screening_gate.status_label` exists, use that
- else null

### artifact rows
Map from manifest paths directly into `county_run_artifacts`.

## Vercel / Railway split

### Vercel API routes
Good for:
- auth
- CRUD over county runs
- listing/detail endpoints
- manifest ingestion
- validation-station uploads

### Railway or equivalent worker
Good for:
- long-running county runtime builds
- scaffold generation
- validation execution
- artifact production

## Minimal shipping milestone

A credible first web milestone does **not** need the full editing experience.

It only needs:
- create county run
- background bootstrap
- ingest manifest
- show county detail page with stage + artifacts

That alone would already make the current local workflow visible through a real app shell.

## Guardrail
The API should not erase modeling truth constraints.

Even if a county run reaches `validated-screening`, the app must still preserve the modeled meaning:
- screening-grade only
- uncalibrated
- not behavioral demand
- not client-ready forecasting
- county-specific / slice-specific where applicable

## Bottom line
The first OpenPlan county onboarding API can be very small.

If it can:
- create a county run,
- ingest a manifest,
- list/detail run state,
- and expose artifacts,

then the current modeling workflow already has enough structure to appear in a real web product without pretending the entire future system is finished.

Related UI state note:
- `docs/ops/2026-03-24-openplan-county-run-ui-state-model.md`
