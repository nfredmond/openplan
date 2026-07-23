# OpenPlan ↔ Aerial `natford-aerial-processing.v1` — live end-to-end smoke (2026-07-23)

**Wave 6A.** First documented green run of the cross-app photogrammetry *processing*
contract: OpenPlan dispatches a mission to the Aerial Intel Platform, which runs a
**real NodeODM/OpenDroneMap reconstruction** and calls back, landing an OpenPlan
evidence package with real artifact URLs. (The prior `local-aerial-evidence-smoke`
only proved the OpenPlan evidence *spine* — mission→package→posture→UI — never this
cross-app loop.)

## Local topology (all reachable at once)
- OpenPlan app: `http://localhost:3000` (Supabase `:54321`)
- Aerial Intel Platform app: `http://localhost:3100` (Supabase `:55321`)
- NodeODM: `http://localhost:3101` (`AERIAL_NODEODM_MODE=real`, NodeODM 2.2.4 / ODM 3.5.6, 24 cores)
- Token pairs value-matched on both sides; aerial org slug `gv-ops`; storage bucket `drone-ops`.

## Imagery
16 real drone images (`DSC00229.JPG`…, 107 MB) — reused from the NodeODM instance's
prior proven task `b2687bdf`, zipped and served at `http://127.0.0.1:8099/openplan-smoke-imagery.zip`
(the OpenPlan `/process` route allows `http` for localhost).

## Drive sequence (each step verified live)
1. **OpenPlan POST `/api/aerial/missions/<id>/process`** (authed QA member, `presetId: fast-preview`)
   → **HTTP 202 accepted**. `requestId=cd9f7a20-246b-49ff-ba12-77481a0eb2eb`,
   `jobReference=58b46673-5ebe-4f23-b4e4-c7ae1e45e366`. OpenPlan `aerial_processing_jobs` row → `accepted`.
2. **Aerial `GET /api/internal/external-ingest`** (Bearer CRON_SECRET) → fetched the ZIP,
   extracted 16 images to `drone-ops` storage, created NodeODM task `8dd5e225-725b-48e1-a4dd-c110e5ed80b7`,
   delivered a `running` callback. Job → `running` / `intake_review`.
3. **Aerial `GET /api/internal/nodeodm-upload`** → uploaded 16/16 images + committed the NodeODM task (one call).
4. **Aerial `GET /api/internal/nodeodm-poll`** (looped) → NodeODM ran the real reconstruction
   (~90 s across polls), reached ODM status **COMPLETED (40)**, imported outputs to `drone-ops`,
   set the job `succeeded` / `complete`, and delivered the terminal **`succeeded`** callback.

## Result — PASS
- **Aerial `drone_processing_jobs`**: `status=succeeded`, `stage=complete`. Ledger
  `drone_external_processing_requests`: `status=completed`, `last_callback_status=succeeded`, progress 100, no errors.
- **Aerial `drone_processing_outputs`** (`status=ready`), copied to Supabase storage:
  - `orthomosaic` → `gv-ops/jobs/<job>/outputs/orthomosaic/odm_orthophoto.tif` (~25.6 MB, image/tiff)
  - `point_cloud` → `gv-ops/jobs/<job>/outputs/point_cloud/odm_georeferenced_model.laz` (application/vnd.las)
- **OpenPlan `aerial_processing_callbacks`** ledger: 5×`running` + 1×`succeeded` (idempotent, terminal status preserved).
- **OpenPlan `aerial_processing_jobs`**: `status=succeeded`.
- **OpenPlan `aerial_evidence_packages`**: 1 row created — "Wave6A Smoke Mission aerial processing outputs",
  `package_type=measurable_output`, `status=ready`, linked to the processing job. Job `artifacts` carried both
  outputs as **24 h signed Supabase download URLs** (tokens redacted here).

## Honesty / posture notes
- Wave 6B moved the cached aerial posture into `aerial_project_posture`; that migration was **not** applied to
  the running OpenPlan DB during this smoke, so the callback's best-effort posture rebuild would no-op/log — it
  does **not** gate evidence-package creation (created before the rebuild). The core contract loop is independent of Wave 6B.
- Artifact URLs are signed, short-TTL, localhost storage — screening/demonstration artifacts, not published deliverables.

## Cleanup
All smoke rows removed from both DBs (OpenPlan: evidence package, callback ledger, job, mission, project,
workspace, membership, QA user; Aerial: external-request/job/mission/dataset/ingest/outputs/events + storage
objects), NodeODM smoke task `8dd5e225` removed (the borrowed source task `b2687bdf` left intact), imagery
server stopped. Verified by re-query (0 rows).
