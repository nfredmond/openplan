# OpenPlan Local Aerial Evidence Smoke - 2026-08-24

## Command
- `cd qa-harness && npm run local-aerial-evidence-smoke`

## Local Targets
- App URL: http://localhost:3200
- Supabase URL: http://127.0.0.1:54321
- Local guard result: Local guard passed for local Aerial evidence smoke: app=http://localhost:3200, supabase=http://127.0.0.1:54321.

## Provisioning Posture
- **Self-provisioning.** No checked-in fixture is read. One auth user is created, the `on_auth_user_created` trigger provisions its workspace, and every mission, AOI, and package asserted on below was written by the aerial route a planner would use.
- **Place-neutral.** Geography labels are generic and the AOI polygon is anchored on a deliberately meaningless origin (0°, 0°), so proof geometry can never be mistaken for a real survey boundary.
- **Hermetic.** Each run works in a workspace that did not exist a moment earlier, so there is nothing to clean up between runs and no shared state with any other smoke.

## Cleanup / Idempotency Posture
- None required. The old version had to delete its own prior rows out of a shared seeded workspace; a per-run workspace removes that class of problem entirely. Local QA users and their workspaces accumulate until the local database is reset.

## Count Expectations
- Baseline established through the API: 2 missions, 1 ready package.
- Post-mutation expectation: 3 missions, 2 ready packages.

## Key IDs
- QA user email: openplan-local-aerial-evidence-smoke-2026-08-24T18-23-45-798Z@example.invalid
- QA user id: 6e1fb08e-5a53-4154-bb91-6b489ea8a47e
- Workspace id: 041de885-a131-4eec-b5fc-08b962122768
- Project id: c4dcc497-2910-49b1-8b95-17b191738b54
- Baseline mission ids: 07cc4d6d-830e-4f01-b510-9b0768132865, ae3afa25-064e-4aec-902c-acfff712fcdf
- Baseline package ids: 9480c39a-b6e1-42b8-a2bb-2d637c04c843
- Proof mission id: 8519a113-c3a2-4ff5-aab3-1ce41fbc637e
- Proof evidence package id: f2c7483d-7afc-43b6-9f4a-6099b67cc24e

## Boundary Notes
- Mission creation used `POST /api/aerial/missions`; the AOI was attached with `PATCH /api/aerial/missions/[missionId]` because mission POST does not accept AOI geometry.
- `/api/map-features/aerial-missions` scopes by current authenticated workspace membership, not by any client-supplied workspace id.
- The AOI is a small closed synthetic Polygon, not a legal survey boundary, and not anywhere.
- The project count is asserted before and after every aerial write. The previous version instead forbade the harness from calling project routes; asserting the count tests the product invariant rather than the harness discipline.

## Project Aerial Posture
- Before `aerial_project_posture.updated_at`: 2026-08-24T18:23:52.066+00:00
- After `aerial_project_posture.updated_at`: 2026-08-24T18:23:53.266+00:00

```json
{
  "missionCount": 3,
  "readyPackageCount": 2,
  "activeMissionCount": 1,
  "completeMissionCount": 2,
  "verificationReadiness": "ready"
}
```

## Count Summary
```json
{
  "baseline": {
    "missionCount": 2,
    "packageCount": 1,
    "readyPackageCount": 1
  },
  "postMutation": {
    "missionCount": 3,
    "packageCount": 2,
    "readyPackageCount": 2
  }
}
```

## Map Feature Summary
```json
{
  "featureCount": 1,
  "missionId": "8519a113-c3a2-4ff5-aab3-1ce41fbc637e",
  "projectId": "c4dcc497-2910-49b1-8b95-17b191738b54",
  "geometryType": "Polygon",
  "scope": "current authenticated workspace membership"
}
```

## Pass/Fail Notes
- PASS: Local guard passed for local Aerial evidence smoke: app=http://localhost:3200, supabase=http://127.0.0.1:54321.
- PASS: Created one fresh QA auth user (openplan-local-aerial-evidence-smoke-2026-08-24T18-23-45-798Z@example.invalid); this run reads no pre-existing fixture data.
- PASS: Signed into the local app through the real sign-in form.
- PASS: Created exactly one project in the auto-provisioned workspace and verified the session resolves to it.
- PASS: Established a baseline of 2 missions and 1 ready package through the aerial routes, and verified the cached posture matched it exactly.
- PASS: Created one project-linked mission through POST /api/aerial/missions.
- PASS: Attached a closed synthetic GeoJSON polygon through PATCH /api/aerial/missions/[missionId].
- PASS: Created one ready evidence package through POST /api/aerial/evidence-packages.
- PASS: Asserted aerial_project_posture.posture and .updated_at were rewritten for exactly this project.
- PASS: Verified the workspace still holds exactly one project after every aerial write — the module minted none.
- PASS: Verified /api/map-features/aerial-missions returns a FeatureCollection containing the new mission AOI.
- PASS: Asserted /aerial renders the mission list and the normal-path aerial layer panel.
- PASS: Asserted mission detail renders package log, cached project posture, AOI state, and DJI export state without the shell map dock covering its evidence sidebar.
- PASS: Asserted the mission detail has no horizontal overflow at 390 x 844.
- PASS: Read the browser console and found no console errors or uncaught page errors.

## Artifacts
- docs/ops/2026-08-24-test-output/2026-08-24-local-aerial-evidence-smoke-01-aerial-list.png
- docs/ops/2026-08-24-test-output/2026-08-24-local-aerial-evidence-smoke-02-mission-detail.png
- docs/ops/2026-08-24-test-output/2026-08-24-local-aerial-evidence-smoke-03-mission-detail-narrow.png

## Verdict
- PASS: The smoke created one project fixture through the project route, established a known baseline through the aerial routes, created a project-linked mission, attached an AOI through the mission PATCH boundary, created a ready evidence package, verified the cached project posture was rewritten to the baseline-plus-one counts, rendered the Aerial list and detail surfaces including the DJI export affordance, confirmed the map AOI feature, and left the workspace with exactly one project.
