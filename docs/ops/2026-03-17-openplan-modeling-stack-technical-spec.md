# OpenPlan Modeling Stack — Technical Specification

**Date:** 2026-03-17  
**Author:** Iris Chen  
**Status:** draft technical spec for implementation planning  
**Companion docs:**
- `docs/ADRs/ADR-002-multi-engine-modeling-stack.md`
- `docs/ops/2026-03-17-openplan-aequilibrae-activitysim-matsim-architecture-memo.md`
- `docs/ops/2026-03-17-openplan-modeling-stack-build-backlog-and-execution-plan.md`

---

## 1. Purpose

This document defines how OpenPlan should evolve its current `models` and `model_runs` posture into a full **multi-engine modeling orchestration system** capable of supporting:

- AequilibraE-backed fast screening,
- ActivitySim-backed behavioral demand runs,
- MATSim-backed dynamic operations runs,
- future controlled feedback loops,
- artifact-level traceability and report-grade evidence.

This is a technical implementation spec, not a marketing document.

---

## 2. Design goals

The system must:

1. preserve OpenPlan as the **canonical planning/data/orchestration layer**,
2. support bounded external engine execution,
3. keep long-running jobs out of the request/response web path,
4. make artifacts first-class,
5. support partial failure and recovery,
6. allow explicit versioning of engines and adapters,
7. support evidence and validation packets,
8. expose clean planner-facing outputs rather than raw engine dumps.

---

## 3. Current state summary

OpenPlan already includes:

- `models` table with model family, metadata, config JSON, readiness fields, and links
- `model_links` table
- `model_runs` table with basic run tracking
- a `model_runs` API that currently launches a managed run by calling `/api/analysis`
- current engine support values in schema for:
  - `deterministic_corridor_v1`
  - `aequilibrae`
  - `activitysim`

Current limitations:

- run tracking is too thin for multi-stage execution
- no artifact registry
- no queue/job abstraction
- no engine version registry
- no validation packet model
- no MATSim support in schema
- no explicit adapter/runtime versioning
- no support for stage retries or resumable execution

---

## 4. Proposed architecture

## 4.1 Logical architecture

```text
OpenPlan Web App / API
    ↓
OpenPlan Domain Layer (projects, scenarios, models, reports, artifacts)
    ↓
OpenPlan Orchestrator Service
    ↓
Queue / Job Broker
    ↓
┌────────────────┬────────────────┬────────────────┐
│ AequilibraE    │ ActivitySim    │ MATSim         │
│ Worker         │ Worker         │ Worker         │
└────────────────┴────────────────┴────────────────┘
    ↓
Artifact Storage + Relational Metadata + Postprocessing Workers
    ↓
OpenPlan KPI / Comparison / Reporting Surfaces
```

## 4.2 Architectural rule
The web app may create runs and inspect state, but **must not** directly execute long-running modeling engines.

---

## 5. Core concepts

## 5.1 Model
A reusable package/configuration definition that describes:

- what planning question the package answers,
- what engine family it uses,
- what inputs it requires,
- what outputs it produces,
- its configuration version,
- its validation posture.

Current table: `models`

## 5.2 Model run
A specific execution instance for a model under a given input snapshot.

Current table: `model_runs`

## 5.3 Run stage
A bounded step in a run, such as:

- network prep
- skim generation
- demand packaging
- ActivitySim run
- MATSim run
- postprocess
- report extract

This does **not** currently exist and should be added.

## 5.4 Artifact
A versioned output or intermediate bundle stored outside the DB and indexed in the DB.

Examples:

- network bundle
- skim matrix cube
- ActivitySim input bundle
- ActivitySim output bundle
- MATSim scenario bundle
- MATSim event bundle
- KPI summary
- validation packet
- report packet

## 5.5 Engine profile
A versioned description of an execution backend/runtime.

Examples:

- `aequilibrae@1.1.x`
- `activitysim@1.x`
- `matsim@<approved-version>`
- adapter/runtime image ids

