# OpenPlan Production Grants Registry Smoke — 2026-04-12

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-prod-grants-smoke-2026-04-12T08-26-01-117Z@natfordplanning.com
- QA user id: unknown
- Workspace id: cd769dd6-61a5-4adf-9e21-740242d761f5
- Bootstrapped workspace id: 55563fb8-31b1-4444-a217-95132c4f54f8
- Project id: c04b7452-99c8-4c34-8913-9c4aab3fc280
- Program id: 709a41b5-562e-49c4-aba7-d8a5b917f29e
- Opportunity id: c1e969fd-8429-4814-9112-66422ad621cf

## Pass/Fail Notes
- PASS: Created QA auth user openplan-prod-grants-smoke-2026-04-12T08-26-01-117Z@natfordplanning.com.
- PASS: Signed into production successfully.
- PASS: Bootstrapped workspace OpenPlan Prod Grants Smoke 08-26-01.
- PASS: Current workspace resolved to cd769dd6-61a5-4adf-9e21-740242d761f5 instead of the freshly bootstrapped workspace 55563fb8-31b1-4444-a217-95132c4f54f8; smoke data was aligned to the active workspace selection.
- PASS: Seeded linked project Grass Valley Safe Routes Smoke 08-26-01 inside the smoke workspace.
- PASS: Created production program ATP Grants Smoke 08-26-01.
- PASS: Grants registry rendered its empty state before the first opportunity was created.
- PASS: Created the first funding opportunity and confirmed the rendered grants surface picked it up with near-term queue pressure.
- PASS: Updated the opportunity decision to pursue directly from the grants registry row controls.
- PASS: Created a linked awarded opportunity so the shared award-conversion lane could take over.
- PASS: Created the lead funding award directly from `/grants` and cleared the award-conversion pressure for the smoke workspace.
- PASS: The workspace award stack surfaced the linked project with reimbursement posture immediately after the award was recorded.
- PASS: Created the first award-linked reimbursement invoice directly from `/grants`, advanced the stack into drafting posture, and surfaced it in the workspace reimbursement queue.
- PASS: Advanced the reimbursement queue item in place from draft to internal review directly from `/grants`.
- PASS: The grants reimbursement action landed directly on the project billing register anchor after direct invoice creation.
- PASS: The grants registry linked back into the canonical program funding lane.

## Artifacts
- 2026-04-12-prod-grants-registry-01-registry.png
- 2026-04-12-prod-grants-registry-02-award-conversion.png
- 2026-04-12-prod-grants-registry-03-reimbursement-creation.png
- 2026-04-12-prod-grants-registry-04-project-billing-register.png
- 2026-04-12-prod-grants-registry-05-program-detail.png

## Verdict
- PASS: Production rendered smoke confirms the shared `/grants` workspace surface can create a funding opportunity, surface grants queue pressure, promote an opportunity into awarded status, create the committed funding award from the award-conversion lane, start the first reimbursement invoice directly from the shared grants surface, advance that reimbursement queue item in place, land on the exact project billing register, and still link back into the canonical program funding lane.
