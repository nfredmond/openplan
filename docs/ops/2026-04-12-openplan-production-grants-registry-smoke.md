# OpenPlan Production Grants Registry Smoke — 2026-04-12

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-prod-grants-smoke-2026-04-12T08-00-48-179Z@natfordplanning.com
- QA user id: unknown
- Workspace id: 2a78d490-9470-4c64-bfa5-75be037fc373
- Bootstrapped workspace id: 4426aa7f-7dd3-405b-a696-ccaeb55f5bee
- Project id: c72af00a-1c2b-4fa2-b141-3b467568161f
- Program id: 6a304b6a-966e-40e8-8fc1-d55db638266d
- Opportunity id: 4cfbd99c-d867-49ba-b2d2-974b392fcf12

## Pass/Fail Notes
- PASS: Created QA auth user openplan-prod-grants-smoke-2026-04-12T08-00-48-179Z@natfordplanning.com.
- PASS: Signed into production successfully.
- PASS: Bootstrapped workspace OpenPlan Prod Grants Smoke 08-00-48.
- PASS: Current workspace resolved to 2a78d490-9470-4c64-bfa5-75be037fc373 instead of the freshly bootstrapped workspace 4426aa7f-7dd3-405b-a696-ccaeb55f5bee; smoke data was aligned to the active workspace selection.
- PASS: Seeded linked project Grass Valley Safe Routes Smoke 08-00-48 inside the smoke workspace.
- PASS: Created production program ATP Grants Smoke 08-00-48.
- PASS: Grants registry rendered its empty state before the first opportunity was created.
- PASS: Created the first funding opportunity and confirmed the rendered grants surface picked it up with near-term queue pressure.
- PASS: Updated the opportunity decision to pursue directly from the grants registry row controls.
- PASS: Created a linked awarded opportunity so the shared award-conversion lane could take over.
- PASS: Created the lead funding award directly from `/grants` and cleared the award-conversion pressure for the smoke workspace.
- PASS: The workspace award stack surfaced the linked project with reimbursement posture immediately after the award was recorded.
- PASS: The grants reimbursement action landed directly on the project billing register anchor.
- PASS: The grants registry linked back into the canonical program funding lane.

## Artifacts
- 2026-04-12-prod-grants-registry-01-registry.png
- 2026-04-12-prod-grants-registry-02-award-conversion.png
- 2026-04-12-prod-grants-registry-03-project-billing-register.png
- 2026-04-12-prod-grants-registry-04-program-detail.png

## Verdict
- PASS: Production rendered smoke confirms the shared `/grants` workspace surface can create a funding opportunity, surface grants queue pressure, promote an opportunity into awarded status, create the committed funding award from the award-conversion lane, surface the workspace award-stack reimbursement posture, and still link back into the canonical program funding lane.