## 5.6 Analysis package
Planner-facing abstraction that groups model + run mode + output expectations.

---

## 6. Relational schema proposal

Below is the recommended extension of the current schema.

## 6.1 Existing tables to preserve and extend

### `models`
Preserve. Extend cautiously.

Recommended additions:
- `analysis_package_key TEXT`
- `runtime_class TEXT` (`fast`, `medium`, `heavy`)
- `calibration_status TEXT`
- `validation_status TEXT`
- `primary_engine_key TEXT`
- `execution_profile_json JSONB`

### `model_runs`
Preserve but promote to run header.

Recommended additions:
- `run_mode_key TEXT`
- `engine_pipeline_key TEXT`
- `current_stage_key TEXT`
- `orchestrator_version TEXT`
- `job_priority TEXT`
- `queue_name TEXT`
- `run_manifest_json JSONB`
- `validation_summary_json JSONB`
- `storage_prefix TEXT`
- `retry_count INTEGER`
- `cancel_requested_at TIMESTAMPTZ`
- `worker_claimed_at TIMESTAMPTZ`
- `worker_heartbeat_at TIMESTAMPTZ`

---

## 6.2 New tables

### `model_engines`
Registry of supported engines and runtime profiles.

Suggested shape:

```sql
CREATE TABLE model_engines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engine_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  engine_family TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  adapter_version TEXT,
  runtime_image TEXT,
  runtime_notes TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(engine_key, engine_version, COALESCE(adapter_version, ''))
);
```

Examples:
- `aequilibrae`
- `activitysim`
- `matsim`
- `deterministic_corridor_v1`

### `model_run_stages`
Tracks fine-grained stage state for every run.

Suggested shape:

```sql
CREATE TABLE model_run_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_run_id UUID NOT NULL REFERENCES model_runs(id) ON DELETE CASCADE,
  stage_key TEXT NOT NULL,
  stage_order INTEGER NOT NULL,
  engine_key TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  input_artifact_ids UUID[] NOT NULL DEFAULT '{}',
  output_artifact_ids UUID[] NOT NULL DEFAULT '{}',
  worker_job_id TEXT,
  log_excerpt TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(model_run_id, stage_key)
);
```

### `model_artifacts`
Canonical artifact registry.

Suggested shape:

```sql
CREATE TABLE model_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  model_id UUID REFERENCES models(id) ON DELETE SET NULL,
  model_run_id UUID REFERENCES model_runs(id) ON DELETE SET NULL,
  stage_id UUID REFERENCES model_run_stages(id) ON DELETE SET NULL,
  artifact_type TEXT NOT NULL,
  artifact_key TEXT NOT NULL,
  storage_uri TEXT NOT NULL,
  content_hash TEXT,
  content_type TEXT,
  byte_size BIGINT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(model_run_id, artifact_key)
);
```

### `model_validation_packets`
Validation and calibration evidence.

Suggested shape:

