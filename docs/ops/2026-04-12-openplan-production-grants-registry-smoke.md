# OpenPlan Production Grants Registry Smoke — 2026-04-12

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-prod-grants-smoke-2026-04-12T08-18-30-980Z@natfordplanning.com
- QA user id: unknown
- Workspace id: 2e9c19d1-4d78-42d9-928a-af1d4053df2a
- Bootstrapped workspace id: 4a6fb5b0-1453-49e1-b250-a7c1f53be31f
- Project id: 6166f382-59fd-4ef3-9508-92e1c42aad67
- Program id: 5c0cbb79-2b09-4d50-b003-7ba3e43d1b65
- Opportunity id: 41d5488e-c42a-4bc6-9f36-25d3f14bda18

## Pass/Fail Notes
- PASS: Created QA auth user openplan-prod-grants-smoke-2026-04-12T08-18-30-980Z@natfordplanning.com.
- PASS: Signed into production successfully.
- PASS: Bootstrapped workspace OpenPlan Prod Grants Smoke 08-18-30.
- PASS: Current workspace resolved to 2e9c19d1-4d78-42d9-928a-af1d4053df2a instead of the freshly bootstrapped workspace 4a6fb5b0-1453-49e1-b250-a7c1f53be31f; smoke data was aligned to the active workspace selection.
- PASS: Seeded linked project Grass Valley Safe Routes Smoke 08-18-30 inside the smoke workspace.
- PASS: Created production program ATP Grants Smoke 08-18-30.
- PASS: Grants registry rendered its empty state before the first opportunity was created.
- PASS: Created the first funding opportunity and confirmed the rendered grants surface picked it up with near-term queue pressure.
- PASS: Updated the opportunity decision to pursue directly from the grants registry row controls.
- PASS: Created a linked awarded opportunity so the shared award-conversion lane could take over.
- PASS: Created the lead funding award directly from `/grants` and cleared the award-conversion pressure for the smoke workspace.
- PASS: The workspace award stack surfaced the linked project with reimbursement posture immediately after the award was recorded.
- PASS: Created the first award-linked reimbursement invoice directly from `/grants`, advanced the stack into drafting posture, and surfaced it in the workspace reimbursement queue.
- PASS: The grants reimbursement action landed directly on the project billing register anchor after direct invoice creation.
- PASS: The grants registry linked back into the canonical program funding lane.

## Artifacts
- 2026-04-12-prod-grants-registry-01-registry.png
- 2026-04-12-prod-grants-registry-02-award-conversion.png
- 2026-04-12-prod-grants-registry-03-reimbursement-creation.png
- 2026-04-12-prod-grants-registry-04-project-billing-register.png
- 2026-04-12-prod-grants-registry-05-program-detail.png

## Verdict
- PASS: Production rendered smoke confirms the shared `/grants` workspace surface can create a funding opportunity, surface grants queue pressure, promote an opportunity into awarded status, create the committed funding award from the award-conversion lane, start the first reimbursement invoice directly from the shared grants surface, land on the exact project billing register, and still link back into the canonical program funding lane.
