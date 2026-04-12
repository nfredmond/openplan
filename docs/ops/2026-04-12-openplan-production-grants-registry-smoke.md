# OpenPlan Production Grants Registry Smoke — 2026-04-12

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-prod-grants-smoke-2026-04-12T07-36-58-206Z@natfordplanning.com
- QA user id: unknown
- Workspace id: d64f768d-729c-40f5-9765-4a1ff0d088e2
- Bootstrapped workspace id: 599a3be2-25de-4dc9-8e6f-cc6c6101584c
- Project id: 3eaff645-254c-4b1c-b4e1-2ceeedbd7f65
- Program id: 80aa87f3-d619-48e1-aadd-599871fac763
- Opportunity id: cade62d9-1267-4255-8e4d-2846c4e4210b

## Pass/Fail Notes
- PASS: Created QA auth user openplan-prod-grants-smoke-2026-04-12T07-36-58-206Z@natfordplanning.com.
- PASS: Signed into production successfully.
- PASS: Bootstrapped workspace OpenPlan Prod Grants Smoke 07-36-58.
- PASS: Current workspace resolved to d64f768d-729c-40f5-9765-4a1ff0d088e2 instead of the freshly bootstrapped workspace 599a3be2-25de-4dc9-8e6f-cc6c6101584c; smoke data was aligned to the active workspace selection.
- PASS: Seeded linked project Grass Valley Safe Routes Smoke 07-36-58 inside the smoke workspace.
- PASS: Created production program ATP Grants Smoke 07-36-58.
- PASS: Grants registry rendered its empty state before the first opportunity was created.
- PASS: Created the first funding opportunity and confirmed the rendered grants surface picked it up with near-term queue pressure.
- PASS: Updated the opportunity decision to pursue directly from the grants registry row controls.
- PASS: Created a linked awarded opportunity so the shared award-conversion lane could take over.
- PASS: Created the lead funding award directly from `/grants` and cleared the award-conversion pressure for the smoke workspace.
- PASS: The grants registry linked back into the canonical program funding lane.

## Artifacts
- 2026-04-12-prod-grants-registry-01-registry.png
- 2026-04-12-prod-grants-registry-02-award-conversion.png
- 2026-04-12-prod-grants-registry-03-program-detail.png

## Verdict
- PASS: Production rendered smoke confirms the shared `/grants` workspace surface can create a funding opportunity, surface grants queue pressure, promote an opportunity into awarded status, create the committed funding award from the award-conversion lane, and still link back into the canonical program funding lane.
