# OpenPlan County Onramp Worker Contract

**Date:** 2026-03-24  
**Author:** Dr. Adrian Velasco, Principal Travel Demand Modeler  
**Purpose:** Define the minimum request/response contract between web/API orchestration and the long-running county worker

## Why this exists

The county onramp API outline now defines the frontend/backend surface.
The next operational question is:

> What exactly does the background worker receive, and what exactly must it return?

This note defines that minimal contract.

## Design goal

Keep the worker contract small and durable.

The worker should not need to know about the full UI or database schema. It only needs enough information to:
- execute a county onramp bootstrap,
- produce a manifest and artifacts,
- and report completion/failure back to the API layer.

## Worker input contract

### Recommended payload
```json
{
  "jobId": "uuid",
  "countyRunId": "uuid",
  "workspaceId": "uuid",
  "runName": "placer-county-runtime-connectorbias2-20260324",
  "geographyType": "county_fips",
  "geographyId": "06061",
  "geographyLabel": "Placer County, CA",
  "countyPrefix": "PLACER",
  "runtimeOptions": {
    "keepProject": true,
    "force": true,
    "overallDemandScalar": null,
    "externalDemandScalar": null,
    "hbwScalar": null,
    "hboScalar": null,
    "nhbScalar": null
  },
  "artifactTargets": {
    "scaffoldCsvPath": "data/pilot-placer-county/validation/placer_priority_count_scaffold_auto.csv",
    "reviewPacketMdPath": "docs/ops/2026-03-24-openplan-placer-validation-review-packet.md",
    "manifestPath": "tmp/county-onramp/placer-county-runtime-connectorbias2-20260324.manifest.json"
  },
  "callback": {
    "manifestIngestUrl": "https://app.example.com/api/county-runs/<id>/manifest",
    "bearerToken": "opaque-token"
  }
}
```

## Required worker behavior

1. Execute county onramp bootstrap.  
2. Produce scaffold CSV, review packet, and manifest.  
3. POST manifest back to the callback URL.  
4. On failure, POST a failure payload or otherwise mark the county run failed in a retry-safe way.

## Preferred worker command shape
The worker should ultimately call:
- `scripts/modeling/bootstrap_county_validation_onramp.py`

With explicit args derived from the job payload.

## Worker success callback

### Endpoint
- `POST /api/county-runs/:id/manifest`

### Request body
```json
{
  "jobId": "uuid",
  "status": "completed",
  "manifest": { "...": "county onramp manifest" }
}
```

### API behavior
- validate manifest shape
- update county run stage/status
- store manifest JSON
- upsert artifact rows
- log a `run_completed` / `manifest_ingested` event

## Worker failure callback

### Suggested request body
```json
{
  "jobId": "uuid",
  "status": "failed",
  "error": {
    "message": "Human-readable summary",
    "kind": "runtime_error",
    "details": "Optional stderr tail or structured detail"
  }
}
```

### API behavior
- mark county run as failed or blocked
- preserve error text for operator review
- keep retries/manual restart possible

## Minimal worker states
Suggested internal worker statuses:
- `queued`
- `running`
- `completed`
- `failed`

Suggested county-run stage mapping:
- worker starts → county run remains `bootstrap-incomplete`
- manifest ingested without validation summary → `runtime-complete`
- manifest ingested with validation scaffold only → `validation-scaffolded`
- manifest ingested with bounded screening-ready validation → `validated-screening`

## Retry posture
The contract should be safe for retries.

That means:
- `countyRunId` is stable
- `runName` is stable per intended run
- manifest ingest should be idempotent enough to accept a repeated completion callback
- artifact upserts should not duplicate rows if the same paths are re-sent

## Recommended separation of concerns

### API layer responsibilities
- auth
- job creation
- queue submission
- manifest ingestion
- persistence into backend tables
- UI-facing status reads

### Worker responsibilities
- run heavy modeling/bootstrap commands
- collect artifacts
- return manifest or failure payload

## Guardrail
The worker contract must not strip away modeling truth constraints.

Even if a worker reports success, the backend/UI must still respect:
- screening-grade only
- validation slice only
- not behavioral demand
- not client-ready forecasting

## Product implication
With this contract, the first live web workflow does not need to be complicated.

It only needs:
- one API endpoint to create a job,
- one worker payload shape,
- one success callback,
- one failure callback,
- and one county-run detail endpoint for the frontend.

That is enough to show a real county progressing through the pipeline.

## Bottom line
The county onramp worker contract should stay boring and explicit.

That is a strength. If the worker only knows how to:
- receive a county job,
- run the bootstrap,
- and return a manifest or error,

then the web product can evolve around it without forcing the modeling lane itself to become UI-specific.
