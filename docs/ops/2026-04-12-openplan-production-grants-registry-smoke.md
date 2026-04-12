# OpenPlan Production Grants Registry Smoke — 2026-04-12

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-prod-grants-smoke-2026-04-12T08-10-26-100Z@natfordplanning.com
- QA user id: unknown
- Workspace id: 43006643-31bd-4282-b314-e0f01485f8e6
- Bootstrapped workspace id: d7790098-9c0f-4dea-aab9-f7108a2273b9
- Project id: 7695f151-1b85-4103-bb0d-b2e403a3b7e1
- Program id: 2370b057-e3dd-42f8-a805-7ee327f411cb
- Opportunity id: 8b571542-afb0-4414-8658-c79d7f196902

## Pass/Fail Notes
- PASS: Created QA auth user openplan-prod-grants-smoke-2026-04-12T08-10-26-100Z@natfordplanning.com.
- PASS: Signed into production successfully.
- PASS: Bootstrapped workspace OpenPlan Prod Grants Smoke 08-10-26.
- PASS: Current workspace resolved to 43006643-31bd-4282-b314-e0f01485f8e6 instead of the freshly bootstrapped workspace d7790098-9c0f-4dea-aab9-f7108a2273b9; smoke data was aligned to the active workspace selection.
- PASS: Seeded linked project Grass Valley Safe Routes Smoke 08-10-26 inside the smoke workspace.
- PASS: Created production program ATP Grants Smoke 08-10-26.
- PASS: Grants registry rendered its empty state before the first opportunity was created.
- PASS: Created the first funding opportunity and confirmed the rendered grants surface picked it up with near-term queue pressure.
- PASS: Updated the opportunity decision to pursue directly from the grants registry row controls.
- PASS: Created a linked awarded opportunity so the shared award-conversion lane could take over.
- PASS: Created the lead funding award directly from `/grants` and cleared the award-conversion pressure for the smoke workspace.
- PASS: The workspace award stack surfaced the linked project with reimbursement posture immediately after the award was recorded.
- PASS: Created the first award-linked reimbursement invoice directly from `/grants` and advanced the stack into drafting posture.
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
