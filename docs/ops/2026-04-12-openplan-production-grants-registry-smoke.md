# OpenPlan Production Grants Registry Smoke — 2026-04-12

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-prod-grants-smoke-2026-04-12T08-47-02-740Z@natfordplanning.com
- QA user id: unknown
- Workspace id: 90318257-e556-407f-a037-094778854cb0
- Bootstrapped workspace id: d3605ea7-3439-410f-9a10-8ed5aa4e9cc7
- Project id: cd95fe50-b831-4f8f-9813-3ed973a428a2
- Program id: 39759a37-0da5-4a19-8146-e03944f3b015
- Opportunity id: 516fcf4d-50b4-44d8-9791-3fb4b138b6df

## Pass/Fail Notes
- PASS: Created QA auth user openplan-prod-grants-smoke-2026-04-12T08-47-02-740Z@natfordplanning.com.
- PASS: Signed into production successfully.
- PASS: Bootstrapped workspace OpenPlan Prod Grants Smoke 08-47-02.
- PASS: Current workspace resolved to 90318257-e556-407f-a037-094778854cb0 instead of the freshly bootstrapped workspace d3605ea7-3439-410f-9a10-8ed5aa4e9cc7; smoke data was aligned to the active workspace selection.
- PASS: Seeded linked project Grass Valley Safe Routes Smoke 08-47-02 inside the smoke workspace.
- PASS: Created production program ATP Grants Smoke 08-47-02.
- PASS: Grants registry rendered its empty state before the first opportunity was created.
- PASS: Created the first funding opportunity and confirmed the rendered grants surface picked it up with near-term queue pressure.
- PASS: Updated the opportunity decision to pursue directly from the grants registry row controls.
- PASS: Created a linked awarded opportunity so the shared award-conversion lane could take over.
- PASS: Created the lead funding award directly from `/grants` and cleared the award-conversion pressure for the smoke workspace.
- PASS: The workspace award stack surfaced the linked project with reimbursement posture immediately after the award was recorded.
- PASS: Created the first award-linked reimbursement invoice directly from `/grants`, advanced the stack into drafting posture, and surfaced it in the workspace reimbursement queue.
- PASS: Advanced the reimbursement queue item in place from draft to internal review directly from `/grants`.
- PASS: Repaired an exact award relink directly from the shared grants queue without leaving `/grants`.
- PASS: The grants reimbursement action landed directly on the project billing register anchor after direct invoice creation.
- PASS: The grants registry linked back into the canonical program funding lane.

## Artifacts
- 2026-04-12-prod-grants-registry-01-registry.png
- 2026-04-12-prod-grants-registry-02-award-conversion.png
- 2026-04-12-prod-grants-registry-03-reimbursement-creation.png
- 2026-04-12-prod-grants-registry-04-project-billing-register.png
- 2026-04-12-prod-grants-registry-05-program-detail.png

## Verdict
- PASS: Production rendered smoke confirms the shared `/grants` workspace surface can create a funding opportunity, surface grants queue pressure, promote an opportunity into awarded status, create the committed funding award from the award-conversion lane, start the first reimbursement invoice directly from the shared grants surface, advance that reimbursement queue item in place, repair an exact award relink from the shared queue, land on the exact project billing register, and still link back into the canonical program funding lane.