```sql
CREATE TABLE model_validation_packets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  model_run_id UUID REFERENCES model_runs(id) ON DELETE SET NULL,
  packet_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  storage_uri TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `model_run_queue`
Optional DB-backed queue mirror if needed for orchestration visibility.

Suggested shape:

```sql
CREATE TABLE model_run_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_run_id UUID NOT NULL REFERENCES model_runs(id) ON DELETE CASCADE,
  queue_name TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'queued',
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_by TEXT,
  claimed_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(model_run_id)
);
```

### `analysis_packages`
Planner-facing packaging layer.

Suggested shape:

```sql
CREATE TABLE analysis_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  package_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  run_mode_key TEXT NOT NULL,
  primary_engine_key TEXT NOT NULL,
  supported_engine_pipeline_keys TEXT[] NOT NULL DEFAULT '{}',
  input_contract_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_contract_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  caveats_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, package_key)
);
```

---

## 7. Enums and canonical keys

## 7.1 `engine_key`
Canonical engine values:

- `deterministic_corridor_v1`
- `aequilibrae`
- `activitysim`
- `matsim`

## 7.2 `engine_pipeline_key`
Canonical pipeline values:

- `deterministic_corridor_v1`
- `aequilibrae_screening_v1`
- `aequilibrae_activitysim_v1`
- `activitysim_matsim_v1`
- `aequilibrae_activitysim_matsim_v1`

## 7.3 `run_mode_key`
User-facing run classes:

- `fast_screening`
- `behavioral_demand`
- `dynamic_operations`

## 7.4 `artifact_type`
Initial controlled vocabulary:

- `run_manifest`
- `network_bundle`
- `zone_bundle`
- `connector_bundle`
- `skim_cube`
- `assignment_result`
- `accessibility_result`
- `activitysim_input_bundle`
- `activitysim_output_bundle`
- `matsim_scenario_bundle`
- `matsim_event_bundle`
- `postprocess_bundle`
- `kpi_summary`
- `validation_packet`
- `report_packet`
- `log_bundle`

## 7.5 `stage_key`
Suggested controlled vocabulary:

- `validate_inputs`
- `prepare_network`
- `prepare_zones`
- `generate_skims`
- `run_assignment`
- `prepare_activitysim_inputs`
- `run_activitysim`
- `prepare_matsim_inputs`
- `run_matsim`
- `postprocess_outputs`
- `build_validation_packet`
- `build_report_packet`

---

## 8. Storage design

## 8.1 Relational storage
Use Postgres/Supabase for:

- run headers
- stage state
- artifact metadata
- package metadata
- engine registry
- validation summaries
- KPI summaries

## 8.2 Object storage
Use object storage for large artifacts.

Suggested path structure:

```text
model-runs/
  <workspace-id>/
    <model-id>/
      <run-id>/
        manifest.json
        stages/
          010-prepare-network/
          020-generate-skims/
          030-run-activitysim/
          040-run-matsim/
        artifacts/
          skim_cube.omx
          assignment_summary.parquet
          activitysim_bundle.zip
          matsim_events.xml.gz
          kpi_summary.json
          validation_packet.md
