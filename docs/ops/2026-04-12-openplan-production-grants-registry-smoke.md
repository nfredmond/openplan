# OpenPlan Production Grants Registry Smoke — 2026-04-12

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-prod-grants-smoke-2026-04-12T09-01-56-009Z@natfordplanning.com
- QA user id: unknown
- Workspace id: 866ec639-04f4-416d-bb75-03d358767bc1
- Bootstrapped workspace id: 2d2c220f-539e-4682-b62a-7225b08a4862
- Project id: f4a26b9f-3558-43a4-a616-1fa93d67ad78
- Program id: 4e4086bf-80fb-4c09-bda4-187d602a58fb
- Opportunity id: e36af4e9-2ff9-4edf-a08d-f4171d5a38be

## Pass/Fail Notes
- PASS: Created QA auth user openplan-prod-grants-smoke-2026-04-12T09-01-56-009Z@natfordplanning.com.
- PASS: Signed into production successfully.
- PASS: Bootstrapped workspace OpenPlan Prod Grants Smoke 09-01-56.
- PASS: Current workspace resolved to 866ec639-04f4-416d-bb75-03d358767bc1 instead of the freshly bootstrapped workspace 2d2c220f-539e-4682-b62a-7225b08a4862; smoke data was aligned to the active workspace selection.
- PASS: Seeded linked project Grass Valley Safe Routes Smoke 09-01-56 inside the smoke workspace.
- PASS: Created production program ATP Grants Smoke 09-01-56.
- PASS: Grants registry rendered its empty state before the first opportunity was created.
- PASS: Created the first funding opportunity and confirmed the rendered grants surface picked it up with near-term queue pressure.
- PASS: Updated the opportunity decision to pursue directly from the grants registry row controls.
- PASS: Created a linked awarded opportunity so the shared award-conversion lane could take over.
- PASS: Created the lead funding award directly from `/grants` and cleared the award-conversion pressure for the smoke workspace.
- PASS: The workspace award stack surfaced the linked project with reimbursement posture immediately after the award was recorded.
- PASS: Created the first award-linked reimbursement invoice directly from `/grants`, advanced the stack into drafting posture, and surfaced it in the workspace reimbursement queue.
- PASS: Advanced the reimbursement queue item in place from draft to internal review directly from `/grants`.
- PASS: Repaired an exact award relink directly from the shared grants queue without leaving `/grants`, and the queue now confirms the saved relink state inline.
- PASS: The grants reimbursement action landed directly on the project billing register anchor after direct invoice creation.
- PASS: The grants registry linked back into the canonical program funding lane.

## Artifacts
- 2026-04-12-prod-grants-registry-01-registry.png
- 2026-04-12-prod-grants-registry-02-award-conversion.png
- 2026-04-12-prod-grants-registry-03-reimbursement-creation.png
- 2026-04-12-prod-grants-registry-04-project-billing-register.png
- 2026-04-12-prod-grants-registry-05-program-detail.png

## Verdict
- PASS: Production rendered smoke confirms the shared `/grants` workspace surface can create a funding opportunity, surface grants queue pressure, promote an opportunity into awarded status, create the committed funding award from the award-conversion lane, start the first reimbursement invoice directly from the shared grants surface, advance that reimbursement queue item in place, repair an exact award relink from the shared queue with inline confirmation, land on the exact project billing register, and still link back into the canonical program funding lane.
