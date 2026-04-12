# OpenPlan Production Grants Registry Smoke — 2026-04-12

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-prod-grants-smoke-2026-04-12T07-49-52-726Z@natfordplanning.com
- QA user id: unknown
- Workspace id: 476e254c-a781-476f-91c1-068b6774a977
- Bootstrapped workspace id: b53a361f-02b0-41ac-888b-72f3d7ae0708
- Project id: 45c0ce72-d048-4e7a-9109-b60c82f8599a
- Program id: a6ec6999-8c9e-4275-8273-f2b4482de496
- Opportunity id: 65b5fea5-42de-48b6-ae2c-40556a439809

## Pass/Fail Notes
- PASS: Created QA auth user openplan-prod-grants-smoke-2026-04-12T07-49-52-726Z@natfordplanning.com.
- PASS: Signed into production successfully.
- PASS: Bootstrapped workspace OpenPlan Prod Grants Smoke 07-49-52.
- PASS: Current workspace resolved to 476e254c-a781-476f-91c1-068b6774a977 instead of the freshly bootstrapped workspace b53a361f-02b0-41ac-888b-72f3d7ae0708; smoke data was aligned to the active workspace selection.
- PASS: Seeded linked project Grass Valley Safe Routes Smoke 07-49-52 inside the smoke workspace.
- PASS: Created production program ATP Grants Smoke 07-49-52.
- PASS: Grants registry rendered its empty state before the first opportunity was created.
- PASS: Created the first funding opportunity and confirmed the rendered grants surface picked it up with near-term queue pressure.
- PASS: Updated the opportunity decision to pursue directly from the grants registry row controls.
- PASS: Created a linked awarded opportunity so the shared award-conversion lane could take over.
- PASS: Created the lead funding award directly from `/grants` and cleared the award-conversion pressure for the smoke workspace.
- PASS: The workspace award stack surfaced the linked project with reimbursement posture immediately after the award was recorded.
- PASS: The grants registry linked back into the canonical program funding lane.

## Artifacts
- 2026-04-12-prod-grants-registry-01-registry.png
- 2026-04-12-prod-grants-registry-02-award-conversion.png
- 2026-04-12-prod-grants-registry-03-program-detail.png

## Verdict
- PASS: Production rendered smoke confirms the shared `/grants` workspace surface can create a funding opportunity, surface grants queue pressure, promote an opportunity into awarded status, create the committed funding award from the award-conversion lane, surface the workspace award-stack reimbursement posture, and still link back into the canonical program funding lane.
