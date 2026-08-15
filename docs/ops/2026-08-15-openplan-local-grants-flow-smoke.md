# OpenPlan Local Grants Flow Smoke — 2026-08-15

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
- QA user email: openplan-local-grants-flow-2026-08-15T22-19-03-846Z@natfordplanning.com
- QA user id: 4a96deab-287a-4986-bba4-95e9d57b61ad
- Workspace id: 920ebf13-7cb6-489c-923d-4103bc941001
- Project id: 428aa515-d30f-498d-8506-63a3c743c544
- Program id: 64e60be3-a81c-423e-847f-842ae782e53e
- Opportunity id: 662dd3bf-34e6-44d9-9a1a-cccafe53cee4
- Award id: 5bc8474e-d223-4a6e-b0a7-be717988833f
- Invoice id: 489d1c3f-1426-4de5-8e46-78c69fbcaa4e
- Obligation milestone id: d0d8bf2c-7b2d-4edd-a325-b8756a748cb5
- Closeout milestone id: a396377a-1b00-4275-bd51-d6ad18805826

## Pass/Fail Notes
- PASS: Local guard passed for local Grants flow smoke: app=http://localhost:3200, supabase=http://127.0.0.1:54321.
- PASS: Created QA auth user openplan-local-grants-flow-2026-08-15T22-19-03-846Z@natfordplanning.com.
- PASS: Signed into the local app successfully.
- PASS: Created project workspace Local Grants Flow Smoke 221903.
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
- 2026-08-15-local-grants-flow-01-award-posture.png
- 2026-08-15-local-grants-flow-02-project-closeout.png

## Verdict
- PASS: Local rendered/API smoke confirms the Grants OS flow from project funding need to awarded opportunity, committed award, project RTP posture write-back, obligation milestone, paid reimbursement invoice, closeout reconciliation, closeout milestone, and project-detail funded/reimbursed posture.