```

## 8.3 Hashing
Each artifact should capture:
- content hash
- byte size
- MIME/content type
- engine version
- adapter version
- source stage key

---

## 9. Service architecture

## 9.1 Web app / API
Responsibilities:
- create/update model records
- create runs
- inspect statuses and artifacts
- compare results
- trigger cancellations
- render report/evidence surfaces

Must not directly execute heavy engine jobs.

## 9.2 Orchestrator service
Responsibilities:
- build run manifests
- create stage rows
- enqueue stage jobs
- observe completion/failure
- start downstream stages when dependencies clear
- write status back into `model_runs` and `model_run_stages`
- trigger postprocessing and packet assembly

Recommended behavior:
- idempotent stage progression
- resumable after restart
- explicit max retry counts
- heartbeat/watchdog support

## 9.3 Queue / job broker
Candidate options:
- DB-backed queue for early simplicity
- Redis-backed queue for more serious scaling
- managed queue later if warranted

Required features:
- claim/ack model
- visibility into queued/running/failed jobs
- retry and dead-letter support
- cancellation support or cooperative cancellation

## 9.4 AequilibraE worker
Responsibilities:
- network prep
- zone/connector prep
- skim generation
- assignment
- accessibility outputs
- artifact registration callbacks

## 9.5 ActivitySim worker
Responsibilities:
- package input bundle
- execute ActivitySim pipeline
- collect outputs
- register artifacts
- emit summary metadata

## 9.6 MATSim worker
Responsibilities:
- package MATSim scenario inputs
- execute simulation
- collect raw outputs/events
- register artifacts
- run first-pass postprocessing or hand off to postprocessor

## 9.7 Postprocessing worker
Responsibilities:
- derive common KPIs
- build map-ready output layers
- produce comparison summaries
- assemble validation and report packets

---

## 10. Run lifecycle

## 10.1 Header lifecycle
`model_runs.status` should support:

- `queued`
- `running`
- `succeeded`
- `failed`
- `cancelled`

## 10.2 Stage lifecycle
`model_run_stages.status` should support:

- `queued`
- `running`
- `succeeded`
- `failed`
- `blocked`
- `cancelled`
- `skipped`

## 10.3 Example lifecycle — AequilibraE screening
```text
create run header
→ validate_inputs
→ prepare_network
→ prepare_zones
→ generate_skims
→ run_assignment
→ postprocess_outputs
→ build_report_packet
→ mark run succeeded
```

## 10.4 Example lifecycle — ActivitySim + MATSim
```text
create run header
→ validate_inputs
→ prepare_network/skims
→ prepare_activitysim_inputs
→ run_activitysim
→ prepare_matsim_inputs
→ run_matsim
→ postprocess_outputs
→ build_validation_packet
→ build_report_packet
→ mark run succeeded
```

---

## 11. API design direction

## 11.1 Existing APIs to preserve
Current APIs under `/api/models/[modelId]/runs` should remain the user-facing entry path.

## 11.2 Recommended API additions

### `POST /api/models/:modelId/runs`
Create run header + orchestrator manifest.

### `GET /api/models/:modelId/runs/:runId`
Return header + stages + artifacts + KPI summaries.

### `POST /api/models/:modelId/runs/:runId/cancel`
Request cooperative cancellation.

### `GET /api/models/:modelId/runs/:runId/artifacts`
List artifacts.

### `GET /api/models/:modelId/runs/:runId/validation`
Return validation summary/packet references.

### `GET /api/models/:modelId/runs/:runId/report`
Return report packet metadata.

### `POST /internal/model-run-stages/:stageId/claim`
Internal worker claim endpoint if DB-backed coordination is used.

### `POST /internal/model-run-stages/:stageId/complete`
Internal stage completion callback.

### `POST /internal/model-run-stages/:stageId/fail`
Internal stage failure callback.

---

## 12. Manifest schema

Each run should write a canonical run manifest.

Suggested shape:

```json
{
  "runId": "uuid",
  "modelId": "uuid",
  "workspaceId": "uuid",
  "runModeKey": "behavioral_demand",
  "enginePipelineKey": "aequilibrae_activitysim_v1",
  "orchestratorVersion": "v1",
  "createdAt": "2026-03-17T00:00:00Z",
  "inputSnapshot": {
    "scenarioSetId": "uuid",
    "scenarioEntryId": "uuid",
    "datasetRefs": [],
    "networkPackageRef": "...",
    "zoneBundleRef": "..."
  },
  "engines": [
    {"engineKey": "aequilibrae", "engineVersion": "...", "adapterVersion": "..."},
    {"engineKey": "activitysim", "engineVersion": "...", "adapterVersion": "..."}
  ],
  "stages": [
    {"stageKey": "generate_skims", "order": 30},
    {"stageKey": "run_activitysim", "order": 40}
  ],
  "caveats": [],
  "validationPolicy": {
    "requiredPacketTypes": ["runtime_qc", "input_provenance"]
  }
}
```

---

## 13. Artifact metadata schema

Suggested `metadata_json` examples:

## 13.1 `skim_cube`
```json
{
  "timePeriods": ["AM", "MD", "PM"],
  "modes": ["drive", "walk", "transit"],
  "zoneSystem": "TAZ",
  "matrixFormat": "omx",
  "sourceStageKey": "generate_skims"
}
```

## 13.2 `activitysim_output_bundle`
```json
{
  "householdCount": 0,
  "personCount": 0,
  "tourCount": 0,
  "tripCount": 0,
  "segments": ["income", "person_type"],
  "sourceStageKey": "run_activitysim"
}
```

## 13.3 `matsim_event_bundle`
```json
{
  "eventFormat": "xml.gz",
  "simulationPeriods": ["full_day"],
  "sourceStageKey": "run_matsim",
  "postprocessRequired": true
}
```

## 13.4 `kpi_summary`
```json
{
  "summaryVersion": "v1",
  "kpis": [
    "travel_time",
    "accessibility_score",
    "mode_share",
    "corridor_delay"
  ],
  "sourceStageKey": "postprocess_outputs"
}
```

---

## 14. Planner-facing package design

## 14.1 Package examples

### `county_accessibility_screening_v1`
- run mode: `fast_screening`
- engine pipeline: `aequilibrae_screening_v1`

### `corridor_behavioral_demand_v1`
- run mode: `behavioral_demand`
- engine pipeline: `aequilibrae_activitysim_v1`

### `dynamic_corridor_operations_v1`
- run mode: `dynamic_operations`
- engine pipeline: `activitysim_matsim_v1`

## 14.2 Package UI rules
For each package, UI should surface:
- intended use
- runtime class
- required inputs
- key outputs
- calibration status
- known limitations

---

## 15. Calibration and validation support

## 15.1 Calibration status model
Suggested values:
- `prototype`
- `internally_benchmarked`
- `partially_calibrated`
- `locally_calibrated`
- `locally_validated`
- `production_grade_for_stated_use`

## 15.2 Validation packet types
Suggested initial values:
- `input_provenance`
- `runtime_qc`
- `observed_data_comparison`
- `sensitivity_check`
- `report_safe_summary`

## 15.3 Product rule
A package cannot claim a higher confidence label than its current validation/calibration packet supports.

---

## 16. Security, permissions, and tenancy

All new tables should follow the existing workspace-tenancy posture.

Required rules:
- workspace-scoped RLS for all new modeling tables
- artifact access gated by workspace/model/run ownership
- internal stage-completion endpoints authenticated separately from end-user routes
- worker callbacks must not trust client-supplied workspace IDs without verification

---

## 17. Observability and supportability

## 17.1 Required logging
Each stage should log:
- stage start
- worker identity/runtime
- input artifact refs
- output artifact refs
- duration
- warning count
- final status

## 17.2 Required operator fields
At minimum:
- `worker_job_id`
- `claimed_by`
- `heartbeat_at`
- `attempt_count`
- `last_error`

## 17.3 UI supportability
Model run detail should show:
- overall run status
- stage timeline
- artifact list
- warnings/errors
- validation packet links
- report packet link

---

## 18. Migration path from current implementation

## 18.1 Near-term migration posture
Do not replace current `model_runs` route wholesale immediately.

Instead:
1. preserve current simple path,
2. add staged fields and artifact table support,
3. make `deterministic_corridor_v1` a first engine profile in the new orchestrator world,
4. evolve the route to create a run manifest and stage plan instead of calling `/api/analysis` directly inline.

## 18.2 Migration sequence
1. schema migration for new tables
2. orchestrator abstraction
3. artifact registry integration
4. move deterministic corridor lane into stage model
5. add AequilibraE stage path
6. add ActivitySim stage path
7. add MATSim stage path

---

## 19. Open questions

1. What exact queue technology should OpenPlan use first?
2. What is the first pilot geography and zone system?
3. How much of the first AequilibraE lane should support transit versus roadway only?
4. What population source should feed the first ActivitySim package?
5. How should OpenPlan package MATSim for commercial deployment posture?
6. Which KPI set is mandatory across all run modes?
7. What is the minimum viable validation packet for each run class?

These questions should be answered explicitly before large implementation waves, not implicitly through drift.

---

## 20. Recommended first implementation slice

The first implementation slice should be:

1. add staged run and artifact tables,
2. convert current deterministic corridor managed run into staged orchestration,
3. introduce first AequilibraE worker lane,
4. register skim and KPI artifacts,
5. upgrade model run detail UI to show stages/artifacts.

This preserves continuity with the current code while opening the path to the broader stack.

---

## 21. Final technical recommendation

Build OpenPlan as an **artifact-driven multi-engine orchestration system**.

Do not hide engine complexity by smearing it across the codebase. Contain it with:

- stage tables,
- artifact contracts,
- worker boundaries,
- versioned engine profiles,
- validation packets,
- planner-facing packages.

That is the architecture most likely to produce a durable, supportable, and commercially credible modeling platform.
