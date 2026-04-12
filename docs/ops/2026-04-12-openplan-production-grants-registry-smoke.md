# OpenPlan Production Grants Registry Smoke — 2026-04-12

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-prod-grants-smoke-2026-04-12T09-55-30-417Z@natfordplanning.com
- QA user id: unknown
- Workspace id: 793ef22b-060c-49e9-b5bf-7a9d64c24b6c
- Bootstrapped workspace id: a72ac23e-4037-480d-a553-74a395450fe5
- Project id: 97b856aa-b008-4880-8fbe-22f8f17d7b7c
- Program id: 9c47a23e-dfa0-4db2-b791-fed3bdd308ac
- Opportunity id: 63c146eb-b8ff-429c-b761-acb70bab15af

## Pass/Fail Notes
- PASS: Created QA auth user openplan-prod-grants-smoke-2026-04-12T09-55-30-417Z@natfordplanning.com.
- PASS: Signed into production successfully.
- PASS: Bootstrapped workspace OpenPlan Prod Grants Smoke 09-55-30.
- PASS: Current workspace resolved to 793ef22b-060c-49e9-b5bf-7a9d64c24b6c instead of the freshly bootstrapped workspace a72ac23e-4037-480d-a553-74a395450fe5; smoke data was aligned to the active workspace selection.
- PASS: Seeded linked project Grass Valley Safe Routes Smoke 09-55-30 inside the smoke workspace and anchored its funding profile for downstream reimbursement commands.
- PASS: Created production program ATP Grants Smoke 09-55-30.
- PASS: Grants registry rendered its empty state before the first opportunity was created.
- PASS: Created the first funding opportunity and confirmed the rendered grants surface picked it up with near-term queue pressure.
- PASS: Updated the opportunity decision to pursue directly from the grants registry row controls.
- PASS: Created a linked awarded opportunity so the shared award-conversion lane could take over.
- PASS: Created the lead funding award directly from `/grants` and cleared the award-conversion pressure for the smoke workspace.
- PASS: The workspace award stack surfaced the linked project with reimbursement posture immediately after the award was recorded.
- PASS: Created the first award-linked reimbursement invoice directly from `/grants`, advanced the stack into drafting posture, and surfaced it in the workspace reimbursement queue with a direct billing triage handoff.
- PASS: Advanced the reimbursement queue item in place from draft to internal review directly from `/grants`.
- PASS: The grants workspace command queue now routes reimbursement follow-through commands to the exact billing triage row when one active invoice is actionable.
- PASS: The workspace award stack now routes directly to the exact billing triage row when there is a single active reimbursement record.
- PASS: The grants workspace command queue also surfaces the exact billing triage row for an invoice that needs award relink.
- PASS: Repaired an exact award relink directly from the shared grants queue without leaving `/grants`, and the queue now confirms the saved relink state inline.
- PASS: The grants reimbursement queue now lands on the exact billing triage row instead of a generic project billing anchor.
- PASS: The grants registry linked back into the canonical program funding lane.

## Artifacts
- 2026-04-12-prod-grants-registry-01-registry.png
- 2026-04-12-prod-grants-registry-02-award-conversion.png
- 2026-04-12-prod-grants-registry-03-reimbursement-creation.png
- 2026-04-12-prod-grants-registry-04-project-billing-register.png
- 2026-04-12-prod-grants-registry-05-program-detail.png

## Verdict
- PASS: Production rendered smoke confirms the shared `/grants` workspace surface can create a funding opportunity, surface grants queue pressure, promote an opportunity into awarded status, create the committed funding award from the award-conversion lane, start the first reimbursement invoice directly from the shared grants surface, route both the workspace grants queue and the award-stack CTA to the exact billing triage row when there is one active invoice, advance that reimbursement queue item in place, surface the exact billing triage row from the workspace command queue when an invoice needs award relink, repair that exact award relink from the shared queue with inline confirmation, land on the exact billing triage row, and still link back into the canonical program funding lane.
