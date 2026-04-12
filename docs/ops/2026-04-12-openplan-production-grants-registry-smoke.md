# OpenPlan Production Grants Registry Smoke — 2026-04-12

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-prod-grants-smoke-2026-04-12T07-05-49-248Z@natfordplanning.com
- QA user id: unknown
- Workspace id: 07741dac-7f77-4b45-acdb-337b1d3ad28a
- Program id: 516a1fa3-3099-40d4-842b-a0290186886f

## Pass/Fail Notes
- PASS: Created QA auth user openplan-prod-grants-smoke-2026-04-12T07-05-49-248Z@natfordplanning.com.
- PASS: Signed into production successfully.
- PASS: Bootstrapped workspace OpenPlan Prod Grants Smoke 07-05-49.
- PASS: Created production program ATP Grants Smoke 07-05-49.
- PASS: Grants registry rendered its empty state before the first opportunity was created.
- PASS: Created the first funding opportunity from the shared grants surface and confirmed the workspace grants queue surfaced the near-term deadline command.
- PASS: Updated the opportunity decision to pursue directly from the grants registry row controls.
- PASS: The grants registry linked back into the canonical program funding lane.

## Artifacts
- 2026-04-12-prod-grants-registry-01-registry.png
- 2026-04-12-prod-grants-registry-02-program-detail.png

## Verdict
- PASS: Production rendered smoke confirms the new `/grants` workspace surface can create a funding opportunity, surface the shared grants queue, update pursue posture, and link back into the canonical funding lane.

## Notes
- Proof required a fresh manual production deploy because the active production aliases were still pinned to an older build that predated `/grants`.
- After the manual deploy, `openplan-natford.vercel.app` and `openplan-git-main-natford.vercel.app` were explicitly re-pointed to the fresh deployment before the final smoke run.
