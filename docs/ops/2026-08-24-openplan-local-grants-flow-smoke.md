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
- QA user email: openplan-local-grants-flow-2026-08-24T20-01-55-163Z@natfordplanning.com
- QA user id: c36dd6a7-9fba-4cd0-9efe-16ecd7d5cb64
- Workspace id: cf5e6f53-f345-4028-8f6b-ea47c444b82a
- Project id: 9b0217eb-d750-407c-90e7-bb2432df5ed4
- Program id: 688481ad-914f-4073-83b3-d0faf9eff20b
- Opportunity id: dbf829ae-36ee-4047-9e90-a232b47b66d4
- Award id: a1e9b034-0c62-4437-8949-891acb1ef303
- Invoice id: 563d6682-3288-47fc-8a17-fd2eb3eaae8a
- Obligation milestone id: d53f4263-c7e6-41f0-ad03-687e36c496b6
- Closeout milestone id: be09e887-bcb9-4780-bf74-ac9e15764991

## Pass/Fail Notes
- PASS: Local guard passed for local Grants flow smoke: app=http://localhost:3200, supabase=http://127.0.0.1:54321.
- PASS: Created QA auth user openplan-local-grants-flow-2026-08-24T20-01-55-163Z@natfordplanning.com.
- PASS: Signed into the local app successfully.
- PASS: Created project workspace Local Grants Flow Smoke 200155.
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
