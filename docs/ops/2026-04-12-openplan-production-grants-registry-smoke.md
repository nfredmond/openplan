# OpenPlan Production Grants Registry Smoke — 2026-04-12

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-prod-grants-smoke-2026-04-12T10-03-37-753Z@natfordplanning.com
- QA user id: unknown
- Workspace id: 117d79d8-61fd-4196-b4cb-a908a67cc021
- Bootstrapped workspace id: dcd42fbc-3e10-498a-ad81-4747826db562
- Project id: c06dd1fc-f291-4793-b0fe-63bf8b7474e6
- Program id: aaaa8191-c3aa-425e-aad3-95418cb999cb
- Opportunity id: dab1ae75-750a-41b9-8389-31214d637c20

## Pass/Fail Notes
- PASS: Created QA auth user openplan-prod-grants-smoke-2026-04-12T10-03-37-753Z@natfordplanning.com.
- PASS: Signed into production successfully.
- PASS: Bootstrapped workspace OpenPlan Prod Grants Smoke 10-03-37.
- PASS: Current workspace resolved to 117d79d8-61fd-4196-b4cb-a908a67cc021 instead of the freshly bootstrapped workspace dcd42fbc-3e10-498a-ad81-4747826db562; smoke data was aligned to the active workspace selection.
- PASS: Seeded linked project Grass Valley Safe Routes Smoke 10-03-37 inside the smoke workspace and anchored its funding profile for downstream reimbursement commands.
- PASS: Created production program ATP Grants Smoke 10-03-37.
- PASS: Grants registry rendered its empty state before the first opportunity was created.
- PASS: Created the first funding opportunity and confirmed the rendered grants surface picked it up with near-term queue pressure.
- PASS: Updated the opportunity decision to pursue directly from the grants registry row controls.
- PASS: Created a linked awarded opportunity so the shared award-conversion lane could take over.
- PASS: Created the lead funding award directly from `/grants` and cleared the award-conversion pressure for the smoke workspace.
- PASS: The workspace award stack surfaced the linked project with reimbursement posture immediately after the award was recorded.
- PASS: The grants workspace command queue now retargets the inline reimbursement composer to the exact project it flagged for packet start.
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
