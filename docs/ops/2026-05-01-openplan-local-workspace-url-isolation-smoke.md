# OpenPlan Local Workspace URL Isolation Smoke — 2026-05-01

- Base URL: http://localhost:3000
- Fixture: /home/narford/.openclaw/workspace/openplan/qa-harness/fixtures/workspace-url-isolation.local.json
- Mutation posture: read-only browser navigation; no Supabase admin/service key used by this harness.

## Result
- PASS

## Notes
- Loaded fixture /home/narford/.openclaw/workspace/openplan/qa-harness/fixtures/workspace-url-isolation.local.json.
- Validated 2 synthetic users and 2 URL checks.
- Authenticated synthetic user workspaceA.
- Authenticated synthetic user workspaceB.
- Allowed-view pass: Synthetic Workspace A project detail is visible to workspaceA and blocked for workspaceB (workspaceA).
- Denied-view pass: Synthetic Workspace A project detail is visible to workspaceA and blocked for workspaceB (workspaceB).
- Session-continuity pass: workspaceB still loads own workspace URL after denial.
- Allowed-view pass: Synthetic Workspace B project detail is visible to workspaceB and blocked for workspaceA (workspaceB).
- Denied-view pass: Synthetic Workspace B project detail is visible to workspaceB and blocked for workspaceA (workspaceA).
- Session-continuity pass: workspaceA still loads own workspace URL after denial.

## Failures
- None

## Artifacts
- docs/ops/2026-05-01-test-output/2026-05-01-synthetic-workspace-a-project-detail-is-visible-to-workspacea-and-blocked-for-workspaceb-a.png
- docs/ops/2026-05-01-test-output/2026-05-01-synthetic-workspace-a-project-detail-is-visible-to-workspacea-and-blocked-for-workspaceb-d.png
- docs/ops/2026-05-01-test-output/2026-05-01-synthetic-workspace-a-project-detail-is-visible-to-workspacea-and-blocked-for-workspaceb-s.png
- docs/ops/2026-05-01-test-output/2026-05-01-synthetic-workspace-b-project-detail-is-visible-to-workspaceb-and-blocked-for-workspacea-a.png
- docs/ops/2026-05-01-test-output/2026-05-01-synthetic-workspace-b-project-detail-is-visible-to-workspaceb-and-blocked-for-workspacea-d.png
- docs/ops/2026-05-01-test-output/2026-05-01-synthetic-workspace-b-project-detail-is-visible-to-workspaceb-and-blocked-for-workspacea-s.png

## Preconditions
- Local app is running against local/synthetic Supabase data.
- Fixture users belong to different workspaces and use `passwordEnv` or Playwright `storageStatePath`; no real credentials are required.
- Fixture URLs point to records seeded in only one workspace so cross-user access can be verified without production mutation.
- Every denied user also has an own-workspace URL check, allowing the harness to prove denied navigation did not poison or switch that browser session.

