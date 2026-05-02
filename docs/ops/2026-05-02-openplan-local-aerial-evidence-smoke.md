# OpenPlan Local Aerial Evidence Smoke - 2026-05-02

## Command
- `cd qa-harness && npm run local-aerial-evidence-smoke`

## Local Targets
- App URL: http://localhost:3000
- Supabase URL: http://127.0.0.1:54321
- Local guard result: Local guard passed for local Aerial evidence smoke: app=http://localhost:3000, supabase=http://127.0.0.1:54321.

## Mutation Summary
- Refreshed the deterministic NCTC seed, scoped one deterministic local QA user to the NCTC workspace, created one project-linked mission, attached one AOI polygon, and created one ready evidence package.

## Cleanup / Idempotency Posture
- Before writing mission/package rows, the harness deletes prior harness-owned rows in the deterministic NCTC workspace/project whose mission title starts with `NCTC local Aerial evidence smoke` or package title starts with `NCTC local Aerial ready package`.
- Cleanup removed 1 mission(s) and 1 package(s).
- Post-cleanup exact seed expectation: 3 seeded missions and 2 seeded ready packages.
- Post-run exact expectation: 4 total missions and 3 ready packages.

## Key IDs
- QA user email: openplan-local-aerial-evidence-smoke@natfordplanning.com
- QA user id: 337cd457-0dcf-4e3a-a95c-9aeeeebfcb4e
- Workspace id: d0000001-0000-4000-8000-000000000001
- Project id: d0000001-0000-4000-8000-000000000003
- Mission id: a2fe755b-3f50-4e28-9c6e-e1caaf2e2bbe
- Evidence package id: 88b09689-77cd-41b8-8481-9ebb9fb241ab

## Boundary Notes
- Mission creation used `POST /api/aerial/missions`; AOI was attached with `PATCH /api/aerial/missions/[missionId]` because mission POST does not accept AOI geometry.
- `/api/map-features/aerial-missions` scopes by current authenticated workspace membership. The `workspaceId` query parameter in this smoke is operator traceability, not an authorization input.
- No project creation API was called. The harness verified exactly one canonical seeded NCTC project before writing mission/package rows.
- AOI boundary: small closed Polygon around Grass Valley / NCTC demo geography; coordinates are local proof geometry, not a legal survey boundary.

## Project Aerial Posture
- Before `projects.aerial_posture_updated_at`: 2026-05-01T23:50:12.561+00:00
- After `projects.aerial_posture_updated_at`: 2026-05-02T19:48:28.688+00:00

```json
{
  "missionCount": 4,
  "readyPackageCount": 3,
  "activeMissionCount": 1,
  "completeMissionCount": 3,
  "verificationReadiness": "partial"
}
```

## Count Summary
```json
{
  "preCleanup": {
    "missionCount": 4,
    "packageCount": 4,
    "readyPackageCount": 3
  },
  "removed": {
    "missions": 1,
    "packages": 1
  },
  "postCleanup": {
    "missionCount": 3,
    "packageCount": 3,
    "readyPackageCount": 2
  },
  "postMutation": {
    "missionCount": 4,
    "packageCount": 4,
    "readyPackageCount": 3
  }
}
```

## Map Feature Summary
```json
{
  "featureCount": 4,
  "missionId": "a2fe755b-3f50-4e28-9c6e-e1caaf2e2bbe",
  "projectId": "d0000001-0000-4000-8000-000000000003",
  "geometryType": "Polygon",
  "queryWorkspaceId": "d0000001-0000-4000-8000-000000000001",
  "scope": "current authenticated workspace membership; workspaceId query param is not trusted by the route"
}
```

## Pass/Fail Notes
- PASS: Local guard passed for local Aerial evidence smoke: app=http://localhost:3000, supabase=http://127.0.0.1:54321.
- PASS: Ran pnpm seed:nctc from openplan/ and refreshed the deterministic NCTC fixture.
- PASS: Cleaned stale harness aerial rows before mutation: 1 mission(s) and 1 package(s) removed.
- PASS: Updated deterministic QA auth user openplan-local-aerial-evidence-smoke@natfordplanning.com.
- PASS: Attached the QA user only to the seeded NCTC workspace.
- PASS: Verified exactly one canonical seeded NCTC project exists; no project creation API is called by this harness.
- PASS: Signed into the local app through Playwright as the scoped QA user.
- PASS: Verified the current session workspace resolves to the seeded NCTC workspace.
- PASS: Created one project-linked mission through POST /api/aerial/missions.
- PASS: Attached a closed Grass Valley/NCTC GeoJSON polygon through PATCH /api/aerial/missions/[missionId].
- PASS: Created one ready evidence package through POST /api/aerial/evidence-packages.
- PASS: Asserted projects.aerial_posture and projects.aerial_posture_updated_at updated on the same seeded project.
- PASS: Verified /api/map-features/aerial-missions returns a FeatureCollection containing the new mission AOI.
- PASS: Asserted /aerial renders the mission list with the new mission.
- PASS: Asserted mission detail renders package log, cached project posture, AOI state, and DJI export state.

## Artifacts
- docs/ops/2026-05-02-test-output/2026-05-02-local-aerial-evidence-smoke-01-aerial-list.png
- docs/ops/2026-05-02-test-output/2026-05-02-local-aerial-evidence-smoke-02-mission-detail.png

## Verdict
- PASS: Local Aerial evidence spine proof created a project-linked mission, attached AOI through the existing mission PATCH boundary, created a ready evidence package, verified same-project aerial posture write-back, rendered the Aerial list/detail surfaces, and confirmed the map AOI feature without duplicating the seeded NCTC project.
