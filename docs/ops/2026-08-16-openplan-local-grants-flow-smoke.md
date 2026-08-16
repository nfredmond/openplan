# OpenPlan Local Grants Flow Smoke — 2026-08-16

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
- QA user email: openplan-local-grants-flow-2026-08-16T00-11-54-171Z@natfordplanning.com
- QA user id: 87385324-c6f2-43a1-93d8-bc0a8d0532af
- Workspace id: 0e3efeff-f383-4cc8-a2f0-3a072c36d8f9
- Project id: 4bca9789-33f7-4382-937c-14e6de6e660f
- Program id: 2379ed93-25e6-4af4-b658-9d1e37631864
- Opportunity id: 484e1c9e-5ae6-47e4-932b-bcb62fafd5f3
- Award id: e9255222-e3c5-4da3-92d7-8bb7435e9cbb
- Invoice id: 543864ba-a9b2-428d-b60d-26c68846e6c8
- Obligation milestone id: cd628946-de58-4b28-b6eb-55b24be5d190
- Closeout milestone id: a821ac6e-e5db-49e6-8610-7c2c36ee9486

## Pass/Fail Notes
- PASS: Local guard passed for local Grants flow smoke: app=http://localhost:3200, supabase=http://127.0.0.1:54321.
- PASS: Created QA auth user openplan-local-grants-flow-2026-08-16T00-11-54-171Z@natfordplanning.com.
- PASS: Signed into the local app successfully.
- PASS: Created project workspace Local Grants Flow Smoke 001154.
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
- 2026-08-16-local-grants-flow-01-award-posture.png
- 2026-08-16-local-grants-flow-02-project-closeout.png

## Verdict
- PASS: Local rendered/API smoke confirms the Grants OS flow from project funding need to awarded opportunity, committed award, project RTP posture write-back, obligation milestone, paid reimbursement invoice, closeout reconciliation, closeout milestone, and project-detail funded/reimbursed posture.
