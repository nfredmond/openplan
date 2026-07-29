# OpenPlan Local Grants Flow Smoke — 2026-07-28

## Local Targets
- App URL: http://localhost:3001
- Supabase URL: http://127.0.0.1:54321
- Local guard result: Local guard passed for local Grants flow smoke: app=http://localhost:3001, supabase=http://127.0.0.1:54321.

## Mutation Summary
- Created one local QA auth user and one project workspace, then wrote the project funding profile, program, opportunity, award, invoice, award closeout, and derived milestone/posture rows required by the Grants flow.

## Cleanup / Idempotency Posture
- Local-only guard runs before service-role auth mutation and refuses Vercel, Supabase cloud, and arbitrary remote targets.
- This timestamped workflow smoke intentionally creates fresh local proof records on each run. It is safe to rerun against local Supabase, but old local QA users/workspaces/records remain until the local database is reset or cleaned manually.

## Key IDs
- QA user email: openplan-local-grants-flow-2026-07-28T18-29-04-037Z@natfordplanning.com
- QA user id: 4104ff44-f870-423a-9582-68f13bf875af
- Workspace id: de4af1cc-b673-45af-af1d-409264392408
- Project id: 8216da2a-78a1-4608-83fc-c096b2e2c6e0
- Program id: 65ba322f-9fac-473b-995d-caafbbb2b6a8
- Opportunity id: d332e9b6-a284-4b34-b560-0dd368fd7aa9
- Award id: 240871f6-7d49-4da2-9bfb-dd36d9e84e3b
- Invoice id: cf41bfa3-855f-40f6-879c-37233f8cab40
- Obligation milestone id: 976ff75e-978c-4e90-9c74-185648d39ff2
- Closeout milestone id: 0a1b48b9-b56f-4e89-a9c0-a28fbfe5fa2b

## Pass/Fail Notes
- PASS: Local guard passed for local Grants flow smoke: app=http://localhost:3001, supabase=http://127.0.0.1:54321.
- PASS: Created QA auth user openplan-local-grants-flow-2026-07-28T18-29-04-037Z@natfordplanning.com.
- PASS: Signed into the local app successfully.
- PASS: Created project workspace Local Grants Flow Smoke 182904.
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
- 2026-07-28-local-grants-flow-01-award-posture.png
- 2026-07-28-local-grants-flow-02-project-closeout.png

## Verdict
- PASS: Local rendered/API smoke confirms the Grants OS flow from project funding need to awarded opportunity, committed award, project RTP posture write-back, obligation milestone, paid reimbursement invoice, closeout reconciliation, closeout milestone, and project-detail funded/reimbursed posture.
