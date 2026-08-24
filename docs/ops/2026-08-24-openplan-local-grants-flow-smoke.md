# OpenPlan Local Grants Flow Smoke — 2026-08-24

## Local Targets
- App URL: http://localhost:3200
- Supabase URL: http://127.0.0.1:54321
- Local guard result: Local guard passed for local Grants flow smoke: app=http://localhost:3200, supabase=http://127.0.0.1:54321.

## Mutation Summary
- Created one local QA auth user and one project workspace, then wrote the project funding profile, program, opportunity, award, invoice, award closeout, and derived milestone/posture rows required by the Grants flow.

## Cleanup / Idempotency Posture
- Local-only guard runs before service-role auth mutation and refuses Vercel, Supabase cloud, and arbitrary remote targets.
- This timestamped workflow smoke intentionally creates fresh local proof records on each run. It is safe to rerun against local Supabase, but old local QA users/workspaces/records remain until the local database is reset or cleaned manually.

## Key IDs
- QA user email: openplan-local-grants-flow-2026-08-24T18-22-35-332Z@natfordplanning.com
- QA user id: fa17eb58-7cbd-4965-a99d-bf850db398f3
- Workspace id: 9a3657da-ba51-44af-9261-71d4f18b2328
- Project id: 47e8d476-4569-4e63-a70e-530a3138a719
- Program id: 169844d4-da86-4efe-89dc-c1d1db50b9d6
- Opportunity id: 4499e254-0cfa-487f-9512-83af645b2a08
- Award id: 5ab5a9d5-29bf-4bda-bd99-2bfc95b85727
- Invoice id: 55d882ba-20e6-4c93-8354-8385ede355da
- Obligation milestone id: 97f2bc12-c3f1-46f8-872a-5c444cde2b51
- Closeout milestone id: e0172536-342b-41ff-8030-3a7facc97861

## Pass/Fail Notes
- PASS: Local guard passed for local Grants flow smoke: app=http://localhost:3200, supabase=http://127.0.0.1:54321.
- PASS: Created QA auth user openplan-local-grants-flow-2026-08-24T18-22-35-332Z@natfordplanning.com.
- PASS: Signed into the local app successfully.
- PASS: Created project workspace Local Grants Flow Smoke 182235.
- PASS: Saved a project funding profile with a known need and local match.
- PASS: Created the funding program that owns the opportunity and award.
- PASS: Created an awarded funding opportunity linked to the project and program.
- PASS: Converted the awarded opportunity into a committed funding award.
- PASS: Verified the award write-back persisted funded RTP posture on the project.
- PASS: Verified the award emitted a scheduled obligation milestone.
- PASS: Created a paid, award-linked reimbursement invoice covering the full award.
- PASS: Closed out the award after 100% paid invoice coverage.
- PASS: Verified closeout persisted a complete closeout milestone.
- PASS: Verified closeout rebuilt project RTP posture with paid reimbursement status.

## Artifacts
- 2026-08-24-local-grants-flow-01-award-posture.png
- 2026-08-24-local-grants-flow-02-project-closeout.png

## Verdict
- PASS: Local rendered/API smoke confirms the Grants OS flow from project funding need to awarded opportunity, committed award, project RTP posture write-back, obligation milestone, paid reimbursement invoice, closeout reconciliation, closeout milestone, and project-detail funded/reimbursed posture.
