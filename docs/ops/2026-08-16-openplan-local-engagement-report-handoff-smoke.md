# OpenPlan Local Engagement Report Handoff Smoke — 2026-08-16

## Local Targets
- App URL: http://localhost:3200
- Supabase URL: http://127.0.0.1:54321
- Local guard result: Local guard passed for local Engagement report handoff smoke: app=http://localhost:3200, supabase=http://127.0.0.1:54321.

## Mutation Summary
- Created one local QA auth user and one project workspace, then wrote an engagement campaign, moderation category, public feedback item, handoff report, report section, and generated report artifact.

## Cleanup / Idempotency Posture
- Local-only guard runs before service-role auth mutation and refuses Vercel, Supabase cloud, and arbitrary remote targets.
- This timestamped workflow smoke intentionally creates fresh local proof records on each run. It is safe to rerun against local Supabase, but old local QA users/workspaces/records remain until the local database is reset or cleaned manually.

## Key IDs
- QA user email: openplan-local-engagement-handoff-2026-08-16T00-12-28-219Z@natfordplanning.com
- QA user id: fb056016-62d4-4c93-b9cb-03c19006b571
- Workspace id: 8af1b244-8191-4f6c-9fdb-3c8a1d1f64e9
- Project id: b42b0f28-a4ab-44d1-b425-6ff31fd3af51
- Campaign id: 4c254d10-7971-4d28-8647-f93f701907e0
- Category id: c1742f15-dc85-44f1-94ad-3f53d252e979
- Engagement item id: aae4ddb0-e265-4b59-af72-2a32817617e8
- Report id: 7b842a57-8058-4546-8cfa-d8beb0c6a9d3
- Report section id: 65a72e9f-f524-4690-b6ef-6bb75480cb3c
- Artifact id: 279ce548-afc8-47ad-8b11-fed97ac76d85
- Share token: f0ze1mvul70lm0p4ola7io621xeu

## Pass/Fail Notes
- PASS: Local guard passed for local Engagement report handoff smoke: app=http://localhost:3200, supabase=http://127.0.0.1:54321.
- PASS: Created QA auth user openplan-local-engagement-handoff-2026-08-16T00-12-28-219Z@natfordplanning.com.
- PASS: Signed into the local app successfully.
- PASS: Created project workspace Local Engagement Handoff Smoke 001228.
- PASS: Created linked engagement campaign Local Public Feedback Campaign 001228.
- PASS: Created moderation category School access 001228.
- PASS: Activated public engagement portal with a server-minted share token (28 chars).
- PASS: Submitted public feedback through the share portal and received the public success state.
- PASS: Verified the public item persisted as pending, categorized, and source_type=public.
- PASS: Approved the public item through the staff moderation registry and verified durable status.
- PASS: Verified approved feedback is visible on the public Community feedback tab.
- PASS: Created a handoff report, and found its summary in the page chrome and its section list under the evidence tab.
- PASS: Verified report section provenance froze the campaign id and handoff-ready count.
- PASS: Generated an HTML packet and verified handoff provenance plus live engagement counts in the artifact preview.
- PASS: Verified the report artifact source context preserved engagement item counts.

## Artifacts
- 2026-08-16-local-engagement-report-handoff-01-public-submit.png
- 2026-08-16-local-engagement-report-handoff-02-moderation-approved.png
- 2026-08-16-local-engagement-report-handoff-03-public-feedback-published.png
- 2026-08-16-local-engagement-report-handoff-04-generated-artifact.png

## Verdict
- PASS: Local rendered/API smoke confirms public engagement intake, pending moderation persistence, staff approval, public feedback publication, handoff report provenance, HTML packet generation, and artifact source-context traceability through the shared project/campaign/report spine.
