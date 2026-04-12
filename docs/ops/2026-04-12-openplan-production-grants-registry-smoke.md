# OpenPlan Production Grants Registry Smoke — 2026-04-12

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-prod-grants-smoke-2026-04-12T10-11-30-719Z@natfordplanning.com
- QA user id: unknown
- Workspace id: 4763c6c1-b98f-4bd6-aacb-4de41b7b4c54
- Bootstrapped workspace id: 62c1373b-019d-44b7-9e30-5125001bb22b
- Project id: 46ac5176-059e-4864-a896-d308d0497ffa
- Program id: c9f02c7f-d064-47c4-8629-19e42caab372
- Opportunity id: a4ad0c2b-16e0-45f3-a065-d927ceea7ef5

## Pass/Fail Notes
- PASS: Created QA auth user openplan-prod-grants-smoke-2026-04-12T10-11-30-719Z@natfordplanning.com.
- PASS: Signed into production successfully.
- PASS: Bootstrapped workspace OpenPlan Prod Grants Smoke 10-11-30.
- PASS: Current workspace resolved to 4763c6c1-b98f-4bd6-aacb-4de41b7b4c54 instead of the freshly bootstrapped workspace 62c1373b-019d-44b7-9e30-5125001bb22b; smoke data was aligned to the active workspace selection.
- PASS: Seeded linked project Grass Valley Safe Routes Smoke 10-11-30 inside the smoke workspace and anchored its funding profile for downstream reimbursement commands.
- PASS: Created production program ATP Grants Smoke 10-11-30.
- PASS: Grants registry rendered its empty state before the first opportunity was created.
- PASS: Created the first funding opportunity and confirmed the rendered grants surface picked it up with near-term queue pressure.
- PASS: Updated the opportunity decision to pursue directly from the grants registry row controls.
- PASS: Created a linked awarded opportunity so the shared award-conversion lane could take over.
- PASS: The grants workspace command queue now retargets the inline award conversion creator to the exact opportunity it flagged for committed-award recording.
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
- PASS: Production rendered smoke confirms the shared `/grants` workspace surface can create a funding opportunity, surface grants queue pressure, retarget the inline award conversion creator to the exact opportunity flagged by the workspace command queue, create the committed funding award from that focused award-conversion lane, retarget the inline reimbursement composer to the exact project flagged for packet start, start the first reimbursement invoice directly from the shared grants surface, route both the workspace grants queue and the award-stack CTA to the exact billing triage row when there is one active invoice, advance that reimbursement queue item in place, surface the exact billing triage row from the workspace command queue when an invoice needs award relink, repair that exact award relink from the shared queue with inline confirmation, land on the exact billing triage row, and still link back into the canonical program funding lane.
